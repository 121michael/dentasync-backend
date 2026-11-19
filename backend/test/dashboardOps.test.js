"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

if (!process.env.DB_USER) {
  throw new Error("DB_USER is required to run dashboardOps.test.js against disposable PostgreSQL.");
}

const dbName = `ds_dashboard_ops_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.CLINIC_TIMEZONE = "Asia/Manila";

test("dashboard metrics, links, branch isolation, and dentist availability", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const branchCheckIn = require("../services/branchCheckIn");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const dashboardOps = require("../services/dashboardOps");

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
  await db.query(`ALTER TABLE staff_portal_notifications ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "024_dentist_portal_notifications.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS coverage_type TEXT;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS hmo_provider TEXT;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable';
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT
    );
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_settings (setting_key TEXT PRIMARY KEY, setting_value JSONB);
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (id BIGSERIAL PRIMARY KEY, clinical_record_id BIGINT, treatment TEXT);
    CREATE TABLE IF NOT EXISTS admin_portal_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      read_at TIMESTAMPTZ
    );
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "026_queue_wait_estimates.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
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
  const mainId = main.rows[0].id;
  const taguigId = taguig.rows[0].id;

  async function addUser(role, email, first, extras = {}) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Dash', $2, $3, 'synthetic-hash', $4, $5, $6, $7, 'regular')
       RETURNING id`,
      [
        first,
        email,
        `09${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`.slice(0, 11),
        role,
        extras.verified !== false,
        extras.status || "Active",
        extras.rfid || null,
      ]
    );
    return result.rows[0].id;
  }

  const mPatient = await addUser("patient", "m.dash@example.test", "Mina", { rfid: "DASHRFID0011" });
  const tPatient = await addUser("patient", "t.dash@example.test", "Tomas", { rfid: "DASHRFID0022" });
  const hmoPatient = await addUser("patient", "h.dash@example.test", "Helen");
  const dateOnlyPatient = await addUser("patient", "d.dash@example.test", "Daria");
  const mStaff = await addUser("staff", "m.staff.dash@example.test", "Minda");
  const tStaff = await addUser("staff", "t.staff.dash@example.test", "Tessa");
  const mDentist = await addUser("dentist", "m.dentist.dash@example.test", "Marco");
  const tDentist = await addUser("dentist", "t.dentist.dash@example.test", "Tala");
  const unknownDentist = await addUser("dentist", "u.dentist.dash@example.test", "Una");
  const admin = await addUser("admin", "admin.dash@example.test", "Ada");
  const pendingPatient = await addUser("patient", "p.dash@example.test", "Pia", {
    verified: false,
    status: "pending",
  });

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id)
     VALUES ($1, $2), ($3, $4), ($5, $2), ($6, $4), ($7, $2)`,
    [mStaff, mainId, tStaff, taguigId, mDentist, tDentist, unknownDentist]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id)
     VALUES ($1, 'dr-marco'), ($2, 'dr-tala'), ($3, 'dr-una')`,
    [String(mDentist), String(tDentist), String(unknownDentist)]
  );

  const book = async ({ userId, branchId, dentistId, dentistName, time, status = "confirmed", coverage = "self_pay", hmo = "not_applicable" }) => {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, hmo_verification_status, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $2, $3,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $4, $5, $6, 500, $7, $8
       ) RETURNING id`,
      [String(userId), dentistId, dentistName, time, coverage, hmo, status, branchId]
    );
    return result.rows[0].id;
  };

  const mVisit = await book({
    userId: mPatient,
    branchId: mainId,
    dentistId: "dr-marco",
    dentistName: "Dr. Marco Dash",
    time: "09:30",
  });
  await book({
    userId: tPatient,
    branchId: taguigId,
    dentistId: "dr-tala",
    dentistName: "Dr. Tala Dash",
    time: "10:30",
  });
  await book({
    userId: hmoPatient,
    branchId: mainId,
    dentistId: "dr-marco",
    dentistName: "Dr. Marco Dash",
    time: "11:00",
    coverage: "hmo",
    hmo: "pending_verification",
  });
  await book({
    userId: dateOnlyPatient,
    branchId: mainId,
    dentistId: "dr-marco",
    dentistName: "Dr. Marco Dash",
    time: null,
  });
  await book({
    userId: mPatient,
    branchId: mainId,
    dentistId: "dr-marco",
    dentistName: "Dr. Marco Dash",
    time: "08:00",
    status: "no_show",
  });
  await book({
    userId: mPatient,
    branchId: mainId,
    dentistId: "dr-marco",
    dentistName: "Dr. Marco Dash",
    time: "16:00",
    status: "completed",
  });

  await db.query(
    `INSERT INTO staff_portal_dentist_availability
       (dentist_id, dentist_name, availability_date, start_time, end_time, status)
     VALUES
       ('dr-marco', 'Dr. Marco Dash', (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, '09:00', '17:00', 'available')`
  );

  const app = express();
  app.use(express.json());
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} }));
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });

  async function request(method, urlPath, { token, headers = {} } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const mStaffToken = tokenFor(mStaff, "staff");
  const tStaffToken = tokenFor(tStaff, "staff");
  const mDentistToken = tokenFor(mDentist, "dentist");
  const adminToken = tokenFor(admin, "admin");

  const mDash = await request("GET", "/api/staff/dashboard", { token: mStaffToken });
  const tDash = await request("GET", "/api/staff/dashboard", { token: tStaffToken });
  assert.equal(mDash.status, 200, JSON.stringify(mDash.body));
  assert.equal(mDash.body.timezone, "Asia/Manila");
  assert.equal(mDash.body.metrics.bookedToday, 4);
  assert.equal(mDash.body.metrics.noShowToday, 1);
  assert.equal(mDash.body.metrics.completedToday, 1);
  assert.equal(mDash.body.metrics.pendingHmoVerification, 1);
  assert.equal(tDash.body.metrics.bookedToday, 1);
  assert.equal(tDash.body.metrics.pendingHmoVerification, 0);
  assert.ok(mDash.body.schedulePreview.some((row) => row.timeLabel === "Date only"));

  const hmoList = await request("GET", "/api/staff/appointments?tab=hmo", { token: mStaffToken });
  assert.equal(hmoList.body.appointments.length, mDash.body.metrics.pendingHmoVerification);
  const todayList = await request("GET", "/api/staff/appointments?tab=today", { token: mStaffToken });
  assert.equal(todayList.body.appointments.length, mDash.body.metrics.bookedToday);
  const noShowList = await request("GET", "/api/staff/appointments?tab=no_show", { token: mStaffToken });
  assert.equal(noShowList.body.appointments.length, mDash.body.metrics.noShowToday);
  const completedList = await request("GET", "/api/staff/appointments?tab=completed&when=today", {
    token: mStaffToken,
  });
  assert.equal(completedList.body.appointments.length, mDash.body.metrics.completedToday);

  const checkInBody = await fetch(`${base}/api/staff/check-in`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${mStaffToken}`,
    },
    body: JSON.stringify({ method: "manual", appointmentId: mVisit }),
  }).then(async (response) => ({ status: response.status, body: await response.json() }));
  assert.equal(checkInBody.status, 201, JSON.stringify(checkInBody.body));

  const afterCheck = await request("GET", "/api/staff/dashboard", { token: mStaffToken });
  const checkedList = await request("GET", "/api/staff/queue?status=checked_in", { token: mStaffToken });
  assert.equal(checkedList.body.queue.length, afterCheck.body.metrics.checkedIn);
  const waitingList = await request("GET", "/api/staff/queue?status=waiting", { token: mStaffToken });
  assert.equal(waitingList.body.queue.length, afterCheck.body.metrics.waiting);

  const wrongBranch = await request("GET", "/api/staff/dashboard", {
    token: tStaffToken,
    headers: { "x-dentasync-branch": String(mainId) },
  });
  assert.equal(wrongBranch.status, 403);

  const dentistDash = await request("GET", "/api/dentist/dashboard", { token: mDentistToken });
  assert.equal(dentistDash.status, 200, JSON.stringify(dentistDash.body));
  assert.equal(dentistDash.body.metrics.bookedToday, 4);
  assert.ok(dentistDash.body.schedulePreview.length >= 1);

  const adminAll = await request("GET", "/api/admin/dashboard", { token: adminToken });
  assert.equal(adminAll.status, 200, JSON.stringify(adminAll.body));
  assert.equal(adminAll.body.selectedBranch.allBranches, true);
  assert.ok(adminAll.body.metrics.bookedToday >= 4);
  assert.equal(adminAll.body.metrics.pendingAccountApprovals >= 1, true);
  const unknownBranch = await request("GET", "/api/admin/dashboard?branchId=999999", { token: adminToken });
  assert.equal(unknownBranch.status, 400);

  const adminMain = await request("GET", `/api/admin/dashboard?branchId=${mainId}`, { token: adminToken });
  assert.equal(String(adminMain.body.selectedBranch.id), String(mainId));
  assert.equal(adminMain.body.metrics.pendingHmoVerification, 1);
  const availability = adminMain.body.dentistAvailability.dentists;
  const marco = availability.find((row) => String(row.catalogDentistId) === "dr-marco");
  const una = availability.find((row) => String(row.catalogDentistId) === "dr-una");
  assert.equal(marco.label, "Available");
  assert.equal(una.label, "Availability unknown");

  const adminTaguig = await request("GET", `/api/admin/dashboard?branchId=${taguigId}`, { token: adminToken });
  assert.equal(adminTaguig.body.metrics.pendingHmoVerification, 0);
  assert.ok(!adminTaguig.body.dentistAvailability.dentists.some((row) => row.catalogDentistId === "dr-marco"));

  const clinicDate = adminMain.body.clinicDate;
  const bookedList = await request(
    "GET",
    `/api/admin/appointments?metric=booked&date=${clinicDate}&branchId=${mainId}&limit=200`,
    { token: adminToken }
  );
  assert.equal(bookedList.status, 200, JSON.stringify(bookedList.body));
  assert.equal(bookedList.body.total, adminMain.body.metrics.bookedToday);
  const hmoAdminList = await request(
    "GET",
    `/api/admin/appointments?metric=hmo&branchId=${mainId}&limit=200`,
    { token: adminToken }
  );
  assert.equal(hmoAdminList.body.total, adminMain.body.metrics.pendingHmoVerification);
  const completedAdminList = await request(
    "GET",
    `/api/admin/appointments?metric=completed&date=${clinicDate}&branchId=${mainId}&limit=200`,
    { token: adminToken }
  );
  assert.equal(completedAdminList.body.total, adminMain.body.metrics.completedToday);
  const noShowAdminList = await request(
    "GET",
    `/api/admin/appointments?metric=no_show&date=${clinicDate}&branchId=${mainId}&limit=200`,
    { token: adminToken }
  );
  assert.equal(noShowAdminList.body.total, adminMain.body.metrics.noShowToday);
  const checkedAdminList = await request(
    "GET",
    `/api/admin/appointments?metric=checked_in&date=${clinicDate}&branchId=${mainId}&limit=200`,
    { token: adminToken }
  );
  assert.equal(checkedAdminList.body.total, afterCheck.body.metrics.checkedIn);
  const taguigHmo = await request(
    "GET",
    `/api/admin/appointments?metric=hmo&branchId=${taguigId}&limit=200`,
    { token: adminToken }
  );
  assert.equal(taguigHmo.body.total, 0);
  const badMetric = await request("GET", "/api/admin/appointments?metric=not-a-metric", { token: adminToken });
  assert.equal(badMetric.status, 400);

  void pendingPatient;
  assert.equal(dashboardOps.clinicTimezone(), "Asia/Manila");
});
