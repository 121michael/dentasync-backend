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

dotenv.config({ path: path.join(__dirname, "..", ".env") });

if (!process.env.DB_USER) {
  throw new Error("DB_USER is required to run patientRegisterSexDob.test.js against disposable PostgreSQL.");
}

const dbName = `ds_reg_sex_dob_${process.pid}_${Date.now().toString(36)}`;
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

test("registration stores sex and birthdate through OTP without timezone shift", { timeout: 60000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { createAuthRouter } = require("../routes/auth");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { createOtpService } = require("../services/otpService");
  const { createPostgresOtpStore } = require("../repositories/postgresOtpStore");
  const clinicalPatients = require("../services/clinicalPatients");
  const patientData = require("../services/patientData");

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
  `);

  const otpService = createOtpService({
    store: createPostgresOtpStore(db),
    otpSecret: process.env.OTP_SECRET,
    deliverOtp: async (payload) => {
      delivered.push(payload);
    },
  });

  const jwtSecret = process.env.JWT_SECRET;
  async function authenticateToken(req, res, next) {
    try {
      const header = String(req.headers.authorization || "");
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      const payload = jwt.verify(token, jwtSecret);
      const result = await db.query(
        `SELECT id, first_name, last_name, email, phone, role, status, is_verified
         FROM users WHERE id::text = $1 LIMIT 1`,
        [String(payload.id)]
      );
      if (!result.rows[0]) return res.status(401).json({ message: "Unauthorized." });
      req.user = result.rows[0];
      next();
    } catch {
      return res.status(403).json({ message: "Invalid or expired token." });
    }
  }

  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db,
      otpService,
      authenticateToken,
      jwtSecret,
    })
  );
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
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const registerBody = {
    firstName: "Lila",
    lastName: "Synthetic",
    email: "lila.synthetic@example.test",
    phone: "09175550101",
    password: "SyntheticPass123",
    sex: "Female",
    dateOfBirth: "2001-06-15",
    patientCategory: "regular",
    acceptedTerms: true,
    acceptedPrivacy: true,
  };

  const missingSex = await request("POST", "/api/auth/register", {
    body: { ...registerBody, sex: "" },
  });
  assert.equal(missingSex.status, 400);
  assert.match(missingSex.body.message, /sex/i);

  const missingDob = await request("POST", "/api/auth/register", {
    body: { ...registerBody, dateOfBirth: "" },
  });
  assert.equal(missingDob.status, 400);
  assert.match(missingDob.body.message, /date of birth/i);

  const invalidDob = await request("POST", "/api/auth/register", {
    body: { ...registerBody, dateOfBirth: "2026-02-31" },
  });
  assert.equal(invalidDob.status, 400);
  assert.match(invalidDob.body.message, /valid date of birth/i);

  const futureDob = await request("POST", "/api/auth/register", {
    body: { ...registerBody, dateOfBirth: "2099-12-31" },
  });
  assert.equal(futureDob.status, 400);
  assert.match(futureDob.body.message, /future/i);

  const registered = await request("POST", "/api/auth/register", { body: registerBody });
  assert.equal(registered.status, 201, JSON.stringify(registered.body));
  assert.equal(registered.body.requiresOtp, true);
  assert.ok(registered.body.requestId);
  assert.equal(delivered.length, 1);
  const firstOtp = String(delivered[0].otp);
  assert.match(firstOtp, /^\d{6}$/);

  const pending = await db.query(
    `SELECT date_of_birth::text AS date_of_birth, gender, birth_date::text AS birth_date
     FROM patient_portal_profiles
     WHERE user_id = (SELECT id::text FROM users WHERE LOWER(email) = $1)`,
    [registerBody.email]
  );
  assert.equal(pending.rows[0].gender, "Female");
  assert.equal(String(pending.rows[0].date_of_birth).slice(0, 10), "2001-06-15");
  assert.equal(String(pending.rows[0].birth_date || pending.rows[0].date_of_birth).slice(0, 10), "2001-06-15");

  const resent = await request("POST", "/api/auth/send-otp", {
    body: { email: registerBody.email, phone: registerBody.phone },
  });
  assert.equal(resent.status, 200, JSON.stringify(resent.body));
  assert.equal(delivered.length, 2);
  const secondOtp = String(delivered[1].otp);
  assert.notEqual(secondOtp, firstOtp);

  const afterResend = await db.query(
    `SELECT date_of_birth::text AS date_of_birth, gender
     FROM patient_portal_profiles
     WHERE user_id = (SELECT id::text FROM users WHERE LOWER(email) = $1)`,
    [registerBody.email]
  );
  assert.equal(afterResend.rows[0].gender, "Female");
  assert.equal(String(afterResend.rows[0].date_of_birth).slice(0, 10), "2001-06-15");

  const stale = await request("POST", "/api/auth/verify-otp", {
    body: { requestId: registered.body.requestId, otp: firstOtp },
  });
  assert.equal(stale.status, 400);

  const verified = await request("POST", "/api/auth/verify-otp", {
    body: { requestId: resent.body.requestId, otp: secondOtp },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.requiresAdminApproval, true);

  const userRow = await db.query(`SELECT id, is_verified, status FROM users WHERE LOWER(email) = $1`, [
    registerBody.email,
  ]);
  const patientId = userRow.rows[0].id;
  assert.equal(userRow.rows[0].is_verified, true);

  const token = jwt.sign({ id: String(patientId), role: "patient" }, jwtSecret, { expiresIn: "1h" });
  const profile = await request("GET", "/api/patient/profile", { token });
  assert.equal(profile.status, 200, JSON.stringify(profile.body));
  assert.equal(profile.body.profile.gender, "Female");
  assert.equal(profile.body.profile.date_of_birth, "2001-06-15");
  assert.equal(profile.body.profile.age, patientData.ageFromDateOfBirth("2001-06-15"));

  const reload = await request("GET", "/api/patient/profile", { token });
  assert.equal(reload.body.profile.date_of_birth, "2001-06-15");

  const clinical = await clinicalPatients.getClinicalRecord(
    db,
    (
      await db.query(
        `SELECT id FROM clinic_patient_records WHERE linked_user_id::text = $1 LIMIT 1`,
        [String(patientId)]
      )
    ).rows[0].id
  );
  assert.equal(clinical.record.gender, "Female");
  assert.equal(String(clinical.record.dateOfBirth).slice(0, 10), "2001-06-15");
  assert.equal(clinical.record.age, patientData.ageFromDateOfBirth("2001-06-15"));

  const existingHash = await bcrypt.hash("ExistingPass123", 4);
  await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Mico', 'Legacy', 'mico.legacy@example.test', '639175550202', $1, 'patient', TRUE, 'Active')`,
    [existingHash]
  );
  const existingLogin = await request("POST", "/api/auth/login", {
    body: { identifier: "mico.legacy@example.test", password: "ExistingPass123" },
  });
  assert.equal(existingLogin.status, 200, JSON.stringify(existingLogin.body));
  const existingToken = existingLogin.body.token;
  const existingProfile = await request("GET", "/api/patient/profile", { token: existingToken });
  assert.equal(existingProfile.status, 200, JSON.stringify(existingProfile.body));
  assert.equal(existingProfile.body.profile.gender || "", "");
  assert.equal(existingProfile.body.profile.date_of_birth || null, null);
});
