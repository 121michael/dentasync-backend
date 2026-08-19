"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const express = require("express");
const clinicalPatients = require("../services/clinicalPatients");

const QUEUE_STATUS_MAP = {
  checked_in: "checked_in",
  waiting: "waiting",
  preparing: "preparing",
  in_chair: "dentist",
  dentist: "dentist",
  completed: "completed",
  no_show: "no_show",
};
const APPOINTMENT_ACTIONS = new Set(["approve", "deny", "cancel", "reschedule"]);

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeEmail(value) {
  const email = stringValue(value, 254)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function normalizePhone(value) {
  if (typeof value !== "string" && typeof value !== "number") {
    return null;
  }

  const digits = String(value).replace(/\D/g, "");
  if (!digits) {
    return null;
  }

  return /^0\d{10}$/.test(digits) ? `63${digits.slice(1)}` : digits;
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isTime(value) {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) {
    return false;
  }

  const [hours, minutes] = value.split(":").map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

function isTodayOrLater(value) {
  return isIsoDate(value) && value >= new Date().toISOString().slice(0, 10);
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function count(row, key) {
  return Number.parseInt(row?.[key] || "0", 10);
}

function displayQueueStatus(status) {
  return status === "dentist" ? "in_chair" : status;
}

function mapCheckIn(row) {
  return {
    id: row.id,
    token: row.token,
    queueNumber: row.position,
    timestamp: row.checked_in_at,
    patientId: row.patient_id,
    patientName: row.patient_name || "Patient",
    appointment: {
      id: row.appointment_id,
      treatment: row.service_name || "Dental visit",
      dentist: row.dentist_name || "Unassigned",
      date: row.appointment_date || null,
      time: row.appointment_time || null,
    },
    status: displayQueueStatus(row.status),
    waitMinutes: Number(row.estimated_wait_minutes || 0),
  };
}

function mapAppointment(row) {
  return {
    id: row.id,
    patientId: row.user_id,
    patientName: row.patient_name || "Patient",
    patientPhone: row.patient_phone || null,
    treatment: row.service_name,
    dentistId: row.dentist_id,
    dentist: row.dentist_name,
    date: row.appointment_date,
    time: row.appointment_time,
    location: row.clinic_location,
    status: row.status,
    notes: row.notes || "",
    createdAt: row.created_at,
  };
}

function mapPatient(row) {
  return {
    id: row.id,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    fullName: row.patient_name || `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    lastVisit: row.last_visit || null,
    status: (row.account_status || "active").toLowerCase(),
    verified: Boolean(row.is_verified),
  };
}

function csvCell(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

async function notifyPatient(client, { userId, type, title, body }) {
  try {
    await client.query(
      `INSERT INTO patient_portal_notifications (user_id, type, title, body)
       VALUES ($1, $2, $3, $4)`,
      [String(userId), type, title, body]
    );
  } catch (error) {
    // Keep the operational update available while a rolling deployment is
    // waiting for the patient portal migration.
    if (error.code !== "42P01") {
      throw error;
    }
  }
}

function requireStaffAccount(db) {
  return async (req, res, next) => {
    const tokenUserId = req.user?.id;
    if (!tokenUserId) {
      return res.status(401).json({ message: "A valid staff session is required." });
    }

    try {
      const result = await db.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified
         FROM users
         WHERE id = $1
           AND LOWER(role) = 'staff'
           AND is_verified = TRUE
           AND COALESCE(is_archived, FALSE) = FALSE
           AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')
         LIMIT 1`,
        [String(tokenUserId)]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          message: "This dashboard is available to active staff accounts only.",
        });
      }

      // The database record is the authorization source of truth. The JWT's
      // role claim is never used to grant staff portal access.
      req.staff = result.rows[0];
      return next();
    } catch (error) {
      console.error("Staff authorization error:", error.message);
      return res.status(500).json({ message: "Unable to validate staff access." });
    }
  };
}

