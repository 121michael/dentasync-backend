"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const express = require("express");

const APPOINTMENT_ACTIONS = new Set([
  "approve",
  "deny",
  "cancel",
  "complete",
  "no_show",
  "reschedule",
]);
const ACCOUNT_ROLES = new Set(["admin", "dentist", "staff", "patient"]);
const SETTINGS_KEYS = ["clinic", "appointments", "notifications", "general"];
const ROLE_PERMISSIONS = [
  {
    role: "admin",
    description: "Full clinic access including accounts, settings, analytics, and system sync.",
  },
  {
    role: "dentist",
    description: "Clinical schedule and patient treatment visibility for assigned appointments.",
  },
  {
    role: "staff",
    description: "Front-desk queue, appointment requests, and patient registration tools.",
  },
  {
    role: "patient",
    description: "Personal portal access for appointments, records, and notifications.",
  },
];

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

function count(row, key = "count") {
  return Number.parseInt(row?.[key] || "0", 10);
}

function csvCell(value) {
  const normalized = value === null || value === undefined ? "" : String(value);
  return `"${normalized.replaceAll('"', '""')}"`;
}

function isMissingRelation(error) {
  return error?.code === "42P01";
}

function migrationUnavailable(res, resource = "Admin portal") {
  return res.status(503).json({
    message: `${resource} tables are not available. Run the admin portal migration.`,
  });
}

function parsePagination(query, { defaultLimit = 20, maxLimit = 100 } = {}) {
  const page = Math.max(1, Number.parseInt(query?.page, 10) || 1);
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(query?.limit, 10) || defaultLimit)
  );
  return { page, limit, offset: (page - 1) * limit };
}

function mapStatusFilter(status) {
  const normalized = stringValue(status, 40)?.toLowerCase();
  if (!normalized || normalized === "all") {
    return null;
  }
  return normalized;
}

function statusFilterClause(alias, status, params) {
  const normalized = mapStatusFilter(status);
  if (!normalized) {
    return null;
  }

  if (normalized === "pending") {
    return `${alias}.is_verified = FALSE`;
  }
  if (normalized === "active") {
    return `LOWER(COALESCE(${alias}.status, 'active')) = 'active' AND ${alias}.is_verified = TRUE`;
  }
  if (normalized === "inactive") {
    return `LOWER(COALESCE(${alias}.status, 'active')) IN ('inactive', 'disabled', 'suspended')`;
  }

  params.push(normalized);
  return `LOWER(COALESCE(${alias}.status, 'active')) = $${params.length}`;
}

function mapAccount(row, extras = {}) {
  const firstName = row.first_name || "";
  const lastName = row.last_name || "";
  const payload = {
    id: row.id,
    firstName,
    lastName,
    fullName: row.full_name || `${firstName} ${lastName}`.trim(),
    email: row.email || "",
    phone: row.phone || "",
    role: (row.role || "").toLowerCase(),
    status: (row.status || "active").toLowerCase(),
    verified: Boolean(row.is_verified),
    createdAt: row.created_at || null,
  };

  if (row.last_visit !== undefined || extras.lastVisit !== undefined) {
    payload.lastVisit = extras.lastVisit ?? row.last_visit ?? null;
  }
  if (row.specialization !== undefined || extras.specialization !== undefined) {
    payload.specialization = extras.specialization ?? row.specialization ?? "";
  }
  if (row.schedule_notes !== undefined || extras.scheduleNotes !== undefined) {
    payload.scheduleNotes = extras.scheduleNotes ?? row.schedule_notes ?? "";
  }
  if (row.catalog_dentist_id !== undefined || extras.catalogDentistId !== undefined) {
    payload.catalogDentistId = extras.catalogDentistId ?? row.catalog_dentist_id ?? null;
  }
  if (extras.position !== undefined) {
    payload.position = extras.position || "";
  }

  return payload;
}

