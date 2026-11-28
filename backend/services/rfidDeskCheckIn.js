"use strict";

const crypto = require("crypto");
const staffCheckIn = require("./staffCheckIn");
const staffRfidEvents = require("./staffRfidEvents");
const branchCheckIn = require("./branchCheckIn");
const branchAccess = require("./branchAccess");
const rfidScanErrors = require("./rfidScanErrors");
const { safeRollback, logCheckInFailure, checkInFailureResponse } = require("./postgresTxn");
const { safeRecalculateQueueWaitEstimates } = require("./queueWaitPrediction");

function resolvedDeviceSecret(env = process.env) {
  return String(env.RFID_DEVICE_SECRET || "").trim();
}

function deviceSecretConfigured(env = process.env) {
  return Boolean(resolvedDeviceSecret(env));
}

function deviceKeyMatches(provided, env = process.env) {
  const expected = resolvedDeviceSecret(env);
  const given = String(provided || "").trim();
  if (!expected || !given) return false;
  const left = crypto.createHash("sha256").update(expected).digest();
  const right = crypto.createHash("sha256").update(given).digest();
  return crypto.timingSafeEqual(left, right);
}

function readProvidedDeviceKey(req) {
  return req.get("x-rfid-device-key") || req.get("x-device-key") || req.body?.deviceKey || req.body?.secret;
}

function authorizePublicRfidRequest(req, env = process.env) {
  if (!deviceSecretConfigured(env)) {
    return {
      ok: false,
      status: 503,
      body: {
        message: "RFID device check-in is not configured. Set RFID_DEVICE_SECRET on the API service.",
      },
    };
  }
  if (!deviceKeyMatches(readProvidedDeviceKey(req), env)) {
    return {
      ok: false,
      status: 403,
      body: { message: "RFID reader is not authorized." },
    };
  }
  return { ok: true };
}

function mapSuccess(appointment, checkIn, walkInCreated) {
  return {
    message: checkIn.alreadyCheckedIn
      ? "Patient already checked in."
      : walkInCreated
        ? "Walk-in patient checked in successfully."
        : "Patient checked in successfully.",
    method: "rfid",
    walkInCreated: Boolean(walkInCreated),
    verified: true,
    patient: {
      id: appointment.user_id,
      fullName: appointment.patient_name || "Patient",
      phone: appointment.patient_phone || null,
      email: appointment.patient_email || null,
    },
    appointment: {
      id: appointment.id,
      service: appointment.service_name,
      dentist: appointment.dentist_name,
      date: appointment.appointment_date,
      time: appointment.appointment_time,
      status: "checked_in",
    },
    queue: {
      id: checkIn.queueEntry.id,
      token: checkIn.queueEntry.token,
      queueNumber: checkIn.queueEntry.token,
      position: checkIn.queueEntry.position,
      status: checkIn.queueEntry.status,
      waitMinutes: Number(checkIn.queueEntry.estimated_wait_minutes || 0),
      checkedInAt: checkIn.queueEntry.checked_in_at || new Date().toISOString(),
    },
  };
}

function failScan({ tag, branchId, status, message, errorCode, patient }) {
  staffRfidEvents.recordRfidEvent({
    rfidTag: tag,
    method: "rfid",
    branchId,
    status: "failed",
    message,
    errorCode,
    patient: patient || null,
  });
  return { ok: false, status, message, errorCode, patient: patient || undefined };
}

async function resolveReaderBranchId(client, reader) {
  if (reader?.legacy) {
    return branchAccess.mainBranchId(client);
  }
  return reader?.branch_id || null;
}

