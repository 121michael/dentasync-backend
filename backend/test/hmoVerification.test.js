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
  throw new Error("DB_USER is required to run hmoVerification.test.js against disposable PostgreSQL.");
}

const dbName = `ds_hmo_verify_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("HMO verification stays independent of appointment status", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const hmoVerification = require("../services/hmoVerification");
  const clinicalPatients = require("../services/clinicalPatients");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

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
  await db.query(`
    ALTER TABLE patient_portal_appointments
      ADD COLUMN IF NOT EXISTS hmo_company_name TEXT,
      ADD COLUMN IF NOT EXISTS hmo_birth_date DATE,
      ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable';
    ALTER TABLE patient_portal_profiles
      ADD COLUMN IF NOT EXISTS company_name TEXT,
      ADD COLUMN IF NOT EXISTS birth_date DATE;
  `);
  await db.query(`ALTER TABLE staff_portal_notifications ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "024_dentist_portal_notifications.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    CREATE TABLE IF NOT EXISTS admin_portal_settings (setting_key TEXT PRIMARY KEY, setting_value JSONB);
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (id BIGSERIAL PRIMARY KEY, clinical_record_id BIGINT, treatment TEXT);
    CREATE TABLE IF NOT EXISTS clinic_patient_records (
      id BIGSERIAL PRIMARY KEY,
      linked_user_id TEXT,
      first_name TEXT,
      last_name TEXT,
      is_archived BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS admin_portal_notifications (
      id BIGSERIAL PRIMARY KEY,
      user_id TEXT,
      read_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
  `);
  try {
    await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "025_patient_notification_entities.sql"), "utf8"));
  } catch (error) {
    if (error?.code !== "42703" && error?.code !== "42P01") throw error;
  }
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await db.query(`
    ALTER TABLE clinic_branches
      ADD COLUMN IF NOT EXISTS rfid_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS qr_enabled BOOLEAN NOT NULL DEFAULT TRUE
  `);
  await hmoVerification.applyHmoVerificationSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const taguig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-HMO2', 'Taguig HMO', '12 Synthetic Street', '09170002222', 'taguig-hmo@example.test', FALSE, 'active', TRUE, TRUE)
     RETURNING id`
  );
  const mainId = main.rows[0].id;
  const taguigId = taguig.rows[0].id;

  async function addUser(role, email, first) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Hmo', $2, $3, 'synthetic-hash', $4, TRUE, 'Active')
       RETURNING id`,
      [first, email, `09${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`.slice(0, 11), role]
    );
    return result.rows[0].id;
  }

  const profilePatient = await addUser("patient", "profile.hmo@example.test", "Pearl");
  const bookedPatient = await addUser("patient", "booked.hmo@example.test", "Bella");
  const verifiedPatient = await addUser("patient", "verified.hmo@example.test", "Vera");
  const mStaff = await addUser("staff", "staff.hmo@example.test", "Sana");
  const tStaff = await addUser("staff", "staff.hmo.t@example.test", "Tess");
  const dentist = await addUser("dentist", "dentist.hmo@example.test", "Dina");

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4), ($5, $2)`,
    [mStaff, mainId, tStaff, taguigId, dentist]
  );

  const smsCalls = [];
  let smsShouldFail = false;
  const clinicSms = {
    sendClinicSms: async (payload) => {
      smsCalls.push(payload);
      assert.equal(payload.message.includes("Maxicare"), false);
      assert.equal(/\d{4,}/.test(payload.message.replace(/\D/g, "") && payload.message.includes("MC-")), false);
      assert.match(payload.message, /verified/i);
      assert.equal(payload.message.includes("MC-"), false);
      if (smsShouldFail) {
        const error = new Error("Semaphore unavailable");
        throw error;
      }
      return { status: "sent", logId: smsCalls.length };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken,
      notifyStaff: async () => {},
      notifyDentist: async () => {},
      clinicSms,
    })
  );
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db,
      authenticateToken,
      notifyStaff: async () => {},
      notifyAdmin: async () => {},
      notifyDentist: async () => {},
      clinicSms,
    })
  );
  app.use(
    "/api/dentist",
    createDentistPortalRouter({
      db,
      authenticateToken,
      notifyStaff: async () => {},
      notifyDentist: async () => {},
    })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });

  async function request(method, url, { token, body, headers } = {}) {
    const response = await fetch(`${base}${url}`, {
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

  const profileToken = tokenFor(profilePatient, "patient");
  const bookedToken = tokenFor(bookedPatient, "patient");
  const verifiedToken = tokenFor(verifiedPatient, "patient");
  const mStaffToken = tokenFor(mStaff, "staff");
  const tStaffToken = tokenFor(tStaff, "staff");
  const dentistToken = tokenFor(dentist, "dentist");

  const standalone = await request("PUT", "/api/patient/profile", {
    token: profileToken,
    body: {
      firstName: "Pearl",
      lastName: "Hmo",
      email: "profile.hmo@example.test",
      phone: "09170001111",
      hmoProvider: "Maxicare",
      hmoMemberNumber: "MC-STANDALONE",
      hmoVerificationBranchId: mainId,
    },
  });
  assert.equal(standalone.status, 200, JSON.stringify(standalone.body));
  assert.equal(standalone.body.profile.hmo_status, "pending_verification");

  const duplicate = await request("PUT", "/api/patient/profile", {
    token: profileToken,
    body: {
      firstName: "Pearl",
      lastName: "Hmo",
      email: "profile.hmo@example.test",
      phone: "09170001111",
      address: "Unit 8 Synthetic Avenue",
      hmoProvider: "Maxicare",
      hmoMemberNumber: "MC-STANDALONE",
      hmoVerificationBranchId: mainId,
    },
  });
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.body));
  const pendingRows = await db.query(
    `SELECT id FROM patient_hmo_submissions
     WHERE user_id = $1 AND verification_status = 'pending_verification'`,
    [String(profilePatient)]
  );
  assert.equal(pendingRows.rows.length, 1);

  const queueCheck = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1`,
    [String(profilePatient)]
  );
  const apptCheck = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_appointments WHERE user_id = $1`,
    [String(profilePatient)]
  );
  assert.equal(queueCheck.rows[0].count, 0);
  assert.equal(apptCheck.rows[0].count, 0);

  const bookedAppt = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, hmo_provider, hmo_member_number,
       hmo_verification_status, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'cleaning', 'Cleaning', 'dr-marco', 'Dr. Marco',
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, '10:00', 'hmo', 'Maxicare', 'MC-BOOKED',
       'pending_verification', 500, 'confirmed', $2
     ) RETURNING *`,
    [String(bookedPatient), mainId]
  );
  await hmoVerification.syncAppointmentCoverage(db, bookedAppt.rows[0]);

  const verifiedPendingAppt = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, hmo_provider, hmo_member_number,
       hmo_verification_status, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'cleaning', 'Cleaning', 'dr-marco', 'Dr. Marco',
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date + 3, '11:00', 'hmo', 'Maxicare', 'MC-VERIFIED',
       'pending_verification', 500, 'pending', $2
     ) RETURNING *`,
    [String(verifiedPatient), mainId]
  );
  await db.query(
    `INSERT INTO patient_portal_profiles (user_id, hmo_provider, hmo_member_number, hmo_status)
     VALUES ($1, 'Maxicare', 'MC-VERIFIED', 'pending_verification')
     ON CONFLICT (user_id) DO UPDATE SET hmo_provider = EXCLUDED.hmo_provider, hmo_member_number = EXCLUDED.hmo_member_number, hmo_status = EXCLUDED.hmo_status`,
    [String(verifiedPatient)]
  );
  const verifiedSub = await hmoVerification.syncAppointmentCoverage(db, verifiedPendingAppt.rows[0]);

  const dash = await request("GET", "/api/staff/dashboard", { token: mStaffToken });
  assert.equal(dash.status, 200, JSON.stringify(dash.body));
  assert.equal(dash.body.metrics.pendingHmoVerification, 3);

  const taguigDash = await request("GET", "/api/staff/dashboard", { token: tStaffToken });
  assert.equal(taguigDash.body.metrics.pendingHmoVerification, 0);

  const isolated = await request("GET", "/api/staff/hmo-submissions", {
    token: tStaffToken,
    headers: { "x-dentasync-branch": String(mainId) },
  });
  assert.equal(isolated.status, 403);

  const list = await request("GET", "/api/staff/hmo-submissions", { token: mStaffToken });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  assert.equal(list.body.submissions.length, 3);
  assert.ok(list.body.submissions.some((row) => row.sourceLabel === "Profile submission" && !row.appointmentId));
  assert.ok(list.body.submissions.some((row) => row.sourceLabel === "Appointment-linked"));

  const bookedRow = list.body.submissions.find((row) => row.hmoMemberNumber === "MC-BOOKED");
  const confirm = await request("PATCH", `/api/staff/appointments/${bookedAppt.rows[0].id}`, {
    token: mStaffToken,
    body: { action: "confirm" },
  });
  assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
  const afterConfirm = await db.query(
    `SELECT status, hmo_verification_status FROM patient_portal_appointments WHERE id = $1`,
    [bookedAppt.rows[0].id]
  );
  assert.equal(afterConfirm.rows[0].status, "confirmed");
  assert.equal(afterConfirm.rows[0].hmo_verification_status, "pending_verification");

  smsShouldFail = true;
  const failVerify = await request("PATCH", `/api/staff/hmo-submissions/${verifiedSub.submission.id}`, {
    token: mStaffToken,
    body: { status: "verified" },
  });
  assert.equal(failVerify.status, 200, JSON.stringify(failVerify.body));
  assert.equal(failVerify.body.submission.verificationStatus, "verified");
  assert.equal(failVerify.body.sms.status, "failed");
  const pendingAppt = await db.query(
    `SELECT status, hmo_verification_status FROM patient_portal_appointments WHERE id = $1`,
    [verifiedPendingAppt.rows[0].id]
  );
  assert.equal(pendingAppt.rows[0].status, "pending");
  assert.equal(pendingAppt.rows[0].hmo_verification_status, "verified");

  const patientDash = await request("GET", "/api/patient/dashboard", { token: verifiedToken });
  assert.equal(patientDash.status, 200, JSON.stringify(patientDash.body));
  assert.equal(patientDash.body.metrics.hmoStatus, "verified");
  assert.equal(patientDash.body.metrics.hmoProvider, "Maxicare");
  assert.ok(patientDash.body.metrics.hmoVerifiedAt);

  smsShouldFail = false;
  const retrySms = await request("PATCH", `/api/staff/hmo-submissions/${verifiedSub.submission.id}`, {
    token: mStaffToken,
    body: { status: "verified" },
  });
  assert.equal(retrySms.body.alreadyRecorded, true);
  assert.equal(retrySms.body.sms.status, "sent");
  const beforeDup = smsCalls.length;
  const duplicateSave = await request("PATCH", `/api/staff/hmo-submissions/${verifiedSub.submission.id}`, {
    token: mStaffToken,
    body: { status: "verified" },
  });
  assert.equal(duplicateSave.body.sms.duplicate, true);
  assert.equal(smsCalls.length, beforeDup);

  const overlay = await clinicalPatients.enrichRecordsFromLinkedProfiles(db, [
    { linkedUserId: String(verifiedPatient), firstName: "Vera", lastName: "Hmo" },
  ]);
  assert.equal(overlay[0].hmoStatus, "verified");
  assert.equal(overlay[0].hmoProvider, "Maxicare");
  assert.ok(overlay[0].hmoVerifiedAt);
  const profileReload = await request("GET", "/api/patient/profile", { token: verifiedToken });
  assert.equal(profileReload.body.profile.hmo_status, "verified");

  const standaloneId = pendingRows.rows[0].id;
  const verifyStandalone = await request("PATCH", `/api/staff/hmo-submissions/${standaloneId}`, {
    token: mStaffToken,
    body: { status: "verified" },
  });
  assert.equal(verifyStandalone.status, 200, JSON.stringify(verifyStandalone.body));
  const stillNoAppt = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_appointments WHERE user_id = $1`,
    [String(profilePatient)]
  );
  assert.equal(stillNoAppt.rows[0].count, 0);

  const coverageChange = await request("PUT", "/api/patient/profile", {
    token: verifiedToken,
    body: {
      firstName: "Vera",
      lastName: "Hmo",
      email: "verified.hmo@example.test",
      phone: "09170003333",
      hmoProvider: "iCare",
      hmoMemberNumber: "IC-9999",
      hmoVerificationBranchId: mainId,
    },
  });
  assert.equal(coverageChange.body.profile.hmo_status, "pending_verification");

  const keepVerified = await request("PUT", "/api/patient/profile", {
    token: profileToken,
    body: {
      firstName: "Pearl",
      lastName: "Hmo",
      email: "profile.hmo@example.test",
      phone: "09170001111",
      address: "Another street",
      hmoProvider: "Maxicare",
      hmoMemberNumber: "MC-STANDALONE",
      hmoVerificationBranchId: mainId,
    },
  });
  assert.equal(keepVerified.body.profile.hmo_status, "verified");

  void bookedToken;
  void bookedRow;
  void dentistToken;
});
