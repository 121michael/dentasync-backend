"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
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

const dbName = `ds_demo_vis_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-disposable-jwt-secret";
process.env.OTP_SECRET = process.env.OTP_SECRET || "local-disposable-otp-secret";

const migrations = path.join(__dirname, "..", "migrations");

test("four roles see the same saved sex and date of birth", { timeout: 90000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { createAuthRouter } = require("../routes/auth");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { createOtpService } = require("../services/otpService");
  const { createPostgresOtpStore } = require("../repositories/postgresOtpStore");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const patientData = require("../services/patientData");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");

  const delivered = [];
  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(migrations, "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(migrations, "001_create_otp_verification_requests.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(migrations, "012_otp_attempt_lockout.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(migrations, "002_create_patient_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(migrations, "009_create_clinical_patient_records.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(migrations, "005_create_admin_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(migrations, "006_create_dentist_portal.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS archived_by TEXT,
      ADD COLUMN IF NOT EXISTS patient_id TEXT,
      ADD COLUMN IF NOT EXISTS patient_category TEXT,
      ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE patient_portal_profiles
      ADD COLUMN IF NOT EXISTS birth_date DATE,
      ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE patient_portal_appointments
      ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB
    );
  `);
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db).catch(() => {});

  const otpService = createOtpService({
    store: createPostgresOtpStore(db),
    otpSecret: process.env.OTP_SECRET,
    deliverOtp: async (payload) => {
      delivered.push(payload);
    },
  });

  const jwtSecret = process.env.JWT_SECRET;
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ db, otpService, authenticateToken, jwtSecret }));
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db,
      authenticateToken,
      jwtSecret,
      notifyStaff: async () => {},
      notifyAdmin: async () => {},
      notifyDentist: async () => {},
    })
  );
  app.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken,
      notifyStaff: async () => {},
      notifyDentist: async () => {},
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
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db,
      authenticateToken,
      notifyStaff: async () => {},
      notifyAdmin: async () => {},
      notifyDentist: async () => {},
    })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, url, { body, token } = {}) {
    const response = await fetch(`${base}${url}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed };
  }

  const hash = await bcrypt.hash("ClinicPass123", 4);
  const staff = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Sana', 'Staff', 'sana.staff@example.test', '639170000001', $1, 'staff', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );
  const outsiderStaff = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Omar', 'Outsider', 'omar.staff@example.test', '639170000002', $1, 'staff', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );
  const dentist = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Dina', 'Dentist', 'dina.dentist@example.test', '639170000003', $1, 'dentist', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );
  const otherDentist = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Nico', 'Other', 'nico.dentist@example.test', '639170000004', $1, 'dentist', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );
  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.admin@example.test', '639170000005', $1, 'admin', TRUE, 'Active')
     RETURNING id`,
    [hash]
  );

  let mainId;
  try {
    const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
    if (main.rows[0]) {
      mainId = main.rows[0].id;
    } else {
      const created = await db.query(
        `INSERT INTO clinic_branches (branch_code, name, is_main, status)
         VALUES ('BR-MAIN', 'Main', TRUE, 'active') RETURNING id`
      );
      mainId = created.rows[0].id;
    }
  } catch (error) {
    if (error.code !== "42P01") throw error;
  }
  const otherBranch = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, is_main, status)
     VALUES ('BR-OTHER', 'Other Clinic', FALSE, 'active') RETURNING id`
  );
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $2), ($4, $5)`, [
    staff.rows[0].id,
    mainId,
    dentist.rows[0].id,
    outsiderStaff.rows[0].id,
    otherBranch.rows[0].id,
  ]);
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`, [
    otherDentist.rows[0].id,
    otherBranch.rows[0].id,
  ]);

  async function registerAndVerify(payload) {
    const registered = await request("POST", "/api/auth/register", { body: payload });
    assert.equal(registered.status, 201, JSON.stringify(registered.body));
    const otp = String(delivered.at(-1).otp);
    const verified = await request("POST", "/api/auth/verify-otp", {
      body: { requestId: registered.body.requestId, otp },
    });
    assert.equal(verified.status, 200, JSON.stringify(verified.body));
    const user = await db.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [payload.email.toLowerCase()]);
    return user.rows[0].id;
  }

  const lilaId = await registerAndVerify({
    firstName: "Lila",
    lastName: "Synthetic",
    email: "lila.vis@example.test",
    phone: "09175551101",
    password: "SyntheticPass123",
    sex: "Female",
    dateOfBirth: "2001-06-15",
    patientCategory: "regular",
    acceptedTerms: true,
    acceptedPrivacy: true,
  });
  const micoId = await registerAndVerify({
    firstName: "Mico",
    lastName: "Boundary",
    email: "mico.vis@example.test",
    phone: "09175551102",
    password: "SyntheticPass123",
    sex: "Male",
    dateOfBirth: "1999-12-31",
    patientCategory: "regular",
    acceptedTerms: true,
    acceptedPrivacy: true,
  });

  await db.query(`UPDATE users SET status = 'Active' WHERE id = ANY($1::bigint[])`, [[lilaId, micoId]]);

  const existingHash = await bcrypt.hash("ExistingPass123", 4);
  const legacy = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Lea', 'Legacy', 'lea.legacy@example.test', '639175551103', $1, 'patient', TRUE, 'Active')
     RETURNING id`,
    [existingHash]
  );

  const lilaRecord = await db.query(
    `SELECT id FROM clinic_patient_records WHERE linked_user_id::text = $1 LIMIT 1`,
    [String(lilaId)]
  );
  const micoRecord = await db.query(
    `SELECT id FROM clinic_patient_records WHERE linked_user_id::text = $1 LIMIT 1`,
    [String(micoId)]
  );
  assert.ok(lilaRecord.rows[0], "registration should create a clinical record");

  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time,
       coverage_type, estimated_cost, status, branch_id
     ) VALUES ($1, 'svc-1', 'Cleaning', $2, 'Dina Dentist', CURRENT_DATE, '10:00', 'self_pay', 0, 'confirmed', $3)`,
    [String(lilaId), String(dentist.rows[0].id), mainId]
  );

  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  const patientToken = tokenFor(lilaId, "patient");
  const micoToken = tokenFor(micoId, "patient");
  const staffToken = tokenFor(staff.rows[0].id, "staff");
  const dentistToken = tokenFor(dentist.rows[0].id, "dentist");
  const otherDentistToken = tokenFor(otherDentist.rows[0].id, "dentist");
  const adminToken = tokenFor(admin.rows[0].id, "admin");

  const patientProfile = await request("GET", "/api/patient/profile", { token: patientToken });
  assert.equal(patientProfile.status, 200, JSON.stringify(patientProfile.body));
  assert.equal(patientProfile.body.profile.gender, "Female");
  assert.equal(patientProfile.body.profile.date_of_birth, "2001-06-15");
  assert.equal(patientProfile.body.profile.age, patientData.ageFromDateOfBirth("2001-06-15"));

  const reload = await request("GET", "/api/patient/profile", { token: patientToken });
  assert.equal(reload.body.profile.date_of_birth, "2001-06-15");
  assert.equal(reload.body.profile.gender, "Female");

  const micoProfile = await request("GET", "/api/patient/profile", { token: micoToken });
  assert.equal(micoProfile.body.profile.gender, "Male");
  assert.equal(micoProfile.body.profile.date_of_birth, "1999-12-31");

  const jan = await request("PUT", "/api/patient/profile", {
    token: micoToken,
    body: {
      firstName: "Mico",
      lastName: "Boundary",
      email: "mico.vis@example.test",
      phone: "09175551102",
      gender: "Male",
      dateOfBirth: "2000-01-01",
    },
  });
  assert.equal(jan.status, 200, JSON.stringify(jan.body));
  assert.equal(jan.body.profile.date_of_birth, "2000-01-01");

  const staffDetail = await request("GET", `/api/staff/patients/${lilaRecord.rows[0].id}`, { token: staffToken });
  assert.equal(staffDetail.status, 200, JSON.stringify(staffDetail.body));
  assert.equal(staffDetail.body.patient.gender, "Female");
  assert.equal(String(staffDetail.body.patient.dateOfBirth).slice(0, 10), "2001-06-15");

  const dentistDetail = await request("GET", `/api/dentist/patients/${lilaRecord.rows[0].id}`, {
    token: dentistToken,
  });
  assert.equal(dentistDetail.status, 200, JSON.stringify(dentistDetail.body));
  assert.equal(dentistDetail.body.patient.gender, "Female");
  assert.equal(String(dentistDetail.body.patient.dateOfBirth).slice(0, 10), "2001-06-15");
  assert.equal(dentistDetail.body.patient.age, patientData.ageFromDateOfBirth("2001-06-15"));

  const adminDetail = await request("GET", `/api/admin/clinical-records/${lilaRecord.rows[0].id}`, {
    token: adminToken,
  });
  assert.equal(adminDetail.status, 200, JSON.stringify(adminDetail.body));
  const adminRecord = adminDetail.body.record || adminDetail.body.patient || adminDetail.body;
  const adminGender = adminRecord.gender || adminDetail.body.record?.gender;
  const adminDob = adminRecord.dateOfBirth || adminDetail.body.record?.dateOfBirth;
  assert.equal(adminGender, "Female");
  assert.equal(String(adminDob).slice(0, 10), "2001-06-15");

  const blockedPatient = await request("GET", "/api/patient/profile", { token: staffToken });
  assert.ok(blockedPatient.status === 403 || blockedPatient.status === 401);

  const otherProfile = await request("GET", "/api/patient/profile", { token: micoToken });
  assert.equal(otherProfile.body.profile.email, "mico.vis@example.test");
  assert.notEqual(otherProfile.body.profile.email, "lila.vis@example.test");

  const blockedDentist = await request("GET", `/api/dentist/patients/${lilaRecord.rows[0].id}`, {
    token: otherDentistToken,
  });
  assert.equal(blockedDentist.status, 403);

  const legacyLogin = await request("POST", "/api/auth/login", {
    body: { identifier: "lea.legacy@example.test", password: "ExistingPass123" },
  });
  assert.equal(legacyLogin.status, 200, JSON.stringify(legacyLogin.body));
  const legacyProfile = await request("GET", "/api/patient/profile", { token: legacyLogin.body.token });
  assert.equal(legacyProfile.status, 200);
  assert.equal(legacyProfile.body.profile.gender || "", "");
  assert.equal(legacyProfile.body.profile.date_of_birth || null, null);

  assert.ok(micoRecord.rows[0]);
});