// The reader firmware does not send a branch. The authorized clinic_rfid_readers
// row supplies the branch. A request body cannot choose a different branch.
// Reader and card assignment are evaluated before appointment or walk-in slots.
async function checkInByRfidTag(db, { rfidTag, notifyClinicStaff, notifyClinicDentists }) {
  const tag = staffCheckIn.normalizeRfidTag(rfidTag);
  if (!tag) {
    return { ok: false, status: 400, message: "Tap a patient RFID card on the reader to check in." };
  }

  const client = await db.connect();
  let transactionOpen = false;
  let readerBranchId = null;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('patient_portal_queue'))");

    const reader = await branchCheckIn.resolveAuthorizedReader(client);
    readerBranchId = await resolveReaderBranchId(client, reader);
    if (!readerBranchId) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return failScan({
        tag,
        branchId: null,
        status: 409,
        message: rfidScanErrors.RFID_READER_UNCONFIGURED_MESSAGE,
        errorCode: rfidScanErrors.RFID_ERROR_CODES.READER_UNCONFIGURED,
      });
    }
    if (!reader?.legacy && reader?.rfid_enabled === false) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return failScan({
        tag,
        branchId: readerBranchId,
        status: 409,
        message: rfidScanErrors.RFID_READER_DISABLED_MESSAGE,
        errorCode: rfidScanErrors.RFID_ERROR_CODES.READER_DISABLED,
      });
    }

    const holder = await staffCheckIn.findRfidCardHolder(client, tag);
    const eligiblePatient =
      holder &&
      String(holder.role || "").toLowerCase() === "patient" &&
      !rfidScanErrors.isInactivePatientStatus(holder)
        ? holder
        : null;

    if (!eligiblePatient) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      if (holder && String(holder.role || "").toLowerCase() === "patient") {
        return failScan({
          tag,
          branchId: readerBranchId,
          status: 403,
          message: rfidScanErrors.RFID_INACTIVE_MESSAGE,
          errorCode: rfidScanErrors.RFID_ERROR_CODES.INACTIVE,
          patient: rfidScanErrors.patientSummary(holder),
        });
      }
      return failScan({
        tag,
        branchId: readerBranchId,
        status: 404,
        message: rfidScanErrors.RFID_UNASSIGNED_MESSAGE,
        errorCode: rfidScanErrors.RFID_ERROR_CODES.UNASSIGNED,
      });
    }

    if (!eligiblePatient.is_verified) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      return failScan({
        tag,
        branchId: readerBranchId,
        status: 403,
        message: "Patient account is not verified yet.",
        patient: rfidScanErrors.patientSummary(eligiblePatient),
      });
    }

    const resolved = await staffCheckIn.resolveAppointmentForCheckIn(client, eligiblePatient, {
      allowWalkIn: true,
      branchId: readerBranchId,
    });
    if (!resolved.appointment) {
      let diagnosis = null;
      try {
        diagnosis = await staffCheckIn.diagnoseMissingCheckInAppointment(client, eligiblePatient);
      } catch (diagnoseError) {
        console.warn("Check-in diagnosis failed:", diagnoseError.message);
      }
      await client.query("ROLLBACK");
      transactionOpen = false;
      const message = diagnosis?.hint
        ? `No eligible appointment found for this patient today. ${diagnosis.hint}`
        : "No eligible appointment found for this patient today.";
      return {
        ...failScan({
          tag,
          branchId: readerBranchId,
          status: 404,
          message,
          patient: rfidScanErrors.patientSummary(eligiblePatient),
        }),
        diagnosis,
      };
    }

    const checkIn = await staffCheckIn.performStaffCheckIn(client, {
      appointment: resolved.appointment,
      staff: null,
      notifyClinicStaff,
      notifyClinicDentists,
      checkInMethod: "rfid",
      branchId: readerBranchId,
    });
    await client.query("COMMIT");
    transactionOpen = false;
    if (typeof db.query === "function") {
      safeRecalculateQueueWaitEstimates(db, {
        fromPosition: 1,
        branchId: readerBranchId,
      }).catch((estimateError) => {
        console.warn("RFID check-in wait estimate skipped:", estimateError.message);
      });
    }

    const payload = mapSuccess(resolved.appointment, checkIn, resolved.walkInCreated);
    staffRfidEvents.recordRfidEvent({
      rfidTag: tag,
      method: "rfid",
      branchId: readerBranchId,
      status: "success",
      message: payload.message,
      patient: payload.patient,
      appointment: payload.appointment,
      queue: payload.queue,
      walkInCreated: payload.walkInCreated,
    });
    return { ok: true, status: checkIn.alreadyCheckedIn ? 200 : 201, payload };
  } catch (error) {
    if (transactionOpen) {
      await safeRollback(client);
    }
    const failure = checkInFailureResponse(error);
    const errorCode = rfidScanErrors.classifyCheckInError(error) || failure.errorCode;
    if (failure.status >= 500 || failure.code === "SETUP_REQUIRED") {
      logCheckInFailure("RFID desk check-in", error);
    }
    staffRfidEvents.recordRfidEvent({
      rfidTag: tag,
      method: "rfid",
      branchId: readerBranchId,
      status: "failed",
      message: failure.message,
      errorCode,
    });
    if (failure.status < 500 || error.status) {
      return { ok: false, status: failure.status, message: failure.message, errorCode, code: failure.code };
    }
    const wrapped = new Error(failure.message);
    wrapped.status = failure.status;
    wrapped.code = failure.code;
    wrapped.errorCode = errorCode;
    throw wrapped;
  } finally {
    client.release();
  }
}

module.exports = {
  resolvedDeviceSecret,
  deviceSecretConfigured,
  deviceKeyMatches,
  readProvidedDeviceKey,
  authorizePublicRfidRequest,
  checkInByRfidTag,
};
