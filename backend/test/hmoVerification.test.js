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

const { buildHmoSnapshot } = require("../services/hmoVerification");

test("HMO snapshot distinguishes no HMO on file from unverified coverage", () => {
  const empty = buildHmoSnapshot();
  assert.equal(empty.hasHmoOnFile, false);
  assert.equal(empty.hmoVerificationDisplay, "no_hmo_on_file");
  assert.equal(empty.hmoVerificationStatus, "not_applicable");

  const pending = buildHmoSnapshot({
    profile: { hmo_provider: "Maxicare", hmo_status: "enrolled" },
  });
  assert.equal(pending.hasHmoOnFile, true);
  assert.equal(pending.hmoVerificationStatus, "pending_verification");
  assert.equal(pending.hmoVerificationDisplay, "pending_verification");

  const verified = buildHmoSnapshot({
    recordStatus: "verified",
    profile: { hmo_provider: "Maxicare", hmo_verification_status: "verified" },
  });
  assert.equal(verified.hmoVerificationStatus, "verified");
});

const dbName = `ds_hmo_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "127.0.0.1",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
}

test("staff HMO verification is shared with both patient-record portals", async (t) => {
  await adminPool.query(`SELECT current_database(), inet_server_port()`);
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const { applyPatientBranchBookingSchema } = require("../services/patientBranchBooking");
  const { ensurePatientHmoSchema } = require("../services/hmoVerification");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  const identity = await db.query(`SELECT current_database() AS name, inet_server_port() AS port`);
  assert.equal(identity.rows[0].name, dbName);

  await db.query(sqlFile("000_create_users.sql"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
  `);
  await db.query(sqlFile("002_create_patient_portal.sql"));
  await db.query(sqlFile("004_create_staff_portal.sql"));
  await db.query(sqlFile("005_create_admin_portal.sql"));
  await db.query(sqlFile("006_create_dentist_portal.sql"));
  await db.query(sqlFile("009_create_clinical_patient_records.sql"));
  await db.query(`
    ALTER TABLE clinic_patient_records ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE clinic_patient_records ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE clinic_patient_treatments
      ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS originating_branch_id INTEGER,
      ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT;
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT,
      actor_name TEXT,
      actor_role TEXT,
      action TEXT,
      target_type TEXT,
      target_id TEXT,
      target_label TEXT,
      result TEXT,
      detail TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(sqlFile("013_paper_gap_features.sql"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await applyPatientBranchBookingSchema(db);
  await db.query(`ALTER TABLE staff_portal_notifications ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await ensurePatientHmoSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const branchId = main.rows[0].id;

  async function addUser(role, email, phone, first) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Hmo', $2, $3, 'synthetic-hash', $4, TRUE, 'Active')
       RETURNING id`,
      [first, email, phone, role]
    );
    return result.rows[0].id;
  }

  const patientA = await addUser("patient", "pat.a.hmo@example.test", "09170004001", "Ava");
  const patientB = await addUser("patient", "pat.b.hmo@example.test", "09170004002", "Ben");
  const patientC = await addUser("patient", "pat.c.hmo@example.test", "09170004003", "Cara");
  const staffId = await addUser("staff", "staff.hmo@example.test", "09170004004", "Sam");
  const dentistId = await addUser("dentist", "dentist.hmo@example.test", "09170004005", "Dana");

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $2)`,
    [staffId, branchId, dentistId]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id, specialization)
     VALUES ($1, 'dr-dana-hmo', 'General')`,
    [String(dentistId)]
  );

  async function addProfile(userId, provider) {
    await db.query(
      `INSERT INTO patient_portal_profiles (user_id, hmo_provider, hmo_member_number, hmo_status)
       VALUES ($1, $2, $3, $4)`,
      [String(userId), provider, provider ? `MEM-${userId}` : null, provider ? "enrolled" : "not_enrolled"]
    );
  }
  await addProfile(patientA, "Maxicare");
  await addProfile(patientB, "Intellicare");
  await addProfile(patientC, null);

  async function addRecord(userId, first) {
    const result = await db.query(
      `INSERT INTO clinic_patient_records (record_code, first_name, last_name, email, phone, linked_user_id)
       VALUES ($1, $2, 'Hmo', $3, $4, $5)
       RETURNING id`,
      [`CPR-HMO-${userId}`, first, `${first.toLowerCase()}.hmo@example.test`, `09${String(userId).padStart(9, "0")}`, String(userId)]
    );
    return result.rows[0].id;
  }
  const recordA = await addRecord(patientA, "Ava");
  const recordB = await addRecord(patientB, "Ben");
  const recordC = await addRecord(patientC, "Cara");

  async function book(userId, time, coverage, provider) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, hmo_provider, hmo_member_number,
         estimated_cost, status, branch_id, hmo_verification_status
       ) VALUES (
         $1, 'cleaning', 'Cleaning', 'dr-dana-hmo', 'Dr. Dana Hmo',
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2::time, $3, $4, $5,
         800, 'confirmed', $6, $7
       ) RETURNING id`,
      [
        String(userId),
        time,
        coverage,
        provider,
        provider ? `MEM-${userId}` : null,
        branchId,
        coverage === "hmo" ? "pending_verification" : "not_applicable",
      ]
    );
    return result.rows[0].id;
  }
  const appointmentA = await book(patientA, "09:00", "hmo", "Maxicare");
  await book(patientB, "10:00", "hmo", "Intellicare");
  await book(patientC, "11:00", "self_pay", null);

  const app = express();
  app.use(express.json());
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  const staffToken = tokenFor(staffId, "staff");
  const dentistToken = tokenFor(dentistId, "dentist");

  async function request(method, urlPath, { token, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
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

  const dashboard = await request("GET", "/api/staff/dashboard", { token: staffToken });
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
  const hmoRows = (dashboard.body.todaysActivity || []).filter((row) => row.coverageType === "hmo");
  assert.equal(hmoRows.length >= 2, true);
  assert.equal(
    hmoRows.some((row) => String(row.patientId) === String(patientA)),
    true
  );

  const hmoDesk = await request("GET", `/api/staff/appointments?tab=hmo&patient=${patientA}`, {
    token: staffToken,
  });
  assert.equal(hmoDesk.status, 200, JSON.stringify(hmoDesk.body));
  assert.equal(hmoDesk.body.appointments.length, 1);
  assert.equal(hmoDesk.body.appointments[0].coverageType, "hmo");
  assert.equal(hmoDesk.body.appointments[0].hmoVerificationStatus, "pending_verification");

  const beforeStaffA = await request("GET", `/api/staff/patients/${recordA}`, { token: staffToken });
  const beforeDentistA = await request("GET", `/api/dentist/patients/${recordA}`, { token: dentistToken });
  const beforeStaffB = await request("GET", `/api/staff/patients/${recordB}`, { token: staffToken });
  const beforeStaffC = await request("GET", `/api/staff/patients/${recordC}`, { token: staffToken });
  assert.equal(beforeStaffA.status, 200, JSON.stringify(beforeStaffA.body));
  assert.equal(beforeDentistA.status, 200, JSON.stringify(beforeDentistA.body));
  assert.equal(beforeStaffA.body.patient.hasHmoOnFile, true);
  assert.equal(beforeStaffA.body.patient.hmoVerificationDisplay, "pending_verification");
  assert.equal(beforeDentistA.body.patient.hmoVerificationDisplay, "pending_verification");
  assert.equal(beforeStaffB.body.patient.hmoVerificationDisplay, "pending_verification");
  assert.equal(beforeStaffC.body.patient.hasHmoOnFile, false);
  assert.equal(beforeStaffC.body.patient.hmoVerificationDisplay, "no_hmo_on_file");

  const verified = await request("PATCH", `/api/staff/appointments/${appointmentA}/hmo-verification`, {
    token: staffToken,
    body: { status: "verified" },
  });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.appointment.hmoVerificationStatus, "verified");

  const afterStaffA = await request("GET", `/api/staff/patients/${recordA}`, { token: staffToken });
  const afterDentistA = await request("GET", `/api/dentist/patients/${recordA}`, { token: dentistToken });
  const afterStaffB = await request("GET", `/api/staff/patients/${recordB}`, { token: staffToken });
  const afterDentistB = await request("GET", `/api/dentist/patients/${recordB}`, { token: dentistToken });
  assert.equal(afterStaffA.body.patient.hmoVerificationStatus, "verified");
  assert.equal(afterStaffA.body.patient.hmoVerificationDisplay, "verified");
  assert.equal(afterDentistA.body.patient.hmoVerificationStatus, "verified");
  assert.equal(afterStaffB.body.patient.hmoVerificationStatus, "pending_verification");
  assert.equal(afterDentistB.body.patient.hmoVerificationStatus, "pending_verification");

  const dentistForbidden = await request("PATCH", `/api/staff/appointments/${appointmentA}/hmo-verification`, {
    token: dentistToken,
    body: { status: "rejected" },
  });
  assert.equal(dentistForbidden.status, 403);

  const dentistPatientForbidden = await request("PATCH", `/api/staff/patients/${recordA}/hmo-verification`, {
    token: dentistToken,
    body: { status: "rejected" },
  });
  assert.equal(dentistPatientForbidden.status, 403);

  const stillVerified = await request("GET", `/api/staff/patients/${recordA}`, { token: staffToken });
  assert.equal(stillVerified.body.patient.hmoVerificationStatus, "verified");

  const recordSave = await request("PATCH", `/api/staff/patients/${recordB}/hmo-verification`, {
    token: staffToken,
    body: { status: "verified" },
  });
  assert.equal(recordSave.status, 200, JSON.stringify(recordSave.body));
  const afterRecordB = await request("GET", `/api/dentist/patients/${recordB}`, { token: dentistToken });
  assert.equal(afterRecordB.body.patient.hmoVerificationStatus, "verified");
});
