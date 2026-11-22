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

const dbName = `ds_patient_tabs_${process.pid}_${Date.now().toString(36)}`;
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

test("Admin patient tabs separate pending approval from approved accounts", { timeout: 90000 }, async (t) => {
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
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
  `);

  const password = "AdminLogin1234";
  const hash = await bcrypt.hash(password, 4);

  async function addUser({ first, last, email, phone, role, verified, status, archived = false, patientId = null }) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, is_archived, patient_id, patient_category)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'regular')
       RETURNING id`,
      [first, last, email, phone, hash, role, verified, status, archived, patientId]
    );
    return String(result.rows[0].id);
  }

  const adminId = await addUser({
    first: "Ada",
    last: "Admin",
    email: "ada.tabs@example.test",
    phone: "09170001111",
    role: "admin",
    verified: true,
    status: "Active",
  });
  const staffId = await addUser({
    first: "Sam",
    last: "Staff",
    email: "sam.tabs@example.test",
    phone: "09170002222",
    role: "staff",
    verified: true,
    status: "Active",
  });

  const pendingOtpDone = await addUser({
    first: "Pia",
    last: "Pending",
    email: "pia.pending@example.test",
    phone: "09170003333",
    role: "patient",
    verified: true,
    status: "pending",
    patientId: "P-PENDING-1",
  });
  const pendingUnverified = await addUser({
    first: "Ula",
    last: "Unverified",
    email: "ula.unverified@example.test",
    phone: "09170004444",
    role: "patient",
    verified: false,
    status: "unverified",
    patientId: "P-PENDING-2",
  });
  const otpNotApproval = await addUser({
    first: "Otto",
    last: "OtpOnly",
    email: "otto.otp@example.test",
    phone: "09170005555",
    role: "patient",
    verified: false,
    status: "Active",
    patientId: "P-OTP-ONLY",
  });
  const approvedId = await addUser({
    first: "Ava",
    last: "Approved",
    email: "ava.approved@example.test",
    phone: "09170006666",
    role: "patient",
    verified: true,
    status: "Active",
    patientId: "P-APPROVED-1",
  });
  await addUser({
    first: "Riley",
    last: "Rejected",
    email: "riley.rejected@example.test",
    phone: "09170007777",
    role: "patient",
    verified: false,
    status: "Rejected",
    patientId: "P-REJECTED",
  });
  await addUser({
    first: "Dana",
    last: "Disabled",
    email: "dana.disabled@example.test",
    phone: "09170008888",
    role: "patient",
    verified: true,
    status: "Inactive",
    patientId: "P-DISABLED",
  });
  await addUser({
    first: "Archie",
    last: "Archived",
    email: "archie.archived@example.test",
    phone: "09170009999",
    role: "patient",
    verified: true,
    status: "Active",
    archived: true,
    patientId: "P-ARCHIVED",
  });

  for (let index = 0; index < 49; index += 1) {
    await addUser({
      first: "Page",
      last: `Patient${String(index).padStart(2, "0")}`,
      email: `page${index}@example.test`,
      phone: `0917100${String(index).padStart(4, "0")}`.slice(0, 11),
      role: "patient",
      verified: false,
      status: "pending",
      patientId: `P-PAGE-${index}`,
    });
  }

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

  const staffDenied = await api("GET", "/api/admin/patients?status=pending", { role: "staff", id: staffId });
  assert.equal(staffDenied.status, 403);

  const pendingPage1 = await api("GET", "/api/admin/patients?status=pending&limit=50&page=1", {
    role: "admin",
    id: adminId,
  });
  assert.equal(pendingPage1.status, 200, JSON.stringify(pendingPage1.json));
  assert.equal(pendingPage1.json.tabCounts.pending, 51);
  assert.equal(pendingPage1.json.tabCounts.approved, 1);
  assert.equal(pendingPage1.json.total, 51);
  assert.equal(pendingPage1.json.patients.length, 50);
  const pendingIds = pendingPage1.json.patients.map((row) => String(row.id));
  assert.ok(pendingIds.includes(pendingOtpDone));
  assert.ok(!pendingIds.includes(otpNotApproval));
  assert.ok(!pendingIds.includes(approvedId));
  assert.ok(pendingPage1.json.patients.every((row) => ["pending", "unverified"].includes(String(row.status).toLowerCase())));

  const pendingPage2 = await api("GET", "/api/admin/patients?status=pending&limit=50&page=2", {
    role: "admin",
    id: adminId,
  });
  assert.equal(pendingPage2.json.patients.length, 1);
  assert.equal(String(pendingPage2.json.patients[0].id), pendingUnverified);
  assert.equal(pendingPage2.json.tabCounts.pending, 51);

  const approved = await api("GET", "/api/admin/patients?status=approved", { role: "admin", id: adminId });
  assert.equal(approved.json.total, 1);
  assert.equal(String(approved.json.patients[0].id), approvedId);
  assert.equal(approved.json.patients[0].verified, true);
  assert.ok(!approved.json.patients.some((row) => String(row.id) === otpNotApproval));

  const searchPending = await api("GET", "/api/admin/patients?status=pending&search=Pia", {
    role: "admin",
    id: adminId,
  });
  assert.equal(searchPending.json.total, 1);
  assert.equal(searchPending.json.tabCounts.pending, 51);
  assert.equal(String(searchPending.json.patients[0].id), pendingOtpDone);

  const searchApproved = await api("GET", "/api/admin/patients?status=approved&search=Pia", {
    role: "admin",
    id: adminId,
  });
  assert.equal(searchApproved.json.total, 0);
  assert.equal(searchApproved.json.tabCounts.approved, 1);

  const dashboard = await api("GET", "/api/admin/dashboard", { role: "admin", id: adminId });
  assert.equal(dashboard.status, 200);
  assert.equal(dashboard.json.metrics.pendingAccountApprovals, 51);

  const failed = await api("PATCH", "/api/admin/accounts/999999999/lifecycle", {
    role: "admin",
    id: adminId,
    body: { action: "approve" },
  });
  assert.equal(failed.status, 404);
  assert.match(String(failed.json.message), /not found/i);
  const stillPending = await api("GET", "/api/admin/patients?status=pending&search=Pia", {
    role: "admin",
    id: adminId,
  });
  assert.equal(stillPending.json.total, 1);

  const approvedMove = await api("PATCH", `/api/admin/accounts/${pendingOtpDone}/lifecycle`, {
    role: "admin",
    id: adminId,
    body: { action: "approve" },
  });
  assert.equal(approvedMove.status, 200, JSON.stringify(approvedMove.json));

  const afterPending = await api("GET", "/api/admin/patients?status=pending", { role: "admin", id: adminId });
  const afterApproved = await api("GET", "/api/admin/patients?status=approved", { role: "admin", id: adminId });
  assert.equal(afterPending.json.tabCounts.pending, 50);
  assert.equal(afterPending.json.tabCounts.approved, 2);
  assert.ok(!afterPending.json.patients.some((row) => String(row.id) === pendingOtpDone));
  assert.ok(afterApproved.json.patients.some((row) => String(row.id) === pendingOtpDone));
  assert.ok(afterApproved.json.patients.some((row) => String(row.id) === approvedId));

  const afterDash = await api("GET", "/api/admin/dashboard", { role: "admin", id: adminId });
  assert.equal(afterDash.json.metrics.pendingAccountApprovals, 50);

  const rejectedList = await api("GET", "/api/admin/registrations/rejected?limit=20", {
    role: "admin",
    id: adminId,
  });
  assert.equal(rejectedList.status, 200);
  assert.ok((rejectedList.json.requests || []).some((row) => String(row.email) === "riley.rejected@example.test"));
});
