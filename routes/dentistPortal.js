"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const express = require("express");

const QUEUE_STATUS_MAP = {
  checked_in: "checked_in",
  waiting: "waiting",
  preparing: "preparing",
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
  return status === "dentist" ? "in_chair" : status;
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

function createDentistPortalRouter({ db, authenticateToken }) {
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
    const scope = dentistScopeClause("appointment", req.dentist);
    const params = [...scope.params];
    let searchSql = "";
    if (search) {
      params.push(`%${search}%`);
      const index = params.length;
      searchSql = ` AND (
        patient.first_name ILIKE $${index}
        OR patient.last_name ILIKE $${index}
        OR patient.email ILIKE $${index}
        OR patient.phone ILIKE $${index}
        OR patient.id::text ILIKE $${index}
      )`;
    }

    try {
      const result = await db.query(
        `SELECT
           patient.id,
           patient.first_name,
           patient.last_name,
           patient.email,
           patient.phone,
           patient.status AS account_status,
           patient.is_verified,
           CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
           profile.date_of_birth,
           profile.gender,
           MAX(appointment.appointment_date) AS last_visit,
           (
             SELECT treatment.treatment
             FROM patient_portal_treatment_records AS treatment
             WHERE treatment.user_id = patient.id::text
             ORDER BY treatment.treatment_date DESC NULLS LAST, treatment.id DESC
             LIMIT 1
           ) AS last_treatment_name,
           (
             SELECT treatment.treatment_date
             FROM patient_portal_treatment_records AS treatment
             WHERE treatment.user_id = patient.id::text
             ORDER BY treatment.treatment_date DESC NULLS LAST, treatment.id DESC
             LIMIT 1
           ) AS last_treatment
         FROM users AS patient
         JOIN patient_portal_appointments AS appointment
           ON appointment.user_id = patient.id::text
         LEFT JOIN patient_portal_profiles AS profile
           ON profile.user_id = patient.id::text
         WHERE ${scope.sql}
           AND LOWER(patient.role) = 'patient'
           AND COALESCE(patient.is_archived, FALSE) = FALSE
           ${searchSql}
         GROUP BY
           patient.id, patient.first_name, patient.last_name, patient.email, patient.phone,
           patient.status, patient.is_verified, profile.date_of_birth, profile.gender
         ORDER BY patient.last_name ASC NULLS LAST, patient.first_name ASC NULLS LAST
         LIMIT 100`,
        params
      );

      return res.json({
        patients: result.rows.map((row) =>
          mapPatient({
            ...row,
            last_treatment: row.last_treatment || row.last_visit,
          })
        ),
      });
    } catch (error) {
      console.error("Dentist patients error:", error.message);
      return res.status(500).json({ message: "Unable to load patient records." });
    }
  });

  router.post("/patients", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const dateOfBirth = stringValue(req.body?.dateOfBirth, 10);
    const gender = stringValue(req.body?.gender, 40);
    const password = typeof req.body?.password === "string" ? req.body.password : null;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        message: "First name, last name, email, and phone are required.",
      });
    }
    if (dateOfBirth && !isIsoDate(dateOfBirth)) {
      return res.status(400).json({ message: "Provide a valid date of birth." });
    }
    if (password && password.length < 10) {
      return res.status(400).json({
        message: "Password must be at least 10 characters long.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const existing = await client.query(
        "SELECT id FROM users WHERE LOWER(email) = $1 OR phone = $2 LIMIT 1",
        [email, phone]
      );
      if (existing.rows.length) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(409).json({
          message: "That email address or phone number is already registered.",
        });
      }

      const plainPassword = password || crypto.randomBytes(32).toString("base64url");
      const passwordHash = await bcrypt.hash(plainPassword, 12);
      const userResult = await client.query(
        `INSERT INTO users (
           first_name, last_name, email, phone, password_hash, role, is_verified, status
         ) VALUES ($1, $2, $3, $4, $5, 'patient', TRUE, 'Active')
         RETURNING id, first_name, last_name, email, phone, status, is_verified`,
        [firstName, lastName, email, phone, passwordHash]
      );
      const patient = userResult.rows[0];

      await client.query(
        `INSERT INTO patient_portal_profiles (user_id, date_of_birth, gender)
         VALUES ($1, $2, $3)
         ON CONFLICT (user_id) DO UPDATE SET
           date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_portal_profiles.date_of_birth),
           gender = COALESCE(EXCLUDED.gender, patient_portal_profiles.gender)`,
        [String(patient.id), dateOfBirth || null, gender || null]
      );

      // Link the patient to this dentist's schedule so they appear in Records Vault.
      const catalogId =
        stringValue(req.dentist.catalog_dentist_id, 80) || String(req.dentist.id);
      const dentistName =
        `Dr. ${`${req.dentist.first_name || ""} ${req.dentist.last_name || ""}`.trim()}`.trim() ||
        "Amethyst Dentist";
      const intakeTime = `${String(new Date().getHours()).padStart(2, "0")}:${String(
        new Date().getMinutes()
      ).padStart(2, "0")}`;
      await client.query(
        `INSERT INTO patient_portal_appointments (
           user_id, service_id, service_name, dentist_id, dentist_name,
           appointment_date, appointment_time, status, notes
         ) VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, $6, 'pending', $7)`,
        [
          String(patient.id),
          "clinical-intake",
          "Clinical intake / new patient",
          catalogId,
          dentistName,
          intakeTime,
          "Registered from dentist patient records vault",
        ]
      );

      await client.query("COMMIT");
      transactionOpen = false;
      return res.status(201).json({
        message: "Patient account created.",
        patient: mapPatient({
          ...patient,
          patient_name: `${firstName} ${lastName}`,
          date_of_birth: dateOfBirth,
          gender,
          account_status: patient.status,
          last_visit: new Date().toISOString().slice(0, 10),
        }),
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Dentist patient create error:", error.message);
      return res.status(500).json({ message: "Unable to create the patient account." });
    } finally {
      client.release();
    }
  });

  router.get("/patients/:id", async (req, res) => {
    const patientId = stringValue(req.params.id, 120);
    if (!patientId) {
      return res.status(400).json({ message: "A valid patient ID is required." });
    }

    const scope = dentistScopeClause("appointment", req.dentist);
    try {
      const access = await db.query(
        `SELECT 1
         FROM patient_portal_appointments AS appointment
         WHERE ${scope.sql}
           AND appointment.user_id = $${scope.params.length + 1}
         LIMIT 1`,
        [...scope.params, patientId]
      );
      if (!access.rows.length) {
        return res.status(403).json({
          message: "You can only view patients assigned to your clinical schedule.",
        });
      }

      const [patientResult, appointmentsResult, treatmentsResult] = await Promise.all([
        db.query(
          `SELECT
             patient.id,
             patient.first_name,
             patient.last_name,
             patient.email,
             patient.phone,
             patient.status AS account_status,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             profile.date_of_birth,
             profile.gender,
             profile.address
           FROM users AS patient
           LEFT JOIN patient_portal_profiles AS profile
             ON profile.user_id = patient.id::text
           WHERE patient.id::text = $1
             AND LOWER(patient.role) = 'patient'
           LIMIT 1`,
          [patientId]
        ),
        db.query(
          `SELECT appointment.*
           FROM patient_portal_appointments AS appointment
           WHERE ${scope.sql}
             AND appointment.user_id = $${scope.params.length + 1}
           ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC
           LIMIT 20`,
          [...scope.params, patientId]
        ),
        db.query(
          `SELECT *
           FROM patient_portal_treatment_records
           WHERE user_id = $1
           ORDER BY treatment_date DESC NULLS LAST, id DESC
           LIMIT 20`,
          [patientId]
        ),
      ]);

      if (!patientResult.rows.length) {
        return res.status(404).json({ message: "Patient not found." });
      }

      return res.json({
        patient: mapPatient(patientResult.rows[0]),
        appointments: appointmentsResult.rows.map(mapAppointment),
        treatments: treatmentsResult.rows.map((row) => ({
          id: row.id,
          name: row.treatment,
          dentist: row.dentist_name,
          date: row.treatment_date,
          status: row.status,
          notes: row.notes || "",
        })),
      });
    } catch (error) {
      console.error("Dentist patient detail error:", error.message);
      return res.status(500).json({ message: "Unable to load the patient record." });
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