function mapAppointment(row) {
  return {
    id: row.id,
    patientId: row.user_id,
    patientName: row.patient_name || "Patient",
    patientEmail: row.patient_email || null,
    patientPhone: row.patient_phone || null,
    treatment: row.service_name,
    dentistId: row.dentist_id,
    dentist: row.dentist_name,
    date: row.appointment_date,
    time: row.appointment_time,
    location: row.clinic_location,
    status: row.status,
    notes: row.notes || "",
    estimatedCost: row.estimated_cost === undefined ? undefined : Number(row.estimated_cost),
    createdAt: row.created_at,
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

function requireAdminAccount(db) {
  return async (req, res, next) => {
    const tokenUserId = req.user?.id;
    if (!tokenUserId) {
      return res.status(401).json({ message: "A valid administrator session is required." });
    }

    try {
      const result = await db.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified, password_hash, created_at
         FROM users
         WHERE id = $1
           AND LOWER(role) = 'admin'
           AND is_verified = TRUE
           AND COALESCE(is_archived, FALSE) = FALSE
           AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')
         LIMIT 1`,
        [String(tokenUserId)]
      );

      if (!result.rows.length) {
        return res.status(403).json({
          message: "This dashboard is available to active administrator accounts only.",
        });
      }

      // Database record is the authorization source of truth; never trust JWT role alone.
      req.admin = result.rows[0];
      return next();
    } catch (error) {
      console.error("Admin authorization error:", error.message);
      return res.status(500).json({ message: "Unable to validate administrator access." });
    }
  };
}

function searchClause(alias, search, params) {
  if (!search) {
    return null;
  }
  params.push(`%${search}%`);
  return `(${alias}.first_name ILIKE $${params.length}
    OR ${alias}.last_name ILIKE $${params.length}
    OR ${alias}.email ILIKE $${params.length}
    OR ${alias}.phone ILIKE $${params.length})`;
}

async function countActiveAdmins(client) {
  const result = await client.query(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE LOWER(role) = 'admin'
       AND is_verified = TRUE
       AND COALESCE(is_archived, FALSE) = FALSE
       AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`
  );
  return count(result.rows[0]);
}

function createAdminPortalRouter({
  db,
  authenticateToken,
  passwordResetService,
  emailDeliveryIsConfigured,
  notifyAdmin = null,
}) {
  const router = express.Router();

  router.use(authenticateToken, requireAdminAccount(db));

  router.get("/dashboard", async (req, res) => {
    try {
      const [
        patientsResult,
        appointmentsTodayResult,
        dentistsResult,
        staffResult,
        pendingResult,
        completedTodayResult,
        cancelledTodayResult,
        alertsResult,
        thisMonthResult,
        previousMonthResult,
      ] = await Promise.all([
        db.query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE LOWER(role) = 'patient'
             AND COALESCE(is_archived, FALSE) = FALSE`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE appointment_date = CURRENT_DATE
             AND status NOT IN ('cancelled', 'no_show')`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE LOWER(role) = 'dentist'
             AND is_verified = TRUE
             AND COALESCE(is_archived, FALSE) = FALSE
             AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE LOWER(role) = 'staff'
             AND is_verified = TRUE
             AND COALESCE(is_archived, FALSE) = FALSE
             AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE status = 'pending'`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE appointment_date = CURRENT_DATE
             AND status = 'completed'`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE appointment_date = CURRENT_DATE
             AND status = 'cancelled'`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM admin_portal_notifications
           WHERE user_id = $1 AND read_at IS NULL`,
          [String(req.admin.id)]
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE LOWER(role) = 'patient'
             AND COALESCE(is_archived, FALSE) = FALSE
             AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)
             AND created_at < date_trunc('month', CURRENT_TIMESTAMP) + INTERVAL '1 month'`
        ),
        db.query(
          `SELECT COUNT(*) AS count
           FROM users
           WHERE LOWER(role) = 'patient'
             AND COALESCE(is_archived, FALSE) = FALSE
             AND created_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '1 month'
             AND created_at < date_trunc('month', CURRENT_TIMESTAMP)`
        ),
      ]);

      const thisMonth = count(thisMonthResult.rows[0]);
      const previousMonth = count(previousMonthResult.rows[0]);
      const monthGrowth =
        previousMonth === 0 ? 0 : Number((((thisMonth - previousMonth) / previousMonth) * 100).toFixed(1));

      return res.json({
        welcomeName:
          `${req.admin.first_name || ""} ${req.admin.last_name || ""}`.trim() || "Administrator",
        date: new Date().toISOString().slice(0, 10),
        metrics: {
          totalPatients: count(patientsResult.rows[0]),
          appointmentsToday: count(appointmentsTodayResult.rows[0]),
          activeDentists: count(dentistsResult.rows[0]),
          activeStaff: count(staffResult.rows[0]),
          pendingRequests: count(pendingResult.rows[0]),
          completedToday: count(completedTodayResult.rows[0]),
          cancelledToday: count(cancelledTodayResult.rows[0]),
          systemAlerts: count(alertsResult.rows[0]),
          monthGrowth,
        },
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin dashboard error:", error.message);
      return res.status(500).json({ message: "Unable to load the admin dashboard." });
    }
  });

  async function listAccountsByRole(req, res, role) {
    const search = stringValue(req.query.search, 100);
    const { page, limit, offset } = parsePagination(req.query);
    const params = [];
    const clauses = [
      `LOWER(account.role) = '${role}'`,
      "COALESCE(account.is_archived, FALSE) = FALSE",
    ];

    const statusClause = statusFilterClause("account", req.query.status, params);
    if (statusClause) {
      clauses.push(statusClause);
    }

    const searchSql = searchClause("account", search, params);
    if (searchSql) {
      clauses.push(searchSql);
    }

    const whereSql = clauses.join(" AND ");

    try {
      const countResult = await db.query(
        `SELECT COUNT(*) AS count
         FROM users AS account
         WHERE ${whereSql}`,
        params
      );

      const listParams = [...params, limit, offset];
      let selectSql;
      if (role === "patient") {
        selectSql = `
          SELECT
            account.id,
            account.first_name,
            account.last_name,
            account.email,
            account.phone,
            account.role,
            account.status,
            account.is_verified,
            account.created_at,
            CONCAT_WS(' ', account.first_name, account.last_name) AS full_name,
            MAX(appointment.appointment_date) AS last_visit
          FROM users AS account
          LEFT JOIN patient_portal_appointments AS appointment
            ON appointment.user_id = account.id::text
          WHERE ${whereSql}
          GROUP BY
            account.id, account.first_name, account.last_name, account.email, account.phone,
            account.role, account.status, account.is_verified, account.created_at
          ORDER BY account.last_name ASC NULLS LAST, account.first_name ASC NULLS LAST
          LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
      } else if (role === "dentist") {
        selectSql = `
          SELECT
            account.id,
            account.first_name,
            account.last_name,
            account.email,
            account.phone,
            account.role,
            account.status,
            account.is_verified,
            account.created_at,
            CONCAT_WS(' ', account.first_name, account.last_name) AS full_name,
            profile.specialization,
            profile.schedule_notes
          FROM users AS account
          LEFT JOIN admin_portal_dentist_profiles AS profile
            ON profile.user_id = account.id::text
          WHERE ${whereSql}
          ORDER BY account.last_name ASC NULLS LAST, account.first_name ASC NULLS LAST
          LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
      } else {
        selectSql = `
          SELECT
            account.id,
            account.first_name,
            account.last_name,
            account.email,
            account.phone,
            account.role,
            account.status,
            account.is_verified,
            account.created_at,
            CONCAT_WS(' ', account.first_name, account.last_name) AS full_name
          FROM users AS account
          WHERE ${whereSql}
          ORDER BY account.last_name ASC NULLS LAST, account.first_name ASC NULLS LAST
          LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`;
      }

      const result = await db.query(selectSql, listParams);
      const key = role === "patient" ? "patients" : role === "dentist" ? "dentists" : "staff";
      return res.json({
        page,
        limit,
        total: count(countResult.rows[0]),
        [key]: result.rows.map((row) => mapAccount(row)),
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error(`Admin ${role} list error:`, error.message);
      return res.status(500).json({ message: `Unable to load ${role} records.` });
    }
  }

  router.get("/patients", (req, res) => listAccountsByRole(req, res, "patient"));
  router.get("/staff", (req, res) => listAccountsByRole(req, res, "staff"));
  router.get("/dentists", (req, res) => listAccountsByRole(req, res, "dentist"));

  router.post("/patients", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const dateOfBirth = stringValue(req.body?.dateOfBirth, 10);
    const gender = stringValue(req.body?.gender, 40);
    const address = stringValue(req.body?.address, 500);
    const notes = stringValue(req.body?.notes, 2000);

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        message: "First name, last name, email, and phone are required.",
      });
    }
    if (dateOfBirth && !isIsoDate(dateOfBirth)) {
      return res.status(400).json({ message: "Provide a valid date of birth (YYYY-MM-DD)." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    let patient;
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

      const temporaryPassword = crypto.randomBytes(32).toString("base64url");
      const passwordHash = await bcrypt.hash(temporaryPassword, 12);
      const userResult = await client.query(
        `INSERT INTO users (
           first_name, last_name, email, phone, password_hash, role, is_verified, status
         ) VALUES ($1, $2, $3, $4, $5, 'patient', TRUE, 'Active')
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [firstName, lastName, email, phone, passwordHash]
      );
      patient = userResult.rows[0];

      if (dateOfBirth || gender || address || notes) {
        await client.query(
          `INSERT INTO patient_portal_profiles (
             user_id, date_of_birth, gender, address, dental_concerns
           ) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (user_id) DO UPDATE SET
             date_of_birth = COALESCE(EXCLUDED.date_of_birth, patient_portal_profiles.date_of_birth),
             gender = COALESCE(EXCLUDED.gender, patient_portal_profiles.gender),
             address = COALESCE(EXCLUDED.address, patient_portal_profiles.address),
             dental_concerns = COALESCE(EXCLUDED.dental_concerns, patient_portal_profiles.dental_concerns),
             updated_at = CURRENT_TIMESTAMP`,
          [String(patient.id), dateOfBirth, gender, address, notes]
        );
      }

      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already registered.",
        });
      }
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Patient portal");
      }
      console.error("Admin patient create error:", error.message);
      return res.status(500).json({ message: "Unable to create the patient account." });
    } finally {
      client.release();
    }

    let invitationSent = false;
    if (passwordResetService) {
      try {
        await passwordResetService.issuePasswordReset({
          ...patient,
          role: "patient",
          first_name: patient.first_name,
          last_name: patient.last_name,
        });
        invitationSent = true;
      } catch (error) {
        console.warn("Patient invitation email was not sent:", error.message);
      }
    }

    if (typeof notifyAdmin === "function") {
      try {
        await notifyAdmin({
          type: "patient",
          title: "Patient account created",
          body: `${firstName} ${lastName} was added by an administrator.`,
          entityType: "patient",
          entityId: patient.id,
        });
      } catch (error) {
        console.warn("Admin patient notification was not created:", error.message);
      }
    }

    return res.status(201).json({
      message: invitationSent
        ? "Patient account created and a secure setup link was sent."
        : "Patient account created successfully.",
      patient: mapAccount(patient),
      invitationSent,
    });
  });

  router.patch("/patients/:id", async (req, res) => {
    const patientId = stringValue(req.params.id, 120);
    if (!patientId) {
      return res.status(400).json({ message: "A valid patient ID is required." });
    }

    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : undefined;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : undefined;
    const statusInput = stringValue(req.body?.status, 40)?.toLowerCase();

    if (req.body?.email !== undefined && !email) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }
    if (req.body?.phone !== undefined && !phone) {
      return res.status(400).json({ message: "Provide a valid phone number." });
    }
    if (statusInput && !["active", "inactive"].includes(statusInput)) {
      return res.status(400).json({ message: "Status must be active or inactive." });
    }

    const fields = [];
    const params = [];
    if (firstName) {
      params.push(firstName);
      fields.push(`first_name = $${params.length}`);
    }
    if (lastName) {
      params.push(lastName);
      fields.push(`last_name = $${params.length}`);
    }
    if (email) {
      params.push(email);
      fields.push(`email = $${params.length}`);
    }
    if (phone) {
      params.push(phone);
      fields.push(`phone = $${params.length}`);
    }
    if (statusInput) {
      params.push(statusInput === "inactive" ? "Inactive" : "Active");
      fields.push(`status = $${params.length}`);
    }

    if (!fields.length) {
      return res.status(400).json({ message: "Provide at least one patient field to update." });
    }

    params.push(patientId);
    try {
      const result = await db.query(
        `UPDATE users
         SET ${fields.join(", ")}
         WHERE id::text = $${params.length}
           AND LOWER(role) = 'patient'
           AND COALESCE(is_archived, FALSE) = FALSE
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        params
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Patient record not found." });
      }
      return res.json({ patient: mapAccount(result.rows[0]) });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already in use.",
        });
      }
      console.error("Admin patient update error:", error.message);
      return res.status(500).json({ message: "Unable to update the patient account." });
    }
  });

  router.get("/patients/:id", async (req, res) => {
    const patientId = stringValue(req.params.id, 120);
    if (!patientId) {
      return res.status(400).json({ message: "A valid patient ID is required." });
    }

    try {
      const [patientResult, profileResult, appointmentResult] = await Promise.all([
        db.query(
          `SELECT
             id, first_name, last_name, email, phone, role, status, is_verified, created_at,
             CONCAT_WS(' ', first_name, last_name) AS full_name
           FROM users
           WHERE id::text = $1
             AND LOWER(role) = 'patient'
             AND COALESCE(is_archived, FALSE) = FALSE
           LIMIT 1`,
          [patientId]
        ),
        db.query(
          `SELECT date_of_birth, gender, address, emergency_contact_name,
                  emergency_contact_relationship, emergency_contact_phone,
                  allergies, existing_conditions, current_medications, dental_concerns,
                  hmo_provider, hmo_status
           FROM patient_portal_profiles
           WHERE user_id = $1`,
          [patientId]
        ),
        db.query(
          `SELECT id, service_name, dentist_name, appointment_date, appointment_time,
                  clinic_location, status, notes, estimated_cost, created_at, user_id, dentist_id
           FROM patient_portal_appointments
           WHERE user_id = $1
           ORDER BY appointment_date DESC, appointment_time DESC
           LIMIT 30`,
          [patientId]
        ),
      ]);

      if (!patientResult.rows.length) {
        return res.status(404).json({ message: "Patient record not found." });
      }

      const profile = profileResult.rows[0] || null;
      return res.json({
        patient: {
          ...mapAccount(patientResult.rows[0]),
          profile: profile
            ? {
                dateOfBirth: profile.date_of_birth,
                gender: profile.gender,
                address: profile.address,
                emergencyContactName: profile.emergency_contact_name,
                emergencyContactRelationship: profile.emergency_contact_relationship,
                emergencyContactPhone: profile.emergency_contact_phone,
                allergies: profile.allergies,
                existingConditions: profile.existing_conditions,
                currentMedications: profile.current_medications,
                notes: profile.dental_concerns,
                hmoProvider: profile.hmo_provider,
                hmoStatus: profile.hmo_status,
              }
            : null,
          appointments: appointmentResult.rows.map(mapAppointment),
        },
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Patient portal");
      }
      console.error("Admin patient detail error:", error.message);
      return res.status(500).json({ message: "Unable to load the patient record." });
    }
  });

  router.post("/staff", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const password = typeof req.body?.password === "string" ? req.body.password : null;
    const position = stringValue(req.body?.position, 120) || "";

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        message: "First name, last name, email, and phone are required.",
      });
    }
    if (password && password.length < 10) {
      return res.status(400).json({
        message: "Password must be at least 10 characters long.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    let staff;
    let usedRandomPassword = false;
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
      usedRandomPassword = !password;
      const passwordHash = await bcrypt.hash(plainPassword, 12);
      const userResult = await client.query(
        `INSERT INTO users (
           first_name, last_name, email, phone, password_hash, role, is_verified, status
         ) VALUES ($1, $2, $3, $4, $5, 'staff', TRUE, 'Active')
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [firstName, lastName, email, phone, passwordHash]
      );
      staff = userResult.rows[0];

      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already registered.",
        });
      }
      console.error("Admin staff create error:", error.message);
      return res.status(500).json({ message: "Unable to create the staff account." });
    } finally {
      client.release();
    }

    let invitationSent = false;
    if (usedRandomPassword && passwordResetService) {
      try {
        await passwordResetService.issuePasswordReset({
          ...staff,
          role: "staff",
          first_name: staff.first_name,
          last_name: staff.last_name,
        });
        invitationSent = true;
      } catch (error) {
        console.warn("Staff invitation email was not sent:", error.message);
      }
    }

    if (typeof notifyAdmin === "function") {
      try {
        await notifyAdmin({
          type: "staff",
          title: "Staff account created",
          body: `${firstName} ${lastName} was added as staff.`,
          entityType: "staff",
          entityId: staff.id,
        });
      } catch (error) {
        console.warn("Admin staff notification was not created:", error.message);
      }
    }

    return res.status(201).json({
      message: invitationSent
        ? "Staff account created and a secure setup link was sent."
        : "Staff account created successfully.",
      staff: mapAccount(staff, { position }),
      invitationSent,
    });
  });

  router.patch("/staff/:id", async (req, res) => {
    const staffId = stringValue(req.params.id, 120);
    if (!staffId) {
      return res.status(400).json({ message: "A valid staff ID is required." });
    }

    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : undefined;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : undefined;
    const statusInput = stringValue(req.body?.status, 40)?.toLowerCase();
    const position = stringValue(req.body?.position, 120);

    if (req.body?.email !== undefined && !email) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }
    if (req.body?.phone !== undefined && !phone) {
      return res.status(400).json({ message: "Provide a valid phone number." });
    }
    if (statusInput && !["active", "inactive"].includes(statusInput)) {
      return res.status(400).json({ message: "Status must be active or inactive." });
    }

    const fields = [];
    const params = [];
    if (firstName) {
      params.push(firstName);
      fields.push(`first_name = $${params.length}`);
    }
    if (lastName) {
      params.push(lastName);
      fields.push(`last_name = $${params.length}`);
    }
    if (email) {
      params.push(email);
      fields.push(`email = $${params.length}`);
    }
    if (phone) {
      params.push(phone);
      fields.push(`phone = $${params.length}`);
    }
    if (statusInput) {
      params.push(statusInput === "inactive" ? "Inactive" : "Active");
      fields.push(`status = $${params.length}`);
    }

    if (!fields.length && position === null) {
      return res.status(400).json({ message: "Provide at least one staff field to update." });
    }

    try {
      let staff;
      if (fields.length) {
        params.push(staffId);
        const result = await db.query(
          `UPDATE users
           SET ${fields.join(", ")}
           WHERE id::text = $${params.length}
             AND LOWER(role) = 'staff'
             AND COALESCE(is_archived, FALSE) = FALSE
           RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
          params
        );
        if (!result.rows.length) {
          return res.status(404).json({ message: "Staff record not found." });
        }
        staff = result.rows[0];
      } else {
        const result = await db.query(
          `SELECT id, first_name, last_name, email, phone, role, status, is_verified, created_at
           FROM users
           WHERE id::text = $1
             AND LOWER(role) = 'staff'
             AND COALESCE(is_archived, FALSE) = FALSE
           LIMIT 1`,
          [staffId]
        );
        if (!result.rows.length) {
          return res.status(404).json({ message: "Staff record not found." });
        }
        staff = result.rows[0];
      }

      return res.json({
        staff: mapAccount(staff, { position: position || "" }),
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already in use.",
        });
      }
      console.error("Admin staff update error:", error.message);
      return res.status(500).json({ message: "Unable to update the staff account." });
    }
  });

  router.post("/dentists", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);
    const password = typeof req.body?.password === "string" ? req.body.password : null;
    const specialization = stringValue(req.body?.specialization, 180) || "";
    const scheduleNotes = stringValue(req.body?.scheduleNotes, 2000) || "";
    const catalogDentistId = stringValue(req.body?.catalogDentistId, 80) || null;

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        message: "First name, last name, email, and phone are required.",
      });
    }
    if (password && password.length < 10) {
      return res.status(400).json({
        message: "Password must be at least 10 characters long.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    let dentist;
    let usedRandomPassword = false;
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
      usedRandomPassword = !password;
      const passwordHash = await bcrypt.hash(plainPassword, 12);
      const userResult = await client.query(
        `INSERT INTO users (
           first_name, last_name, email, phone, password_hash, role, is_verified, status
         ) VALUES ($1, $2, $3, $4, $5, 'dentist', TRUE, 'Active')
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [firstName, lastName, email, phone, passwordHash]
      );
      dentist = userResult.rows[0];

      await client.query(
        `INSERT INTO admin_portal_dentist_profiles (
           user_id, specialization, schedule_notes, catalog_dentist_id
         ) VALUES ($1, $2, $3, $4)`,
        [String(dentist.id), specialization || null, scheduleNotes || null, catalogDentistId]
      );

      await client.query("COMMIT");
      transactionOpen = false;
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already registered.",
        });
      }
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin dentist create error:", error.message);
      return res.status(500).json({ message: "Unable to create the dentist account." });
    } finally {
      client.release();
    }

    let invitationSent = false;
    if (usedRandomPassword && passwordResetService) {
      try {
        await passwordResetService.issuePasswordReset({
          ...dentist,
          role: "dentist",
          first_name: dentist.first_name,
          last_name: dentist.last_name,
        });
        invitationSent = true;
      } catch (error) {
        console.warn("Dentist invitation email was not sent:", error.message);
      }
    }

    return res.status(201).json({
      message: invitationSent
        ? "Dentist account created and a secure setup link was sent."
        : "Dentist account created successfully.",
      dentist: mapAccount(dentist, { specialization, scheduleNotes, catalogDentistId }),
      invitationSent,
    });
  });

  router.patch("/dentists/:id", async (req, res) => {
    const dentistId = stringValue(req.params.id, 120);
    if (!dentistId) {
      return res.status(400).json({ message: "A valid dentist ID is required." });
    }

    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = req.body?.email !== undefined ? normalizeEmail(req.body.email) : undefined;
    const phone = req.body?.phone !== undefined ? normalizePhone(req.body.phone) : undefined;
    const statusInput = stringValue(req.body?.status, 40)?.toLowerCase();
    const specializationProvided = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "specialization"
    );
    const scheduleNotesProvided = Object.prototype.hasOwnProperty.call(
      req.body || {},
      "scheduleNotes"
    );
    const specialization = specializationProvided
      ? stringValue(req.body.specialization, 180) || ""
      : undefined;
    const scheduleNotes = scheduleNotesProvided
      ? stringValue(req.body.scheduleNotes, 2000) || ""
      : undefined;

    if (req.body?.email !== undefined && !email) {
      return res.status(400).json({ message: "Provide a valid email address." });
    }
    if (req.body?.phone !== undefined && !phone) {
      return res.status(400).json({ message: "Provide a valid phone number." });
    }
    if (statusInput && !["active", "inactive"].includes(statusInput)) {
      return res.status(400).json({ message: "Status must be active or inactive." });
    }

    const fields = [];
    const params = [];
    if (firstName) {
      params.push(firstName);
      fields.push(`first_name = $${params.length}`);
    }
    if (lastName) {
      params.push(lastName);
      fields.push(`last_name = $${params.length}`);
    }
    if (email) {
      params.push(email);
      fields.push(`email = $${params.length}`);
    }
    if (phone) {
      params.push(phone);
      fields.push(`phone = $${params.length}`);
    }
    if (statusInput) {
      params.push(statusInput === "inactive" ? "Inactive" : "Active");
      fields.push(`status = $${params.length}`);
    }

    if (!fields.length && !specializationProvided && !scheduleNotesProvided) {
      return res.status(400).json({ message: "Provide at least one dentist field to update." });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      let dentist;
      if (fields.length) {
        params.push(dentistId);
        const result = await client.query(
          `UPDATE users
           SET ${fields.join(", ")}
           WHERE id::text = $${params.length}
             AND LOWER(role) = 'dentist'
             AND COALESCE(is_archived, FALSE) = FALSE
           RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
          params
        );
        if (!result.rows.length) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(404).json({ message: "Dentist record not found." });
        }
        dentist = result.rows[0];
      } else {
        const result = await client.query(
          `SELECT id, first_name, last_name, email, phone, role, status, is_verified, created_at
           FROM users
           WHERE id::text = $1
             AND LOWER(role) = 'dentist'
             AND COALESCE(is_archived, FALSE) = FALSE
           LIMIT 1`,
          [dentistId]
        );
        if (!result.rows.length) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(404).json({ message: "Dentist record not found." });
        }
        dentist = result.rows[0];
      }

      if (specializationProvided || scheduleNotesProvided) {
        await client.query(
          `INSERT INTO admin_portal_dentist_profiles (user_id, specialization, schedule_notes)
           VALUES ($1, $2, $3)
           ON CONFLICT (user_id) DO UPDATE SET
             specialization = COALESCE($2, admin_portal_dentist_profiles.specialization),
             schedule_notes = COALESCE($3, admin_portal_dentist_profiles.schedule_notes),
             updated_at = CURRENT_TIMESTAMP`,
          [
            String(dentist.id),
            specializationProvided ? specialization || null : null,
            scheduleNotesProvided ? scheduleNotes || null : null,
          ]
        );
      }

      const profileResult = await client.query(
        `SELECT specialization, schedule_notes
         FROM admin_portal_dentist_profiles
         WHERE user_id = $1`,
        [String(dentist.id)]
      );

      await client.query("COMMIT");
      transactionOpen = false;

      return res.json({
        dentist: mapAccount(dentist, {
          specialization: profileResult.rows[0]?.specialization || "",
          scheduleNotes: profileResult.rows[0]?.schedule_notes || "",
        }),
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already in use.",
        });
      }
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin dentist update error:", error.message);
      return res.status(500).json({ message: "Unable to update the dentist account." });
    } finally {
      client.release();
    }
  });

  router.get("/accounts", async (req, res) => {
    const search = stringValue(req.query.search, 100);
    const roleFilter = stringValue(req.query.role, 40)?.toLowerCase();
    const { page, limit, offset } = parsePagination(req.query);
    const params = [];
    const clauses = ["COALESCE(account.is_archived, FALSE) = FALSE"];

    if (roleFilter) {
      if (!ACCOUNT_ROLES.has(roleFilter)) {
        return res.status(400).json({
          message: "Role filter must be admin, dentist, staff, or patient.",
        });
      }
      params.push(roleFilter);
      clauses.push(`LOWER(account.role) = $${params.length}`);
    } else {
      clauses.push("LOWER(account.role) IN ('admin', 'dentist', 'staff', 'patient')");
    }

    const statusClause = statusFilterClause("account", req.query.status, params);
    if (statusClause) {
      clauses.push(statusClause);
    }

    const searchSql = searchClause("account", search, params);
    if (searchSql) {
      clauses.push(searchSql);
    }

    const whereSql = clauses.join(" AND ");
    try {
      const countResult = await db.query(
        `SELECT COUNT(*) AS count FROM users AS account WHERE ${whereSql}`,
        params
      );
      const listParams = [...params, limit, offset];
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
           CONCAT_WS(' ', account.first_name, account.last_name) AS full_name
         FROM users AS account
         WHERE ${whereSql}
         ORDER BY account.role ASC, account.last_name ASC NULLS LAST, account.first_name ASC NULLS LAST
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );

      return res.json({
        page,
        limit,
        total: count(countResult.rows[0]),
        accounts: result.rows.map((row) => mapAccount(row)),
      });
    } catch (error) {
      console.error("Admin accounts list error:", error.message);
      return res.status(500).json({ message: "Unable to load accounts." });
    }
  });

  router.patch("/accounts/:id/status", async (req, res) => {
    const accountId = stringValue(req.params.id, 120);
    const statusInput = stringValue(req.body?.status, 40)?.toLowerCase();

    if (!accountId) {
      return res.status(400).json({ message: "A valid account ID is required." });
    }
    if (!["active", "inactive"].includes(statusInput)) {
      return res.status(400).json({ message: "Status must be active or inactive." });
    }
    if (String(req.admin.id) === String(accountId) && statusInput === "inactive") {
      return res.status(403).json({
        message: "You cannot deactivate the currently logged-in administrator account.",
      });
    }

    const nextStatus = statusInput === "inactive" ? "Inactive" : "Active";
    try {
      if (statusInput === "inactive") {
        const target = await db.query(
          `SELECT id, role
           FROM users
           WHERE id::text = $1
             AND COALESCE(is_archived, FALSE) = FALSE
           LIMIT 1`,
          [accountId]
        );
        if (!target.rows.length) {
          return res.status(404).json({ message: "Account not found." });
        }
        if (String(target.rows[0].role || "").toLowerCase() === "admin") {
          const activeAdmins = await countActiveAdmins(db);
          if (activeAdmins <= 1) {
            return res.status(409).json({
              message: "Cannot deactivate the last remaining active administrator.",
            });
          }
        }
      }

      const result = await db.query(
        `UPDATE users
         SET status = $1
         WHERE id::text = $2
           AND COALESCE(is_archived, FALSE) = FALSE
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [nextStatus, accountId]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Account not found." });
      }
      return res.json({ account: mapAccount(result.rows[0]) });
    } catch (error) {
      console.error("Admin account status error:", error.message);
      return res.status(500).json({ message: "Unable to update account status." });
    }
  });

  router.delete("/accounts/:id", async (req, res) => {
    const accountId = stringValue(req.params.id, 120);
    if (!accountId) {
      return res.status(400).json({ message: "A valid account ID is required." });
    }
    if (String(req.admin.id) === String(accountId)) {
      return res.status(403).json({
        message: "You cannot delete the currently logged-in administrator account.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const targetResult = await client.query(
        `SELECT id, role, status, is_verified, is_archived
         FROM users
         WHERE id::text = $1
         FOR UPDATE`,
        [accountId]
      );
      const target = targetResult.rows[0];
      if (!target || target.is_archived) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Account not found." });
      }

      const isActiveAdmin =
        String(target.role || "").toLowerCase() === "admin" &&
        Boolean(target.is_verified) &&
        !["inactive", "disabled", "suspended"].includes(
          String(target.status || "active").toLowerCase()
        );

      if (isActiveAdmin) {
        const activeAdmins = await countActiveAdmins(client);
        if (activeAdmins <= 1) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(409).json({
            message: "Cannot delete the last remaining active administrator.",
          });
        }
      }

      const result = await client.query(
        `UPDATE users
         SET is_archived = TRUE, status = 'Inactive'
         WHERE id::text = $1
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [accountId]
      );

      await client.query("COMMIT");
      transactionOpen = false;
      return res.json({
        message: "Account archived successfully.",
        account: mapAccount(result.rows[0]),
      });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      console.error("Admin account delete error:", error.message);
      return res.status(500).json({ message: "Unable to delete the account." });
    } finally {
      client.release();
    }
  });

  router.get("/appointments", async (req, res) => {
    const search = stringValue(req.query.search, 100);
    const date = stringValue(req.query.date, 10);
    const status = stringValue(req.query.status, 40)?.toLowerCase();
    const { page, limit, offset } = parsePagination(req.query);
    const params = [];
    const clauses = ["1=1"];

    if (date) {
      if (!isIsoDate(date)) {
        return res.status(400).json({ message: "Provide a valid appointment date (YYYY-MM-DD)." });
      }
      params.push(date);
      clauses.push(`appointment.appointment_date = $${params.length}`);
    }
    if (status) {
      params.push(status);
      clauses.push(`LOWER(appointment.status) = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      clauses.push(
        `(CONCAT_WS(' ', patient.first_name, patient.last_name) ILIKE $${params.length}
          OR appointment.service_name ILIKE $${params.length}
          OR appointment.dentist_name ILIKE $${params.length}
          OR patient.email ILIKE $${params.length}
          OR patient.phone ILIKE $${params.length})`
      );
    }

    const whereSql = clauses.join(" AND ");
    try {
      const countResult = await db.query(
        `SELECT COUNT(*) AS count
         FROM patient_portal_appointments AS appointment
         JOIN users AS patient ON patient.id::text = appointment.user_id
         WHERE ${whereSql}`,
        params
      );
      const listParams = [...params, limit, offset];
      const result = await db.query(
        `SELECT
           appointment.*,
           CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
           patient.email AS patient_email,
           patient.phone AS patient_phone
         FROM patient_portal_appointments AS appointment
         JOIN users AS patient ON patient.id::text = appointment.user_id
         WHERE ${whereSql}
         ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );

      return res.json({
        page,
        limit,
        total: count(countResult.rows[0]),
        appointments: result.rows.map(mapAppointment),
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Patient portal");
      }
      console.error("Admin appointments list error:", error.message);
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
      } else if (action === "complete") {
        nextStatus = "completed";
        patientTitle = "Visit completed";
        patientBody = "Your visit has been marked as completed. Thank you for visiting Amethyst Dental.";
      } else if (action === "no_show") {
        nextStatus = "no_show";
        patientTitle = "Appointment marked as no-show";
        patientBody =
          "Your appointment was marked as a no-show. Please contact the clinic if this is incorrect.";
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
        `SELECT
           CONCAT_WS(' ', first_name, last_name) AS patient_name,
           email AS patient_email,
           phone AS patient_phone
         FROM users
         WHERE id::text = $1
         LIMIT 1`,
        [String(current.user_id)]
      );

      return res.json({
        appointment: mapAppointment({
          ...result.rows[0],
          patient_name: patientResult.rows[0]?.patient_name,
          patient_email: patientResult.rows[0]?.patient_email,
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
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Patient portal");
      }
      console.error("Admin appointment update error:", error.message);
      return res.status(500).json({ message: "Unable to update the appointment." });
    } finally {
      client.release();
    }
  });

  router.get("/analytics", async (req, res) => {
    const range = stringValue(req.query.range, 20)?.toLowerCase() || "month";
    if (!["today", "week", "month", "year"].includes(range)) {
      return res.status(400).json({
        message: "Analytics range must be today, week, month, or year.",
      });
    }

    let revenueSql;
    if (range === "today") {
      revenueSql = `
        SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date = CURRENT_DATE
        GROUP BY appointment_date
        ORDER BY appointment_date`;
    } else if (range === "week") {
      revenueSql = `
        SELECT TO_CHAR(appointment_date, 'YYYY-MM-DD') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date >= CURRENT_DATE - INTERVAL '6 days'
          AND appointment_date <= CURRENT_DATE
        GROUP BY appointment_date
        ORDER BY appointment_date`;
    } else if (range === "month") {
      revenueSql = `
        SELECT TO_CHAR(date_trunc('week', appointment_date), 'IYYY-"W"IW') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date >= date_trunc('month', CURRENT_DATE)
          AND appointment_date < date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'
        GROUP BY date_trunc('week', appointment_date)
        ORDER BY date_trunc('week', appointment_date)`;
    } else {
      revenueSql = `
        SELECT TO_CHAR(date_trunc('month', appointment_date), 'YYYY-MM') AS label,
               COALESCE(SUM(estimated_cost), 0) AS value
        FROM patient_portal_appointments
        WHERE status = 'completed'
          AND appointment_date >= date_trunc('year', CURRENT_DATE)
          AND appointment_date < date_trunc('year', CURRENT_DATE) + INTERVAL '1 year'
        GROUP BY date_trunc('month', appointment_date)
        ORDER BY date_trunc('month', appointment_date)`;
    }

    try {
      const [revenueResult, breakdownResult, growthResult, dentistResult] = await Promise.all([
        db.query(revenueSql),
        db.query(
          `SELECT
             COUNT(*) FILTER (WHERE status = 'completed') AS completed,
             COUNT(*) FILTER (WHERE status = 'pending') AS pending,
             COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
             COUNT(*) FILTER (WHERE status = 'no_show') AS no_show,
             COUNT(*) FILTER (WHERE status = 'confirmed') AS confirmed,
             COUNT(*) FILTER (WHERE status = 'checked_in') AS checked_in
           FROM patient_portal_appointments`
        ),
        db.query(
          `SELECT TO_CHAR(date_trunc('month', created_at), 'YYYY-MM') AS label,
                  COUNT(*) AS count
           FROM users
           WHERE LOWER(role) = 'patient'
             AND COALESCE(is_archived, FALSE) = FALSE
             AND created_at >= date_trunc('month', CURRENT_TIMESTAMP) - INTERVAL '5 months'
           GROUP BY date_trunc('month', created_at)
           ORDER BY date_trunc('month', created_at)`
        ),
        db.query(
          `SELECT
             COALESCE(dentist_name, 'Unassigned') AS dentist,
             COUNT(*) FILTER (WHERE status = 'completed') AS completed,
             COUNT(*) AS total
           FROM patient_portal_appointments
           GROUP BY dentist_name
           ORDER BY completed DESC, total DESC, dentist ASC
           LIMIT 20`
        ),
      ]);

      const breakdown = breakdownResult.rows[0] || {};
      return res.json({
        range,
        revenueByPeriod: revenueResult.rows.map((row) => ({
          label: row.label,
          value: Number(row.value || 0),
        })),
        appointmentBreakdown: {
          completed: count(breakdown, "completed"),
          pending: count(breakdown, "pending"),
          cancelled: count(breakdown, "cancelled"),
          no_show: count(breakdown, "no_show"),
          confirmed: count(breakdown, "confirmed"),
          checked_in: count(breakdown, "checked_in"),
        },
        patientGrowth: growthResult.rows.map((row) => ({
          label: row.label,
          count: count(row, "count"),
        })),
        dentistPerformance: dentistResult.rows.map((row) => ({
          dentist: row.dentist,
          completed: count(row, "completed"),
          total: count(row, "total"),
        })),
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Patient portal");
      }
      console.error("Admin analytics error:", error.message);
      return res.status(500).json({ message: "Unable to load analytics." });
    }
  });

  router.get("/settings", async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT setting_key, setting_value, updated_at, updated_by
         FROM admin_portal_settings
         WHERE setting_key = ANY($1::text[])`,
        [SETTINGS_KEYS]
      );

      const settings = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, {}]));
      for (const row of result.rows) {
        settings[row.setting_key] = row.setting_value || {};
      }

      return res.json({ settings });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin settings read error:", error.message);
      return res.status(500).json({ message: "Unable to load settings." });
    }
  });

  router.put("/settings", async (req, res) => {
    const payload = req.body?.settings && typeof req.body.settings === "object"
      ? req.body.settings
      : req.body;
    if (!payload || typeof payload !== "object") {
      return res.status(400).json({ message: "Provide settings values to update." });
    }

    const updates = SETTINGS_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(payload, key));
    if (!updates.length) {
      return res.status(400).json({
        message: "Provide clinic, appointments, notifications, or general settings.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      for (const key of updates) {
        const value = payload[key];
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(400).json({
            message: `Settings key "${key}" must be an object.`,
          });
        }

        await client.query(
          `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
           VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP, $3)
           ON CONFLICT (setting_key) DO UPDATE SET
             setting_value = EXCLUDED.setting_value,
             updated_at = CURRENT_TIMESTAMP,
             updated_by = EXCLUDED.updated_by`,
          [key, JSON.stringify(value), String(req.admin.id)]
        );
      }

      const result = await client.query(
        `SELECT setting_key, setting_value
         FROM admin_portal_settings
         WHERE setting_key = ANY($1::text[])`,
        [SETTINGS_KEYS]
      );

      await client.query("COMMIT");
      transactionOpen = false;

      const settings = Object.fromEntries(SETTINGS_KEYS.map((key) => [key, {}]));
      for (const row of result.rows) {
        settings[row.setting_key] = row.setting_value || {};
      }
      return res.json({ settings });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin settings write error:", error.message);
      return res.status(500).json({ message: "Unable to save settings." });
    } finally {
      client.release();
    }
  });

  router.get("/security", async (_req, res) => {
    let loginActivity = [];
    let failedAttempts = 0;
    let passwordResets = 0;

    try {
      try {
        const activityResult = await db.query(
          `SELECT
             activity.id,
             activity.user_id,
             activity.event_type,
             activity.ip_address,
             activity.user_agent,
             activity.created_at,
             CONCAT_WS(' ', account.first_name, account.last_name) AS full_name,
             account.email,
             account.role
           FROM patient_portal_login_activity AS activity
           LEFT JOIN users AS account ON account.id::text = activity.user_id
           ORDER BY activity.created_at DESC
           LIMIT 50`
        );
        loginActivity = activityResult.rows.map((row) => ({
          id: row.id,
          userId: row.user_id,
          fullName: row.full_name || "",
          email: row.email || "",
          role: (row.role || "").toLowerCase(),
          eventType: row.event_type,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          createdAt: row.created_at,
        }));
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      try {
        const failedResult = await db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_login_activity
           WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'
             AND event_type ILIKE '%fail%'`
        );
        failedAttempts = count(failedResult.rows[0]);
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      try {
        const resetResult = await db.query(
          `SELECT COUNT(*) AS count
           FROM password_reset_requests
           WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`
        );
        passwordResets = count(resetResult.rows[0]);
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      return res.json({
        loginActivity,
        failedAttempts,
        passwordResets,
        rolePermissions: ROLE_PERMISSIONS,
      });
    } catch (error) {
      console.error("Admin security error:", error.message);
      return res.status(500).json({ message: "Unable to load security activity." });
    }
  });

  async function buildHealthSnapshot() {
    let database = false;
    let databaseError = null;
    try {
      await db.query("SELECT 1");
      database = true;
    } catch (error) {
      databaseError = error.message;
    }

    const email = Boolean(
      typeof emailDeliveryIsConfigured === "function" && emailDeliveryIsConfigured()
    );

    return {
      database,
      api: true,
      email,
      auth: true,
      databaseError,
      checkedAt: new Date().toISOString(),
    };
  }

  router.get("/system-health", async (_req, res) => {
    try {
      const health = await buildHealthSnapshot();
      return res.json({
        statuses: {
          database: health.database,
          api: health.api,
          email: health.email,
          auth: health.auth,
        },
        checkedAt: health.checkedAt,
      });
    } catch (error) {
      console.error("Admin system health error:", error.message);
      return res.status(500).json({ message: "Unable to evaluate system health." });
    }
  });

  router.get("/sync", async (_req, res) => {
    try {
      const health = await buildHealthSnapshot();
      let latestEvents = [];
      try {
        const eventsResult = await db.query(
          `SELECT id, triggered_by, status, database_ok, api_ok, email_ok, detail, created_at
           FROM admin_portal_sync_events
           ORDER BY created_at DESC
           LIMIT 20`
        );
        latestEvents = eventsResult.rows.map((row) => ({
          id: row.id,
          triggeredBy: row.triggered_by,
          status: row.status,
          databaseOk: row.database_ok,
          apiOk: row.api_ok,
          emailOk: row.email_ok,
          detail: row.detail,
          createdAt: row.created_at,
        }));
      } catch (error) {
        if (isMissingRelation(error)) {
          return migrationUnavailable(res);
        }
        throw error;
      }

      return res.json({
        health: {
          database: health.database,
          api: health.api,
          email: health.email,
          auth: health.auth,
          checkedAt: health.checkedAt,
        },
        events: latestEvents,
      });
    } catch (error) {
      console.error("Admin sync status error:", error.message);
      return res.status(500).json({ message: "Unable to load sync status." });
    }
  });

  router.post("/sync", async (req, res) => {
    const health = await buildHealthSnapshot();
    const success = health.database;
    const detail = success
      ? "Synchronization checks completed successfully."
      : `Database check failed${health.databaseError ? `: ${health.databaseError}` : "."}`;

    try {
      const insertResult = await db.query(
        `INSERT INTO admin_portal_sync_events (
           triggered_by, status, database_ok, api_ok, email_ok, detail
         ) VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, triggered_by, status, database_ok, api_ok, email_ok, detail, created_at`,
        [
          String(req.admin.id),
          success ? "success" : "failed",
          health.database,
          true,
          health.email,
          detail,
        ]
      );

      const event = insertResult.rows[0];
      return res.status(success ? 200 : 503).json({
        result: {
          status: success ? "success" : "failed",
          database: health.database,
          api: true,
          email: health.email,
          auth: true,
          detail,
        },
        event: {
          id: event.id,
          triggeredBy: event.triggered_by,
          status: event.status,
          databaseOk: event.database_ok,
          apiOk: event.api_ok,
          emailOk: event.email_ok,
          detail: event.detail,
          createdAt: event.created_at,
        },
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin sync run error:", error.message);
      return res.status(500).json({
        message: "Unable to record the synchronization result.",
        result: {
          status: "failed",
          database: health.database,
          api: true,
          email: health.email,
          auth: true,
          detail,
        },
      });
    }
  });

  router.get("/notifications", async (req, res) => {
    try {
      const result = await db.query(
        `SELECT id, type, title, body, entity_type, entity_id, read_at, created_at
         FROM admin_portal_notifications
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 100`,
        [String(req.admin.id)]
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
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin notifications error:", error.message);
      return res.status(500).json({ message: "Unable to load notifications." });
    }
  });

  router.patch("/notifications/read-all", async (req, res) => {
    try {
      const result = await db.query(
        `UPDATE admin_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE user_id = $1 AND read_at IS NULL`,
        [String(req.admin.id)]
      );
      return res.json({ markedRead: result.rowCount || 0 });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin mark all notifications read error:", error.message);
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
        `UPDATE admin_portal_notifications
         SET read_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND user_id = $2
         RETURNING id`,
        [notificationId, String(req.admin.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Notification not found." });
      }
      return res.json({ message: "Notification marked as read." });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin notification update error:", error.message);
      return res.status(500).json({ message: "Unable to update the notification." });
    }
  });

  router.get("/profile", (req, res) => {
    const admin = req.admin;
    return res.json({
      profile: {
        id: admin.id,
        firstName: admin.first_name || "",
        lastName: admin.last_name || "",
        fullName: `${admin.first_name || ""} ${admin.last_name || ""}`.trim(),
        email: admin.email || "",
        phone: admin.phone || "",
        role: "admin",
        status: (admin.status || "active").toLowerCase(),
        verified: Boolean(admin.is_verified),
        createdAt: admin.created_at || null,
      },
    });
  });

  router.put("/profile", async (req, res) => {
    const firstName = stringValue(req.body?.firstName, 80);
    const lastName = stringValue(req.body?.lastName, 80);
    const email = normalizeEmail(req.body?.email);
    const phone = normalizePhone(req.body?.phone);

    if (!firstName || !lastName || !email || !phone) {
      return res.status(400).json({
        message: "Name, email address, and phone number are required.",
      });
    }

    try {
      const result = await db.query(
        `UPDATE users
         SET first_name = $1, last_name = $2, email = $3, phone = $4
         WHERE id = $5
           AND LOWER(role) = 'admin'
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [firstName, lastName, email, phone, String(req.admin.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Administrator profile not found." });
      }

      const admin = result.rows[0];
      req.admin = { ...req.admin, ...admin };
      return res.json({
        profile: {
          id: admin.id,
          firstName: admin.first_name || "",
          lastName: admin.last_name || "",
          fullName: `${admin.first_name || ""} ${admin.last_name || ""}`.trim(),
          email: admin.email || "",
          phone: admin.phone || "",
          role: "admin",
          status: (admin.status || "active").toLowerCase(),
          verified: Boolean(admin.is_verified),
          createdAt: admin.created_at || null,
        },
      });
    } catch (error) {
      if (error.code === "23505") {
        return res.status(409).json({
          message: "That email address or phone number is already in use.",
        });
      }
      console.error("Admin profile update error:", error.message);
      return res.status(500).json({ message: "Unable to save the administrator profile." });
    }
  });

  router.put("/password", async (req, res) => {
    const currentPassword =
      typeof req.body?.currentPassword === "string" ? req.body.currentPassword : "";
    const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required.",
      });
    }
    if (newPassword.length < 10) {
      return res.status(400).json({
        message: "New password must be at least 10 characters long.",
      });
    }

    try {
      const match = await bcrypt.compare(currentPassword, req.admin.password_hash || "");
      if (!match) {
        return res.status(401).json({ message: "Current password is incorrect." });
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await db.query(
        `UPDATE users
         SET password_hash = $1
         WHERE id = $2
           AND LOWER(role) = 'admin'`,
        [passwordHash, String(req.admin.id)]
      );
      req.admin.password_hash = passwordHash;
      return res.json({ message: "Password updated successfully." });
    } catch (error) {
      console.error("Admin password update error:", error.message);
      return res.status(500).json({ message: "Unable to update the password." });
    }
  });

  router.get("/export/:report", async (req, res) => {
    const report = stringValue(req.params.report, 30)?.toLowerCase();
    let headers;
    let rows;
    let fileName;

    try {
      if (report === "patients") {
        const result = await db.query(
          `SELECT
             account.id,
             account.first_name,
             account.last_name,
             account.email,
             account.phone,
             account.status,
             account.is_verified,
             account.created_at,
             MAX(appointment.appointment_date) AS last_visit
           FROM users AS account
           LEFT JOIN patient_portal_appointments AS appointment
             ON appointment.user_id = account.id::text
           WHERE LOWER(account.role) = 'patient'
             AND COALESCE(account.is_archived, FALSE) = FALSE
           GROUP BY
             account.id, account.first_name, account.last_name, account.email, account.phone,
             account.status, account.is_verified, account.created_at
           ORDER BY account.last_name ASC NULLS LAST, account.first_name ASC NULLS LAST
           LIMIT 5000`
        );
        headers = ["ID", "First Name", "Last Name", "Email", "Phone", "Status", "Verified", "Last Visit", "Created At"];
        rows = result.rows.map((row) => [
          row.id,
          row.first_name,
          row.last_name,
          row.email,
          row.phone,
          row.status,
          row.is_verified,
          row.last_visit,
          row.created_at,
        ]);
        fileName = "patients.csv";
      } else if (report === "staff") {
        const result = await db.query(
          `SELECT id, first_name, last_name, email, phone, status, is_verified, created_at
           FROM users
           WHERE LOWER(role) = 'staff'
             AND COALESCE(is_archived, FALSE) = FALSE
           ORDER BY last_name ASC NULLS LAST, first_name ASC NULLS LAST
           LIMIT 5000`
        );
        headers = ["ID", "First Name", "Last Name", "Email", "Phone", "Status", "Verified", "Created At"];
        rows = result.rows.map((row) => [
          row.id,
          row.first_name,
          row.last_name,
          row.email,
          row.phone,
          row.status,
          row.is_verified,
          row.created_at,
        ]);
        fileName = "staff.csv";
      } else if (report === "dentists") {
        const result = await db.query(
          `SELECT
             account.id,
             account.first_name,
             account.last_name,
             account.email,
             account.phone,
             account.status,
             account.is_verified,
             profile.specialization,
             profile.schedule_notes,
             account.created_at
           FROM users AS account
           LEFT JOIN admin_portal_dentist_profiles AS profile
             ON profile.user_id = account.id::text
           WHERE LOWER(account.role) = 'dentist'
             AND COALESCE(account.is_archived, FALSE) = FALSE
           ORDER BY account.last_name ASC NULLS LAST, account.first_name ASC NULLS LAST
           LIMIT 5000`
        );
        headers = [
          "ID",
          "First Name",
          "Last Name",
          "Email",
          "Phone",
          "Status",
          "Verified",
          "Specialization",
          "Schedule Notes",
          "Created At",
        ];
        rows = result.rows.map((row) => [
          row.id,
          row.first_name,
          row.last_name,
          row.email,
          row.phone,
          row.status,
          row.is_verified,
          row.specialization,
          row.schedule_notes,
          row.created_at,
        ]);
        fileName = "dentists.csv";
      } else if (report === "appointments") {
        const result = await db.query(
          `SELECT
             appointment.appointment_date,
             appointment.appointment_time,
             CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name,
             appointment.service_name,
             appointment.dentist_name,
             appointment.status,
             appointment.estimated_cost
           FROM patient_portal_appointments AS appointment
           JOIN users AS patient ON patient.id::text = appointment.user_id
           ORDER BY appointment.appointment_date DESC, appointment.appointment_time DESC
           LIMIT 5000`
        );
        headers = ["Date", "Time", "Patient", "Treatment", "Dentist", "Status", "Estimated Cost"];
        rows = result.rows.map((row) => [
          row.appointment_date,
          row.appointment_time,
          row.patient_name,
          row.service_name,
          row.dentist_name,
          row.status,
          row.estimated_cost,
        ]);
        fileName = "appointments.csv";
      } else if (report === "accounts") {
        const result = await db.query(
          `SELECT id, first_name, last_name, email, phone, role, status, is_verified, created_at
           FROM users
           WHERE LOWER(role) IN ('admin', 'dentist', 'staff', 'patient')
             AND COALESCE(is_archived, FALSE) = FALSE
           ORDER BY role ASC, last_name ASC NULLS LAST, first_name ASC NULLS LAST
           LIMIT 5000`
        );
        headers = ["ID", "First Name", "Last Name", "Email", "Phone", "Role", "Status", "Verified", "Created At"];
        rows = result.rows.map((row) => [
          row.id,
          row.first_name,
          row.last_name,
          row.email,
          row.phone,
          row.role,
          row.status,
          row.is_verified,
          row.created_at,
        ]);
        fileName = "accounts.csv";
      } else {
        return res.status(404).json({ message: "That export report is not available." });
      }

      const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
      return res.send(`\uFEFF${csv}`);
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin export error:", error.message);
      return res.status(500).json({ message: "Unable to export this report." });
    }
  });

  return router;
}

module.exports = {
  createAdminPortalRouter,
  requireAdminAccount,
  stringValue,
  normalizeEmail,
  normalizePhone,
  isIsoDate,
  isTime,
  numericId,
  csvCell,
  count,
};
