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

const dbName = `ds_record_identity_${process.pid}_${Date.now().toString(36)}`;
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

test("Dentist identity is clinic-wide; history stays with the originating branch", async (t) => {
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
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS tooth_number TEXT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) DEFAULT 0;
    CREATE TABLE IF NOT EXISTS clinic_dental_chart_entries (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT NOT NULL REFERENCES clinic_patient_records(id) ON DELETE CASCADE,
      tooth_number TEXT NOT NULL,
      condition_label TEXT NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_by_role TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (clinical_record_id, tooth_number)
    );
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS patient_portal_documents (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT
    );
    CREATE TABLE IF NOT EXISTS dental_wellness_assessments (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT
    );
    CREATE TABLE IF NOT EXISTS dental_procedure_authorizations (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT
    );
  `);
  await db.query(sqlFile("056_cross_branch_record_access.sql"));

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  await db.query(`UPDATE clinic_branches SET name = 'Taguig', branch_code = 'TAG' WHERE id = $1`, [
    main.rows[0].id,
  ]);
  const taguigId = main.rows[0].id;
  const mandaluyong = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('MND', 'Mandaluyong', 'Boni', '09170003333', 'mnd@example.test', FALSE, 'active', TRUE, TRUE)
     RETURNING id`
  );
  const mandaluyongId = mandaluyong.rows[0].id;

  async function addUser(role, email, first, extra = {}) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category, patient_id)
       VALUES ($1, $2, $3, $4, 'synthetic-hash', $5, TRUE, 'Active', $6, 'regular', $7)
       RETURNING id`,
      [
        first,
        extra.last || "Identity",
        email,
        `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`,
        role,
        extra.rfid || null,
        extra.patientId || null,
      ]
    );
    return result.rows[0].id;
  }

  const taguigPatient = await addUser("patient", "tomas.taguig@example.test", "Tomas", {
    last: "Taguig",
    patientId: "PID-TAG",
    rfid: "RFIDTAG01",
  });
  const mandaluyongPatient = await addUser("patient", "mina.mandaluyong@example.test", "Mina", {
    last: "Mandaluyong",
    patientId: "PID-MND",
  });
  const bothPatient = await addUser("patient", "both.branches@example.test", "Both", { last: "Branches" });
  const appointmentOnly = await addUser("patient", "appt.only@example.test", "Appt", { last: "Only" });
  const unknownPatient = await addUser("patient", "unknown.origin@example.test", "Unknown", { last: "Origin" });
  const staffTaguig = await addUser("staff", "staff.taguig@example.test", "Sasha");
  const staffMandaluyong = await addUser("staff", "staff.mnd@example.test", "Soren");
  const dentistTaguig = await addUser("dentist", "dentist.taguig@example.test", "Tala");
  const dentistMandaluyong = await addUser("dentist", "dentist.mnd@example.test", "Marco");
  const admin = await addUser("admin", "admin.identity@example.test", "Ada");

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES
     ($1, $2), ($3, $4), ($5, $2), ($6, $4)`,
    [staffTaguig, taguigId, staffMandaluyong, mandaluyongId, dentistTaguig, dentistMandaluyong]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-tala'), ($2, 'dr-marco')`,
    [String(dentistTaguig), String(dentistMandaluyong)]
  );

  async function book(userId, branchId, dentistId, dentistName, status, time) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $2, $3,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $6::time, 'self_pay', 500, $4, $5
       ) RETURNING id`,
      [String(userId), dentistId, dentistName, status, branchId, time]
    );
    return result.rows[0].id;
  }

  await book(taguigPatient, taguigId, String(dentistTaguig), "Dr. Tala Identity", "confirmed", "09:00");
  await book(mandaluyongPatient, mandaluyongId, String(dentistMandaluyong), "Dr. Marco Identity", "confirmed", "09:30");
  await book(bothPatient, taguigId, String(dentistTaguig), "Dr. Tala Identity", "confirmed", "10:00");
  await book(bothPatient, mandaluyongId, String(dentistMandaluyong), "Dr. Marco Identity", "confirmed", "10:30");
  await book(appointmentOnly, taguigId, String(dentistTaguig), "Dr. Tala Identity", "confirmed", "11:00");
  await book(appointmentOnly, mandaluyongId, String(dentistMandaluyong), "Dr. Marco Identity", "checked_in", "11:30");

  async function recordFor(userId, code, first, last) {
    const result = await db.query(
      `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id, email, phone)
       VALUES ($1, $2, $3, $4, $5, '09170009999') RETURNING id`,
      [code, first, last, String(userId), `${first.toLowerCase()}@hidden.test`]
    );
    return result.rows[0].id;
  }

  const recordTaguig = await recordFor(taguigPatient, "CR-TAG", "Tomas", "Taguig");
  const recordMandaluyong = await recordFor(mandaluyongPatient, "CR-MND", "Mina", "Mandaluyong");
  const recordBoth = await recordFor(bothPatient, "CR-BOTH", "Both", "Branches");
  const recordAppt = await recordFor(appointmentOnly, "CR-APPT", "Appt", "Only");
  const recordUnknown = await recordFor(unknownPatient, "CR-UNK", "Unknown", "Origin");

  await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, diagnosis_notes, originating_branch_id, amount_charged
     ) VALUES
       ($1, 'Taguig cleaning', 'Dr. Tala Identity', 'completed', 'Mild stain Taguig', $2, 500),
       ($3, 'Mandaluyong filling', 'Dr. Marco Identity', 'completed', 'Deep caries Mandaluyong', $4, 800),
       ($5, 'Taguig both', 'Dr. Tala Identity', 'completed', 'Both Taguig note', $2, 400),
       ($5, 'Mandaluyong both', 'Dr. Marco Identity', 'completed', 'Both Mandaluyong note', $4, 600),
       ($6, 'Planned only', 'Dr. Tala Identity', 'planned', 'Should not qualify staff', $2, 0),
       ($7, 'Unknown filling', 'Dr. Tala Identity', 'completed', 'Unknown origin note', NULL, 250)`,
    [recordTaguig, taguigId, recordMandaluyong, mandaluyongId, recordBoth, recordAppt, recordUnknown]
  );

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => 0, notifyDentist: async () => 0 })
  );
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  app.use(
    "/api/admin",
    createAdminPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } })
  );
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
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      body = { raw: text };
    }
    return { status: response.status, body, text };
  }

  const tStaffT = tokenFor(staffTaguig, "staff");
  const tStaffM = tokenFor(staffMandaluyong, "staff");
  const tDentT = tokenFor(dentistTaguig, "dentist");
  const tDentM = tokenFor(dentistMandaluyong, "dentist");
  const tAdmin = tokenFor(admin, "admin");
  const headerT = { "x-dentasync-branch": String(taguigId) };
  const headerM = { "x-dentasync-branch": String(mandaluyongId) };

  function names(payload) {
    return (payload.patients || payload.records || []).map(
      (row) => row.fullName || row.patientName || `${row.firstName || ""} ${row.lastName || ""}`.trim()
    );
  }

  const dentistMList = await request("GET", "/api/dentist/patients", { token: tDentM, headers: headerM });
  assert.equal(dentistMList.status, 200, JSON.stringify(dentistMList.body));
  assert.equal(names(dentistMList.body).includes("Tomas Taguig"), true);
  assert.equal(names(dentistMList.body).includes("Mina Mandaluyong"), true);
  assert.equal(names(dentistMList.body).includes("Appt Only"), true);
  assert.equal(names(dentistMList.body).includes("Unknown Origin"), true);
  assert.equal(dentistMList.body.total, dentistMList.body.patients.length);
  const tomasRow = dentistMList.body.patients.find((row) => row.fullName === "Tomas Taguig");
  assert.ok(["PID-TAG", "CR-TAG"].includes(String(tomasRow.patientId)));
  assert.equal(tomasRow.phone, undefined);
  assert.equal(tomasRow.email, undefined);
  assert.equal(tomasRow.lastTreatment, undefined);
  assert.equal(JSON.stringify(dentistMList.body).includes("Mild stain"), false);
  assert.equal(JSON.stringify(dentistMList.body).includes("09170009999"), false);

  const dentistTList = await request("GET", "/api/dentist/patients", { token: tDentT, headers: headerT });
  assert.equal(names(dentistTList.body).includes("Mina Mandaluyong"), true);
  assert.equal(dentistTList.body.total, dentistMList.body.total);

  const dentistMSearch = await request("GET", "/api/dentist/patients?search=Tomas", {
    token: tDentM,
    headers: headerM,
  });
  assert.equal(names(dentistMSearch.body).includes("Tomas Taguig"), true);
  assert.equal(JSON.stringify(dentistMSearch.body).includes("Mild stain"), false);

  const openTomasFromM = await request("GET", `/api/dentist/patients/${recordTaguig}`, {
    token: tDentM,
    headers: headerM,
  });
  assert.equal(openTomasFromM.status, 200);
  assert.equal(openTomasFromM.body.patient.fullName, "Tomas Taguig");
  assert.equal(openTomasFromM.body.patient.phone, undefined);
  assert.equal((openTomasFromM.body.treatments || []).length, 0);
  assert.equal(openTomasFromM.body.restrictedHistory, true);
  assert.match(String(openTomasFromM.body.restrictedHistoryMessage), /requires authorization/);
  assert.equal(JSON.stringify(openTomasFromM.body).includes("Mild stain Taguig"), false);
  assert.equal(JSON.stringify(openTomasFromM.body).includes("Taguig cleaning"), false);

  const openMinaFromT = await request("GET", `/api/dentist/patients/${recordMandaluyong}`, {
    token: tDentT,
    headers: headerT,
  });
  assert.equal(openMinaFromT.status, 200);
  assert.equal((openMinaFromT.body.treatments || []).length, 0);
  assert.equal(JSON.stringify(openMinaFromT.body).includes("Deep caries"), false);

  const openBothFromM = await request("GET", `/api/dentist/patients/${recordBoth}`, {
    token: tDentM,
    headers: headerM,
  });
  assert.equal(openBothFromM.body.treatments.map((row) => row.treatment).join(), "Mandaluyong both");
  assert.equal(openBothFromM.body.restrictedHistory, true);
  assert.equal(JSON.stringify(openBothFromM.body).includes("Both Taguig note"), false);
  assert.equal(JSON.stringify(openBothFromM.body).includes("Taguig both"), false);

  const openUnknownFromT = await request("GET", `/api/dentist/patients/${recordUnknown}`, {
    token: tDentT,
    headers: headerT,
  });
  assert.equal((openUnknownFromT.body.treatments || []).length, 0);
  assert.equal(openUnknownFromT.body.restrictedHistory, true);
  assert.equal(JSON.stringify(openUnknownFromT.body).includes("Unknown origin note"), false);

  const chartTomas = await request("GET", `/api/dentist/patients/${recordTaguig}/dental-chart`, {
    token: tDentM,
    headers: headerM,
  });
  assert.equal(chartTomas.status, 200);
  assert.equal((chartTomas.body.entries || []).length, 0);
  assert.equal(JSON.stringify(chartTomas.body).includes("Mild stain"), false);

  const requestRow = await db.query(
    `INSERT INTO record_access_requests (
       clinical_record_id, requesting_dentist_id, requesting_branch_id, originating_branch_id, reason, scope, status
     ) VALUES ($1, $2, $3, $4, 'Continuity of care', 'diagnosis_notes', 'approved')
     RETURNING id`,
    [recordTaguig, String(dentistMandaluyong), mandaluyongId, taguigId]
  );
  await db.query(
    `INSERT INTO record_access_grants (
       request_id, requesting_dentist_id, clinical_record_id, originating_branch_id, scope, status, expires_at
     ) VALUES ($1, $2, $3, $4, 'diagnosis_notes', 'active', NOW() + INTERVAL '30 minutes')`,
    [requestRow.rows[0].id, String(dentistMandaluyong), recordTaguig, taguigId]
  );

  const granted = await request("GET", `/api/dentist/patients/${recordTaguig}`, {
    token: tDentM,
    headers: headerM,
  });
  assert.equal(granted.status, 200);
  assert.equal(
    (granted.body.treatments || []).some((row) => row.treatment === "Taguig cleaning"),
    true
  );
  assert.equal(
    granted.body.treatments.find((row) => row.treatment === "Taguig cleaning").diagnosisNotes,
    "Mild stain Taguig"
  );

  await db.query(`UPDATE record_access_grants SET status = 'expired' WHERE request_id = $1`, [
    requestRow.rows[0].id,
  ]);
  const expired = await request("GET", `/api/dentist/patients/${recordTaguig}`, {
    token: tDentM,
    headers: headerM,
  });
  assert.equal((expired.body.treatments || []).length, 0);
  assert.equal(JSON.stringify(expired.body).includes("Mild stain Taguig"), false);

  const staffTList = await request("GET", "/api/staff/patients", { token: tStaffT });
  assert.equal(staffTList.status, 200);
  assert.equal(names(staffTList.body).includes("Tomas Taguig"), true);
  assert.equal(names(staffTList.body).includes("Both Branches"), true);
  assert.equal(names(staffTList.body).includes("Mina Mandaluyong"), false);
  assert.equal(names(staffTList.body).includes("Appt Only"), false);
  assert.equal(names(staffTList.body).includes("Unknown Origin"), false);
  assert.equal(staffTList.body.total, names(staffTList.body).length);

  const staffTSearch = await request("GET", "/api/staff/patients?search=Mina", { token: tStaffT });
  assert.equal(names(staffTSearch.body).includes("Mina Mandaluyong"), false);
  assert.equal(staffTSearch.body.total, 0);

  const staffTMina = await request("GET", `/api/staff/patients/${recordMandaluyong}`, { token: tStaffT });
  assert.equal(staffTMina.status, 404);
  assert.equal(staffTMina.body.patient, undefined);
  assert.equal(JSON.stringify(staffTMina.body).includes("Mina"), false);

  const staffTAppt = await request("GET", `/api/staff/patients/${recordAppt}`, { token: tStaffT });
  assert.equal(staffTAppt.status, 404);

  const staffTUnknown = await request("GET", `/api/staff/patients/${recordUnknown}`, { token: tStaffT });
  assert.equal(staffTUnknown.status, 404);

  const staffMTomas = await request("GET", `/api/staff/patients/${recordTaguig}`, { token: tStaffM });
  assert.equal(staffMTomas.status, 404);

  const staffBothT = await request("GET", `/api/staff/patients/${recordBoth}`, { token: tStaffT });
  assert.equal(staffBothT.status, 200);
  assert.equal(staffBothT.body.patient.treatments.map((row) => row.treatment).join(), "Taguig both");
  assert.equal(JSON.stringify(staffBothT.body).includes("Both Mandaluyong note"), false);

  const dentistWrongBranch = await request("GET", `/api/dentist/patients/${recordTaguig}`, {
    token: tDentM,
    headers: headerT,
  });
  assert.equal(dentistWrongBranch.status, 403);

  const adminList = await request("GET", "/api/admin/clinical-records", { token: tAdmin });
  assert.ok(names(adminList.body).some((name) => name.includes("Tomas")));
  assert.ok(names(adminList.body).some((name) => name.includes("Mina")));
  assert.ok(names(adminList.body).some((name) => name.includes("Appt")));
});
