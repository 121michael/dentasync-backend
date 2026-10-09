"use strict";

const crypto = require("crypto");
const staffCheckIn = require("./staffCheckIn");
const staffRfidEvents = require("./staffRfidEvents");

function deviceSecretConfigured(env = process.env) {
  return Boolean(String(env.RFID_DEVICE_SECRET || "").trim());
}

function deviceKeyMatches(provided, env = process.env) {
  const expected = String(env.RFID_DEVICE_SECRET || "").trim();
  const given = String(provided || "").trim();
  if (!expected || !given) return false;
  const left = crypto.createHash("sha256").update(expected).digest();
  const right = crypto.createHash("sha256").update(given).digest();
  return crypto.timingSafeEqual(left, right);
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

async function checkInByRfidTag(db, { rfidTag, notifyClinicStaff, notifyClinicDentists }) {
  const tag = staffCheckIn.normalizeRfidTag(rfidTag);
  if (!tag) {
    return { ok: false, status: 400, message: "Tap a patient RFID card on the reader to check in." };
  }

  const client = await db.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('patient_portal_queue'))");

    const patient = await staffCheckIn.findPatient(client, { rfidTag: tag });
    if (!patient) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      staffRfidEvents.recordRfidEvent({
        rfidTag: tag,
        method: "rfid",
        status: "failed",
        message: "RFID not recognized. Ask Admin to assign this card to the patient account.",
      });
      return {
        ok: false,
        status: 404,
        message: "RFID not recognized. Ask Admin to assign this card to the patient account.",
      };
    }

    if (!patient.is_verified) {
      await client.query("ROLLBACK");
      transactionOpen = false;
      const fullName = `${patient.first_name || ""} ${patient.last_name || ""}`.trim();
      staffRfidEvents.recordRfidEvent({
        rfidTag: tag,
        method: "rfid",
        status: "failed",
        message: "Patient account is not verified yet.",
        patient: { id: patient.id, fullName },
      });
      return {
        ok: false,
        status: 403,
        message: "Patient account is not verified yet.",
        patient: { id: patient.id, fullName },
      };
    }

    const resolved = await staffCheckIn.resolveAppointmentForCheckIn(client, patient, {
      allowWalkIn: true,
    });
    if (!resolved.appointment) {
      let diagnosis = null;
      try {
        diagnosis = await staffCheckIn.diagnoseMissingCheckInAppointment(client, patient);
      } catch (diagnoseError) {
        console.warn("Check-in diagnosis failed:", diagnoseError.message);
      }
      await client.query("ROLLBACK");
      transactionOpen = false;
      const message = diagnosis?.hint
        ? `No eligible appointment found for this patient today. ${diagnosis.hint}`
        : "No eligible appointment found for this patient today.";
      staffRfidEvents.recordRfidEvent({
        rfidTag: tag,
        method: "rfid",
        status: "failed",
        message,
        patient: {
          id: patient.id,
          fullName: `${patient.first_name || ""} ${patient.last_name || ""}`.trim(),
        },
      });
      return { ok: false, status: 404, message, diagnosis };
    }

    const checkIn = await staffCheckIn.performStaffCheckIn(client, {
      appointment: resolved.appointment,
      staff: null,
      notifyClinicStaff,
      notifyClinicDentists,
      checkInMethod: "rfid",
    });
    await client.query("COMMIT");
    transactionOpen = false;

    const payload = mapSuccess(resolved.appointment, checkIn, resolved.walkInCreated);
    staffRfidEvents.recordRfidEvent({
      rfidTag: tag,
      method: "rfid",
      status: "success",
      message: payload.message,
      patient: payload.patient,
      appointment: payload.appointment,
      queue: payload.queue,
    });
    return { ok: true, status: checkIn.alreadyCheckedIn ? 200 : 201, payload };
  } catch (error) {
    if (transactionOpen) {
      await client.query("ROLLBACK");
    }
    staffRfidEvents.recordRfidEvent({
      rfidTag: tag,
      method: "rfid",
      status: "failed",
      message: error.message || "Unable to complete patient check-in.",
    });
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  deviceSecretConfigured,
  deviceKeyMatches,
  checkInByRfidTag,
};
