"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const express = require("express");
const clinicalPatients = require("../services/clinicalPatients");
const {
  estimateWaitMinutesForPosition,
  getServiceDurationMinutes,
} = require("../services/waitTime");

const QUEUE_STATUS_MAP = {
  checked_in: "checked_in",
  waiting: "waiting",
  preparing: "preparing",
  called: "preparing",
  in_treatment: "dentist",
  in_chair: "dentist",
  dentist: "dentist",
  completed: "completed",
  no_show: "no_show",
};

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

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function count(row, key = "count") {
  return Number.parseInt(row?.[key] || "0", 10);
}

function displayQueueStatus(status) {
  if (status === "dentist") return "in_chair";
  if (status === "preparing") return "called";
  return status;
}

function ageFromDob(value) {
  if (!value) return null;
  const dob = new Date(value);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age -= 1;
  }
  return age >= 0 ? age : null;
}

function mapQueueEntry(row) {
  return {
    id: row.id,
    token: row.token,
    sequence: row.position,
    patientId: row.patient_id,
    patientName: row.patient_name || "Patient",
    patientPhone: row.patient_phone || null,
    procedure: row.service_name || "Dental visit",
    dentistId: row.dentist_id || null,
    dentist: row.dentist_name || "Unassigned",
    appointmentId: row.appointment_id || null,
    appointmentDate: row.appointment_date || null,
    appointmentTime: row.appointment_time || null,
    status: displayQueueStatus(row.status),
    waitMinutes: Number(row.estimated_wait_minutes || 0),
    checkedInAt: row.checked_in_at || null,
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
  const age = ageFromDob(row.date_of_birth);
  return {
    id: row.id,
    profileCode: `PT-${String(row.id).replace(/\D/g, "").slice(-3).padStart(3, "0") || String(row.id).slice(-3)}`,
    firstName: row.first_name || "",
    lastName: row.last_name || "",
    fullName: row.patient_name || `${row.first_name || ""} ${row.last_name || ""}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    age,
    sex: row.gender || null,
    ageSex:
      age !== null || row.gender
        ? `${age !== null ? `${age} yrs` : "—"}${row.gender ? ` / ${row.gender}` : ""}`
        : "—",
    lastTreatment: row.last_treatment || row.last_visit || null,
    status: (row.account_status || "active").toLowerCase(),
  };
}

async function notifyPatient(client, { userId, type, title, body }) {
  try {
    await client.query(
      `INSERT INTO patient_portal_notifications (user_id, type, title, body)
       VALUES ($1, $2, $3, $4)`,
      [String(userId), type, title, body]
    );
  } catch (error) {
    if (error.code !== "42P01") {
      throw error;
    }
  }
}

function dentistScopeClause(alias, dentist) {
  const catalogId = stringValue(dentist.catalog_dentist_id, 80);
  if (catalogId) {
    return {
      sql: `${alias}.dentist_id = $1`,
      params: [catalogId],
    };
  }

  const fullName = `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim();
  const displayName = fullName ? `Dr. ${fullName}` : null;
  if (displayName) {
    return {
      sql: `(${alias}.dentist_id = $1 OR LOWER(${alias}.dentist_name) = LOWER($2) OR LOWER(${alias}.dentist_name) = LOWER($3))`,
      params: [String(dentist.id), displayName, fullName],
    };
  }

  return {
    sql: `${alias}.dentist_id = $1`,
    params: [String(dentist.id)],
  };
}

function requireDentistAccount(db) {
  return async (req, res, next) => {
    const tokenUserId = req.user?.id;
    if (!tokenUserId) {
      return res.status(401).json({ message: "A valid dentist session is required." });
    }

    try {
      const result = await db.query(
        `SELECT
           account.id,
           account.first_name,
           account.last_name,
           account.email,
           account.phone,
           account.role,
           account.status,
           account.is_verified,
           account.created_at,
           profile.specialization,
           profile.schedule_notes,
           profile.catalog_dentist_id
         FROM users AS account
         LEFT JOIN admin_portal_dentist_profiles AS profile
           ON profile.user_id = account.id::text
         WHERE account.id = $1
           AND LOWER(account.role) = 'dentist'
           AND account.is_verified = TRUE
           AND COALESCE(account.is_archived, FALSE) = FALSE
           AND LOWER(COALESCE(account.status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')
         LIMIT 1`,
        [String(tokenUserId)]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          message: "This dashboard is available to active dentist accounts only.",
        });
      }

      // Database role is the authorization source of truth; never trust JWT role alone.
      req.dentist = result.rows[0];
      return next();
    } catch (error) {
      if (error.code === "42P01") {
        return res.status(503).json({
          message: "Dentist portal tables are not available. Run the dentist portal migration.",
        });
      }
      console.error("Dentist authorization error:", error.message);
      return res.status(500).json({ message: "Unable to validate dentist access." });
    }
  };
}

