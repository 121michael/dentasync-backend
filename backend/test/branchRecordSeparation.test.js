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

test("assigned branch limits appointments, notices, queues, and records", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const recordAccess = require("../services/recordAccess");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createRecordAccessApprovalRouter } = require("../routes/recordAccessApproval");
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
  await db.query(sqlFile("009_create_clinical_patient_records.sql"));
  await db.query(sqlFile("024_dentist_portal_notifications.sql"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    ALTER TABLE patient_portal_queue_entries
      ADD COLUMN IF NOT EXISTS wait_estimate_min_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS wait_estimate_max_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS wait_estimate_duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS wait_estimate_call_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS wait_estimate_call_end TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS wait_estimate_method TEXT,
      ADD COLUMN IF NOT EXISTS wait_estimate_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMPTZ;
    ALTER TABLE clinic_patient_treatments
      ADD COLUMN IF NOT EXISTS tooth_number TEXT,
      ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT,
      ADD COLUMN IF NOT EXISTS procedure_details TEXT,
      ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
      ADD COLUMN IF NOT EXISTS queue_entry_id BIGINT,
      ADD COLUMN IF NOT EXISTS visit_sequence INTEGER,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_by TEXT;
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
      tooth_status TEXT,
      conditions_json JSONB,
      treatments_json JSONB,
      updated_by TEXT,
      UNIQUE (clinical_record_id, tooth_number)
    );
    CREATE TABLE IF NOT EXISTS patient_portal_documents (
      id UUID PRIMARY KEY,
      user_id TEXT NOT NULL,
      document_type TEXT NOT NULL,
      original_name TEXT,
      stored_name TEXT,
      mime_type TEXT,
      byte_size INTEGER,
      originating_branch_id BIGINT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_portal_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
  `);
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await db.query(sqlFile("036_dental_wellness_assessments.sql"));
  await db.query(sqlFile("040_dental_procedure_authorizations.sql"));
  await db.query(sqlFile("056_cross_branch_record_access.sql"));
  await db.query(sqlFile("057_record_access_workstation_auth.sql"));
  await db.query(sqlFile("058_record_access_isolated_approver.sql"));

  const mandaluyong = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const taguig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-TAGUIG', 'Taguig', 'Synthetic Taguig', '09180000022', FALSE, 'active')
     RETURNING id`
  );
  const mandaluyongId = mandaluyong.rows[0].id;
  const taguigId = taguig.rows[0].id;

  let phone = 9170001000;
  async function addUser(role, first, email) {
    phone += 1;
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Branch', $2, $3, 'synthetic-hash', $4, TRUE, 'Active')
       RETURNING id`,
      [first, email, String(phone), role]
    );
    return String(result.rows[0].id);
  }

  const adminId = await addUser("admin", "Ada", "ada.records@example.test");
  const mindaId = await addUser("staff", "Minda", "minda.records@example.test");
  const tessaId = await addUser("staff", "Tessa", "tessa.records@example.test");
  const marcoId = await addUser("dentist", "Marco", "marco.records@example.test");
  const talaId = await addUser("dentist", "Tala", "tala.records@example.test");
  const strayId = await addUser("staff", "Stray", "stray.records@example.test");
  const patientId = await addUser("patient", "Mina", "mina.records@example.test");
  await db.query(
    `UPDATE users SET patient_category = 'regular', patient_id = 'A202611_01' WHERE id = $1`,
    [patientId]
  );
  await db.query(`
    ALTER TABLE admin_portal_dentist_profiles
      ADD COLUMN IF NOT EXISTS catalog_dentist_id TEXT,
      ADD COLUMN IF NOT EXISTS license_number TEXT,
      ADD COLUMN IF NOT EXISTS ptr_number TEXT,
      ADD COLUMN IF NOT EXISTS professional_designation TEXT,
      ADD COLUMN IF NOT EXISTS license_verified BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS can_approve_cross_branch_access BOOLEAN NOT NULL DEFAULT FALSE;
  `);
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, specialization) VALUES ($1, 'General'), ($2, 'General')`,
    [marcoId, talaId]
  );
  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES
     ($1, $2), ($3, $4), ($5, $2), ($6, $4)`,
    [mindaId, mandaluyongId, tessaId, taguigId, marcoId, talaId]
  );

  const record = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CPR-MINA', 'Mina', 'Branch', $1)
     RETURNING id`,
    [patientId]
  );
  const recordId = record.rows[0].id;
  await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, treatment_date, diagnosis_notes,
       originating_branch_id, treating_dentist_id, tooth_number, created_by, created_by_role
     ) VALUES
     ($1, 'Mandaluyong Cleaning', 'Dr. Marco Branch', 'completed', CURRENT_DATE, 'Mandaluyong caries', $2, $3, '16', $3, 'dentist'),
     ($1, 'Taguig Filling', 'Dr. Tala Branch', 'completed', CURRENT_DATE, 'Taguig fracture', $4, $5, '26', $5, 'dentist')`,
    [recordId, mandaluyongId, marcoId, taguigId, talaId]
  );
  await db.query(
    `INSERT INTO clinic_dental_chart_entries (
       clinical_record_id, tooth_number, condition_label, notes, tooth_status, conditions_json, treatments_json
     ) VALUES
     ($1, '16', 'Caries', 'Mandaluyong chart note', 'treated', '["Caries"]'::jsonb, '["Cleaning"]'::jsonb),
     ($1, '26', 'Fracture', 'Taguig chart note', 'treated', '["Fracture"]'::jsonb, '["Filling"]'::jsonb)`,
    [recordId]
  );
  const docId = "22222222-2222-2222-2222-222222222222";
  await db.query(
    `INSERT INTO patient_portal_documents (
       id, user_id, document_type, original_name, stored_name, mime_type, byte_size, originating_branch_id
     ) VALUES ($1, $2, 'medical_document', 'taguig.pdf', 'missing.bin', 'application/pdf', 12, $3)`,
    [docId, patientId, taguigId]
  );
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time,
       coverage_type, estimated_cost, status, branch_id
     ) VALUES
     ($1, 'cleaning', 'Mandaluyong Cleaning', $2, 'Dr. Marco Branch', CURRENT_DATE, '23:40', 'self_pay', 0, 'confirmed', $3),
     ($1, 'filling', 'Taguig Filling', $4, 'Dr. Tala Branch', CURRENT_DATE, '23:45', 'self_pay', 0, 'confirmed', $5)`,
    [patientId, marcoId, mandaluyongId, talaId, taguigId]
  );

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  app.use("/api/record-access", createRecordAccessApprovalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  function tokenFor(id, role) {
    return jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  }
  async function api(method, urlPath, { role, id, body, branchId } = {}) {
    const headers = { "content-type": "application/json" };
    if (id) headers.authorization = `Bearer ${tokenFor(id, role)}`;
    if (branchId) headers["x-dentasync-branch"] = String(branchId);
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { status: response.status, json, text };
  }

  const mindaAppointments = await api("GET", "/api/staff/appointments?tab=today", { role: "staff", id: mindaId });
  assert.equal(mindaAppointments.status, 200);
  assert.equal(mindaAppointments.json.appointments.length, 1);
  assert.match(mindaAppointments.json.appointments[0].serviceName || mindaAppointments.json.appointments[0].treatment || "", /Mandaluyong/);
  const tessaAppointments = await api("GET", "/api/staff/appointments?tab=today", { role: "staff", id: tessaId });
  assert.equal(tessaAppointments.json.appointments.length, 1);
  assert.match(JSON.stringify(tessaAppointments.json.appointments), /Taguig Filling/);
  assert.equal(JSON.stringify(tessaAppointments.json).includes("Mandaluyong Cleaning"), false);

  const mindaDash = await api("GET", "/api/staff/dashboard", { role: "staff", id: mindaId });
  const tessaDash = await api("GET", "/api/staff/dashboard", { role: "staff", id: tessaId });
  assert.equal(mindaDash.json.metrics.todaysAppointments, 1);
  assert.equal(tessaDash.json.metrics.todaysAppointments, 1);

  const marcoAppointments = await api("GET", "/api/dentist/appointments", { role: "dentist", id: marcoId });
  const talaAppointments = await api("GET", "/api/dentist/appointments", { role: "dentist", id: talaId });
  assert.equal(marcoAppointments.json.todayAppointments.length, 1);
  assert.equal(talaAppointments.json.todayAppointments.length, 1);
  assert.match(JSON.stringify(marcoAppointments.json), /Mandaluyong/);
  assert.equal(JSON.stringify(talaAppointments.json).includes("Mandaluyong"), false);

  const forged = await api("GET", "/api/staff/appointments?tab=today", {
    role: "staff",
    id: mindaId,
    branchId: taguigId,
  });
  assert.equal(forged.status, 403);
  const forgedQuery = await api("GET", `/api/dentist/appointments?branchId=${taguigId}`, {
    role: "dentist",
    id: marcoId,
  });
  assert.equal(forgedQuery.status, 403);
  const stray = await api("GET", "/api/staff/appointments?tab=today", { role: "staff", id: strayId });
  assert.equal(stray.json.appointments.length, 0);
  assert.equal(stray.json.metrics, undefined);

  const { notifyActiveStaff } = require("../services/staffNotifications");
  const { notifyDentists } = require("../services/dentistNotifications");
  const mandaluyongVisit = (await db.query(
    `SELECT id FROM patient_portal_appointments WHERE branch_id = $1`,
    [mandaluyongId]
  )).rows[0].id;
  await notifyActiveStaff(db, {
    type: "appointment",
    title: "New Mandaluyong booking",
    body: "Mina booked Mandaluyong Cleaning",
    entityType: "appointment",
    entityId: mandaluyongVisit,
    branchId: mandaluyongId,
  });
  await notifyDentists(db, {
    type: "appointment",
    title: "New Mandaluyong booking",
    body: "Mina booked Mandaluyong Cleaning",
    entityType: "appointment",
    entityId: mandaluyongVisit,
    branchId: mandaluyongId,
    dentistId: marcoId,
  });
  const mindaNotes = await api("GET", "/api/staff/notifications", { role: "staff", id: mindaId });
  const tessaNotes = await api("GET", "/api/staff/notifications", { role: "staff", id: tessaId });
  const marcoNotes = await api("GET", "/api/dentist/notifications", { role: "dentist", id: marcoId });
  const talaNotes = await api("GET", "/api/dentist/notifications", { role: "dentist", id: talaId });
  assert.equal(mindaNotes.json.unreadCount, 1);
  assert.equal(tessaNotes.json.unreadCount, 0);
  assert.equal(marcoNotes.json.unreadCount, 1);
  assert.equal(talaNotes.json.unreadCount, 0);

  const checked = await api("POST", "/api/staff/check-in", {
    role: "staff",
    id: mindaId,
    body: { method: "manual", appointmentId: mandaluyongVisit },
  });
  assert.equal(checked.status, 201, checked.json.message);
  const mindaQueue = await api("GET", "/api/staff/queue", { role: "staff", id: mindaId });
  const tessaQueue = await api("GET", "/api/staff/queue", { role: "staff", id: tessaId });
  assert.equal(mindaQueue.json.queue.length, 1);
  assert.equal(tessaQueue.json.queue.length, 0);
  const wrongCheckIn = await api("POST", "/api/staff/check-in", {
    role: "staff",
    id: tessaId,
    body: { method: "manual", appointmentId: mandaluyongVisit },
  });
  assert.equal(wrongCheckIn.status, 409);

  const mindaSearch = await api("GET", "/api/staff/patients?search=Mina", { role: "staff", id: mindaId });
  assert.equal(mindaSearch.json.patients.length, 1);
  assert.equal(mindaSearch.json.patients[0].lastTreatment, "Mandaluyong Cleaning");
  const mindaChart = await api("GET", `/api/staff/patients/${recordId}`, { role: "staff", id: mindaId });
  assert.equal(mindaChart.status, 200);
  assert.equal(mindaChart.json.patient.treatments.some((row) => row.treatment === "Taguig Filling"), false);
  assert.equal(mindaChart.json.patient.treatments.some((row) => row.diagnosisNotes === "Mandaluyong caries"), true);
  const tessaChart = await api("GET", `/api/staff/patients/${recordId}`, { role: "staff", id: tessaId });
  assert.equal(tessaChart.json.patient.treatments.some((row) => row.treatment === "Mandaluyong Cleaning"), false);
  assert.equal(tessaChart.json.patient.treatments.some((row) => row.diagnosisNotes === "Taguig fracture"), true);
  assert.equal(JSON.stringify(tessaChart.json).includes("Mandaluyong caries"), false);
  const talaChart = await api("GET", `/api/dentist/patients/${recordId}`, { role: "dentist", id: talaId });
  assert.equal(talaChart.status, 200, talaChart.json.message);
  assert.equal(talaChart.json.treatments.find((row) => row.treatment === "Mandaluyong Cleaning"), undefined);
  assert.equal(talaChart.json.treatments.find((row) => row.treatment === "Taguig Filling").diagnosisNotes, "Taguig fracture");
  const taguigTreatment = await db.query(
    `SELECT id FROM clinic_patient_treatments WHERE clinical_record_id = $1 AND treatment = 'Taguig Filling'`,
    [recordId]
  );
  const staffPayment = await api("PATCH", `/api/staff/patients/${recordId}/treatments/${taguigTreatment.rows[0].id}`, {
    role: "staff",
    id: mindaId,
    body: { amountPaid: 10 },
  });
  assert.equal(staffPayment.status, 403);

  const mindaTeeth = await api("GET", `/api/staff/patients/${recordId}/dental-chart`, { role: "staff", id: mindaId });
  const tooth26 = mindaTeeth.json.entries.find((row) => String(row.toothNumber) === "26");
  const tooth16 = mindaTeeth.json.entries.find((row) => String(row.toothNumber) === "16");
  assert.equal(tooth26.notes, "");
  assert.match(tooth16.notes, /Mandaluyong/);
  assert.equal(tooth16.notes.includes("Taguig"), false);

  const marcoChart = await api("GET", `/api/dentist/patients/${recordId}`, { role: "dentist", id: marcoId });
  assert.equal(marcoChart.status, 200, marcoChart.json.message);
  assert.equal(marcoChart.json.treatments.find((row) => row.treatment === "Taguig Filling"), undefined);
  assert.equal(marcoChart.json.treatments.find((row) => row.treatment === "Mandaluyong Cleaning").diagnosisNotes, "Mandaluyong caries");
  const hiddenDownload = await api(
    "GET",
    `/api/dentist/patients/${recordId}/medical-documents/${docId}/download`,
    { role: "dentist", id: marcoId }
  );
  assert.equal(hiddenDownload.status, 403);

  const pending = await api("POST", `/api/dentist/patients/${recordId}/access-challenges`, {
    role: "dentist",
    id: marcoId,
    body: {
      requestingBranchId: mandaluyongId,
      originatingBranchId: taguigId,
      reason: "Need the Taguig note",
      scope: "diagnosis_notes",
    },
  });
  assert.equal(pending.status, 201, pending.json.message);
  const duringRequest = await api("GET", `/api/dentist/patients/${recordId}`, { role: "dentist", id: marcoId });
  assert.equal(duringRequest.json.treatments.find((row) => row.treatment === "Taguig Filling"), undefined);

  const approved = await api("POST", `/api/record-access/challenges/${pending.json.challenge.approvalCode}/approve`, {
    role: "admin",
    id: adminId,
  });
  assert.equal(approved.status, 200, approved.json.message);
  const opened = await api("GET", `/api/dentist/patients/${recordId}`, { role: "dentist", id: marcoId });
  assert.equal(opened.json.treatments.find((row) => row.treatment === "Taguig Filling").diagnosisNotes, "Taguig fracture");
  const xraysStillHidden = await api("GET", `/api/dentist/patients/${recordId}/xrays`, { role: "dentist", id: marcoId });
  assert.equal(xraysStillHidden.json.xrays.length, 0);
  const downloadStillHidden = await api(
    "GET",
    `/api/dentist/patients/${recordId}/medical-documents/${docId}/download`,
    { role: "dentist", id: marcoId }
  );
  assert.equal(downloadStillHidden.status, 403);
  const taguigVisit = (await db.query(
    `SELECT id FROM patient_portal_appointments WHERE branch_id = $1`,
    [taguigId]
  )).rows[0].id;
  await notifyActiveStaff(db, {
    type: "appointment",
    title: "New Taguig booking",
    body: "Mina booked Taguig Filling",
    entityType: "appointment",
    entityId: taguigVisit,
    branchId: taguigId,
  });
  const mindaAfterTaguig = await api("GET", "/api/staff/notifications", { role: "staff", id: mindaId });
  const tessaAfterTaguig = await api("GET", "/api/staff/notifications", { role: "staff", id: tessaId });
  assert.equal(mindaAfterTaguig.json.unreadCount, 1);
  assert.equal(tessaAfterTaguig.json.unreadCount, 1);
  assert.equal(JSON.stringify(mindaAfterTaguig.json).includes("Taguig Filling"), false);
  const staffStillBlind = await api("GET", `/api/staff/patients/${recordId}`, { role: "staff", id: mindaId });
  assert.equal(staffStillBlind.json.patient.treatments.some((row) => row.treatment === "Taguig Filling"), false);

  const grant = await db.query(
    `SELECT request_id FROM record_access_grants
     WHERE requesting_dentist_id = $1 AND scope = 'diagnosis_notes' AND status = 'active'`,
    [marcoId]
  );
  await recordAccess.decideRequest(db, { id: adminId, role: "admin" }, grant.rows[0].request_id, "revoked");
  const closed = await api("GET", `/api/dentist/patients/${recordId}`, { role: "dentist", id: marcoId });
  assert.equal(closed.json.treatments.find((row) => row.treatment === "Taguig Filling"), undefined);
  assert.equal(JSON.stringify(closed.json).includes("Taguig fracture"), false);
});