function createStaffPortalRouter({
  db,
  authenticateToken,
  passwordResetService,
  notifyStaff = async () => {},
}) {
  const router = express.Router();

  router.use(authenticateToken, requireStaffAccount(db));

  router.get("/dashboard", async (_req, res) => {
    try {
      const [checkInResult, queueResult, pendingResult, unreadResult] = await Promise.all([
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_queue_entries
           WHERE DATE(checked_in_at) = CURRENT_DATE`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_queue_entries
           WHERE DATE(checked_in_at) = CURRENT_DATE
             AND status NOT IN ('completed', 'no_show')`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE status = 'pending'`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM staff_portal_notifications
           WHERE user_id = $1 AND read_at IS NULL`,
          [String(_req.staff.id)]
        ),
      ]);

      return res.json({
        date: new Date().toISOString().slice(0, 10),
        metrics: {
          todayCheckIns: count(checkInResult.rows[0], "count"),
          activeQueue: count(queueResult.rows[0], "count"),
          pendingRequests: count(pendingResult.rows[0], "count"),
          unreadNotifications: count(unreadResult.rows[0], "count"),
        },
      });
    } catch (error) {
      console.error("Staff dashboard error:", error.message);
      return res.status(500).json({ message: "Unable to load the staff dashboard." });
    }
  });

  router.get("/check-ins", async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT
           queue.id,
           queue.token,
           queue.position,
           queue.status,
           queue.estimated_wait_minutes,
           queue.checked_in_at,
           queue.appointment_id,
           appointment.service_name,
           appointment.dentist_name,
           appointment.appointment_date,
           appointment.appointment_time,
           patient.id AS patient_id,
           CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name
         FROM patient_portal_queue_entries AS queue
         JOIN users AS patient ON patient.id::text = queue.user_id
         LEFT JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
         WHERE DATE(queue.checked_in_at) = CURRENT_DATE
         ORDER BY queue.checked_in_at DESC, queue.position ASC`
      );
      return res.json({
        updatedAt: new Date().toISOString(),
        checkIns: result.rows.map(mapCheckIn),
      });
    } catch (error) {
      console.error("Staff check-in log error:", error.message);
      return res.status(500).json({ message: "Unable to load today's check-in log." });
    }
  });

  router.get("/queue", async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT
           queue.id,
           queue.token,
           queue.position,
           queue.status,
           queue.estimated_wait_minutes,
           queue.checked_in_at,
           queue.appointment_id,
           appointment.service_name,
           appointment.dentist_name,
           appointment.appointment_date,
           appointment.appointment_time,
           patient.id AS patient_id,
           CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name
         FROM patient_portal_queue_entries AS queue
         JOIN users AS patient ON patient.id::text = queue.user_id
         LEFT JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
         WHERE DATE(queue.checked_in_at) = CURRENT_DATE
         ORDER BY
           CASE WHEN queue.status IN ('completed', 'no_show') THEN 1 ELSE 0 END,
           queue.position ASC`
      );
      return res.json({
        updatedAt: new Date().toISOString(),
        queue: result.rows.map(mapCheckIn),
      });
    } catch (error) {
      console.error("Staff queue error:", error.message);
      return res.status(500).json({ message: "Unable to load the live queue." });
    }
  });

  router.patch("/queue/:id", async (req, res) => {
    const queueId = numericId(req.params.id);
    const submittedStatus = stringValue(req.body?.status, 40)?.toLowerCase();
    const databaseStatus = QUEUE_STATUS_MAP[submittedStatus];
    const suppliedWait = req.body?.waitMinutes;
    const waitMinutes =
      suppliedWait === undefined || suppliedWait === null || suppliedWait === ""
        ? null
        : Number.parseInt(suppliedWait, 10);

    if (!queueId || !databaseStatus) {
      return res.status(400).json({ message: "Choose a valid queue status." });
    }
    if (waitMinutes !== null && (!Number.isInteger(waitMinutes) || waitMinutes < 0 || waitMinutes > 720)) {
      return res.status(400).json({ message: "Wait time must be between 0 and 720 minutes." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const currentResult = await client.query(
        `SELECT id, user_id, appointment_id, token, position, status, estimated_wait_minutes
         FROM patient_portal_queue_entries
         WHERE id = $1
         FOR UPDATE`,
        [queueId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Queue entry not found." });
      }

      const updatedResult = await client.query(
        `UPDATE patient_portal_queue_entries
         SET status = $1,
             estimated_wait_minutes = COALESCE($2, estimated_wait_minutes),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3
         RETURNING *`,
        [databaseStatus, waitMinutes, queueId]
      );

      if (current.appointment_id) {
        const appointmentStatus =
          databaseStatus === "completed"
            ? "completed"
            : databaseStatus === "no_show"
              ? "no_show"
              : "checked_in";
        await client.query(
          `UPDATE patient_portal_appointments
           SET status = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [appointmentStatus, current.appointment_id]
        );
      }

      const patientMessage =
        databaseStatus === "completed"
          ? "Your visit has been marked as completed. Thank you for visiting Amethyst Dental."
          : databaseStatus === "no_show"
            ? "Your appointment was marked as a no-show. Please contact the clinic if this is incorrect."
            : `Your queue status is now ${displayQueueStatus(databaseStatus).replaceAll("_", " ")}.`;
      await notifyPatient(client, {
        userId: current.user_id,
        type: "queue",
        title: "Queue status updated",
        body: patientMessage,
      });

      await client.query("COMMIT");
      transactionOpen = false;
      return res.json({
        queueEntry: {
          id: updatedResult.rows[0].id,
          token: updatedResult.rows[0].token,
          position: updatedResult.rows[0].position,
          status: displayQueueStatus(updatedResult.rows[0].status),
          waitMinutes: Number(updatedResult.rows[0].estimated_wait_minutes || 0),
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Staff queue update error:", error.message);
      return res.status(500).json({ message: "Unable to update the queue entry." });
    } finally {
      client.release();
    }
  });

  router.get("/appointments", async (_req, res) => {
    try {
      const [todayResult, pendingResult] = await Promise.all([
        db.query(
          `SELECT
             appointment.*,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             patient.phone AS patient_phone
           FROM patient_portal_appointments AS appointment
           JOIN users AS patient ON patient.id::text = appointment.user_id
           WHERE appointment.appointment_date = CURRENT_DATE
             AND appointment.status IN ('confirmed', 'checked_in', 'completed')
           ORDER BY appointment.appointment_time ASC`
        ),
        db.query(
          `SELECT
             appointment.*,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             patient.phone AS patient_phone
           FROM patient_portal_appointments AS appointment
           JOIN users AS patient ON patient.id::text = appointment.user_id
           WHERE appointment.status = 'pending'
           ORDER BY appointment.appointment_date ASC, appointment.appointment_time ASC
           LIMIT 100`
        ),
      ]);

      return res.json({
        todayAppointments: todayResult.rows.map(mapAppointment),
        pendingRequests: pendingResult.rows.map(mapAppointment),
      });
    } catch (error) {
      console.error("Staff appointments error:", error.message);
      return res.status(500).json({ message: "Unable to load appointments." });
    }
  });

  router.patch("/appointments/:id", async (req, res) => {
    const appointmentId = numericId(req.params.id);
    const action = stringValue(req.body?.action, 40)?.toLowerCase();

    if (!appointmentId || !APPOINTMENT_ACTIONS.has(action)) {
      return res.status(400).json({ message: "Choose a valid appointment action." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;
      const currentResult = await client.query(
        `SELECT *
         FROM patient_portal_appointments
         WHERE id = $1
         FOR UPDATE`,
        [appointmentId]
      );
      const current = currentResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Appointment not found." });
      }

      let nextStatus = current.status;
      let nextDate = current.appointment_date;
      let nextTime = current.appointment_time;
      let patientTitle = "Appointment updated";
      let patientBody = "";

      if (action === "approve") {
        nextStatus = "confirmed";
        patientTitle = "Appointment confirmed";
        patientBody = `Your ${current.service_name} appointment is confirmed for ${current.appointment_date} at ${String(current.appointment_time).slice(0, 5)}.`;
      } else if (action === "deny" || action === "cancel") {
        nextStatus = "cancelled";
        patientTitle = action === "deny" ? "Appointment request declined" : "Appointment cancelled";
        patientBody =
          action === "deny"
            ? "Your appointment request could not be approved. Please choose another available time."
            : "Your appointment has been cancelled. Contact the clinic if you need assistance.";
      } else {
        const requestedDate = stringValue(req.body?.appointmentDate, 10);
        const requestedTime = stringValue(req.body?.appointmentTime, 5);
        if (!isTodayOrLater(requestedDate) || !isTime(requestedTime)) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(400).json({
            message: "Choose a valid appointment date and time for the reschedule.",
          });
        }

        const conflict = await client.query(
          `SELECT id
           FROM patient_portal_appointments
           WHERE dentist_id = $1
             AND appointment_date = $2
             AND appointment_time = $3
             AND id <> $4
             AND status NOT IN ('cancelled', 'no_show')
           LIMIT 1`,
          [current.dentist_id, requestedDate, requestedTime, appointmentId]
        );
        if (conflict.rows.length) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(409).json({
            message: "That dentist already has an active appointment at the selected time.",
          });
        }

        nextStatus = "confirmed";
        nextDate = requestedDate;
        nextTime = requestedTime;
        patientTitle = "Appointment rescheduled";
        patientBody = `Your ${current.service_name} appointment is now scheduled for ${requestedDate} at ${requestedTime}.`;
      }

      const result = await client.query(
        `UPDATE patient_portal_appointments
         SET status = $1,
             appointment_date = $2,
             appointment_time = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4
         RETURNING *`,
        [nextStatus, nextDate, nextTime, appointmentId]
      );
      await notifyPatient(client, {
        userId: current.user_id,
        type: "appointment",
        title: patientTitle,
        body: patientBody,
      });

      await client.query("COMMIT");
      transactionOpen = false;

      const patientResult = await db.query(
        `SELECT CONCAT_WS(' ', first_name, last_name) AS patient_name, phone AS patient_phone
         FROM users
         WHERE id::text = $1
         LIMIT 1`,
        [String(current.user_id)]
      );
      return res.json({
        appointment: mapAppointment({
          ...result.rows[0],
          patient_name: patientResult.rows[0]?.patient_name,
          patient_phone: patientResult.rows[0]?.patient_phone,
        }),
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That dentist already has an active appointment at the selected time.",
        });
      }
      console.error("Staff appointment update error:", error.message);
      return res.status(500).json({ message: "Unable to update the appointment." });
    } finally {
      client.release();
    }
  });

  router.get("/dentist-availability", async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT id, dentist_id, dentist_name, availability_date, start_time, end_time, status
         FROM staff_portal_dentist_availability
         WHERE availability_date >= CURRENT_DATE
         ORDER BY availability_date ASC, start_time ASC, dentist_name ASC
         LIMIT 200`
      );
      return res.json({
        availability: result.rows.map((entry) => ({
          id: entry.id,
          dentistId: entry.dentist_id,
          dentistName: entry.dentist_name,
          date: entry.availability_date,
          startTime: entry.start_time,
          endTime: entry.end_time,
          status: entry.status,
        })),
      });
    } catch (error) {
      console.error("Dentist availability error:", error.message);
      return res.status(500).json({ message: "Unable to load dentist availability." });
    }
  });

  router.get("/patients", async (req, res) => {
    const search = stringValue(req.query.search, 100);
    try {
      const patients = await clinicalPatients.listClinicalRecords(db, { search, limit: 100 });
      return res.json({
        patients: patients.map((record) => ({
          id: record.id,
          recordCode: record.recordCode,
          firstName: record.firstName,
          lastName: record.lastName,
          fullName: record.fullName,
          patientName: record.fullName,
          email: record.email,
          phone: record.phone,
          dateOfBirth: record.dateOfBirth,
          gender: record.gender,
          lastVisit: record.lastTreatmentDate,
          accountStatus: record.linkedUserId ? "linked_account" : "clinical_record",
          isVerified: Boolean(record.linkedUserId),
          isClinicalRecord: true,
        })),
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Staff patient search error:", error.message);
      return res.status(500).json({ message: "Unable to load patient records." });
    }
  });

  router.post("/patients", async (req, res) => {
    try {
      const record = await clinicalPatients.createClinicalRecord(
        db,
        {
          firstName: req.body?.firstName,
          lastName: req.body?.lastName,
          email: req.body?.email,
          phone: req.body?.phone,
          dateOfBirth: req.body?.dateOfBirth,
          gender: req.body?.gender,
          address: req.body?.address,
          notes: [req.body?.emergencyContact, req.body?.medicalDentalNotes]
            .filter(Boolean)
            .join(" | "),
        },
        { id: req.staff.id, role: "staff" }
      );

      try {
        await notifyStaff({
          type: "patient",
          title: "Patient clinical record registered",
          body: `${record.fullName} was added to the clinical patient registry (not a login account).`,
          entityType: "clinical_patient",
          entityId: record.id,
        });
      } catch (notifyError) {
        console.warn("Staff registration notification was not created:", notifyError.message);
      }

      return res.status(201).json({
        message: "Patient clinical record created (not a login account).",
        patient: {
          ...record,
          patientName: record.fullName,
          accountStatus: "clinical_record",
          isClinicalRecord: true,
        },
        invitationSent: false,
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Staff patient registration error:", error.message);
      return res.status(error.status || 500).json({
        message: error.status ? error.message : "Unable to register the patient record.",
      });
    }
  });

  router.patch("/patients/:id", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }
    try {
      const record = await clinicalPatients.updateClinicalRecord(db, recordId, req.body || {}, {
        id: req.staff.id,
        role: "staff",
      });
      return res.json({
        message: "Patient record updated.",
        patient: { ...record, patientName: record.fullName, isClinicalRecord: true },
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        message: error.status ? error.message : "Unable to update the patient record.",
      });
    }
  });

  router.delete("/patients/:id", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }
    try {
      const record = await clinicalPatients.archiveClinicalRecord(db, recordId, {
        id: req.staff.id,
        role: "staff",
      });
      return res.json({
        message: "Patient record archived.",
        patient: { ...record, isClinicalRecord: true },
      });
    } catch (error) {
      return res.status(error.status || 500).json({
        message: error.status ? error.message : "Unable to archive the patient record.",
      });
    }
  });

  router.get("/patients/:id", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }

    try {
      const detail = await clinicalPatients.getClinicalRecord(db, recordId);
      if (!detail || detail.record.archived) {
        return res.status(404).json({ message: "Patient record not found." });
      }
      return res.json({
        patient: {
          ...detail.record,
          patientName: detail.record.fullName,
          accountStatus: detail.record.linkedUserId ? "linked_account" : "clinical_record",
          isClinicalRecord: true,
          createdAt: detail.record.createdAt,
          profile: {
            date_of_birth: detail.record.dateOfBirth,
            gender: detail.record.gender,
            address: detail.record.address,
            dental_concerns: detail.record.notes,
          },
          appointments: [],
          treatments: detail.treatments.map((record) => ({
            id: record.id,
            treatment: record.treatment,
            dentist: record.dentistName,
            date: record.treatmentDate,
            status: record.status,
            notes: record.notes || "",
          })),
        },
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Staff patient detail error:", error.message);
      return res.status(500).json({ message: "Unable to load the patient record." });
    }
  });

  router.get("/notifications", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, type, title, body, entity_type, entity_id, read_at, created_at
         FROM staff_portal_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [String(req.staff.id)]
      );
      return res.json({
        notifications: result.rows.map((notification) => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          body: notification.body,
          entityType: notification.entity_type,
          entityId: notification.entity_id,
          read: Boolean(notification.read_at),
          createdAt: notification.created_at,
        })),
      });
    } catch (error) {
      console.error("Staff notifications error:", error.message);
      return res.status(500).json({ message: "Unable to load notifications." });
    }
  });

  router.patch("/notifications/read-all", async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE staff_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND read_at IS NULL`,
        [String(req.staff.id)]
      );
      return res.json({ markedRead: result.rowCount || 0 });
    } catch (error) {
      console.error("Staff mark all notifications read error:", error.message);
      return res.status(500).json({ message: "Unable to update notifications." });
    }
  });

  router.patch("/notifications/:id/read", async (req, res) => {
    const notificationId = numericId(req.params.id);
    if (!notificationId) {
      return res.status(400).json({ message: "A valid notification is required." });
    }

    try {
      const result = await db.query(
        `UPDATE staff_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [notificationId, String(req.staff.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Notification not found." });
      }
      return res.json({ message: "Notification marked as read." });
    } catch (error) {
      console.error("Staff notification update error:", error.message);
      return res.status(500).json({ message: "Unable to update the notification." });
    }
  });

  router.get("/profile", (req, res) => {
    const staff = req.staff;
    return res.json({
      profile: {
        id: staff.id,
        firstName: staff.first_name || "",
        lastName: staff.last_name || "",
        fullName: `${staff.first_name || ""} ${staff.last_name || ""}`.trim(),
        email: staff.email || "",
        phone: staff.phone || "",
        role: "Staff / Secretary",
        accountStatus: (staff.status || "active").toLowerCase(),
      },
    });
  });

  router.put("/profile", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({ message: "Name, email address, and phone number are required." });
    }

    try {
      const result = await db.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, email = $3, phone = $4
         WHERE id = $5
           AND LOWER(role) = 'staff'
         RETURNING id, first_name, last_name, email, phone, status`,
        [firstName, lastName, email, phone, String(req.staff.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Staff profile not found." });
      }
      const staff = result.rows[0];
      return res.json({
        profile: {
          id: staff.id,
          firstName: staff.first_name,
          lastName: staff.last_name,
          fullName: `${staff.first_name} ${staff.last_name}`.trim(),
          email: staff.email,
          phone: staff.phone,
          role: "Staff / Secretary",
          accountStatus: (staff.status || "active").toLowerCase(),
        },
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({ message: "That email address or phone number is already in use." });
      }
      console.error("Staff profile update error:", error.message);
      return res.status(500).json({ message: "Unable to save the staff profile." });
    }
  });

  router.get("/export/:report", async (_req, res) => {
    const report = stringValue(_req.params.report, 30)?.toLowerCase();
    let headers;
    let rows;
    let fileName;

    try {
      if (report === "check-ins" || report === "queue") {
        const result = await db.query(
          `SELECT
             queue.token,
             queue.position,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             appointment.dentist_name,
             queue.status,
             queue.estimated_wait_minutes,
             queue.checked_in_at
           FROM patient_portal_queue_entries AS queue
           JOIN users AS patient ON patient.id::text = queue.user_id
           LEFT JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
           WHERE DATE(queue.checked_in_at) = CURRENT_DATE
           ORDER BY queue.position ASC`
        );
        headers = ["Queue #", "Patient", "Dentist", "Status", "Wait Minutes", "Checked In"];
        rows = result.rows.map((row) => [
          row.token || `#${row.position}`,
          row.patient_name,
          row.dentist_name,
          displayQueueStatus(row.status),
          row.estimated_wait_minutes,
          row.checked_in_at,
        ]);
        fileName = `${report}-log.csv`;
      } else if (report === "appointments") {
        const result = await db.query(
          `SELECT
             appointment.appointment_date,
             appointment.appointment_time,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             appointment.service_name,
             appointment.dentist_name,
             appointment.status
           FROM patient_portal_appointments AS appointment
           JOIN users AS patient ON patient.id::text = appointment.user_id
           ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC
           LIMIT 1000`
        );
        headers = ["Date", "Time", "Patient", "Treatment", "Dentist", "Status"];
        rows = result.rows.map((row) => [
          row.appointment_date,
          row.appointment_time,
          row.patient_name,
          row.service_name,
          row.dentist_name,
          row.status,
        ]);
        fileName = "appointments-log.csv";
      } else {
        return res.status(404).json({ message: "That export report is not available." });
      }

      const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      console.error("Staff export error:", error.message);
      return res.status(500).json({ message: "Unable to export this report." });
    }
  });

  return router;
}

module.exports = {
  createStaffPortalRouter,
  displayQueueStatus,
  requireStaffAccount,
};
