"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const envPath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

function assertLocalPostgresOnly() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    throw new Error("DATABASE_URL must be unset for local disposable PostgreSQL tests.");
  }
  const host = String(process.env.DB_HOST || "localhost").trim();
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Refusing non-local DB_HOST ${host}`);
  }
  if (!String(process.env.DB_USER || "").trim()) {
    throw new Error("DB_USER is required for local disposable PostgreSQL.");
  }
}

assertLocalPostgresOnly();

const dbName = `ds_arch_purge_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-disposable-jwt-secret";

const migrations = path.join(__dirname, "..", "migrations");
function sqlFile(name) {
  return fs.readFileSync(path.join(migrations, name), "utf8");
}

test("Admin can permanently delete an archived patient without removing clinic history", { timeout: 90000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  const files = [
    "000_create_users.sql",
    "001_create_otp_verification_requests.sql",
    "002_create_patient_portal.sql",
    "003_create_password_reset_requests.sql",
    "004_create_staff_portal.sql",
    "005_create_admin_portal.sql",
    "007_create_document_sync.sql",
    "008_create_admin_command_center.sql",
    "009_create_clinical_patient_records.sql",
    "010_create_staff_operations.sql",
    "011_create_patient_sms.sql",
    "013_paper_gap_features.sql",
    "015_admin_dashboard_updates.sql",
    "016_staff_walkin_qr.sql",
    "026_queue_wait_estimates.sql",
    "027_visit_multiple_procedures.sql",
    "034_patient_ai_conversations.sql",
    "035_daily_queue_numbers.sql",
    "036_dental_wellness_assessments.sql",
    "040_dental_procedure_authorizations.sql",
    "041_patient_medical_documents.sql",
    "044_appointment_sms_reminders.sql",
    "052_clinic_branches.sql",
    "061_hmo_verification_submissions.sql",
  ];
  for (const file of files) {
    try {
      await db.query(sqlFile(file));
    } catch (error) {
      if (error?.code !== "42P01" && error?.code !== "42703") throw error;
    }
  }
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS branch_id BIGINT;
  `);

  const password = "AdminLogin1234";
  const hash = await bcrypt.hash(password, 4);
  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.purge@example.test', '09170001111', $1, 'admin', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );
  const dentist = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Dina', 'Dentist', 'dina.purge@example.test', '09170004444', $1, 'dentist', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );
  const archived = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, is_archived, archived_at, archived_by, patient_id, patient_category)
     VALUES ('Nico', 'Archive', 'nico.archive@example.test', '09170002222', $1, 'patient', TRUE, 'Suspended', TRUE, CURRENT_TIMESTAMP, $2, 'P202611_99', 'regular')
     RETURNING id`,
    [hash, String(admin.rows[0].id)]
  );
  const otherArchived = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, is_archived, archived_at, patient_id)
     VALUES ('Remy', 'Kept', 'remy.kept@example.test', '09170003333', $1, 'patient', TRUE, 'Pending', TRUE, CURRENT_TIMESTAMP, 'P202611_98')
     RETURNING id`,
    [hash]
  );
  const activePatient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, patient_id)
     VALUES ('Active', 'Patient', 'active.patient@example.test', '09170005555', $1, 'patient', TRUE, 'Active', 'P202611_97')
     RETURNING id`,
    [hash]
  );
  const adminId = String(admin.rows[0].id);
  const dentistId = String(dentist.rows[0].id);
  const archivedId = String(archived.rows[0].id);
  const otherId = String(otherArchived.rows[0].id);
  const activeId = String(activePatient.rows[0].id);

  await db.query(`INSERT INTO patient_portal_profiles (user_id) VALUES ($1)`, [archivedId]);
  const appt = await db.query(
    `INSERT INTO patient_portal_appointments
      (user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time, coverage_type, estimated_cost, status)
     VALUES ($1, 'cleaning', 'Cleaning', 'd1', 'Dr Test', CURRENT_DATE, '09:00', 'hmo', 1000, 'completed')
     RETURNING id`,
    [archivedId]
  );
  const queue = await db.query(
    `INSERT INTO patient_portal_queue_entries (user_id, appointment_id, token, position, status)
     VALUES ($1, $2, 'Q-NICO', 1, 'completed')
     RETURNING id`,
    [archivedId, appt.rows[0].id]
  );
  const record = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CR-NICO', 'Nico', 'Archive', $1)
     RETURNING id`,
    [archivedId]
  );
  await db.query(
    `INSERT INTO clinic_patient_treatments (clinical_record_id, treatment, queue_entry_id, appointment_id)
     VALUES ($1, 'Cleaning', $2, $3)`,
    [record.rows[0].id, queue.rows[0].id, appt.rows[0].id]
  );
  await db.query(
    `INSERT INTO dental_wellness_assessments (clinical_record_id, patient_user_id, assessment_date, wellness_score, dentist_id)
     VALUES ($1, $2, CURRENT_DATE, 80, 'd1')`,
    [record.rows[0].id, archivedId]
  );
  const branch = await db.query(`SELECT id FROM clinic_branches LIMIT 1`);
  if (branch.rows[0]) {
    await db.query(
      `INSERT INTO patient_hmo_submissions
        (user_id, source, appointment_id, hmo_provider, hmo_member_number, verification_branch_id, verification_status)
       VALUES ($1, 'appointment', $2, 'Intellicare', 'HMO-999', $3, 'verified')`,
      [archivedId, appt.rows[0].id, branch.rows[0].id]
    );
  }
  await db.query(
    `INSERT INTO clinic_appointment_sms_reminders
      (appointment_id, patient_user_id, reminder_kind, appointment_at, scheduled_for, status)
     VALUES ($1, $2, '24h', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'sent')`,
    [appt.rows[0].id, archivedId]
  );

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, notifyAdmin: async () => {} }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  function tokenFor(id, role) {
    return jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  }

  async function api(method, urlPath, { role, id, body } = {}) {
    const headers = { "content-type": "application/json" };
    if (id) headers.authorization = `Bearer ${tokenFor(id, role)}`;
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  const listed = await api("GET", "/api/admin/archived?role=patient&limit=50", { role: "admin", id: adminId });
  assert.equal(listed.status, 200);
  const listedIds = (listed.json.records || []).map((row) => String(row.id));
  assert.ok(listedIds.includes(archivedId));
  assert.ok(listedIds.includes(otherId));
  const listedNico = listed.json.records.find((row) => String(row.id) === archivedId);
  assert.equal(listedNico.patientId, "P202611_99");

  const denied = await api("DELETE", `/api/admin/archived/${archivedId}`, {
    role: "dentist",
    id: dentistId,
    body: { confirm: "delete" },
  });
  assert.equal(denied.status, 403);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM users WHERE id::text = $1`, [archivedId])).rows[0].count, 1);

  const activeDenied = await api("DELETE", `/api/admin/archived/${activeId}`, {
    role: "admin",
    id: adminId,
    body: { confirm: "delete" },
  });
  assert.equal(activeDenied.status, 409);
  assert.match(String(activeDenied.json.message), /not archived/i);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM users WHERE id::text = $1`, [activeId])).rows[0].count, 1);

  const missingConfirm = await api("DELETE", `/api/admin/archived/${archivedId}`, {
    role: "admin",
    id: adminId,
    body: {},
  });
  assert.equal(missingConfirm.status, 400);

  const removed = await api("DELETE", `/api/admin/archived/${archivedId}`, {
    role: "admin",
    id: adminId,
    body: { confirm: "delete" },
  });
  assert.equal(removed.status, 200, removed.json.message);
  assert.match(removed.json.message, /permanently deleted/i);
  assert.equal(JSON.stringify(removed.json).includes("nico.archive@example.test"), false);

  const gone = await db.query(`SELECT id FROM users WHERE id::text = $1`, [archivedId]);
  assert.equal(gone.rows.length, 0);
  const clinical = await db.query(`SELECT linked_user_id, first_name FROM clinic_patient_records WHERE record_code = 'CR-NICO'`);
  assert.equal(clinical.rows.length, 1);
  assert.equal(clinical.rows[0].linked_user_id, null);
  const treatments = await db.query(`SELECT treatment FROM clinic_patient_treatments WHERE clinical_record_id = $1`, [
    record.rows[0].id,
  ]);
  assert.equal(treatments.rows[0].treatment, "Cleaning");
  const otherStill = await db.query(`SELECT is_archived FROM users WHERE id::text = $1`, [otherId]);
  assert.equal(otherStill.rows[0].is_archived, true);

  const reloaded = await api("GET", "/api/admin/archived?role=patient&limit=50", { role: "admin", id: adminId });
  const reloadedIds = (reloaded.json.records || []).map((row) => String(row.id));
  assert.equal(reloadedIds.includes(archivedId), false);
  assert.ok(reloadedIds.includes(otherId));

  const repeat = await api("DELETE", `/api/admin/archived/${archivedId}`, {
    role: "admin",
    id: adminId,
    body: { confirm: "delete" },
  });
  assert.equal(repeat.status, 404);

  await db.query(`UPDATE users SET is_archived = FALSE, archived_at = NULL, status = 'Active' WHERE id::text = $1`, [
    otherId,
  ]);
  const restoredDenied = await api("DELETE", `/api/admin/archived/${otherId}`, {
    role: "admin",
    id: adminId,
    body: { confirm: "delete" },
  });
  assert.equal(restoredDenied.status, 409);
  assert.equal((await db.query(`SELECT COUNT(*)::int AS count FROM users WHERE id::text = $1`, [otherId])).rows[0].count, 1);

  await db.query(
    `UPDATE users SET is_archived = TRUE, archived_at = CURRENT_TIMESTAMP, status = 'Pending' WHERE id::text = $1`,
    [otherId]
  );
  await db.query(`
    CREATE TABLE synthetic_account_locks (
      user_id BIGINT PRIMARY KEY
    )
  `);
  await db.query(`
    ALTER TABLE synthetic_account_locks
      ADD CONSTRAINT synthetic_account_locks_user_fk
      FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE RESTRICT
  `);
  const lock = await db.query(`INSERT INTO synthetic_account_locks (user_id) VALUES ($1) RETURNING user_id`, [otherId]);
  assert.equal(String(lock.rows[0].user_id), otherId);
  const blocked = await api("DELETE", `/api/admin/archived/${otherId}`, {
    role: "admin",
    id: adminId,
    body: { confirm: "delete" },
  });
  assert.equal(blocked.status, 409, blocked.json.message);
  assert.match(String(blocked.json.message), /could not be deleted/i);
  assert.equal(String(blocked.json.message).includes("synthetic_account_locks"), false);
  const blockedRow = await db.query(`SELECT is_archived, email FROM users WHERE id::text = $1`, [otherId]);
  assert.equal(blockedRow.rows[0].is_archived, true);
  assert.equal(blockedRow.rows[0].email, "remy.kept@example.test");
});
