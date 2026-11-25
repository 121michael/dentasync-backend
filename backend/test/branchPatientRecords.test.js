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

const dbName = `ds_branch_records_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
}

test("Staff lists performed local procedures; dentists identify patients without exposing other-branch history", async (t) => {
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

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(sqlFile("000_create_users.sql"));
  await db.query(sqlFile("002_create_patient_portal.sql"));
  await db.query(sqlFile("004_create_staff_portal.sql"));
  await db.query(sqlFile("005_create_admin_portal.sql"));
  await db.query(sqlFile("006_create_dentist_portal.sql"));
  await db.query(sqlFile("009_create_clinical_patient_records.sql"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) DEFAULT 0;
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      catalog_dentist_id TEXT,
      can_approve_cross_branch_access BOOLEAN DEFAULT FALSE
    );
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_settings (setting_key TEXT PRIMARY KEY, setting_value JSONB);
    CREATE TABLE IF NOT EXISTS admin_portal_audit_logs (
      id BIGSERIAL PRIMARY KEY,
      actor_id TEXT,
      actor_role TEXT,
      action TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await db.query(sqlFile("026_queue_wait_estimates.sql")).catch(() => {});
  await db.query(sqlFile("016_staff_walkin_qr.sql"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);
  await db.query(sqlFile("056_cross_branch_record_access.sql")).catch(() => {});

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const branchB = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-B', 'Branch B', 'B Street', '09170002222', 'b@example.test', FALSE, 'active', TRUE, TRUE)
     RETURNING id`
  );
  await db.query(`UPDATE clinic_branches SET name = 'Branch A' WHERE id = $1`, [main.rows[0].id]);
  const branchA = main.rows[0].id;
  const branchBId = branchB.rows[0].id;

  async function addUser(role, email, first, extra = {}) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Scope', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', $5, 'regular')
       RETURNING id`,
      [first, email, `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, role, extra.rfid || null]
    );
    return result.rows[0].id;
  }

  const patientA = await addUser("patient", "a.only@example.test", "Alpha");
  const patientB = await addUser("patient", "b.only@example.test", "Bravo");
  const patientBoth = await addUser("patient", "both@example.test", "Both");
  const patientNone = await addUser("patient", "none@example.test", "None", { rfid: "RFIDNONE01" });
  const patientDup = await addUser("patient", "dup@example.test", "Duplo");
  const staffA = await addUser("staff", "staff.a@example.test", "Sable");
  const staffB = await addUser("staff", "staff.b@example.test", "Soren");
  const dentistA = await addUser("dentist", "dentist.a@example.test", "Dana");
  const dentistB = await addUser("dentist", "dentist.b@example.test", "Dora");
  const dentistBoth = await addUser("dentist", "dentist.ab@example.test", "Drew");
  const admin = await addUser("admin", "admin.scope@example.test", "Ada");

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES
     ($1, $2), ($3, $4), ($5, $2), ($6, $4), ($7, $2), ($7, $4)`,
    [staffA, branchA, staffB, branchBId, dentistA, dentistB, dentistBoth]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES
     ($1, 'dr-dana'), ($2, 'dr-dora'), ($3, 'dr-drew')`,
    [String(dentistA), String(dentistB), String(dentistBoth)]
  );

  async function book(userId, branchId, dentistId, dentistName, status, time = "09:00") {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $2, $3,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $4::time, 'self_pay', 500, $5, $6
       ) RETURNING id`,
      [String(userId), dentistId, dentistName, time, status, branchId]
    );
    return result.rows[0].id;
  }

  await book(patientA, branchA, String(dentistA), "Dr. Dana Scope", "confirmed", "09:00");
  await book(patientB, branchBId, String(dentistB), "Dr. Dora Scope", "confirmed", "10:00");
  await book(patientBoth, branchA, String(dentistA), "Dr. Dana Scope", "confirmed", "11:00");
  await book(patientBoth, branchBId, String(dentistB), "Dr. Dora Scope", "confirmed", "12:00");
  await book(patientDup, branchA, String(dentistA), "Dr. Dana Scope", "confirmed", "13:00");
  await book(patientDup, branchA, String(dentistA), "Dr. Dana Scope", "confirmed", "14:00");
  await book(patientNone, branchA, String(dentistA), "Dr. Dana Scope", "pending", "15:00");

  async function recordFor(userId, code, first) {
    const result = await db.query(
      `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
       VALUES ($1, $2, 'Scope', $3) RETURNING id`,
      [code, first, String(userId)]
    );
    return result.rows[0].id;
  }

  const recordA = await recordFor(patientA, "CR-A", "Alpha");
  const recordB = await recordFor(patientB, "CR-B", "Bravo");
  const recordBoth = await recordFor(patientBoth, "CR-BOTH", "Both");
  const recordNone = await recordFor(patientNone, "CR-NONE", "None");
  const recordDup = await recordFor(patientDup, "CR-DUP", "Duplo");

  await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, diagnosis_notes, originating_branch_id
     ) VALUES
       ($1, 'A filling', 'Dr. Dana Scope', 'completed', 'Secret A note', $2),
       ($3, 'B filling', 'Dr. Dora Scope', 'completed', 'Secret B note', $4),
       ($5, 'A dual', 'Dr. Dana Scope', 'completed', 'Dual A note', $2),
       ($5, 'B dual', 'Dr. Dora Scope', 'completed', 'Dual B note', $4)`,
    [recordA, branchA, recordB, branchBId, recordBoth]
  );

  const app = express();
  app.use(express.json());
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => 0, notifyDentist: async () => 0 }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
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
    let parsed = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { raw: text };
    }
    return { status: response.status, body: parsed };
  }

  const tStaffA = tokenFor(staffA, "staff");
  const tStaffB = tokenFor(staffB, "staff");
  const tDentA = tokenFor(dentistA, "dentist");
  const tDentB = tokenFor(dentistB, "dentist");
  const tDentBoth = tokenFor(dentistBoth, "dentist");
  const tAdmin = tokenFor(admin, "admin");

  function names(payload) {
    return (payload.patients || payload.records || []).map((row) => row.fullName || row.patientName || `${row.firstName || ""} ${row.lastName || ""}`.trim());
  }

  const listA = await request("GET", "/api/staff/patients", { token: tStaffA });
  assert.equal(listA.status, 200, JSON.stringify(listA.body));
  assert.equal(names(listA.body).includes("Alpha Scope"), true);
  assert.equal(names(listA.body).includes("Bravo Scope"), false);
  assert.equal(names(listA.body).includes("None Scope"), false);
  assert.equal(names(listA.body).includes("Duplo Scope"), false);
  assert.equal(listA.body.total, names(listA.body).length);

  const spoof = await request("GET", `/api/staff/patients?branchId=${branchBId}&search=Bravo`, { token: tStaffA });
  assert.equal(names(spoof.body).includes("Bravo Scope"), false);

  const listB = await request("GET", "/api/staff/patients", { token: tStaffB });
  assert.equal(names(listB.body).includes("Bravo Scope"), true);
  assert.equal(names(listB.body).includes("Alpha Scope"), false);

  const bothA = await request("GET", `/api/staff/patients/${recordBoth}`, { token: tStaffA });
  assert.equal(bothA.status, 200, JSON.stringify(bothA.body));
  const bothATreatments = bothA.body.patient.treatments.map((row) => row.treatment);
  assert.deepEqual(bothATreatments, ["A dual"]);
  assert.equal(JSON.stringify(bothA.body).includes("Dual B note"), false);

  const bothB = await request("GET", `/api/staff/patients/${recordBoth}`, { token: tStaffB });
  assert.equal(bothB.body.patient.treatments.map((row) => row.treatment).join(), "B dual");
  assert.equal(JSON.stringify(bothB.body).includes("Dual A note"), false);

  const denyB = await request("GET", `/api/staff/patients/${recordA}`, { token: tStaffB });
  assert.equal(denyB.status, 404);
  assert.equal(denyB.body.patient, undefined);
  assert.equal(JSON.stringify(denyB.body).includes("Secret A note"), false);
  assert.equal(JSON.stringify(denyB.body).includes("Alpha"), false);

  const denyNone = await request("GET", `/api/staff/patients/${recordNone}`, { token: tStaffA });
  assert.equal(denyNone.status, 404);

  const chartDeny = await request("GET", `/api/staff/patients/${recordB}/dental-chart`, { token: tStaffA });
  assert.equal(chartDeny.status, 404);

  const rxDeny = await request("GET", `/api/staff/patients/${recordB}/prescriptions`, { token: tStaffA });
  assert.equal(rxDeny.status, 404);

  const dentAList = await request("GET", "/api/dentist/patients", {
    token: tDentA,
    headers: { "x-dentasync-branch": String(branchA) },
  });
  assert.equal(names(dentAList.body).includes("Alpha Scope"), true);
  assert.equal(names(dentAList.body).includes("Bravo Scope"), true);
  assert.equal(dentAList.body.patients.some((row) => row.lastTreatment), false);

  const dentAOnB = await request("GET", `/api/dentist/patients/${recordB}`, {
    token: tDentA,
    headers: { "x-dentasync-branch": String(branchA) },
  });
  assert.equal(dentAOnB.status, 200, JSON.stringify(dentAOnB.body));
  assert.equal(dentAOnB.body.patient.fullName, "Bravo Scope");
  assert.equal((dentAOnB.body.treatments || []).length, 0);
  assert.equal(dentAOnB.body.restrictedHistory, true);
  assert.equal(JSON.stringify(dentAOnB.body).includes("Secret B note"), false);

  const otherDentistOnA = await request("GET", `/api/dentist/patients/${recordA}`, {
    token: tDentB,
    headers: { "x-dentasync-branch": String(branchA) },
  });
  assert.equal(otherDentistOnA.status, 403);

  const dentBothOnA = await request("GET", "/api/dentist/patients", {
    token: tDentBoth,
    headers: { "x-dentasync-branch": String(branchA) },
  });
  assert.equal(names(dentBothOnA.body).includes("Alpha Scope"), true);
  assert.equal(names(dentBothOnA.body).includes("Both Scope"), true);

  const xrays = await request("GET", `/api/dentist/patients/${recordB}/xrays`, {
    token: tDentA,
    headers: { "x-dentasync-branch": String(branchA) },
  });
  assert.equal(xrays.status, 200);
  assert.equal((xrays.body.xrays || []).length, 0);

  const exportA = await request("GET", "/api/staff/export/appointments", { token: tStaffA });
  assert.equal(exportA.status, 200);
  assert.equal(String(exportA.body.raw || "").includes("Bravo"), false);

  const adminList = await request("GET", "/api/admin/clinical-records", { token: tAdmin });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.body));
  const adminNames = names(adminList.body);
  assert.ok(adminNames.some((name) => name.includes("Alpha")));
  assert.ok(adminNames.some((name) => name.includes("Bravo")));
  assert.ok(adminNames.some((name) => name.includes("None")));
});
