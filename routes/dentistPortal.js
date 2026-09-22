"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const express = require("express");
const clinicalPatients = require("../services/clinicalPatients");
const dentalChartSync = require("../services/dentalChartSync");
const patientData = require("../services/patientData");
const { writeAdminAudit } = require("../services/adminAudit");
const { insertPatientNotification } = require("../services/patientPortalNotifications");
const {
  getServiceDurationMinutes,
} = require("../services/waitTime");
const {
  safeRecalculateQueueWaitEstimates,
  staffWaitEstimate,
  waitEstimateFromRow,
} = require("../services/queueWaitPrediction");
const {
  markQueueServingStarted,
  recordTreatmentComplete,
  recordTreatmentStart,
} = require("../services/treatmentDuration");

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

/** Shared shape for treatment-history responses (create, update, delete). */
function serializeDentistTreatment(row) {
  return {
    id: row.id,
    name: row.treatment,
    treatment: row.treatment,
    dentist: row.dentistName,
    date: row.treatmentDate,
    treatmentDate: row.treatmentDate,
    status: row.status,
    notes: "",
    diagnosis: row.diagnosis || row.diagnosisNotes || "",
    diagnosisNotes: row.diagnosisNotes || row.diagnosis || "",
    durationMinutes: row.durationMinutes,
    toothNumber: row.toothNumber,
    procedureDetails: row.procedureDetails,
    ...patientData.paymentSummary(row.amountCharged, row.amountPaid),
    appointmentId: row.appointmentId,
    queueEntryId: row.queueEntryId || null,
    visitSequence: row.visitSequence || null,
    startedAt: row.startedAt || null,
    completedAt: row.completedAt || null,
  };
}

