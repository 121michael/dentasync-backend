"use strict";

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { writeAdminAudit } = require("../services/adminAudit");
const { linkClinicalRecordsToUser } = require("../services/clinicalPatients");

const ACCOUNT_ROLES = new Set(["admin", "dentist", "staff", "patient"]);
const SCHEDULE_TYPES = new Set([
  "dentist",
  "staff",
  "clinic_hours",
  "blocked",
  "availability",
]);
const DEFAULT_AI_SETTINGS = {
  amethystAiEnabled: true,
  predictiveDiagnostics: true,
  automatedReminders: true,
  waitingTimePrediction: true,
  aiChatbot: false,
  scheduledSystemUpdates: true,
  chatbotKnowledgeMode: "clinic",
  diagnosticsSensitivity: "balanced",
};

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function numericId(value) {
  const id = Number.parseInt(value, 10);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function count(row, key = "count") {
  return Number.parseInt(row?.[key] || "0", 10);
}

function isMissingRelation(error) {
  return error?.code === "42P01";
}

function migrationUnavailable(res, resource = "Admin command center") {
  return res.status(503).json({
    message: `${resource} tables are not available. Run npm run migrate:admin-command-center.`,
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

function mapAccount(row, extras = {}) {
  const firstName = row.first_name || "";
  const lastName = row.last_name || "";
  return {
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
    archivedAt: row.archived_at || null,
    archivedBy: row.archived_by || null,
    operationalRole: extras.operationalRole ?? row.operational_role ?? "",
    specialization: extras.specialization ?? row.specialization ?? "",
    scheduleNotes: extras.scheduleNotes ?? row.schedule_notes ?? "",
    lastVisit: extras.lastVisit ?? row.last_visit ?? null,
    dateOfBirth: extras.dateOfBirth ?? row.date_of_birth ?? null,
    gender: extras.gender ?? row.gender ?? "",
    age: extras.age ?? row.age ?? null,
    lastTreatment: extras.lastTreatment ?? row.last_treatment ?? "",
  };
}

function mapSchedule(row) {
  return {
    id: row.id,
    scheduleType: row.schedule_type,
    title: row.title,
    assigneeId: row.assignee_id || null,
    assigneeName: row.assignee_name || "",
    dayOfWeek: row.day_of_week === null || row.day_of_week === undefined ? null : Number(row.day_of_week),
    scheduleDate: row.schedule_date || null,
    startTime: row.start_time || null,
    endTime: row.end_time || null,
    notes: row.notes || "",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapAudit(row) {
  return {
    id: row.id,
    timestamp: row.created_at,
    user: row.actor_name || "System",
    role: (row.actor_role || "").toLowerCase(),
    action: row.action,
    target: row.target_label || [row.target_type, row.target_id].filter(Boolean).join(" "),
    targetType: row.target_type || null,
    targetId: row.target_id || null,
    result: row.result || "success",
    detail: row.detail || "",
    ipAddress: row.ip_address || null,
    sessionId: row.session_id || null,
  };
}

function requestIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim().slice(0, 80);
  }
  return req.ip ? String(req.ip).slice(0, 80) : null;
}

function adminLabel(admin) {
  return `${admin?.first_name || ""} ${admin?.last_name || ""}`.trim() || admin?.email || "Administrator";
}

async function audit(db, req, entry) {
  return writeAdminAudit(db, {
    actorId: req.admin?.id,
    actorName: adminLabel(req.admin),
    actorRole: "admin",
    ipAddress: requestIp(req),
    sessionId: req.headers?.authorization ? "session" : null,
    ...entry,
  });
}

async function countActiveAdmins(client) {
  const result = await client.query(
    `SELECT COUNT(*) AS count
     FROM users
     WHERE LOWER(role) = 'admin'
       AND is_verified = TRUE
       AND COALESCE(is_archived, FALSE) = FALSE
       AND LOWER(COALESCE(status, 'active')) NOT IN ('inactive', 'disabled', 'suspended', 'rejected')`
  );
  return count(result.rows[0]);
}

function attachAdminCommandCenterRoutes(router, { db }) {
  router.get("/status", async (_req, res) => {
    try {
      let database = false;
      try {
        await db.query("SELECT 1");
        database = true;
      } catch {
        database = false;
      }

      let liveChannels = 0;
      try {
        const queue = await db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_queue_entries
           WHERE status IN ('checked_in', 'waiting', 'preparing', 'dentist')`
        );
        const appointments = await db.query(
          `SELECT COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE appointment_date = CURRENT_DATE
             AND status IN ('confirmed', 'checked_in', 'pending', 'in_progress')`
        );
        liveChannels = count(queue.rows[0]) + count(appointments.rows[0]);
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      return res.json({
        coreInfrastructureOnline: database,
        activeOperationsTerminals: liveChannels,
        checkedAt: new Date().toISOString(),
        date: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Admin status error:", error.message);
      return res.status(500).json({ message: "Unable to load system status." });
    }
  });

  router.get("/registrations/pending", async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query);
    try {
      const countResult = await db.query(
        `SELECT COUNT(*) AS count
         FROM users
         WHERE COALESCE(is_archived, FALSE) = FALSE
           AND (
             is_verified = FALSE
             OR LOWER(COALESCE(status, 'active')) IN ('pending', 'unverified')
           )
           AND LOWER(role) = 'patient'`
      );
      const result = await db.query(
        `SELECT
           id, first_name, last_name, email, phone, role, status, is_verified, created_at,
           CONCAT_WS(' ', first_name, last_name) AS full_name
         FROM users
         WHERE COALESCE(is_archived, FALSE) = FALSE
           AND (
             is_verified = FALSE
             OR LOWER(COALESCE(status, 'active')) IN ('pending', 'unverified')
           )
           AND LOWER(role) = 'patient'
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );
      return res.json({
        page,
        limit,
        total: count(countResult.rows[0]),
        requests: result.rows.map((row) => mapAccount(row)),
      });
    } catch (error) {
      console.error("Admin pending registrations error:", error.message);
      return res.status(500).json({ message: "Unable to load pending registrations." });
    }
  });

  async function setRegistrationDecision(req, res, decision) {
    const accountId = stringValue(req.params.id, 120);
    if (!accountId) {
      return res.status(400).json({ message: "A valid account ID is required." });
    }

    try {
      const existing = await db.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified, created_at
         FROM users
         WHERE id::text = $1
           AND COALESCE(is_archived, FALSE) = FALSE
         LIMIT 1`,
        [accountId]
      );
      if (!existing.rows.length) {
        return res.status(404).json({ message: "Registration request not found." });
      }

      const nextStatus = decision === "approve" ? "Active" : "Rejected";
      const verified = decision === "approve";
      const result = await db.query(
        `UPDATE users
         SET is_verified = $1,
             status = $2
         WHERE id::text = $3
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [verified, nextStatus, accountId]
      );

      await audit(db, req, {
        action: decision === "approve" ? "approve_registration" : "reject_registration",
        targetType: "account",
        targetId: accountId,
        targetLabel: existing.rows[0].email || accountId,
        result: "success",
        detail: `Registration ${decision}d for role ${existing.rows[0].role}.`,
      });

      if (decision === "approve") {
        try {
          await linkClinicalRecordsToUser(db, {
            id: result.rows[0].id,
            email: result.rows[0].email,
            phone: result.rows[0].phone,
          });
        } catch (linkError) {
          console.warn("Unable to link clinical records after approval:", linkError.message);
        }
      }

      return res.json({
        message:
          decision === "approve"
            ? "Account approved successfully. The patient can now open the dashboard and book appointments."
            : "Registration rejected. Login access is blocked.",
        account: mapAccount(result.rows[0]),
      });
    } catch (error) {
      console.error(`Admin registration ${decision} error:`, error.message);
      return res.status(500).json({ message: `Unable to ${decision} registration.` });
    }
  }

  router.post("/registrations/:id/approve", (req, res) => setRegistrationDecision(req, res, "approve"));
  router.post("/registrations/:id/reject", (req, res) => setRegistrationDecision(req, res, "reject"));

  router.patch("/accounts/:id/lifecycle", async (req, res) => {
    const accountId = stringValue(req.params.id, 120);
    const action = stringValue(req.body?.action, 40)?.toLowerCase();
    const allowed = new Set([
      "verify",
      "approve",
      "reject",
      "suspend",
      "activate",
      "archive",
      "restore",
    ]);

    if (!accountId) {
      return res.status(400).json({ message: "A valid account ID is required." });
    }
    if (!allowed.has(action)) {
      return res.status(400).json({
        message: "Lifecycle action must be verify, approve, reject, suspend, activate, archive, or restore.",
      });
    }
    if (String(req.admin.id) === String(accountId) && ["suspend", "archive", "reject"].includes(action)) {
      return res.status(403).json({
        message: "You cannot suspend, archive, or reject the currently logged-in administrator account.",
      });
    }

    const client = await db.connect();
    let transactionOpen = false;
    try {
      await client.query("BEGIN");
      transactionOpen = true;

      const targetResult = await client.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified, is_archived, created_at
         FROM users
         WHERE id::text = $1
         FOR UPDATE`,
        [accountId]
      );
      const target = targetResult.rows[0];
      if (!target) {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(404).json({ message: "Account not found." });
      }

      if (action === "restore") {
        if (!target.is_archived) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(409).json({ message: "Account is not archived." });
        }
        const result = await client.query(
          `UPDATE users
           SET is_archived = FALSE,
               archived_at = NULL,
               archived_by = NULL,
               status = 'Active',
               is_verified = TRUE
           WHERE id::text = $1
           RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, archived_at, archived_by`,
          [accountId]
        );
        await client.query("COMMIT");
        transactionOpen = false;
        await audit(db, req, {
          action: "restore_account",
          targetType: "account",
          targetId: accountId,
          targetLabel: target.email,
          result: "success",
        });
        return res.json({ message: "User restored successfully.", account: mapAccount(result.rows[0]) });
      }

      if (target.is_archived && action !== "archive") {
        await client.query("ROLLBACK");
        transactionOpen = false;
        return res.status(409).json({ message: "Restore the archived account before applying other actions." });
      }

      if (["suspend", "archive"].includes(action) && String(target.role || "").toLowerCase() === "admin") {
        const activeAdmins = await countActiveAdmins(client);
        if (activeAdmins <= 1) {
          await client.query("ROLLBACK");
          transactionOpen = false;
          return res.status(409).json({
            message: "Cannot suspend or archive the last remaining active administrator.",
          });
        }
      }

      let sql;
      let params;
      let message;
      if (action === "verify" || action === "approve") {
        sql = `UPDATE users SET is_verified = TRUE, status = 'Active'
               WHERE id::text = $1
               RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, archived_at, archived_by`;
        params = [accountId];
        message =
          action === "verify"
            ? "Account verified successfully."
            : "Account approved successfully. The patient can now open the dashboard and book appointments.";
      } else if (action === "reject") {
        sql = `UPDATE users SET is_verified = FALSE, status = 'Rejected'
               WHERE id::text = $1
               RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, archived_at, archived_by`;
        params = [accountId];
        message = "Account rejected. Login access is blocked.";
      } else if (action === "suspend") {
        sql = `UPDATE users SET status = 'Suspended'
               WHERE id::text = $1
               RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, archived_at, archived_by`;
        params = [accountId];
        message = "Account suspended successfully.";
      } else if (action === "activate") {
        sql = `UPDATE users SET status = 'Active', is_verified = TRUE
               WHERE id::text = $1
               RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, archived_at, archived_by`;
        params = [accountId];
        message = "Account activated successfully.";
      } else {
        sql = `UPDATE users
               SET is_archived = TRUE,
                   status = 'Inactive',
                   archived_at = CURRENT_TIMESTAMP,
                   archived_by = $2
               WHERE id::text = $1
               RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at, archived_at, archived_by`;
        params = [accountId, String(req.admin.id)];
        message = "User archived successfully.";
      }

      const result = await client.query(sql, params);
      await client.query("COMMIT");
      transactionOpen = false;

      await audit(db, req, {
        action: `${action}_account`,
        targetType: "account",
        targetId: accountId,
        targetLabel: target.email,
        result: "success",
      });

      if (["approve", "verify", "activate"].includes(action) && result.rows[0]) {
        try {
          await linkClinicalRecordsToUser(db, result.rows[0]);
        } catch (linkError) {
          console.warn("Unable to link clinical records after lifecycle update:", linkError.message);
        }
      }

      return res.json({ message, account: mapAccount(result.rows[0]) });
    } catch (error) {
      if (transactionOpen) {
        await client.query("ROLLBACK");
      }
      if (error?.code === "42703") {
        return migrationUnavailable(res, "Archive metadata");
      }
      console.error("Admin lifecycle error:", error.message);
      return res.status(500).json({ message: "Unable to update account lifecycle." });
    } finally {
      client.release();
    }
  });

  router.patch("/accounts/:id/role", async (req, res) => {
    const accountId = stringValue(req.params.id, 120);
    const role = stringValue(req.body?.role, 40)?.toLowerCase();
    if (!accountId) {
      return res.status(400).json({ message: "A valid account ID is required." });
    }
    if (!ACCOUNT_ROLES.has(role)) {
      return res.status(400).json({ message: "Role must be admin, dentist, staff, or patient." });
    }
    if (String(req.admin.id) === String(accountId) && role !== "admin") {
      return res.status(403).json({ message: "You cannot remove your own administrator role." });
    }

    try {
      const target = await db.query(
        `SELECT id, role, email, is_verified, status, is_archived
         FROM users WHERE id::text = $1 LIMIT 1`,
        [accountId]
      );
      if (!target.rows.length || target.rows[0].is_archived) {
        return res.status(404).json({ message: "Account not found." });
      }

      if (String(target.rows[0].role || "").toLowerCase() === "admin" && role !== "admin") {
        const activeAdmins = await countActiveAdmins(db);
        if (activeAdmins <= 1) {
          return res.status(409).json({
            message: "Cannot change role of the last remaining active administrator.",
          });
        }
      }

      const result = await db.query(
        `UPDATE users
         SET role = $1
         WHERE id::text = $2
         RETURNING id, first_name, last_name, email, phone, role, status, is_verified, created_at`,
        [role, accountId]
      );

      await audit(db, req, {
        action: "change_role",
        targetType: "account",
        targetId: accountId,
        targetLabel: target.rows[0].email,
        result: "success",
        detail: `Role changed from ${target.rows[0].role} to ${role}.`,
      });

      return res.json({ message: "Role updated successfully.", account: mapAccount(result.rows[0]) });
    } catch (error) {
      console.error("Admin role change error:", error.message);
      return res.status(500).json({ message: "Unable to change account role." });
    }
  });

  router.post("/accounts/:id/reset-password", async (req, res) => {
    const accountId = stringValue(req.params.id, 120);
    if (!accountId) {
      return res.status(400).json({ message: "A valid account ID is required." });
    }

    const temporaryPassword =
      stringValue(req.body?.temporaryPassword, 72) ||
      `Amethyst-${crypto.randomBytes(4).toString("hex")}`;

    try {
      const target = await db.query(
        `SELECT id, email, is_archived FROM users WHERE id::text = $1 LIMIT 1`,
        [accountId]
      );
      if (!target.rows.length || target.rows[0].is_archived) {
        return res.status(404).json({ message: "Account not found." });
      }

      const passwordHash = await bcrypt.hash(temporaryPassword, 10);
      await db.query(
        `UPDATE users
         SET password_hash = $1,
             password_changed_at = CURRENT_TIMESTAMP
         WHERE id::text = $2`,
        [passwordHash, accountId]
      );

      await audit(db, req, {
        action: "reset_password",
        targetType: "account",
        targetId: accountId,
        targetLabel: target.rows[0].email,
        result: "warning",
        detail: "Administrator issued a temporary password reset.",
      });

      return res.json({
        message: "Password reset successfully.",
        temporaryPassword,
      });
    } catch (error) {
      console.error("Admin reset password error:", error.message);
      return res.status(500).json({ message: "Unable to reset password." });
    }
  });

  router.get("/archived", async (req, res) => {
    const search = stringValue(req.query.search, 100);
    const { page, limit, offset } = parsePagination(req.query);
    const params = [];
    const clauses = ["COALESCE(account.is_archived, FALSE) = TRUE"];

    if (search) {
      params.push(`%${search}%`);
      clauses.push(`(
        account.first_name ILIKE $${params.length}
        OR account.last_name ILIKE $${params.length}
        OR account.email ILIKE $${params.length}
        OR account.phone ILIKE $${params.length}
        OR account.id::text ILIKE $${params.length}
      )`);
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
           account.archived_at,
           account.archived_by,
           CONCAT_WS(' ', account.first_name, account.last_name) AS full_name,
           CONCAT_WS(' ', archiver.first_name, archiver.last_name) AS archived_by_name
         FROM users AS account
         LEFT JOIN users AS archiver ON archiver.id::text = account.archived_by
         WHERE ${whereSql}
         ORDER BY account.archived_at DESC NULLS LAST, account.created_at DESC
         LIMIT $${listParams.length - 1} OFFSET $${listParams.length}`,
        listParams
      );

      return res.json({
        page,
        limit,
        total: count(countResult.rows[0]),
        records: result.rows.map((row) => ({
          ...mapAccount(row),
          recordType: (row.role || "user").toLowerCase(),
          archivedByName: row.archived_by_name || row.archived_by || "Administrator",
          status: "archived",
        })),
      });
    } catch (error) {
      if (error?.code === "42703" || isMissingRelation(error)) {
        return migrationUnavailable(res, "Archived records");
      }
      console.error("Admin archived list error:", error.message);
      return res.status(500).json({ message: "Unable to load archived records." });
    }
  });

  router.delete("/archived/:id", async (req, res) => {
    const accountId = stringValue(req.params.id, 120);
    const confirm = stringValue(req.body?.confirm, 40)?.toLowerCase();
    if (!accountId) {
      return res.status(400).json({ message: "A valid record ID is required." });
    }
    if (confirm !== "delete") {
      return res.status(400).json({
        message: 'Permanent delete requires confirm: "delete".',
      });
    }
    if (String(req.admin.id) === String(accountId)) {
      return res.status(403).json({ message: "You cannot permanently delete your own account." });
    }

    try {
      const target = await db.query(
        `SELECT id, email, role, is_archived
         FROM users WHERE id::text = $1 LIMIT 1`,
        [accountId]
      );
      if (!target.rows.length || !target.rows[0].is_archived) {
        return res.status(404).json({ message: "Archived record not found." });
      }

      await db.query(`DELETE FROM users WHERE id::text = $1`, [accountId]);
      await audit(db, req, {
        action: "delete_account_permanent",
        targetType: "account",
        targetId: accountId,
        targetLabel: target.rows[0].email,
        result: "warning",
        detail: "Archived record permanently deleted.",
      });

      return res.json({ message: "Record deleted permanently." });
    } catch (error) {
      console.error("Admin permanent delete error:", error.message);
      return res.status(500).json({ message: "Unable to permanently delete the record." });
    }
  });

  router.get("/ai-settings", async (_req, res) => {
    try {
      const result = await db.query(
        `SELECT setting_value, updated_at, updated_by
         FROM admin_portal_settings
         WHERE setting_key = 'ai'
         LIMIT 1`
      );
      const settings = {
        ...DEFAULT_AI_SETTINGS,
        ...(result.rows[0]?.setting_value || {}),
      };
      return res.json({
        settings,
        updatedAt: result.rows[0]?.updated_at || null,
        updatedBy: result.rows[0]?.updated_by || null,
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin AI settings read error:", error.message);
      return res.status(500).json({ message: "Unable to load AI settings." });
    }
  });

  router.put("/ai-settings", async (req, res) => {
    const payload = req.body?.settings && typeof req.body.settings === "object"
      ? req.body.settings
      : req.body;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return res.status(400).json({ message: "Provide AI settings values to update." });
    }

    const next = {
      ...DEFAULT_AI_SETTINGS,
      amethystAiEnabled: Boolean(payload.amethystAiEnabled),
      predictiveDiagnostics: Boolean(payload.predictiveDiagnostics),
      automatedReminders: Boolean(payload.automatedReminders),
      waitingTimePrediction: Boolean(payload.waitingTimePrediction),
      aiChatbot: Boolean(payload.aiChatbot),
      scheduledSystemUpdates: Boolean(payload.scheduledSystemUpdates),
      chatbotKnowledgeMode: stringValue(payload.chatbotKnowledgeMode, 40) || "clinic",
      diagnosticsSensitivity: stringValue(payload.diagnosticsSensitivity, 40) || "balanced",
    };

    try {
      const result = await db.query(
        `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
         VALUES ('ai', $1::jsonb, CURRENT_TIMESTAMP, $2)
         ON CONFLICT (setting_key) DO UPDATE SET
           setting_value = EXCLUDED.setting_value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by
         RETURNING setting_value, updated_at, updated_by`,
        [JSON.stringify(next), String(req.admin.id)]
      );

      await audit(db, req, {
        action: "update_ai_settings",
        targetType: "settings",
        targetId: "ai",
        targetLabel: "Amethyst AI Core Settings",
        result: "success",
        detail: JSON.stringify(next),
      });

      return res.json({
        message: "AI settings updated successfully.",
        settings: result.rows[0].setting_value,
        updatedAt: result.rows[0].updated_at,
        updatedBy: result.rows[0].updated_by,
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res);
      }
      console.error("Admin AI settings write error:", error.message);
      return res.status(500).json({ message: "Unable to save AI settings." });
    }
  });

  router.get("/schedules", async (req, res) => {
    const type = stringValue(req.query.type, 40)?.toLowerCase();
    const params = [];
    const clauses = ["COALESCE(is_active, TRUE) = TRUE"];
    if (type) {
      if (!SCHEDULE_TYPES.has(type)) {
        return res.status(400).json({ message: "Invalid schedule type filter." });
      }
      params.push(type);
      clauses.push(`schedule_type = $${params.length}`);
    }

    try {
      const result = await db.query(
        `SELECT *
         FROM admin_portal_schedules
         WHERE ${clauses.join(" AND ")}
         ORDER BY
           schedule_date ASC NULLS LAST,
           day_of_week ASC NULLS LAST,
           start_time ASC NULLS LAST,
           id ASC`,
        params
      );

      let appointments = [];
      try {
        const appointmentResult = await db.query(
          `SELECT id, dentist_id, dentist_name, appointment_date, appointment_time, status, service_name,
                  CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name
           FROM patient_portal_appointments AS appointment
           LEFT JOIN users AS patient ON patient.id::text = appointment.user_id
           WHERE appointment_date >= CURRENT_DATE - INTERVAL '1 day'
             AND appointment_date <= CURRENT_DATE + INTERVAL '14 days'
             AND status NOT IN ('cancelled')
           ORDER BY appointment_date ASC, appointment_time ASC
           LIMIT 100`
        );
        appointments = appointmentResult.rows.map((row) => ({
          id: row.id,
          dentistId: row.dentist_id,
          dentistName: row.dentist_name,
          date: row.appointment_date,
          time: row.appointment_time,
          status: row.status,
          treatment: row.service_name,
          patientName: row.patient_name || "Patient",
        }));
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      let clinicHours = null;
      try {
        const settings = await db.query(
          `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'clinic' LIMIT 1`
        );
        clinicHours = settings.rows[0]?.setting_value?.operatingHours || null;
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      return res.json({
        schedules: result.rows.map(mapSchedule),
        appointments,
        clinicHours,
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Schedule");
      }
      console.error("Admin schedules list error:", error.message);
      return res.status(500).json({ message: "Unable to load clinic schedules." });
    }
  });

  router.post("/schedules", async (req, res) => {
    const scheduleType = stringValue(req.body?.scheduleType, 40)?.toLowerCase();
    const title = stringValue(req.body?.title, 160);
    const assigneeId = stringValue(req.body?.assigneeId, 120);
    const assigneeName = stringValue(req.body?.assigneeName, 160);
    const dayOfWeek =
      req.body?.dayOfWeek === null || req.body?.dayOfWeek === undefined || req.body?.dayOfWeek === ""
        ? null
        : Number.parseInt(req.body.dayOfWeek, 10);
    const scheduleDate = stringValue(req.body?.scheduleDate, 10);
    const startTime = stringValue(req.body?.startTime, 5);
    const endTime = stringValue(req.body?.endTime, 5);
    const notes = stringValue(req.body?.notes, 2000);

    if (!SCHEDULE_TYPES.has(scheduleType)) {
      return res.status(400).json({ message: "A valid schedule type is required." });
    }
    if (!title) {
      return res.status(400).json({ message: "Schedule title is required." });
    }
    if (dayOfWeek !== null && (Number.isNaN(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6)) {
      return res.status(400).json({ message: "dayOfWeek must be 0–6 when provided." });
    }
    if (scheduleDate && !isIsoDate(scheduleDate)) {
      return res.status(400).json({ message: "scheduleDate must use YYYY-MM-DD." });
    }
    if ((startTime && !isTime(startTime)) || (endTime && !isTime(endTime))) {
      return res.status(400).json({ message: "Times must use HH:MM." });
    }
    if (startTime && endTime && startTime >= endTime) {
      return res.status(400).json({ message: "endTime must be after startTime." });
    }

    try {
      if (scheduleType === "blocked" && scheduleDate && startTime && endTime) {
        const conflict = await db.query(
          `SELECT id
           FROM patient_portal_appointments
           WHERE appointment_date = $1::date
             AND status NOT IN ('cancelled', 'no_show')
             AND appointment_time >= $2
             AND appointment_time < $3
           LIMIT 1`,
          [scheduleDate, startTime, endTime]
        );
        if (conflict.rows.length) {
          return res.status(409).json({
            message: "Cannot block this window because appointments already exist in that range.",
          });
        }
      }

      const result = await db.query(
        `INSERT INTO admin_portal_schedules (
           schedule_type, title, assignee_id, assignee_name, day_of_week,
           schedule_date, start_time, end_time, notes, created_by, updated_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING *`,
        [
          scheduleType,
          title,
          assigneeId,
          assigneeName,
          dayOfWeek,
          scheduleDate,
          startTime,
          endTime,
          notes,
          String(req.admin.id),
        ]
      );

      await audit(db, req, {
        action: "create_schedule",
        targetType: "schedule",
        targetId: String(result.rows[0].id),
        targetLabel: title,
        result: "success",
      });

      return res.status(201).json({
        message: "Schedule added successfully.",
        schedule: mapSchedule(result.rows[0]),
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Schedule");
      }
      console.error("Admin schedule create error:", error.message);
      return res.status(500).json({ message: "Unable to create schedule." });
    }
  });

  router.patch("/schedules/:id", async (req, res) => {
    const id = numericId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "A valid schedule ID is required." });
    }

    const fields = [];
    const params = [];
    const setters = {
      title: stringValue(req.body?.title, 160),
      assigneeId: stringValue(req.body?.assigneeId, 120),
      assigneeName: stringValue(req.body?.assigneeName, 160),
      notes: stringValue(req.body?.notes, 2000),
      startTime: stringValue(req.body?.startTime, 5),
      endTime: stringValue(req.body?.endTime, 5),
      scheduleDate: stringValue(req.body?.scheduleDate, 10),
    };

    if (Object.prototype.hasOwnProperty.call(req.body || {}, "title")) {
      if (!setters.title) return res.status(400).json({ message: "Title cannot be empty." });
      params.push(setters.title);
      fields.push(`title = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "assigneeId")) {
      params.push(setters.assigneeId);
      fields.push(`assignee_id = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "assigneeName")) {
      params.push(setters.assigneeName);
      fields.push(`assignee_name = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "notes")) {
      params.push(setters.notes);
      fields.push(`notes = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "startTime")) {
      if (setters.startTime && !isTime(setters.startTime)) {
        return res.status(400).json({ message: "startTime must use HH:MM." });
      }
      params.push(setters.startTime);
      fields.push(`start_time = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "endTime")) {
      if (setters.endTime && !isTime(setters.endTime)) {
        return res.status(400).json({ message: "endTime must use HH:MM." });
      }
      params.push(setters.endTime);
      fields.push(`end_time = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "scheduleDate")) {
      if (setters.scheduleDate && !isIsoDate(setters.scheduleDate)) {
        return res.status(400).json({ message: "scheduleDate must use YYYY-MM-DD." });
      }
      params.push(setters.scheduleDate);
      fields.push(`schedule_date = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "dayOfWeek")) {
      const day =
        req.body.dayOfWeek === null || req.body.dayOfWeek === ""
          ? null
          : Number.parseInt(req.body.dayOfWeek, 10);
      if (day !== null && (Number.isNaN(day) || day < 0 || day > 6)) {
        return res.status(400).json({ message: "dayOfWeek must be 0–6." });
      }
      params.push(day);
      fields.push(`day_of_week = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "isActive")) {
      params.push(Boolean(req.body.isActive));
      fields.push(`is_active = $${params.length}`);
    }
    if (Object.prototype.hasOwnProperty.call(req.body || {}, "scheduleType")) {
      const scheduleType = stringValue(req.body.scheduleType, 40)?.toLowerCase();
      if (!SCHEDULE_TYPES.has(scheduleType)) {
        return res.status(400).json({ message: "Invalid schedule type." });
      }
      params.push(scheduleType);
      fields.push(`schedule_type = $${params.length}`);
    }

    if (!fields.length) {
      return res.status(400).json({ message: "Provide schedule fields to update." });
    }

    params.push(String(req.admin.id));
    fields.push(`updated_by = $${params.length}`);
    fields.push("updated_at = CURRENT_TIMESTAMP");
    params.push(id);

    try {
      const result = await db.query(
        `UPDATE admin_portal_schedules
         SET ${fields.join(", ")}
         WHERE id = $${params.length}
         RETURNING *`,
        params
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Schedule not found." });
      }

      await audit(db, req, {
        action: "update_schedule",
        targetType: "schedule",
        targetId: String(id),
        targetLabel: result.rows[0].title,
        result: "success",
      });

      return res.json({ message: "Schedule updated successfully.", schedule: mapSchedule(result.rows[0]) });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Schedule");
      }
      console.error("Admin schedule update error:", error.message);
      return res.status(500).json({ message: "Unable to update schedule." });
    }
  });

  router.delete("/schedules/:id", async (req, res) => {
    const id = numericId(req.params.id);
    if (!id) {
      return res.status(400).json({ message: "A valid schedule ID is required." });
    }

    try {
      const result = await db.query(
        `UPDATE admin_portal_schedules
         SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP, updated_by = $2
         WHERE id = $1
         RETURNING *`,
        [id, String(req.admin.id)]
      );
      if (!result.rows.length) {
        return res.status(404).json({ message: "Schedule not found." });
      }

      await audit(db, req, {
        action: "remove_schedule",
        targetType: "schedule",
        targetId: String(id),
        targetLabel: result.rows[0].title,
        result: "success",
      });

      return res.json({ message: "Schedule removed successfully.", schedule: mapSchedule(result.rows[0]) });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Schedule");
      }
      console.error("Admin schedule delete error:", error.message);
      return res.status(500).json({ message: "Unable to remove schedule." });
    }
  });

  router.get("/audit-logs", async (req, res) => {
    const { page, limit, offset } = parsePagination(req.query, { defaultLimit: 50 });
    try {
      const countResult = await db.query(`SELECT COUNT(*) AS count FROM admin_portal_audit_logs`);
      const result = await db.query(
        `SELECT *
         FROM admin_portal_audit_logs
         ORDER BY created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset]
      );

      let loginActivity = [];
      try {
        const activityResult = await db.query(
          `SELECT
             activity.id,
             activity.user_id,
             activity.event_type,
             activity.ip_address,
             activity.created_at,
             CONCAT_WS(' ', account.first_name, account.last_name) AS full_name,
             account.role
           FROM patient_portal_login_activity AS activity
           LEFT JOIN users AS account ON account.id::text = activity.user_id
           ORDER BY activity.created_at DESC
           LIMIT 30`
        );
        loginActivity = activityResult.rows.map((row) => ({
          id: `login-${row.id}`,
          timestamp: row.created_at,
          user: row.full_name || row.user_id || "Unknown",
          role: (row.role || "").toLowerCase(),
          action: row.event_type,
          target: "Login session",
          result: String(row.event_type || "").toLowerCase().includes("fail") ? "failed" : "success",
          ipAddress: row.ip_address,
        }));
      } catch (error) {
        if (!isMissingRelation(error)) {
          throw error;
        }
      }

      return res.json({
        page,
        limit,
        total: count(countResult.rows[0]),
        logs: result.rows.map(mapAudit),
        loginActivity,
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Audit log");
      }
      console.error("Admin audit logs error:", error.message);
      return res.status(500).json({ message: "Unable to load audit logs." });
    }
  });

  router.post("/audit/run", async (req, res) => {
    try {
      await audit(db, req, {
        action: "run_security_audit",
        targetType: "system",
        targetId: "security",
        targetLabel: "Security Audit",
        result: "success",
        detail: "Administrator launched a security audit review.",
      });

      const [securitySummary, auditCount] = await Promise.all([
        db.query(
          `SELECT
             COUNT(*) FILTER (WHERE event_type ILIKE '%fail%') AS failed,
             COUNT(*) AS total
           FROM patient_portal_login_activity
           WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`
        ).catch((error) => {
          if (isMissingRelation(error)) return { rows: [{ failed: "0", total: "0" }] };
          throw error;
        }),
        db.query(
          `SELECT COUNT(*) AS count
           FROM admin_portal_audit_logs
           WHERE created_at >= CURRENT_TIMESTAMP - INTERVAL '7 days'`
        ),
      ]);

      return res.json({
        message: "Security audit completed.",
        summary: {
          failedLogins7d: count(securitySummary.rows[0], "failed"),
          loginEvents7d: count(securitySummary.rows[0], "total"),
          adminActions7d: count(auditCount.rows[0]),
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      if (isMissingRelation(error)) {
        return migrationUnavailable(res, "Audit log");
      }
      console.error("Admin security audit error:", error.message);
      return res.status(500).json({ message: "Unable to run security audit." });
    }
  });
}

module.exports = {
  attachAdminCommandCenterRoutes,
  DEFAULT_AI_SETTINGS,
};