function createDentistPortalRouter({ db, authenticateToken, clinicSms = null }) {
  const router = express.Router();
  router.use(authenticateToken, requireDentistAccount(db));

  router.get("/dashboard", async (req, res) => {
    const scope = dentistScopeClause("appointment", req.dentist);
    try {
      const [targetResult, remainingResult, completedResult, nextResult] = await Promise.all([
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments AS appointment
           WHERE ${scope.sql}
             AND appointment.appointment_date = CURRENT_DATE
             AND appointment.status NOT IN ('cancelled')`,
          scope.params
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_queue_entries AS queue
           JOIN patient_portal_appointments AS appointment
             ON appointment.id = queue.appointment_id
           WHERE ${scope.sql}
             AND DATE(queue.checked_in_at) = CURRENT_DATE
             AND queue.status IN ('checked_in', 'waiting', 'preparing')`,
          scope.params
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_queue_entries AS queue
           JOIN patient_portal_appointments AS appointment
             ON appointment.id = queue.appointment_id
           WHERE ${scope.sql}
             AND DATE(queue.checked_in_at) = CURRENT_DATE
             AND queue.status = 'completed'`,
          scope.params
        ),
        db.query(
          `SELECT
             queue.id,
             queue.token,
             queue.position,
             queue.status,
             queue.estimated_wait_minutes,
             queue.checked_in_at,
             queue.appointment_id,
             appointment.service_name,
             appointment.dentist_id,
             appointment.dentist_name,
             appointment.appointment_date,
             appointment.appointment_time,
             patient.id AS patient_id,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             patient.phone AS patient_phone
           FROM patient_portal_queue_entries AS queue
           JOIN patient_portal_appointments AS appointment
             ON appointment.id = queue.appointment_id
           JOIN users AS patient ON patient.id::text = queue.user_id
           WHERE ${scope.sql}
             AND DATE(queue.checked_in_at) = CURRENT_DATE
             AND queue.status IN ('dentist', 'checked_in', 'waiting', 'preparing')
           ORDER BY
             CASE queue.status
               WHEN 'dentist' THEN 0
               WHEN 'preparing' THEN 1
               WHEN 'waiting' THEN 2
               ELSE 3
             END,
             queue.position ASC
           LIMIT 1`,
          scope.params
        ),
      ]);

      const specialization =
        req.dentist.specialization || "Dental Specialist";
      const fullName = `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim();

      return res.json({
        date: new Date().toISOString(),
        dentist: {
          id: req.dentist.id,
          fullName: fullName === "Dr." ? "Dentist" : fullName,
          specialization,
          catalogDentistId: req.dentist.catalog_dentist_id || null,
        },
        metrics: {
          todaysTarget: count(targetResult.rows[0]),
          remainingQueue: count(remainingResult.rows[0]),
          completedToday: count(completedResult.rows[0]),
        },
        nextPatient: nextResult.rows[0] ? mapQueueEntry(nextResult.rows[0]) : null,
      });
    } catch (error) {
      console.error("Dentist dashboard error:", error.message);
      return res.status(500).json({ message: "Unable to load the dentist dashboard." });
    }
  });

  router.get("/queue", async (req, res) => {
    const scope = dentistScopeClause("appointment", req.dentist);
    const tab = stringValue(req.query.tab, 40)?.toLowerCase() || "ongoing";
    let statusFilter;
    if (tab === "inline" || tab === "in_line") {
      statusFilter = `queue.status IN ('checked_in', 'waiting', 'preparing')`;
    } else if (tab === "completed") {
      statusFilter = `queue.status IN ('completed', 'no_show')`;
    } else {
      statusFilter = `queue.status = 'dentist'`;
    }

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
           appointment.dentist_id,
           appointment.dentist_name,
           appointment.appointment_date,
           appointment.appointment_time,
           patient.id AS patient_id,
           CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
           patient.phone AS patient_phone
         FROM patient_portal_queue_entries AS queue
         JOIN patient_portal_appointments AS appointment
           ON appointment.id = queue.appointment_id
         JOIN users AS patient ON patient.id::text = queue.user_id
         WHERE ${scope.sql}
           AND DATE(queue.checked_in_at) = CURRENT_DATE
           AND ${statusFilter}
         ORDER BY queue.position ASC`,
        scope.params
      );

      const countsResult = await db.query(
        `SELECT
           COUNT(*) FILTER (WHERE queue.status = 'dentist') AS ongoing,
           COUNT(*) FILTER (WHERE queue.status IN ('checked_in', 'waiting', 'preparing')) AS inline,
           COUNT(*) FILTER (WHERE queue.status IN ('completed', 'no_show')) AS completed
         FROM patient_portal_queue_entries AS queue
         JOIN patient_portal_appointments AS appointment
           ON appointment.id = queue.appointment_id
         WHERE ${scope.sql}
           AND DATE(queue.checked_in_at) = CURRENT_DATE`,
        scope.params
      );

      return res.json({
        updatedAt: new Date().toISOString(),
        tab,
        counts: {
          ongoing: count(countsResult.rows[0], "ongoing"),
          inline: count(countsResult.rows[0], "inline"),
          completed: count(countsResult.rows[0], "completed"),
        },
        queue: result.rows.map(mapQueueEntry),
      });
    } catch (error) {
      console.error("Dentist queue error:", error.message);
      return res.status(500).json({ message: "Unable to load the treatment queue." });
    }
  });

  async function assertQueueBelongsToDentist(client, queueId, dentist) {
    const scope = dentistScopeClause("appointment", dentist);
    const result = await client.query(
      `SELECT
         queue.id,
         queue.user_id,
         queue.appointment_id,
         queue.token,
         queue.position,
         queue.status,
         queue.estimated_wait_minutes
       FROM patient_portal_queue_entries AS queue
       JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE queue.id = $${scope.params.length + 1}
         AND ${scope.sql}
       FOR UPDATE OF queue`,
      [...scope.params, queueId]
    );
    return result.rows[0] || null;
  }

  router.post("/queue/call-next", async (req, res) => {
    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const scope = dentistScopeClause("appointment", req.dentist);
      const nextResult = await client.query(
        `SELECT queue.id
         FROM patient_portal_queue_entries AS queue
         JOIN patient_portal_appointments AS appointment
           ON appointment.id = queue.appointment_id
         WHERE ${scope.sql}
           AND DATE(queue.checked_in_at) = CURRENT_DATE
           AND queue.status IN ('checked_in', 'waiting', 'preparing')
         ORDER BY
           CASE queue.status
             WHEN 'preparing' THEN 0
             WHEN 'waiting' THEN 1
             ELSE 2
           END,
           queue.position ASC
         LIMIT 1
         FOR UPDATE OF queue SKIP LOCKED`,
        scope.params
      );

      if (!nextResult.rows.length) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "No patients are waiting in your queue." });
      }

      const queueId = nextResult.rows[0].id;
      const current = await assertQueueBelongsToDentist(client, queueId, req.dentist);
      if (!current) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Queue entry not found for this dentist." });
      }

      // Complete any previous in-chair patient for this dentist before calling next.
      await client.query(
        `UPDATE patient_portal_queue_entries AS queue
         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         FROM patient_portal_appointments AS appointment
         WHERE appointment.id = queue.appointment_id
           AND ${scope.sql}
           AND DATE(queue.checked_in_at) = CURRENT_DATE
           AND queue.status = 'dentist'
           AND queue.id <> $${scope.params.length + 1}`,
        [...scope.params, queueId]
      );

      const updatedResult = await client.query(
        `UPDATE patient_portal_queue_entries
         SET status = 'dentist', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [queueId]
      );

      if (current.appointment_id) {
        await client.query(
          `UPDATE patient_portal_appointments
           SET status = 'checked_in', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [current.appointment_id]
        );
      }

      await notifyPatient(client, {
        userId: current.user_id,
        type: "queue",
        title: "You are next",
        body: "Your dentist is ready. Please proceed to the treatment chair.",
      });

      await client.query("COMMIT");
      transactionOpen = false;

      if (clinicSms?.notifyQueueSms) {
        clinicSms
          .notifyQueueSms({
            userId: current.user_id,
            queueEntry: { ...updatedResult.rows[0], status: "dentist" },
            actorRole: "dentist",
            actorId: req.dentist?.id,
          })
          .catch((smsError) => console.warn("Dentist queue SMS failed:", smsError.message));
      }

      const detail = await db.query(
        `SELECT
           queue.id,
           queue.token,
           queue.position,
           queue.status,
           queue.estimated_wait_minutes,
           queue.checked_in_at,
           queue.appointment_id,
           appointment.service_name,
           appointment.dentist_id,
           appointment.dentist_name,
           appointment.appointment_date,
           appointment.appointment_time,
           patient.id AS patient_id,
           CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
           patient.phone AS patient_phone
         FROM patient_portal_queue_entries AS queue
         JOIN patient_portal_appointments AS appointment ON appointment.id = queue.appointment_id
         JOIN users AS patient ON patient.id::text = queue.user_id
         WHERE queue.id = $1`,
        [updatedResult.rows[0].id]
      );

      return res.json({
        message: "Next patient called.",
        queueEntry: mapQueueEntry(detail.rows[0]),
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Dentist call-next error:", error.message);
      return res.status(500).json({ message: "Unable to call the next patient." });
    } finally {
      client.release();
    }
  });

  router.patch("/queue/:id", async (req, res) => {
    const queueId = numericId(req.params.id);
    const submittedStatus = stringValue(req.body?.status, 40)?.toLowerCase();
    const databaseStatus = QUEUE_STATUS_MAP[submittedStatus];

    if (!queueId || !databaseStatus) {
      return res.status(400).json({ message: "Choose a valid queue status." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const current = await assertQueueBelongsToDentist(client, queueId, req.dentist);
      if (!current) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({
          message: "Queue entry not found for this dentist.",
        });
      }

      const updatedResult = await client.query(
        `UPDATE patient_portal_queue_entries
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [databaseStatus, queueId]
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

      await notifyPatient(client, {
        userId: current.user_id,
        type: "queue",
        title: "Treatment status updated",
        body:
          databaseStatus === "completed"
            ? "Your visit has been marked as completed. Thank you for visiting Amethyst Dental."
            : `Your treatment status is now ${displayQueueStatus(databaseStatus).replaceAll("_", " ")}.`,
      });

      await client.query("COMMIT");
      transactionOpen = false;

      if (clinicSms?.notifyQueueSms) {
        clinicSms
          .notifyQueueSms({
            userId: current.user_id,
            queueEntry: updatedResult.rows[0],
            actorRole: "dentist",
            actorId: req.dentist?.id,
          })
          .catch((smsError) => console.warn("Dentist queue SMS failed:", smsError.message));
      }

      return res.json({
        queueEntry: {
          id: updatedResult.rows[0].id,
          token: updatedResult.rows[0].token,
          sequence: updatedResult.rows[0].position,
          status: displayQueueStatus(updatedResult.rows[0].status),
          waitMinutes: Number(updatedResult.rows[0].estimated_wait_minutes || 0),
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Dentist queue update error:", error.message);
      return res.status(500).json({ message: "Unable to update the queue entry." });
    } finally {
      client.release();
    }
  });

  async function recomputeWaitsBehind(client, afterPosition) {
    const waitingResult = await client.query(
      `SELECT
         queue.id,
         queue.position,
         appointment.service_id,
         appointment.service_name
       FROM patient_portal_queue_entries AS queue
       LEFT JOIN patient_portal_appointments AS appointment
         ON appointment.id = queue.appointment_id
       WHERE DATE(queue.checked_in_at) = CURRENT_DATE
         AND queue.status IN ('checked_in', 'waiting', 'preparing')
         AND queue.position > $1
       ORDER BY queue.position ASC`,
      [afterPosition]
    );

    for (const entry of waitingResult.rows) {
      const aheadResult = await client.query(
        `SELECT appointment.service_id, appointment.service_name
         FROM patient_portal_queue_entries AS queue
         LEFT JOIN patient_portal_appointments AS appointment
           ON appointment.id = queue.appointment_id
         WHERE DATE(queue.checked_in_at) = CURRENT_DATE
           AND queue.status NOT IN ('completed', 'no_show')
           AND queue.position < $1
         ORDER BY queue.position ASC`,
        [entry.position]
      );
      const waitMinutes = await estimateWaitMinutesForPosition(client, {
        position: entry.position,
        aheadEntries: aheadResult.rows,
      });
      await client.query(
        `UPDATE patient_portal_queue_entries
         SET estimated_wait_minutes = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [waitMinutes, entry.id]
      );
    }
  }

  router.patch("/queue/:id/duration", async (req, res) => {
    const queueId = numericId(req.params.id);
    const durationMinutes = Number.parseInt(req.body?.durationMinutes, 10);

    if (!queueId || !Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ message: "Provide a positive durationMinutes value." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const current = await assertQueueBelongsToDentist(client, queueId, req.dentist);
      if (!current) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Queue entry not found for this dentist." });
      }

      const appointmentResult = await client.query(
        `SELECT id, service_id, service_name, user_id
         FROM patient_portal_appointments
         WHERE id = $1
         LIMIT 1`,
        [current.appointment_id]
      );
      const appointment = appointmentResult.rows[0] || null;

      if (appointment?.service_id || appointment?.service_name) {
        await client.query(
          `INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (service_id) DO UPDATE SET
             service_name = EXCLUDED.service_name,
             default_duration_minutes = EXCLUDED.default_duration_minutes,
             updated_at = CURRENT_TIMESTAMP`,
          [
            appointment.service_id || `custom-${appointment.id}`,
            appointment.service_name || "Dental visit",
            durationMinutes,
          ]
        ).catch((error) => {
          if (error?.code !== "42P01") throw error;
        });
      }

      await client.query(
        `UPDATE patient_portal_queue_entries
         SET estimated_wait_minutes = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2`,
        [durationMinutes, queueId]
      );

      if (appointment?.user_id) {
        const clinical = await client.query(
          `SELECT id
           FROM clinic_patient_records
           WHERE linked_user_id = $1
             AND COALESCE(is_archived, FALSE) = FALSE
           ORDER BY updated_at DESC
           LIMIT 1`,
          [String(appointment.user_id)]
        ).catch((error) => {
          if (error?.code === "42P01") return { rows: [] };
          throw error;
        });

        if (clinical.rows[0]) {
          const todayTreatment = await client.query(
            `UPDATE clinic_patient_treatments
             SET duration_minutes = $1
             WHERE id = (
               SELECT id
               FROM clinic_patient_treatments
               WHERE clinical_record_id = $2
                 AND treatment_date = CURRENT_DATE
               ORDER BY id DESC
               LIMIT 1
             )
             RETURNING id`,
            [durationMinutes, clinical.rows[0].id]
          ).catch((error) => {
            if (error?.code === "42703" || error?.code === "42P01") return { rows: [] };
            throw error;
          });

          if (!todayTreatment.rows.length) {
            await clinicalPatients
              .addClinicalTreatment(
                client,
                clinical.rows[0].id,
                {
                  treatment: appointment.service_name || "Dental visit",
                  dentistName: `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim(),
                  treatmentDate: new Date().toISOString().slice(0, 10),
                  status: "in_progress",
                  durationMinutes,
                },
                { id: req.dentist.id, role: "dentist" }
              )
              .catch(() => {});
          }
        }
      }

      await recomputeWaitsBehind(client, current.position);
      await client.query("COMMIT");
      transactionOpen = false;

      const refreshed = await db.query(
        `SELECT id, token, position, status, estimated_wait_minutes
         FROM patient_portal_queue_entries
         WHERE id = $1`,
        [queueId]
      );

      return res.json({
        message: "Procedure duration saved and queue waits recomputed.",
        queueEntry: {
          id: refreshed.rows[0].id,
          token: refreshed.rows[0].token,
          sequence: refreshed.rows[0].position,
          status: displayQueueStatus(refreshed.rows[0].status),
          waitMinutes: Number(refreshed.rows[0].estimated_wait_minutes || 0),
          durationMinutes,
        },
        serviceDurationMinutes: appointment
          ? await getServiceDurationMinutes(db, appointment.service_id, appointment.service_name)
          : durationMinutes,
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Dentist queue duration error:", error.message);
      return res.status(500).json({ message: "Unable to update procedure duration." });
    } finally {
      client.release();
    }
  });

  router.get("/appointments", async (req, res) => {
    const scope = dentistScopeClause("appointment", req.dentist);
    try {
      const [todayResult, upcomingResult] = await Promise.all([
        db.query(
          `SELECT
             appointment.*,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             patient.phone AS patient_phone
           FROM patient_portal_appointments AS appointment
           JOIN users AS patient ON patient.id::text = appointment.user_id
           WHERE ${scope.sql}
             AND appointment.appointment_date = CURRENT_DATE
             AND appointment.status NOT IN ('cancelled')
           ORDER BY appointment.appointment_time ASC`,
          scope.params
        ),
        db.query(
          `SELECT
             appointment.*,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             patient.phone AS patient_phone
           FROM patient_portal_appointments AS appointment
           JOIN users AS patient ON patient.id::text = appointment.user_id
           WHERE ${scope.sql}
             AND appointment.appointment_date > CURRENT_DATE
             AND appointment.status IN ('pending', 'confirmed')
           ORDER BY appointment.appointment_date ASC, appointment.appointment_time ASC
           LIMIT 50`,
          scope.params
        ),
      ]);

      return res.json({
        todayAppointments: todayResult.rows.map(mapAppointment),
        upcomingAppointments: upcomingResult.rows.map(mapAppointment),
      });
    } catch (error) {
      console.error("Dentist appointments error:", error.message);
      return res.status(500).json({ message: "Unable to load appointments." });
    }
  });

  router.get("/patients", async (req, res) => {
    const search = stringValue(req.query.search, 100);
    try {
      const patients = await clinicalPatients.listClinicalRecords(db, {
        search,
        limit: 100,
      });
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
          lastTreatment: record.lastTreatment,
          lastTreatmentName: record.lastTreatment,
          accountStatus: record.linkedUserId ? "linked_account" : "clinical_record",
          linkedUserId: record.linkedUserId,
          isClinicalRecord: true,
        })),
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Dentist patients error:", error.message);
      return res.status(500).json({ message: "Unable to load patient records." });
    }
  });

  router.post("/patients", async (req, res) => {
    try {
      const record = await clinicalPatients.createClinicalRecord(db, req.body || {}, {
        id: req.dentist.id,
        role: "dentist",
      });

      await clinicalPatients.addClinicalTreatment(
        db,
        record.id,
        {
          treatment: req.body?.treatment || "Clinical intake / new patient",
          dentistName:
            `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim() ||
            "Amethyst Dentist",
          notes: req.body?.notes || "Registered from dentist patient records vault",
          treatmentDate: new Date().toISOString().slice(0, 10),
          status: "planned",
        },
        { id: req.dentist.id, role: "dentist" }
      );

      return res.status(201).json({
        message: "Patient clinical record created (not a login account).",
        patient: {
          ...record,
          patientName: record.fullName,
          isClinicalRecord: true,
        },
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Dentist patient create error:", error.message);
      return res.status(error.status || 500).json({
        message: error.status ? error.message : "Unable to create the patient record.",
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
        id: req.dentist.id,
        role: "dentist",
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
        id: req.dentist.id,
        role: "dentist",
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
        },
        appointments: [],
        treatments: detail.treatments.map((row) => ({
          id: row.id,
          name: row.treatment,
          dentist: row.dentistName,
          date: row.treatmentDate,
          status: row.status,
          notes: row.notes || "",
          durationMinutes: row.durationMinutes,
          toothNumber: row.toothNumber,
          diagnosisNotes: row.diagnosisNotes,
          procedureDetails: row.procedureDetails,
        })),
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Dentist patient detail error:", error.message);
      return res.status(500).json({ message: "Unable to load the patient record." });
    }
  });

  router.get("/patients/:id/xrays", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }

    try {
      const detail = await clinicalPatients.getClinicalRecord(db, recordId);
      if (!detail || detail.record.archived) {
        return res.status(404).json({ message: "Patient record not found." });
      }

      const linkedUserId = detail.record.linkedUserId;
      if (!linkedUserId) {
        return res.json({
          xrays: [],
          message: "No linked patient portal account — X-ray uploads appear after the patient registers.",
        });
      }

      const [documentsResult, analysesResult] = await Promise.all([
        db.query(
          `SELECT id, original_name, mime_type, byte_size, created_at
           FROM patient_portal_documents
           WHERE user_id = $1
             AND document_type = 'xray'
           ORDER BY created_at DESC`,
          [String(linkedUserId)]
        ),
        db.query(
          `SELECT id, document_id, status, summary, findings_json, confidence, disclaimer, created_at, updated_at
           FROM patient_xray_analyses
           WHERE user_id = $1
           ORDER BY created_at DESC`,
          [String(linkedUserId)]
        ).catch((error) => {
          if (error?.code === "42P01") {
            return { rows: [] };
          }
          throw error;
        }),
      ]);

      const analysesByDocument = new Map(
        analysesResult.rows.map((row) => [String(row.document_id), row])
      );

      return res.json({
        xrays: documentsResult.rows.map((document) => {
          const analysis = analysesByDocument.get(String(document.id));
          return {
            id: document.id,
            name: document.original_name,
            mimeType: document.mime_type,
            size: document.byte_size,
            uploadedAt: document.created_at,
            analysis: analysis
              ? {
                  id: analysis.id,
                  status: analysis.status,
                  summary: analysis.summary,
                  findings: analysis.findings_json,
                  confidence:
                    analysis.confidence != null ? Number(analysis.confidence) : null,
                  disclaimer: analysis.disclaimer,
                  createdAt: analysis.created_at,
                  updatedAt: analysis.updated_at,
                }
              : {
                  status: "unavailable",
                  disclaimer:
                    "Preliminary / supplementary information only. Not a clinical diagnosis.",
                },
          };
        }),
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Dentist patient x-rays error:", error.message);
      return res.status(500).json({ message: "Unable to load patient X-rays." });
    }
  });

  router.get("/patients/:id/dental-chart", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }

    try {
      const record = await db.query(
        `SELECT id FROM clinic_patient_records
         WHERE id = $1 AND COALESCE(is_archived, FALSE) = FALSE
         LIMIT 1`,
        [recordId]
      );
      if (!record.rows.length) {
        return res.status(404).json({ message: "Patient record not found." });
      }

      const result = await db.query(
        `SELECT
           id, tooth_number, condition_label, notes, created_by, created_by_role,
           created_at, updated_at,
           COALESCE(tooth_status, 'healthy') AS tooth_status,
           COALESCE(conditions_json, '[]'::jsonb) AS conditions_json,
           COALESCE(treatments_json, '[]'::jsonb) AS treatments_json,
           updated_by
         FROM clinic_dental_chart_entries
         WHERE clinical_record_id = $1
         ORDER BY tooth_number ASC`,
        [recordId]
      ).catch(async (error) => {
        if (error?.code === "42703") {
          // Enrichment columns not migrated yet — fall back to base chart columns.
          return db.query(
            `SELECT id, tooth_number, condition_label, notes, created_by, created_by_role, created_at, updated_at
             FROM clinic_dental_chart_entries
             WHERE clinical_record_id = $1
             ORDER BY tooth_number ASC`,
            [recordId]
          );
        }
        throw error;
      });

      return res.json({
        patientId: recordId,
        entries: result.rows.map((row) => {
          const conditions = Array.isArray(row.conditions_json)
            ? row.conditions_json
            : row.condition_label
              ? [row.condition_label]
              : [];
          const treatments = Array.isArray(row.treatments_json) ? row.treatments_json : [];
          return {
            id: row.id,
            toothNumber: row.tooth_number,
            conditionLabel: row.condition_label,
            conditions,
            condition: conditions,
            treatments,
            status: row.tooth_status || "healthy",
            notes: row.notes || "",
            createdBy: row.created_by,
            createdByRole: row.created_by_role,
            updatedBy: row.updated_by || row.created_by || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }),
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error) || error?.code === "42P01") {
        return res.status(503).json({
          message: "Dental chart is not available. Run npm run migrate:paper-gaps.",
        });
      }
      console.error("Dentist dental chart load error:", error.message);
      return res.status(500).json({ message: "Unable to load the dental chart." });
    }
  });

  router.put("/patients/:id/dental-chart", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }

    const entries = Array.isArray(req.body?.entries) ? req.body.entries : null;
    const singleTooth = stringValue(req.body?.toothNumber, 20);
    const singleCondition = stringValue(req.body?.conditionLabel || req.body?.condition, 120);
    const bodyConditions = Array.isArray(req.body?.conditions)
      ? req.body.conditions
      : Array.isArray(req.body?.condition)
        ? req.body.condition
        : null;
    const bodyTreatments = Array.isArray(req.body?.treatments)
      ? req.body.treatments
      : Array.isArray(req.body?.treatment)
        ? req.body.treatment
        : [];
    const bodyStatus = stringValue(req.body?.status || req.body?.toothStatus, 40) || "healthy";

    if (!entries && !singleTooth) {
      return res.status(400).json({
        message: "Provide entries[] or toothNumber with chart fields.",
      });
    }

    function normalizeEntry(entry) {
      const toothNumber = stringValue(entry?.toothNumber || entry?.tooth, 20);
      const conditions = Array.isArray(entry?.conditions)
        ? entry.conditions.map((item) => stringValue(String(item), 80)).filter(Boolean)
        : Array.isArray(entry?.condition)
          ? entry.condition.map((item) => stringValue(String(item), 80)).filter(Boolean)
          : stringValue(entry?.conditionLabel || entry?.condition, 120)
            ? [stringValue(entry?.conditionLabel || entry?.condition, 120)]
            : ["healthy"];
      const treatments = Array.isArray(entry?.treatments)
        ? entry.treatments.map((item) => stringValue(String(item), 80)).filter(Boolean)
        : Array.isArray(entry?.treatment)
          ? entry.treatment.map((item) => stringValue(String(item), 80)).filter(Boolean)
          : [];
      const status = stringValue(entry?.status || entry?.toothStatus, 40) || "healthy";
      const conditionLabel = conditions[0] || "healthy";
      return {
        toothNumber,
        conditionLabel,
        conditions,
        treatments,
        status,
        notes: stringValue(entry?.notes, 2000),
      };
    }

    const normalizedEntries = entries
      ? entries.map(normalizeEntry).filter((entry) => entry.toothNumber)
      : [
          normalizeEntry({
            toothNumber: singleTooth,
            conditionLabel: singleCondition || (bodyConditions && bodyConditions[0]) || bodyStatus,
            conditions: bodyConditions,
            treatments: bodyTreatments,
            status: bodyStatus,
            notes: req.body?.notes,
          }),
        ].filter((entry) => entry.toothNumber);

    if (!normalizedEntries.length) {
      return res.status(400).json({ message: "At least one valid chart entry is required." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const record = await client.query(
        `SELECT id FROM clinic_patient_records
         WHERE id = $1 AND COALESCE(is_archived, FALSE) = FALSE
         LIMIT 1
         FOR UPDATE`,
        [recordId]
      );
      if (!record.rows.length) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Patient record not found." });
      }

      const dentistId = String(req.dentist.id);
      const saved = [];
      for (const entry of normalizedEntries) {
        let result;
        try {
          result = await client.query(
            `INSERT INTO clinic_dental_chart_entries (
               clinical_record_id, tooth_number, condition_label, notes,
               created_by, created_by_role, tooth_status, conditions_json, treatments_json, updated_by
             ) VALUES ($1, $2, $3, $4, $5, 'dentist', $6, $7::jsonb, $8::jsonb, $5)
             ON CONFLICT (clinical_record_id, tooth_number) DO UPDATE SET
               condition_label = EXCLUDED.condition_label,
               notes = EXCLUDED.notes,
               tooth_status = EXCLUDED.tooth_status,
               conditions_json = EXCLUDED.conditions_json,
               treatments_json = EXCLUDED.treatments_json,
               updated_by = EXCLUDED.updated_by,
               updated_at = CURRENT_TIMESTAMP
             RETURNING
               id, tooth_number, condition_label, notes, created_by, created_by_role,
               created_at, updated_at, tooth_status, conditions_json, treatments_json, updated_by`,
            [
              recordId,
              entry.toothNumber,
              entry.conditionLabel,
              entry.notes,
              dentistId,
              entry.status,
              JSON.stringify(entry.conditions),
              JSON.stringify(entry.treatments),
            ]
          );
        } catch (columnError) {
          if (columnError?.code !== "42703") throw columnError;
          result = await client.query(
            `INSERT INTO clinic_dental_chart_entries (
               clinical_record_id, tooth_number, condition_label, notes, created_by, created_by_role
             ) VALUES ($1, $2, $3, $4, $5, 'dentist')
             ON CONFLICT (clinical_record_id, tooth_number) DO UPDATE SET
               condition_label = EXCLUDED.condition_label,
               notes = EXCLUDED.notes,
               updated_at = CURRENT_TIMESTAMP
             RETURNING id, tooth_number, condition_label, notes, created_by, created_by_role, created_at, updated_at`,
            [recordId, entry.toothNumber, entry.conditionLabel, entry.notes, dentistId]
          );
        }
        saved.push({ ...result.rows[0], _entry: entry });
      }

      await client.query("COMMIT");
      transactionOpen = false;

      return res.json({
        message: "Dental chart updated successfully.",
        patientId: recordId,
        entries: saved.map((row) => {
          const conditions = Array.isArray(row.conditions_json)
            ? row.conditions_json
            : row._entry?.conditions || (row.condition_label ? [row.condition_label] : []);
          const treatments = Array.isArray(row.treatments_json)
            ? row.treatments_json
            : row._entry?.treatments || [];
          return {
            id: row.id,
            toothNumber: row.tooth_number,
            conditionLabel: row.condition_label,
            conditions,
            condition: conditions,
            treatments,
            status: row.tooth_status || row._entry?.status || "healthy",
            notes: row.notes || "",
            createdBy: row.created_by,
            createdByRole: row.created_by_role,
            updatedBy: row.updated_by || row.created_by || null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          };
        }),
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (clinicalPatients.isMissingRelation(error) || error?.code === "42P01") {
        return res.status(503).json({
          message: "Dental chart is not available. Run npm run migrate:paper-gaps.",
        });
      }
      console.error("Dentist dental chart save error:", error.message);
      return res.status(500).json({ message: "Unable to save the dental chart." });
    } finally {
      client.release();
    }
  });

  router.delete("/patients/:id/dental-chart/:toothNumber", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    const toothNumber = stringValue(req.params.toothNumber, 20);
    if (!Number.isSafeInteger(recordId) || recordId <= 0 || !toothNumber) {
      return res.status(400).json({ message: "A valid patient record ID and tooth number are required." });
    }

    try {
      const result = await db.query(
        `DELETE FROM clinic_dental_chart_entries
         WHERE clinical_record_id = $1
           AND tooth_number = $2
         RETURNING id, tooth_number`,
        [recordId, toothNumber]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Chart entry not found for that tooth." });
      }
      return res.json({
        message: `Tooth ${toothNumber} chart entry removed.`,
        toothNumber: result.rows[0].tooth_number,
      });
    } catch (error) {
      if (clinicalPatients.isMissingRelation(error) || error?.code === "42P01") {
        return res.status(503).json({
          message: "Dental chart is not available. Run npm run migrate:paper-gaps.",
        });
      }
      console.error("Dentist dental chart delete error:", error.message);
      return res.status(500).json({ message: "Unable to remove the dental chart entry." });
    }
  });

  router.post("/patients/:id/treatments", async (req, res) => {
    const recordId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(recordId) || recordId <= 0) {
      return res.status(400).json({ message: "A valid patient record ID is required." });
    }

    try {
      const dentistName =
        stringValue(req.body?.dentistName, 160) ||
        `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim();

      const row = await clinicalPatients.addClinicalTreatment(
        db,
        recordId,
        {
          treatment: req.body?.treatment,
          procedureDetails: req.body?.procedureDetails,
          diagnosisNotes: req.body?.diagnosisNotes,
          durationMinutes: req.body?.durationMinutes,
          toothNumber: req.body?.toothNumber,
          treatmentDate: req.body?.treatmentDate,
          status: req.body?.status,
          notes: req.body?.notes,
          dentistName,
          clinicLocation: req.body?.clinicLocation,
          coverageStatus: req.body?.coverageStatus,
        },
        { id: req.dentist.id, role: "dentist" }
      );

      return res.status(201).json({
        treatment: {
          id: row.id,
          name: row.treatment,
          dentist: row.dentist_name,
          date: row.treatment_date,
          status: row.status,
          notes: row.notes || "",
          durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
          toothNumber: row.tooth_number || null,
          diagnosisNotes: row.diagnosis_notes || null,
          procedureDetails: row.procedure_details || null,
        },
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Dentist treatment create error:", error.message);
      return res.status(500).json({ message: "Unable to save the treatment." });
    }
  });

  router.get("/profile", (req, res) => {
    const fullName = `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim();
    return res.json({
      profile: {
        id: req.dentist.id,
        firstName: req.dentist.first_name || "",
        lastName: req.dentist.last_name || "",
        fullName: fullName === "Dr." ? "Dentist" : fullName,
        email: req.dentist.email || "",
        phone: req.dentist.phone || "",
        role: "dentist",
        specialization: req.dentist.specialization || "",
        scheduleNotes: req.dentist.schedule_notes || "",
        catalogDentistId: req.dentist.catalog_dentist_id || null,
        createdAt: req.dentist.created_at || null,
      },
    });
  });

  router.put("/profile", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const specialization = stringValue(req.body?.specialization, 180) || "";
    const scheduleNotes = stringValue(req.body?.scheduleNotes, 2000) || "";

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        message: "Name, email address, and phone number are required.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const userResult = await client.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, email = $3, phone = $4
         WHERE id = $5
           AND LOWER(role) = 'dentist'
         RETURNING id, first_name, last_name, email, phone, role, created_at`,
        [firstName, lastName, email, phone, req.dentist.id]
      );

      await client.query(
        `INSERT INTO admin_portal_dentist_profiles (
           user_id, specialization, schedule_notes, catalog_dentist_id
         ) VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id) DO UPDATE SET
           specialization = EXCLUDED.specialization,
           schedule_notes = EXCLUDED.schedule_notes,
           updated_at = CURRENT_TIMESTAMP`,
        [
          String(req.dentist.id),
          specialization || null,
          scheduleNotes || null,
          req.dentist.catalog_dentist_id || null,
        ]
      );

      await client.query("COMMIT");
      transactionOpen = false;

      const profile = userResult.rows[0];
      return res.json({
        profile: {
          id: profile.id,
          firstName: profile.first_name || "",
          lastName: profile.last_name || "",
          fullName: `Dr. ${`${profile.first_name || ""} ${profile.last_name || ""}`.trim()}`.trim(),
          email: profile.email || "",
          phone: profile.phone || "",
          role: "dentist",
          specialization,
          scheduleNotes,
          catalogDentistId: req.dentist.catalog_dentist_id || null,
          createdAt: profile.created_at || null,
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already registered.",
        });
      }
      console.error("Dentist profile update error:", error.message);
      return res.status(500).json({ message: "Unable to update the dentist profile." });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = {
  createDentistPortalRouter,
  requireDentistAccount,
  dentistScopeClause,
  displayQueueStatus,
};