function auditDentistTreatment(db, req, action, recordId, row, detail) {
  writeAdminAudit(db, {
    actorId: String(req.dentist.id),
    actorName: `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim(),
    actorRole: "dentist",
    action,
    targetType: "clinical_treatment",
    targetId: row?.id ? String(row.id) : null,
    targetLabel: row?.treatment || null,
    result: "success",
    detail: `Patient record ${recordId}. ${detail}`.trim(),
    ipAddress: req.ip || null,
  }).catch(() => {});
}

function displayQueueStatus(status) {
  if (status === "dentist") return "in_chair";
  if (status === "preparing") return "called";
  return status;
}

function clinicTimezone() {
  return process.env.CLINIC_TIMEZONE || "Asia/Manila";
}

/** Same clinic-local "today" used by RFID check-in. */
function clinicTodayQueueSql(alias = "queue") {
  const tz = clinicTimezone().replace(/'/g, "''");
  return `(${alias}.checked_in_at AT TIME ZONE '${tz}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${tz}')::date`;
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
  const status = displayQueueStatus(row.status);
  const waitMinutes = Number(row.estimated_wait_minutes || 0);
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
    status,
    waitMinutes,
    durationMinutes:
      status === "in_chair"
        ? row.wait_estimate_duration_minutes != null
          ? Number(row.wait_estimate_duration_minutes)
          : waitMinutes
        : null,
    estimatedDurationMinutes:
      row.wait_estimate_duration_minutes != null
        ? Number(row.wait_estimate_duration_minutes)
        : status === "in_chair"
          ? waitMinutes
          : null,
    waitEstimate: staffWaitEstimate(waitEstimateFromRow(row)),
    checkedInAt: row.checked_in_at || null,
    procedures: (row.procedures || []).map((procedure) => ({
      id: procedure.id,
      name: procedure.treatment || procedure.name,
      treatment: procedure.treatment || procedure.name,
      status: procedure.status,
      toothNumber: procedure.toothNumber || null,
      durationMinutes: procedure.durationMinutes,
      visitSequence: procedure.visitSequence,
    })),
    currentProcedure: (() => {
      const list = row.procedures || [];
      const raw =
        list.find((procedure) => String(procedure.status || "").toLowerCase() === "in_progress") ||
        list.find((procedure) =>
          ["planned", "pending"].includes(String(procedure.status || "").toLowerCase())
        ) ||
        null;
      if (!raw) return null;
      return {
        id: raw.id,
        name: raw.treatment || raw.name,
        treatment: raw.treatment || raw.name,
        status: raw.status,
        toothNumber: raw.toothNumber || null,
      };
    })(),
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

async function notifyPatient(client, payload) {
  try {
    await insertPatientNotification(client, payload);
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

async function repairOrphanWalkInQueueForDentist(db, dentist) {
  const catalogId = stringValue(dentist.catalog_dentist_id, 80);
  if (!catalogId) return;
  const fullName = `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim();
  const dentistName = fullName ? `Dr. ${fullName}` : catalogId;
  const tz = clinicTimezone();
  try {
    await db.query(
      `UPDATE patient_portal_appointments AS appointment
       SET dentist_id = $1,
           dentist_name = CASE
             WHEN appointment.dentist_name IS NULL OR BTRIM(appointment.dentist_name) = '' OR appointment.dentist_name = 'Clinic Walk-in'
               THEN $2
             ELSE appointment.dentist_name
           END,
           updated_at = CURRENT_TIMESTAMP
       FROM patient_portal_queue_entries AS queue
       WHERE queue.appointment_id = appointment.id
         AND (queue.checked_in_at AT TIME ZONE $3)::date = (CURRENT_TIMESTAMP AT TIME ZONE $3)::date
         AND queue.status IN ('checked_in', 'waiting', 'preparing', 'dentist')
         AND appointment.dentist_id LIKE 'walk-in-%'`,
      [catalogId, dentistName, tz]
    );
  } catch (error) {
    console.warn("Walk-in queue dentist repair skipped:", error.message);
  }
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

function createDentistPortalRouter({ db, authenticateToken, clinicSms = null, notifyDentist = async () => {} }) {
  const router = express.Router();
  router.use(authenticateToken, requireDentistAccount(db));
  void notifyDentist;

  router.get("/dashboard", async (req, res) => {
    const scope = dentistScopeClause("appointment", req.dentist);
    try {
      const [targetResult, remainingResult, completedResult, nextResult, unreadResult] = await Promise.all([
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
             AND ${clinicTodayQueueSql("queue")}
             AND queue.status IN ('checked_in', 'waiting', 'preparing')`,
          scope.params
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_queue_entries AS queue
           JOIN patient_portal_appointments AS appointment
             ON appointment.id = queue.appointment_id
           WHERE ${scope.sql}
             AND ${clinicTodayQueueSql("queue")}
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
             queue.wait_estimate_min_minutes,
             queue.wait_estimate_max_minutes,
             queue.wait_estimate_duration_minutes,
             queue.wait_estimate_call_start,
             queue.wait_estimate_call_end,
             queue.wait_estimate_method,
             queue.wait_estimate_at,
             queue.serving_started_at,
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
             AND ${clinicTodayQueueSql("queue")}
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
        db.query(
          `SELECT COUNT(*) AS count
           FROM dentist_portal_notifications
           WHERE user_id = $1 AND read_at IS NULL`,
          [String(req.dentist.id)]
        ).catch((error) => {
          if (error.code === "42P01" || error.code === "42703") {
            return { rows: [{ count: "0" }] };
          }
          throw error;
        }),
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
          unreadNotifications: count(unreadResult.rows[0]),
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
    const tab = stringValue(req.query.tab, 40)?.toLowerCase() || "inline";
    let statusFilter;
    if (tab === "inline" || tab === "in_line") {
      statusFilter = `queue.status IN ('checked_in', 'waiting', 'preparing')`;
    } else if (tab === "completed") {
      statusFilter = `queue.status IN ('completed', 'no_show')`;
    } else {
      statusFilter = `queue.status = 'dentist'`;
    }

    try {
      await repairOrphanWalkInQueueForDentist(db, req.dentist);
      const result = await db.query(
        `SELECT
           queue.id,
           queue.token,
           queue.position,
           queue.status,
           queue.estimated_wait_minutes,
           queue.wait_estimate_min_minutes,
           queue.wait_estimate_max_minutes,
           queue.wait_estimate_duration_minutes,
           queue.wait_estimate_call_start,
           queue.wait_estimate_call_end,
           queue.wait_estimate_method,
           queue.wait_estimate_at,
           queue.serving_started_at,
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
           AND ${clinicTodayQueueSql("queue")}
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
           AND ${clinicTodayQueueSql("queue")}`,
        scope.params
      );

      const grouped = await clinicalPatients.listTreatmentsForQueueEntries(
        db,
        result.rows.map((row) => row.id)
      );
      const queueRows = result.rows.map((row) => ({
        ...row,
        procedures: grouped.get(Number(row.id)) || [],
      }));

      return res.json({
        updatedAt: new Date().toISOString(),
        tab,
        counts: {
          ongoing: count(countsResult.rows[0], "ongoing"),
          inline: count(countsResult.rows[0], "inline"),
          completed: count(countsResult.rows[0], "completed"),
        },
        queue: queueRows.map(mapQueueEntry),
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

  router.post("/queue/recalculate-estimates", async (_req, res) => {
    try {
      const result = await safeRecalculateQueueWaitEstimates(db, { fromPosition: 1 });
      return res.json({
        message: result.ok
          ? "Queue wait estimates recalculated."
          : "Queue wait estimates could not be fully recalculated.",
        updated: result.updated || 0,
        calculatedAt: result.calculatedAt || new Date().toISOString(),
      });
    } catch (error) {
      console.error("Dentist wait estimate recalculation error:", error.message);
      return res.status(500).json({ message: "Unable to recalculate queue estimates." });
    }
  });

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
           AND ${clinicTodayQueueSql("queue")}
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
      const previousServing = await client.query(
        `SELECT queue.id, queue.user_id, queue.appointment_id
         FROM patient_portal_queue_entries AS queue
         JOIN patient_portal_appointments AS appointment
           ON appointment.id = queue.appointment_id
         WHERE ${scope.sql}
           AND ${clinicTodayQueueSql("queue")}
           AND queue.status = 'dentist'
           AND queue.id <> $${scope.params.length + 1}`,
        [...scope.params, queueId]
      );

      await client.query(
        `UPDATE patient_portal_queue_entries AS queue
         SET status = 'completed', updated_at = CURRENT_TIMESTAMP
         FROM patient_portal_appointments AS appointment
         WHERE appointment.id = queue.appointment_id
           AND ${scope.sql}
           AND ${clinicTodayQueueSql("queue")}
           AND queue.status = 'dentist'
           AND queue.id <> $${scope.params.length + 1}`,
        [...scope.params, queueId]
      );

      for (const previous of previousServing.rows) {
        await recordTreatmentComplete(client, {
          patientUserId: previous.user_id,
          appointmentId: previous.appointment_id,
          queueEntryId: previous.id,
        });
      }

      const updatedResult = await client.query(
        `UPDATE patient_portal_queue_entries
         SET status = 'dentist', updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [queueId]
      );
      await markQueueServingStarted(client, queueId);
      await recomputeWaitsBehind(client, 1);

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
        entityType: "queue",
        entityId: current.id,
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
           queue.wait_estimate_min_minutes,
           queue.wait_estimate_max_minutes,
           queue.wait_estimate_duration_minutes,
           queue.wait_estimate_call_start,
           queue.wait_estimate_call_end,
           queue.wait_estimate_method,
           queue.wait_estimate_at,
           queue.serving_started_at,
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

  router.post("/queue/:id/start-treatment", async (req, res) => {
    const queueId = numericId(req.params.id);
    const procedureType = stringValue(req.body?.procedureType, 80);
    const procedureName =
      stringValue(req.body?.procedureName || req.body?.treatment || req.body?.name, 200) ||
      procedureType;
    const toothNumber = stringValue(req.body?.toothNumber, 40);
    const durationMinutes = Number.parseInt(req.body?.durationMinutes, 10);
    const amountChargedRaw = req.body?.amountCharged ?? req.body?.price ?? req.body?.cost;
    const clinicTz = process.env.CLINIC_TIMEZONE || "Asia/Manila";
    const treatmentDate =
      stringValue(req.body?.treatmentDate, 10) ||
      new Date().toLocaleDateString("en-CA", { timeZone: clinicTz });

    if (!queueId) {
      return res.status(400).json({ message: "A valid queue entry id is required." });
    }
    if (!procedureName) {
      return res.status(400).json({ message: "Procedure name is required." });
    }
    if (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0) {
      return res.status(400).json({ message: "Duration minutes must be a positive number." });
    }
    if (amountChargedRaw === undefined || amountChargedRaw === null || amountChargedRaw === "") {
      return res.status(400).json({ message: "Treatment price / amount charged is required." });
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

      const patientResult = await client.query(
        `SELECT id, first_name, last_name, email, phone,
                CONCAT_WS(' ', first_name, last_name) AS full_name
         FROM users
         WHERE id::text = $1
         LIMIT 1`,
        [String(current.user_id)]
      );
      const patient = patientResult.rows[0];
      if (!patient) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Patient account linked to this queue entry was not found." });
      }

      const dentistName =
        stringValue(req.body?.dentistName, 160) ||
        `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim() ||
        "Clinic Dentist";

      const clinicalRecord = await clinicalPatients.findOrCreateClinicalRecordForUser(
        client,
        current.user_id,
        { id: req.dentist.id, role: "dentist" }
      );

      const visitSequence = await clinicalPatients.nextVisitSequence(client, queueId);
      const existingVisit = await clinicalPatients.listTreatmentsForVisit(client, {
        queueEntryId: queueId,
        appointmentId: current.appointment_id || null,
      });
      const hasInProgress = existingVisit.some(
        (item) => String(item.status || "").toLowerCase() === "in_progress"
      );

      const treatment = await clinicalPatients.addClinicalTreatment(
        client,
        clinicalRecord.id,
        {
          treatment: procedureName,
          procedureDetails: procedureType
            ? `Procedure type: ${procedureType}`
            : stringValue(req.body?.procedureDetails, 2000),
          toothNumber,
          durationMinutes,
          amountCharged: amountChargedRaw,
          amountPaid: req.body?.amountPaid ?? 0,
          treatmentDate,
          status: hasInProgress ? "planned" : "in_progress",
          notes: stringValue(req.body?.notes, 2000),
          diagnosisNotes: stringValue(req.body?.diagnosisNotes, 2000),
          dentistName,
          appointmentId: current.appointment_id || null,
          queueEntryId: queueId,
          visitSequence,
        },
        { id: req.dentist.id, role: "dentist" }
      );

      let appointmentServiceId = null;
      let appointmentServiceName = null;
      if (current.appointment_id) {
        const appointmentResult = await client.query(
          `SELECT service_id, service_name
           FROM patient_portal_appointments
           WHERE id = $1
           LIMIT 1`,
          [current.appointment_id]
        );
        appointmentServiceId = appointmentResult.rows[0]?.service_id || null;
        appointmentServiceName = appointmentResult.rows[0]?.service_name || null;
      }

      const durationServiceId =
        appointmentServiceId ||
        `procedure-${procedureName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "custom"}`;
      const durationServiceName = procedureName || appointmentServiceName || "Dental visit";

      await client
        .query(
          `INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes, updated_at)
           VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
           ON CONFLICT (service_id) DO UPDATE SET
             service_name = EXCLUDED.service_name,
             default_duration_minutes = EXCLUDED.default_duration_minutes,
             updated_at = CURRENT_TIMESTAMP`,
          [durationServiceId, durationServiceName, durationMinutes]
        )
        .catch((error) => {
          if (error?.code !== "42P01") throw error;
        });

      const updatedResult = await client.query(
        `UPDATE patient_portal_queue_entries
         SET status = 'dentist',
             estimated_wait_minutes = CASE WHEN $3::boolean THEN estimated_wait_minutes ELSE $2 END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1
         RETURNING *`,
        [queueId, durationMinutes, hasInProgress]
      );

      if (!hasInProgress) {
        await recordTreatmentStart(client, {
          patientUserId: current.user_id,
          appointmentId: current.appointment_id || null,
          queueEntryId: queueId,
          procedureType: procedureName,
          dentistId: req.dentist?.id,
          treatmentId: treatment.id,
        });
      }

      if (current.appointment_id) {
        await client.query(
          `UPDATE patient_portal_appointments
           SET status = 'checked_in', updated_at = CURRENT_TIMESTAMP
           WHERE id = $1
             AND status NOT IN ('completed', 'cancelled', 'no_show')`,
          [current.appointment_id]
        );
      }

      await recomputeWaitsBehind(client, current.position);

      await notifyPatient(client, {
        userId: current.user_id,
        type: "queue",
        title: "Treatment started",
        body: `Your ${procedureName} treatment has started with ${dentistName}.`,
        entityType: "queue",
        entityId: current.id,
      });

      await client.query("COMMIT");
      transactionOpen = false;

      return res.status(201).json({
        message:
          "Ongoing treatment started. It will be finalized to the patient record when you press Done.",
        queueEntry: {
          id: updatedResult.rows[0].id,
          token: updatedResult.rows[0].token,
          sequence: updatedResult.rows[0].position,
          status: displayQueueStatus(updatedResult.rows[0].status),
          waitMinutes: Number(updatedResult.rows[0].estimated_wait_minutes || 0),
          durationMinutes,
        },
        patient: {
          id: clinicalRecord.id,
          userId: String(current.user_id),
          fullName: clinicalRecord.fullName || patient.full_name || "Patient",
          recordCode: clinicalRecord.recordCode || null,
        },
        treatment: {
          id: treatment.id,
          name: treatment.treatment,
          treatment: treatment.treatment,
          procedureType: procedureType || null,
          toothNumber: treatment.toothNumber,
          durationMinutes: treatment.durationMinutes,
          amountCharged: treatment.amountCharged ?? 0,
          amountPaid: treatment.amountPaid ?? 0,
          treatmentDate: treatment.treatmentDate,
          status: treatment.status,
          dentist: treatment.dentistName,
          clinicalRecordId: clinicalRecord.id,
          appointmentId: treatment.appointmentId,
        },
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.status) {
        return res.status(error.status).json({ message: error.message });
      }
      if (clinicalPatients.isMissingRelation(error)) {
        return res.status(503).json({
          message: "Clinical patient records are not available. Run npm run migrate:clinical-records.",
        });
      }
      console.error("Dentist start-treatment error:", error.message, error.code || "", error.detail || "");
      return res.status(500).json({
        message: error.message || "Unable to start treatment and save the patient record.",
        detail: error.message,
        code: error.code || undefined,
      });
    } finally {
      client.release();
    }
  });

  router.patch("/queue/:id", async (req, res) => {
    const queueId = numericId(req.params.id);
    const submittedStatus = stringValue(req.body?.status, 40)?.toLowerCase();
    const databaseStatus = QUEUE_STATUS_MAP[submittedStatus];
    const durationMinutes = Number.parseInt(req.body?.durationMinutes, 10);
    const hasDuration = Number.isSafeInteger(durationMinutes) && durationMinutes > 0;

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

      let completedTreatment = null;
      let nextProcedure = null;
      let visitComplete = databaseStatus !== "completed";
      let queueStatus = databaseStatus;

      if (databaseStatus === "completed") {
        const visitResult = await clinicalPatients.completeCurrentVisitProcedure(
          client,
          current.user_id,
          {
            appointmentId: current.appointment_id || null,
            queueEntryId: queueId,
            durationMinutes: hasDuration ? durationMinutes : null,
          },
          { id: req.dentist.id, role: "dentist" }
        );
        completedTreatment = visitResult.completed;
        nextProcedure = visitResult.next;
        visitComplete = visitResult.visitComplete;
        queueStatus = visitComplete ? "completed" : "dentist";
        await recordTreatmentComplete(client, {
          patientUserId: current.user_id,
          appointmentId: current.appointment_id || null,
          queueEntryId: queueId,
          durationMinutes: hasDuration ? durationMinutes : completedTreatment?.durationMinutes,
          treatmentId: completedTreatment?.id,
        });
        if (nextProcedure) {
          await recordTreatmentStart(client, {
            patientUserId: current.user_id,
            appointmentId: current.appointment_id || null,
            queueEntryId: queueId,
            procedureType: nextProcedure.treatment,
            dentistId: req.dentist?.id,
            treatmentId: nextProcedure.id,
          });
        }
      }

      const updatedResult = await client.query(
        `UPDATE patient_portal_queue_entries
         SET status = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2
         RETURNING *`,
        [queueStatus, queueId]
      );

      if (current.appointment_id) {
        const appointmentStatus =
          queueStatus === "completed"
            ? "completed"
            : queueStatus === "no_show"
              ? "no_show"
              : "checked_in";
        await client.query(
          `UPDATE patient_portal_appointments
           SET status = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [appointmentStatus, current.appointment_id]
        );
      }

      if (databaseStatus === "dentist") {
        await markQueueServingStarted(client, queueId);
      }
      await recomputeWaitsBehind(client, current.position);

      await notifyPatient(client, {
        userId: current.user_id,
        type: "queue",
        title:
          databaseStatus === "completed" && visitComplete
            ? "Treatment completed"
            : databaseStatus === "completed"
              ? "Next procedure started"
              : "Treatment status updated",
        body:
          databaseStatus === "completed" && visitComplete
            ? "Your visit has been marked as completed. Thank you for visiting Amethyst Dental."
            : databaseStatus === "completed" && nextProcedure
              ? `Your dentist is continuing with ${nextProcedure.treatment}.`
            : `Your treatment status is now ${displayQueueStatus(queueStatus).replaceAll("_", " ")}.`,
        entityType: "queue",
        entityId: current.id,
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
        message:
          databaseStatus === "completed"
            ? visitComplete
              ? completedTreatment
                ? "Visit completed and treatment saved to the patient record."
                : "Visit completed."
              : `Procedure saved. Next: ${nextProcedure?.treatment || "additional procedure in progress"}.`
            : "Queue status updated.",
        visitComplete: databaseStatus === "completed" ? visitComplete : undefined,
        nextProcedure: nextProcedure
          ? {
              id: nextProcedure.id,
              treatment: nextProcedure.treatment,
              status: nextProcedure.status,
            }
          : null,
        queueEntry: {
          id: updatedResult.rows[0].id,
          token: updatedResult.rows[0].token,
          sequence: updatedResult.rows[0].position,
          status: displayQueueStatus(updatedResult.rows[0].status),
          waitMinutes: Number(updatedResult.rows[0].estimated_wait_minutes || 0),
        },
        treatment: completedTreatment
          ? {
              id: completedTreatment.id,
              treatment: completedTreatment.treatment,
              status: completedTreatment.status,
              durationMinutes: completedTreatment.durationMinutes,
              clinicalRecordId: completedTreatment.clinicalRecordId,
            }
          : null,
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
    await safeRecalculateQueueWaitEstimates(client, {
      fromPosition: Math.max(1, Number(afterPosition) || 1),
    });
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
        patients: patients.map((record) => {
          const nextAppointment = clinicalPatients.resolveClinicalNextAppointment(record, []);
          return {
            id: record.id,
            recordCode: record.recordCode,
            patientId: record.patientId || record.recordCode || null,
            patientCategory: record.patientCategory || null,
            firstName: record.firstName,
            lastName: record.lastName,
            fullName: record.fullName,
            patientName: record.fullName,
            email: record.email,
            phone: record.phone,
            dateOfBirth: record.dateOfBirth,
            gender: record.gender,
            age: record.age,
            ageSex: record.ageSex || clinicalPatients.formatAgeSex(record.age, record.gender),
            lastVisit: record.lastTreatmentDate,
            lastTreatment: record.lastTreatment,
            lastTreatmentName: record.lastTreatment,
            lastTreatmentDate: record.lastTreatmentDate,
            amountPaid: record.lastAmountPaid,
            nextAppointmentDate: nextAppointment?.date || record.nextAppointmentDate || null,
            nextAppointmentTime: nextAppointment?.time || record.nextAppointmentTime || null,
            nextAppointment: nextAppointment,
            accountStatus: record.linkedUserId ? "linked_account" : "clinical_record",
            linkedUserId: record.linkedUserId,
            profileLocked: Boolean(record.profileLocked || record.linkedUserId),
            accountLinked: Boolean(record.accountLinked || record.linkedUserId),
            isClinicalRecord: true,
          };
        }),
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

    // Dentist may edit clinical notes/address on any record.
    // Account-linked demographics (name/sex/age/birthdate/phone) are profile-owned and rejected by the service.
    const allowed = {};
    for (const key of [
      "firstName",
      "lastName",
      "email",
      "phone",
      "dateOfBirth",
      "age",
      "gender",
      "address",
      "notes",
    ]) {
      if (Object.prototype.hasOwnProperty.call(req.body || {}, key)) {
        allowed[key] = req.body[key];
      }
    }

    try {
      const record = await clinicalPatients.updateClinicalRecord(db, recordId, allowed, {
        id: req.dentist.id,
        role: "dentist",
      });
      const [enriched] = await clinicalPatients.enrichRecordsFromLinkedProfiles(db, [record]);
      return res.json({
        message: "Patient record updated.",
        patient: {
          ...enriched,
          patientName: enriched.fullName,
          ageSex: enriched.ageSex || clinicalPatients.formatAgeSex(enriched.age, enriched.gender),
          isClinicalRecord: true,
          profileLocked: Boolean(enriched.profileLocked || enriched.linkedUserId),
        },
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

      let appointments = [];
      try {
        appointments = await clinicalPatients.listLinkedAppointments(db, detail.record, { limit: 100 });
      } catch (appointmentError) {
        console.warn("Dentist clinical appointments lookup failed:", appointmentError.message);
      }

      const patientNextAppointment = clinicalPatients.resolveClinicalNextAppointment(
        detail.record,
        appointments
      );

      return res.json({
        patient: {
          ...detail.record,
          patientName: detail.record.fullName,
          ageSex:
            detail.record.ageSex ||
            clinicalPatients.formatAgeSex(detail.record.age, detail.record.gender),
          accountStatus: detail.record.linkedUserId ? "linked_account" : "clinical_record",
          isClinicalRecord: true,
          patientId: detail.record.patientId || detail.record.recordCode || null,
          patientCategory: detail.record.patientCategory || null,
          profileLocked: Boolean(detail.record.profileLocked || detail.record.linkedUserId),
          accountLinked: Boolean(detail.record.accountLinked || detail.record.linkedUserId),
          linkedUserId: detail.record.linkedUserId || null,
          amountPaid: detail.record.lastAmountPaid,
          nextAppointmentDate: detail.record.nextAppointmentDate || patientNextAppointment?.date || null,
          nextAppointmentTime: detail.record.nextAppointmentTime || patientNextAppointment?.time || null,
        },
        appointments,
        nextAppointment: patientNextAppointment,
        treatments: detail.treatments.map((row) => {
          const amountCharged = Number(row.amountCharged || 0);
          const amountPaid = Number(row.amountPaid || 0);
          const nextAppointment =
            clinicalPatients.resolveClinicalNextAppointment(
              detail.record,
              appointments,
              row.treatmentDate
            ) || patientNextAppointment;
          return {
            id: row.id,
            name: row.treatment,
            treatment: row.treatment,
            dentist: row.dentistName,
            date: row.treatmentDate,
            treatmentDate: row.treatmentDate,
            status: row.status,
            notes: "",
            diagnosis: row.diagnosisNotes || row.diagnosis || "",
            diagnosisNotes: row.diagnosisNotes || row.diagnosis || "",
            durationMinutes: row.durationMinutes,
            toothNumber: row.toothNumber,
            procedureDetails: row.procedureDetails,
            amountCharged,
            amountPaid,
            balance: Math.round((amountCharged - amountPaid) * 100) / 100,
            appointmentId: row.appointmentId,
            queueEntryId: row.queueEntryId || null,
            visitSequence: row.visitSequence || null,
            nextAppointment: nextAppointment
              ? {
                  id: nextAppointment.id,
                  date: nextAppointment.date,
                  time: nextAppointment.time,
                  treatment: nextAppointment.treatment,
                  status: nextAppointment.status,
                }
              : null,
          };
        }),
        currentVisit: await clinicalPatients.listCurrentVisitForRecord(db, detail.record),
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

      // Ensure chart statuses reflect treatment history (DB-driven).
      try {
        await dentalChartSync.rebuildChartFromTreatments(db, recordId, {
          id: req.dentist.id,
          role: "dentist",
        });
      } catch (rebuildError) {
        console.warn("Dental chart rebuild from treatments skipped:", rebuildError.message);
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

      let appointmentId =
        Number.isSafeInteger(Number(req.body?.appointmentId)) && Number(req.body.appointmentId) > 0
          ? Number(req.body.appointmentId)
          : null;
      let queueEntryId =
        Number.isSafeInteger(Number(req.body?.queueEntryId)) && Number(req.body.queueEntryId) > 0
          ? Number(req.body.queueEntryId)
          : null;

      const detail = await clinicalPatients.getClinicalRecord(db, recordId).catch(() => null);
      const forCurrentVisit = Boolean(req.body?.forCurrentVisit);
      if (!queueEntryId && forCurrentVisit && detail?.record?.linkedUserId) {
        const activeQueue = await clinicalPatients.findActiveQueueForUser(db, detail.record.linkedUserId);
        if (activeQueue) {
          queueEntryId = Number(activeQueue.id);
          appointmentId = appointmentId || Number(activeQueue.appointment_id) || null;
        }
      }

      if (!appointmentId) {
        try {
          if (detail?.record) {
            const appointments = await clinicalPatients.listLinkedAppointments(db, detail.record, {
              limit: 100,
            });
            const treatmentDate =
              stringValue(req.body?.treatmentDate, 10) || new Date().toISOString().slice(0, 10);
            const sameDay = appointments.find((appointment) => {
              const dateText =
                typeof appointment.date === "string"
                  ? appointment.date.slice(0, 10)
                  : appointment.date
                    ? new Date(appointment.date).toISOString().slice(0, 10)
                    : "";
              return dateText === treatmentDate;
            });
            if (sameDay) appointmentId = Number(sameDay.id) || null;
          }
        } catch (linkError) {
          console.warn("Dentist treatment appointment link skipped:", linkError.message);
        }
      }

      let status = stringValue(req.body?.status, 40);
      let visitSequence = null;
      if (forCurrentVisit) {
        if (!queueEntryId) {
          return res.status(400).json({
            message: "This patient does not have an active visit/check-in to attach another procedure to.",
          });
        }
        visitSequence = await clinicalPatients.nextVisitSequence(db, queueEntryId);
        const visitTreatments = await clinicalPatients.listTreatmentsForVisit(db, {
          queueEntryId,
          appointmentId,
        });
        const hasInProgress = visitTreatments.some(
          (item) => String(item.status || "").toLowerCase() === "in_progress"
        );
        if (!status) {
          status = hasInProgress ? "planned" : "in_progress";
        }
      }

      const row = await clinicalPatients.addClinicalTreatment(
        db,
        recordId,
        {
          treatment: req.body?.treatment || req.body?.name,
          procedureDetails: req.body?.procedureDetails,
          diagnosisNotes: req.body?.diagnosisNotes || req.body?.diagnosis || req.body?.notes,
          durationMinutes: req.body?.durationMinutes,
          toothNumber: req.body?.toothNumber || req.body?.affectedTooth || req.body?.affectedTeeth,
          treatmentDate: req.body?.treatmentDate,
          status: status || "completed",
          notes: req.body?.diagnosisNotes || req.body?.diagnosis || req.body?.notes,
          dentistName,
          clinicLocation: req.body?.clinicLocation,
          coverageStatus: req.body?.coverageStatus,
          amountCharged: req.body?.amountCharged,
          // Amount paid is staff-managed on the shared clinical record.
          amountPaid: 0,
          appointmentId,
          queueEntryId: forCurrentVisit ? queueEntryId : null,
          visitSequence: forCurrentVisit ? visitSequence : null,
        },
        { id: req.dentist.id, role: "dentist" }
      );

      if (String(row.status || "").toLowerCase() === "in_progress" && queueEntryId) {
        await recordTreatmentStart(db, {
          patientUserId: detail?.record?.linkedUserId || null,
          appointmentId,
          queueEntryId,
          procedureType: row.treatment,
          dentistId: req.dentist?.id,
          treatmentId: row.id,
        });
        await markQueueServingStarted(db, queueEntryId);
      }

      await safeRecalculateQueueWaitEstimates(db, { fromPosition: 1 });

      auditDentistTreatment(db, req, "Treatment Added", recordId, row, `Tooth: ${row.toothNumber || "—"}. Date: ${row.treatmentDate}.`);

      return res.status(201).json({
        message: "Treatment record saved successfully. Dental chart updated from this treatment.",
        treatment: serializeDentistTreatment(row),
        chartSynced: Boolean(row.toothNumber),
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

  router.put("/patients/:id/treatments/:treatmentId", async (req, res) => {
    const recordId = numericId(req.params.id);
    const treatmentId = numericId(req.params.treatmentId);
    if (!recordId || !treatmentId) {
      return res
        .status(400)
        .json({ message: "A valid patient record ID and treatment ID are required." });
    }

    try {
      const row = await clinicalPatients.updateClinicalTreatment(
        db,
        recordId,
        treatmentId,
        {
          treatment: req.body?.treatment || req.body?.name,
          treatmentDate: req.body?.treatmentDate,
          diagnosisNotes: req.body?.diagnosisNotes ?? req.body?.diagnosis,
          toothNumber: req.body?.toothNumber ?? req.body?.affectedTooth ?? req.body?.affectedTeeth,
          durationMinutes: req.body?.durationMinutes,
          amountCharged: req.body?.amountCharged,
          status: req.body?.status,
          // Amount paid stays staff-owned and is deliberately not forwarded here.
        },
        { id: req.dentist.id, role: "dentist" }
      );

      auditDentistTreatment(db, req, "Treatment Edited", recordId, row, `Tooth: ${row.toothNumber || "—"}. Date: ${row.treatmentDate}. Chart recalculated.`);

      await safeRecalculateQueueWaitEstimates(db, { fromPosition: 1 });

      return res.json({
        message: "Treatment updated. Dental chart recalculated from the treatment history.",
        treatment: serializeDentistTreatment(row),
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
      console.error("Dentist treatment update error:", error.message);
      return res.status(500).json({ message: "Unable to update the treatment." });
    }
  });

  router.delete("/patients/:id/treatments/:treatmentId", async (req, res) => {
    const recordId = numericId(req.params.id);
    const treatmentId = numericId(req.params.treatmentId);
    if (!recordId || !treatmentId) {
      return res
        .status(400)
        .json({ message: "A valid patient record ID and treatment ID are required." });
    }

    try {
      const row = await clinicalPatients.deleteClinicalTreatment(
        db,
        recordId,
        treatmentId,
        { id: req.dentist.id, role: "dentist" }
      );

      auditDentistTreatment(db, req, "Treatment Deleted", recordId, row, `Tooth: ${row.toothNumber || "—"}. Chart recalculated from remaining treatments.`);

      await safeRecalculateQueueWaitEstimates(db, { fromPosition: 1 });

      return res.json({
        message: "Treatment deleted. Dental chart recalculated from the remaining treatments.",
        treatment: serializeDentistTreatment(row),
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
      console.error("Dentist treatment delete error:", error.message);
      return res.status(500).json({ message: "Unable to delete the treatment." });
    }
  });

  router.get("/notifications", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, type, title, body, entity_type, entity_id, read_at, created_at
         FROM dentist_portal_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [String(req.dentist.id)]
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
      if (error.code === "42P01") {
        return res.status(503).json({
          message: "Dentist notifications are not available. Run npm run migrate:dentist-notifications.",
        });
      }
      console.error("Dentist notifications error:", error.message);
      return res.status(500).json({ message: "Unable to load notifications." });
    }
  });

  router.patch("/notifications/read-all", async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE dentist_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND read_at IS NULL`,
        [String(req.dentist.id)]
      );
      return res.json({ markedRead: result.rowCount || 0 });
    } catch (error) {
      if (error.code === "42P01") {
        return res.status(503).json({
          message: "Dentist notifications are not available. Run npm run migrate:dentist-notifications.",
        });
      }
      console.error("Dentist mark all notifications read error:", error.message);
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
        `UPDATE dentist_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [notificationId, String(req.dentist.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Notification not found." });
      }
      return res.json({ message: "Notification marked as read." });
    } catch (error) {
      if (error.code === "42P01") {
        return res.status(503).json({
          message: "Dentist notifications are not available. Run npm run migrate:dentist-notifications.",
        });
      }
      console.error("Dentist notification update error:", error.message);
      return res.status(500).json({ message: "Unable to update the notification." });
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
