"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dbName = `ds_branch_scope_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("staff and dentist operations stay inside the assigned branch", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const branchCheckIn = require("../services/branchCheckIn");
  const { notifyActiveStaff } = require("../services/staffNotifications");
  const { notifyDentists } = require("../services/dentistNotifications");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const staffRfidEvents = require("../services/staffRfidEvents");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "002_create_patient_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "004_create_staff_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "024_dentist_portal_notifications.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT,
      license_number TEXT,
      ptr_number TEXT,
      professional_designation TEXT,
      license_verified BOOLEAN
    );
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_settings (setting_key TEXT PRIMARY KEY, setting_value JSONB);
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (id BIGSERIAL PRIMARY KEY, clinical_record_id BIGINT, treatment TEXT);
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "026_queue_wait_estimates.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const taguig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-0002', 'Taguig', '12 Synthetic Street', '09170002222', 'taguig@example.test', FALSE, 'active', TRUE, TRUE)
     RETURNING id`
  );
  await db.query(`UPDATE clinic_branches SET name = 'Mandaluyong' WHERE id = $1`, [main.rows[0].id]);

  async function addUser(role, email, first, rfid = null) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Scope', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', $5, 'regular')
       RETURNING id`,
      [first, email, `09${Math.floor(Math.random() * 1e8)}`, role, rfid]
    );
    return result.rows[0].id;
  }

  const mandaluyongPatient = await addUser("patient", "m.patient.scope@example.test", "Mina", "AABBCCDDEE11");
  const taguigPatient = await addUser("patient", "t.patient.scope@example.test", "Tomas", "AABBCCDDEE22");
  const mandaluyongStaff = await addUser("staff", "m.staff.scope@example.test", "Minda");
  const taguigStaff = await addUser("staff", "t.staff.scope@example.test", "Tessa");
  const mandaluyongDentist = await addUser("dentist", "m.dentist.scope@example.test", "Marco");
  const taguigDentist = await addUser("dentist", "t.dentist.scope@example.test", "Tala");
  const admin = await addUser("admin", "admin.scope@example.test", "Ada");
  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4), ($5, $2), ($6, $4)`,
    [mandaluyongStaff, main.rows[0].id, taguigStaff, taguig.rows[0].id, mandaluyongDentist, taguigDentist]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-marco'), ($2, 'dr-tala')`,
    [String(mandaluyongDentist), String(taguigDentist)]
  );

  async function book(userId, branchId, dentistId, dentistName, time) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $2, $3,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $4::time, 'self_pay', 500, 'confirmed', $5
       ) RETURNING id, branch_id`,
      [String(userId), dentistId, dentistName, time, branchId]
    );
    return result.rows[0];
  }

  const mandaluyongVisit = await book(mandaluyongPatient, main.rows[0].id, "dr-marco", "Dr. Marco Scope", "09:30");
  const taguigVisit = await book(taguigPatient, taguig.rows[0].id, "dr-tala", "Dr. Tala Scope", "10:30");

  const mandaluyongStaffNotices = await notifyActiveStaff(db, {
    type: "appointment",
    title: "New Appointment Request",
    body: "Mina booked Cleaning at Mandaluyong.",
    entityType: "appointment",
    entityId: mandaluyongVisit.id,
    branchId: mandaluyongVisit.branch_id,
  });
  const mandaluyongDentistNotices = await notifyDentists(db, {
    type: "appointment",
    title: "New Appointment Request",
    body: "Mina booked Cleaning at Mandaluyong.",
    entityType: "appointment",
    entityId: mandaluyongVisit.id,
    dentistId: "dr-marco",
    dentistName: "Dr. Marco Scope",
    branchId: mandaluyongVisit.branch_id,
  });
  assert.equal(mandaluyongStaffNotices, 1);
  assert.equal(mandaluyongDentistNotices, 1);

  const app = express();
  app.use(express.json());
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: (notice) => notifyActiveStaff(db, notice), notifyDentist: (notice) => notifyDentists(db, notice) }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: (notice) => notifyDentists(db, notice) }));
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });

  async function request(method, urlPath, { token, body, headers = {} } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const mStaff = tokenFor(mandaluyongStaff, "staff");
  const tStaff = tokenFor(taguigStaff, "staff");
  const mDentist = tokenFor(mandaluyongDentist, "dentist");
  const tDentist = tokenFor(taguigDentist, "dentist");
  const adminToken = tokenFor(admin, "admin");

  const mStaffInbox = await request("GET", "/api/staff/notifications", { token: mStaff });
  const tStaffInbox = await request("GET", "/api/staff/notifications", { token: tStaff });
  const mDentistInbox = await request("GET", "/api/dentist/notifications", { token: mDentist });
  const tDentistInbox = await request("GET", "/api/dentist/notifications", { token: tDentist });
  assert.equal(mStaffInbox.status, 200, JSON.stringify(mStaffInbox.body));
  assert.equal(mStaffInbox.body.unreadCount, 1);
  assert.equal(tStaffInbox.body.unreadCount, 0);
  assert.equal(tStaffInbox.body.notifications.length, 0);
  assert.equal(mDentistInbox.body.unreadCount, 1);
  assert.equal(tDentistInbox.body.unreadCount, 0);

  const mDash = await request("GET", "/api/staff/dashboard", { token: mStaff });
  const tDash = await request("GET", "/api/staff/dashboard", { token: tStaff });
  assert.equal(mDash.body.metrics.unreadNotifications, 1);
  assert.equal(tDash.body.metrics.unreadNotifications, 0);
  assert.equal(mDash.body.metrics.todaysAppointments, 1);
  assert.equal(tDash.body.metrics.todaysAppointments, 1);

  const wrongHeader = await request("GET", "/api/staff/queue", {
    token: tStaff,
    headers: { "x-dentasync-branch": String(main.rows[0].id) },
  });
  assert.equal(wrongHeader.status, 403);

  const mCheck = await request("POST", "/api/staff/check-in", {
    token: mStaff,
    body: { method: "rfid", rfidTag: "AABBCCDDEE11" },
  });
  assert.equal(mCheck.status, 201, JSON.stringify(mCheck.body));
  const mQueue = await request("GET", "/api/staff/queue", { token: mStaff });
  const tQueue = await request("GET", "/api/staff/queue", { token: tStaff });
  const mSummary = await request("GET", "/api/staff/queue/summary", { token: mStaff });
  const tSummary = await request("GET", "/api/staff/queue/summary", { token: tStaff });
  assert.equal(mQueue.body.queue.length, 1);
  assert.equal(tQueue.body.queue.length, 0);
  assert.equal(mSummary.body.currentlyWaiting, 1);
  assert.equal(tSummary.body.currentlyWaiting, 0);
  const mLog = await request("GET", "/api/staff/check-ins", { token: mStaff });
  const tLog = await request("GET", "/api/staff/check-ins", { token: tStaff });
  assert.equal(mLog.body.checkIns.length, 1);
  assert.equal(tLog.body.checkIns.length, 0);
  const mEvents = await request("GET", "/api/staff/rfid-events", { token: mStaff });
  const tEvents = await request("GET", "/api/staff/rfid-events", { token: tStaff });
  assert.equal(mEvents.body.events.length, 1);
  assert.equal(tEvents.body.events.length, 0);
  assert.equal(staffRfidEvents.listRfidEvents({ branchId: taguig.rows[0].id }).length, 0);

  const tCheckWrong = await request("POST", "/api/staff/check-in", {
    token: tStaff,
    body: { method: "qr", appointmentId: mandaluyongVisit.id },
  });
  assert.equal(tCheckWrong.status, 409);
  const tPatch = await request("PATCH", `/api/staff/queue/${mCheck.body.queue.id}`, {
    token: tStaff,
    body: { status: "completed" },
  });
  assert.equal(tPatch.status, 404);

  const tStaffAfter = await request("GET", "/api/staff/notifications", { token: tStaff });
  const tDentistAfter = await request("GET", "/api/dentist/notifications", { token: tDentist });
  assert.equal(tStaffAfter.body.unreadCount, 0);
  assert.equal(tDentistAfter.body.unreadCount, 0);
  const mStaffAfter = await request("GET", "/api/staff/notifications", { token: mStaff });
  assert.ok(mStaffAfter.body.unreadCount >= 2);

  const tCheck = await request("POST", "/api/staff/check-in", {
    token: tStaff,
    body: { method: "qr", appointmentId: taguigVisit.id },
  });
  assert.equal(tCheck.status, 201, JSON.stringify(tCheck.body));
  const mQueueAfter = await request("GET", "/api/staff/queue", { token: mStaff });
  const tQueueAfter = await request("GET", "/api/staff/queue", { token: tStaff });
  assert.equal(mQueueAfter.body.queue.length, 1);
  assert.equal(tQueueAfter.body.queue.length, 1);
  assert.equal(String(mQueueAfter.body.queue[0].patientName || "").includes("Mina"), true);
  assert.equal(String(tQueueAfter.body.queue[0].patientName || "").includes("Tomas"), true);
  const mDentistQueue = await request("GET", "/api/dentist/queue?tab=inline", { token: mDentist });
  const tDentistQueue = await request("GET", "/api/dentist/queue?tab=inline", { token: tDentist });
  assert.equal(mDentistQueue.body.queue.length, 1);
  assert.equal(tDentistQueue.body.queue.length, 1);
  assert.equal(String(mDentistQueue.body.queue[0].patientName || "").includes("Mina"), true);
  assert.equal(String(tDentistQueue.body.queue[0].patientName || "").includes("Tomas"), true);

  const mStaffSeesTaguig = await request("GET", "/api/staff/notifications", { token: mStaff });
  assert.equal(
    mStaffSeesTaguig.body.notifications.some((item) => String(item.body || "").includes("Tomas") || String(item.body || "").includes("Taguig")),
    false
  );

  const adminList = await request("GET", "/api/admin/appointments", { token: adminToken });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.body));
  const names = (adminList.body.appointments || []).map((row) => row.patientName || row.patient?.fullName || "");
  assert.ok(names.some((name) => name.includes("Mina")));
  assert.ok(names.some((name) => name.includes("Tomas")));

  const unassigned = await notifyActiveStaff(db, {
    type: "appointment",
    title: "New Appointment Request",
    body: "This must not fan out.",
    entityType: "appointment",
    entityId: mandaluyongVisit.id,
  });
  assert.equal(unassigned, 0);
});
