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

const dbName = `ds_access_${process.pid}_${Date.now().toString(36)}`;
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

test("Phase 5 centralized records and cross-branch grants", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
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
  await db.query(sqlFile("005_create_admin_portal.sql"));
  await db.query(sqlFile("006_create_dentist_portal.sql"));
  await db.query(sqlFile("046_dentist_pad_credentials.sql"));
  await db.query(sqlFile("007_create_document_sync.sql"));
  await db.query(`
    ALTER TABLE admin_portal_document_sync_jobs
      ADD COLUMN IF NOT EXISTS approved_by TEXT,
      ADD COLUMN IF NOT EXISTS approved_by_name TEXT,
      ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
  `);
  await db.query(sqlFile("008_create_admin_command_center.sql"));
  await db.query(sqlFile("009_create_clinical_patient_records.sql"));
  await db.query(`
    ALTER TABLE clinic_patient_treatments
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS tooth_number TEXT,
      ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT,
      ADD COLUMN IF NOT EXISTS procedure_details TEXT;
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
    ALTER TABLE clinic_dental_chart_entries
      ADD COLUMN IF NOT EXISTS tooth_status TEXT,
      ADD COLUMN IF NOT EXISTS conditions_json JSONB,
      ADD COLUMN IF NOT EXISTS treatments_json JSONB,
      ADD COLUMN IF NOT EXISTS updated_by TEXT;
    ALTER TABLE clinic_patient_treatments
      ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(12, 2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS appointment_id BIGINT,
      ADD COLUMN IF NOT EXISTS queue_entry_id BIGINT,
      ADD COLUMN IF NOT EXISTS visit_sequence INTEGER,
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS updated_by TEXT;
  `);
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE patient_portal_appointments DROP CONSTRAINT IF EXISTS patient_portal_appointments_status_check;
    ALTER TABLE patient_portal_appointments
      ADD CONSTRAINT patient_portal_appointments_status_check
      CHECK (status IN ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'rescheduled'));
    ALTER TABLE patient_portal_queue_entries DROP CONSTRAINT IF EXISTS patient_portal_queue_entries_status_check;
    ALTER TABLE patient_portal_queue_entries
      ADD CONSTRAINT patient_portal_queue_entries_status_check
      CHECK (status IN ('waiting', 'checked_in', 'preparing', 'dentist', 'completed', 'no_show'));
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
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_portal_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_by TEXT
    );
  `);
  await db.query(sqlFile("056_cross_branch_record_access.sql"));
  await db.query(sqlFile("057_record_access_workstation_auth.sql"));
  await db.query(sqlFile("058_record_access_isolated_approver.sql"));
  await db.query(sqlFile("060_record_access_approval_credential.sql"));

  const mandaluyong = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000002', FALSE, 'active')
     RETURNING id`
  );
  const mandaluyongId = mandaluyong.rows[0].id;
  const pasigId = pasig.rows[0].id;

  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.admin@example.test', '09170000001', 'synthetic-hash', 'admin', TRUE, 'Active')
     RETURNING id`
  );
  const treating = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Pat', 'Treating', 'pat.treating@example.test', '09170000002', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  const unrelated = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Una', 'Related', 'una.related@example.test', '09170000003', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  const coworker = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Cow', 'Worker', 'cow.worker@example.test', '09170000004', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  const delegate = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Del', 'Egated', 'del.egated@example.test', '09170000005', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  const staff = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Sam', 'Staff', 'sam.staff@example.test', '09170000006', 'synthetic-hash', 'staff', TRUE, 'Active')
     RETURNING id`
  );
  const patient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Mina', 'Patient', 'mina.patient@example.test', '09170000007', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const otherPatient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Other', 'Patient', 'other.patient@example.test', '09170000008', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );

  const treatingId = String(treating.rows[0].id);
  const unrelatedId = String(unrelated.rows[0].id);
  const coworkerId = String(coworker.rows[0].id);
  const delegateId = String(delegate.rows[0].id);
  const staffId = String(staff.rows[0].id);
  const adminId = String(admin.rows[0].id);
  const patientId = String(patient.rows[0].id);
  const otherPatientId = String(otherPatient.rows[0].id);

  const delegatePin = "Delegate-pin-9";
  const delegatePinHash = await bcrypt.hash(delegatePin, 4);
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, specialization)
     VALUES ($1, 'General'), ($2, 'General'), ($3, 'General'), ($4, 'General')`,
    [treatingId, unrelatedId, coworkerId, delegateId]
  );
  await db.query(
    `UPDATE admin_portal_dentist_profiles
     SET can_approve_cross_branch_access = TRUE,
         license_number = 'PRC-DEL-0001',
         license_verified = TRUE,
         cross_branch_approval_secret_hash = $2,
         cross_branch_approval_credential_status = 'active'
     WHERE user_id = $1`,
    [delegateId, delegatePinHash]
  );
  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES
     ($1, $2), ($1, $3), ($4, $3), ($5, $2), ($6, $3), ($7, $3)`,
    [treatingId, mandaluyongId, pasigId, unrelatedId, coworkerId, delegateId, staffId]
  );

  const record = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CPR-MINA', 'Mina', 'Patient', $1)
     RETURNING id`,
    [patientId]
  );
  const otherRecord = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CPR-OTHER', 'Other', 'Patient', $1)
     RETURNING id`,
    [otherPatientId]
  );
  const recordId = record.rows[0].id;
  const otherRecordId = otherRecord.rows[0].id;

  await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, treatment_date, notes, diagnosis_notes,
       originating_branch_id, treating_dentist_id, created_by, created_by_role
     ) VALUES (
       $1, 'Oral Prophylaxis', 'Dr. History', 'completed', '2026-01-10', 'legacy note', 'Deep caries on 36',
       $2, $3, $3, 'dentist'
     )`,
    [recordId, mandaluyongId, coworkerId]
  );
  await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, treatment_date, notes, diagnosis_notes
     ) VALUES (
       $1, 'Legacy Filling', 'Unknown', 'completed', '2025-12-01', 'unattributed', 'Hidden diagnosis'
     )`,
    [recordId]
  );

  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time,
       coverage_type, estimated_cost, status, branch_id
     ) VALUES
     ($1, 'cleaning', 'Cleaning', $2, 'Dr. Pat Treating', '2099-12-01', '10:00', 'self_pay', 0, 'confirmed', $3),
     ($1, 'cleaning', 'Cleaning', $4, 'Dr. Cow Worker', '2099-12-01', '11:00', 'self_pay', 0, 'confirmed', $5),
     ($6, 'cleaning', 'Cleaning', $2, 'Dr. Pat Treating', '2099-12-02', '10:00', 'self_pay', 0, 'confirmed', $3)`,
    [patientId, treatingId, pasigId, coworkerId, mandaluyongId, otherPatientId]
  );

  const closed = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('End', 'Ed', 'end.ed@example.test', '09170000009', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  const bystander = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Bye', 'Stander', 'bye.stander@example.test', '09170000010', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  const bystanderId = String(bystander.rows[0].id);
  await db.query(`INSERT INTO admin_portal_dentist_profiles (user_id) VALUES ($1)`, [bystanderId]);
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`, [
    bystanderId,
    mandaluyongId,
  ]);

  const closedId = String(closed.rows[0].id);
  await db.query(`INSERT INTO admin_portal_dentist_profiles (user_id) VALUES ($1)`, [closedId]);
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`, [closedId, pasigId]);
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time,
       coverage_type, estimated_cost, status, branch_id
     ) VALUES ($1, 'cleaning', 'Cleaning', $2, 'Dr. End Ed', '2026-01-02', '09:00', 'self_pay', 0, 'completed', $3)`,
    [patientId, closedId, pasigId]
  );

  const adminPassword = "AdminPass1234";
  const delegatePassword = "DelegatePass1234";
  const treatingPassword = "TreatPass1234";
  const staffPassword = "StaffPass1234";
  const coworkerPassword = "CoworkerPass1234";
  const adminHash = await bcrypt.hash(adminPassword, 4);
  const delegateHash = await bcrypt.hash(delegatePassword, 4);
  const treatingHash = await bcrypt.hash(treatingPassword, 4);
  const staffHash = await bcrypt.hash(staffPassword, 4);
  const coworkerHash = await bcrypt.hash(coworkerPassword, 4);
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [adminHash, adminId]);
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [delegateHash, delegateId]);
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [treatingHash, treatingId]);
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [staffHash, staffId]);
  await db.query(`UPDATE users SET password_hash = $1 WHERE id = $2`, [coworkerHash, coworkerId]);
  const inactiveAdmin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ina', 'Active', 'ina.active@example.test', '09170000011', $1, 'admin', TRUE, 'Inactive')
     RETURNING id`,
    [adminHash]
  );
  const inactiveAdminId = String(inactiveAdmin.rows[0].id);

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, notifyAdmin: async () => {} }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} }));
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
    return { status: response.status, json };
  }

  const treatingChart = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(treatingChart.status, 200, treatingChart.json.message);
  const ordinary = treatingChart.json.treatments.find((row) => row.treatment === "Oral Prophylaxis");
  assert.ok(ordinary);
  assert.equal(ordinary.treatmentDate.slice(0, 10), "2026-01-10");
  assert.equal(ordinary.diagnosisNotes, "");
  assert.equal(ordinary.diagnosis, "");
  const legacy = treatingChart.json.treatments.find((row) => row.treatment === "Legacy Filling");
  assert.equal(legacy.attributionReview, true);
  assert.equal(legacy.diagnosisNotes, "");
  assert.ok(!treatingChart.json.appointments.some((row) => Number(row.branchId) === Number(mandaluyongId)));

  const search = await api("GET", "/api/dentist/patients", { role: "dentist", id: treatingId, branchId: pasigId });
  assert.equal(search.status, 200);
  const listed = search.json.patients.find((row) => Number(row.id) === Number(recordId));
  assert.equal(listed.fullName, "Mina Patient");
  assert.equal(listed.lastTreatment, "Oral Prophylaxis");

  const unrelatedDetail = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: unrelatedId,
    branchId: pasigId,
  });
  assert.equal(unrelatedDetail.status, 403);
  assert.equal(unrelatedDetail.json.patient.id, recordId);
  assert.equal(unrelatedDetail.json.patient.fullName, "Mina Patient");
  assert.equal(unrelatedDetail.json.patient.phone, undefined);

  const coworkerDetail = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: coworkerId,
    branchId: mandaluyongId,
  });
  assert.equal(coworkerDetail.status, 200);
  const coworkerDiagnosis = coworkerDetail.json.treatments.find((row) => row.treatment === "Oral Prophylaxis");
  assert.equal(coworkerDiagnosis.diagnosisNotes, "Deep caries on 36");

  const coworkerPasig = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: coworkerId,
    branchId: pasigId,
  });
  assert.equal(coworkerPasig.status, 403);

  const bystanderDetail = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: bystanderId,
    branchId: mandaluyongId,
  });
  assert.equal(bystanderDetail.status, 403);
  assert.equal(bystanderDetail.json.patient?.fullName, "Mina Patient");
  assert.equal(JSON.stringify(bystanderDetail.json).includes("Deep caries"), false);

  const ended = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: closedId,
    branchId: pasigId,
  });
  assert.equal(ended.status, 403);

  const xrays = await api("GET", `/api/dentist/patients/${recordId}/xrays`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(xrays.status, 200);
  assert.equal(xrays.json.xrays.length, 0);

  const docs = await api("GET", `/api/dentist/patients/${recordId}/medical-documents`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(docs.status, 200);
  assert.equal(docs.json.documents.length, 0);

  const chart = await api("GET", `/api/dentist/patients/${recordId}/dental-chart`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(chart.status, 200);

  const editBlocked = await api("PUT", `/api/dentist/patients/${recordId}/treatments/1`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: { treatment: "Oral Prophylaxis", treatmentDate: "2026-01-10", diagnosisNotes: "changed" },
  });
  const treatmentRow = await db.query(
    `SELECT id FROM clinic_patient_treatments WHERE clinical_record_id = $1 AND treatment = 'Oral Prophylaxis'`,
    [recordId]
  );
  const blockedEdit = await api(
    "PUT",
    `/api/dentist/patients/${recordId}/treatments/${treatmentRow.rows[0].id}`,
    {
      role: "dentist",
      id: treatingId,
      branchId: pasigId,
      body: { treatment: "Oral Prophylaxis", treatmentDate: "2026-01-10", diagnosisNotes: "changed" },
    }
  );
  assert.equal(blockedEdit.status, 403, JSON.stringify(editBlocked.json));

  const challengeBody = {
    requestingBranchId: pasigId,
    originatingBranchId: mandaluyongId,
    reason: "Need diagnosis for today's visit",
    scope: "diagnosis_notes",
  };
  const challenge = await api("POST", `/api/dentist/patients/${recordId}/access-challenges`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: challengeBody,
  });
  assert.equal(challenge.status, 201, challenge.json.message);
  const challengeId = challenge.json.challenge.id;
  const approvalCode = challenge.json.challenge.approvalCode;
  assert.ok(approvalCode);
  assert.equal(JSON.stringify(challenge.json).toLowerCase().includes("password"), false);

  const stillHidden = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(
    stillHidden.json.treatments.find((row) => row.treatment === "Oral Prophylaxis").diagnosisNotes,
    ""
  );

  const sharedSession = await api("POST", `/api/dentist/access-challenges/${challengeId}/authorize`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: { identifier: "ada.admin@example.test", password: adminPassword },
  });
  assert.equal(sharedSession.status, 410);
  const stillNoGrant = await db.query(
    `SELECT id FROM record_access_grants WHERE clinical_record_id = $1 AND scope = 'diagnosis_notes'`,
    [recordId]
  );
  assert.equal(stillNoGrant.rows.length, 0);

  const anonymousApprover = await api("GET", "/api/record-access/approver");
  assert.equal(anonymousApprover.status, 401);
  const staffApprover = await api("GET", "/api/record-access/approver", { role: "staff", id: staffId });
  assert.equal(staffApprover.status, 200);
  assert.equal(staffApprover.json.eligible, false);
  const patientApprover = await api("GET", "/api/record-access/approver", { role: "patient", id: patientId });
  assert.equal(patientApprover.status, 200);
  assert.equal(patientApprover.json.eligible, false);
  const ordinaryApprover = await api("GET", "/api/record-access/approver", { role: "dentist", id: coworkerId });
  assert.equal(ordinaryApprover.json.eligible, false);
  const selfApprover = await api("GET", "/api/record-access/approver", { role: "dentist", id: treatingId });
  assert.equal(selfApprover.json.eligible, false);
  const delegateApprover = await api("GET", "/api/record-access/approver", { role: "dentist", id: delegateId });
  assert.equal(delegateApprover.json.eligible, true);
  const adminApprover = await api("GET", "/api/record-access/approver", { role: "admin", id: adminId });
  assert.equal(adminApprover.json.eligible, true);
  const unverifiedAdmin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Admin', 'User', 'admin.user@example.test', '09170000021', 'synthetic-hash', 'admin', FALSE, 'Active')
     RETURNING id`
  );
  const unverifiedAdminId = String(unverifiedAdmin.rows[0].id);
  const unverifiedApprover = await api("GET", "/api/record-access/approver", {
    role: "admin",
    id: unverifiedAdminId,
  });
  assert.equal(unverifiedApprover.status, 200);
  assert.equal(unverifiedApprover.json.eligible, true);
  const inactiveApprover = await api("GET", "/api/record-access/approver", { role: "admin", id: inactiveAdminId });
  assert.equal(inactiveApprover.status, 403);

  const anonymousCode = await api("GET", `/api/record-access/challenges/${approvalCode}`);
  assert.equal(anonymousCode.status, 401);
  const anonymousApprove = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    body: { originatingBranchId: pasigId, scope: "xrays", clinicalRecordId: otherRecordId },
  });
  assert.equal(anonymousApprove.status, 401);

  const grantsBeforePatient = await db.query(
    `SELECT id FROM record_access_grants WHERE clinical_record_id = $1 AND scope = 'diagnosis_notes'`,
    [recordId]
  );
  const patientPreview = await api("GET", `/api/record-access/challenges/${approvalCode}`, {
    role: "patient",
    id: patientId,
  });
  assert.equal(patientPreview.status, 403, JSON.stringify(patientPreview.json));
  const patientAuth = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "patient",
    id: patientId,
  });
  assert.equal(patientAuth.status, 403, JSON.stringify(patientAuth.json));
  const grantsAfterPatient = await db.query(
    `SELECT id FROM record_access_grants WHERE clinical_record_id = $1 AND scope = 'diagnosis_notes'`,
    [recordId]
  );
  assert.equal(grantsAfterPatient.rows.length, grantsBeforePatient.rows.length);

  const staffAuth = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "staff",
    id: staffId,
  });
  assert.equal(staffAuth.status, 403, JSON.stringify(staffAuth.json));

  const ordinaryAuth = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "dentist",
    id: coworkerId,
  });
  assert.equal(ordinaryAuth.status, 403);

  const selfAuth = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "dentist",
    id: treatingId,
  });
  assert.equal(selfAuth.status, 403);

  const inactiveAuth = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "admin",
    id: inactiveAdminId,
  });
  assert.equal(inactiveAuth.status, 403);

  const outOfScope = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "dentist",
    id: delegateId,
    body: { secret: delegatePin },
  });
  assert.equal(outOfScope.status, 403);

  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`, [
    delegateId,
    mandaluyongId,
  ]);

  const tamper = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "admin",
    id: adminId,
    body: {
      originatingBranchId: pasigId,
      scope: "xrays",
      clinicalRecordId: otherRecordId,
    },
  });
  assert.equal(tamper.status, 200, tamper.json.message);
  assert.equal(tamper.json.grant.scope, "diagnosis_notes");
  assert.equal(JSON.stringify(tamper.json).includes("AdminPass"), false);

  const replay = await api("POST", `/api/record-access/challenges/${approvalCode}/approve`, {
    role: "admin",
    id: adminId,
  });
  assert.equal(replay.status, 409);

  const polled = await api("GET", `/api/dentist/patients/${recordId}/access-challenges/${challengeId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(polled.status, 200);
  assert.equal(polled.json.challenge.status, "approved");

  const opened = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(
    opened.json.treatments.find((row) => row.treatment === "Oral Prophylaxis").diagnosisNotes,
    "Deep caries on 36"
  );
  assert.equal(opened.json.treatments.find((row) => row.treatment === "Legacy Filling").diagnosisNotes, "");
  const requesterAfter = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(requesterAfter.status, 200);

  const otherPatientChart = await api("GET", `/api/dentist/patients/${otherRecordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(otherPatientChart.status, 200);
  assert.equal((otherPatientChart.json.treatments || []).length, 0);

  const wellnessChallenge = await api("POST", `/api/dentist/patients/${recordId}/access-challenges`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need wellness",
      scope: "wellness",
    },
  });
  assert.equal(wellnessChallenge.status, 201);
  const grantedDiagnosisStill = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(grantedDiagnosisStill.json.wellness?.restricted, true);

  const legacyPending = await api("POST", `/api/dentist/patients/${recordId}/access-requests`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need xrays",
      scope: "xrays",
    },
  });
  assert.equal(legacyPending.status, 201);
  const remoteApprove = await api("POST", `/api/admin/record-access-requests/${legacyPending.json.request.id}/decision`, {
    role: "admin",
    id: adminId,
    body: { decision: "approved" },
  });
  assert.equal(remoteApprove.status, 409);
  const denied = await api("POST", `/api/admin/record-access-requests/${legacyPending.json.request.id}/decision`, {
    role: "admin",
    id: adminId,
    body: { decision: "denied" },
  });
  assert.equal(denied.status, 200);
  const xrayAfterDeny = await api("GET", `/api/dentist/patients/${recordId}/xrays`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(xrayAfterDeny.json.xrays.length, 0);

  const grantRow = await db.query(
    `SELECT request_id FROM record_access_grants WHERE clinical_record_id = $1 AND scope = 'diagnosis_notes' AND status = 'active'`,
    [recordId]
  );
  const requestId = grantRow.rows[0].request_id;
  const docId = "11111111-1111-1111-1111-111111111111";
  await db.query(
    `INSERT INTO patient_portal_documents (id, user_id, document_type, original_name, stored_name, mime_type, byte_size, originating_branch_id)
     VALUES ($1, $2, 'medical_document', 'note.pdf', 'missing.bin', 'application/pdf', 12, $3)`,
    [docId, patientId, mandaluyongId]
  );
  const docsHidden = await api("GET", `/api/dentist/patients/${recordId}/medical-documents/${docId}/download`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(docsHidden.status, 403);

  const revoke = await api("POST", `/api/admin/record-access-requests/${requestId}/decision`, {
    role: "admin",
    id: adminId,
    body: { decision: "revoked" },
  });
  assert.equal(revoke.status, 200);
  const afterRevoke = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(
    afterRevoke.json.treatments.find((row) => row.treatment === "Oral Prophylaxis").diagnosisNotes,
    ""
  );
  const downloadRevoked = await api("GET", `/api/dentist/patients/${recordId}/medical-documents/${docId}/download`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(downloadRevoked.status, 403);

  const duration = await api("PUT", "/api/admin/record-access-settings", {
    role: "admin",
    id: adminId,
    body: { grantMinutes: 45 },
  });
  assert.equal(duration.status, 200, duration.json.message);
  assert.equal(duration.json.grantMinutes, 45);
  const tooLong = await api("PUT", "/api/admin/record-access-settings", {
    role: "admin",
    id: adminId,
    body: { grantMinutes: 999 },
  });
  assert.equal(tooLong.status, 400);

  const delegateChallenge = await api("POST", `/api/dentist/patients/${recordId}/access-challenges`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need notes again",
      scope: "diagnosis_notes",
    },
  });
  const [first, second] = await Promise.all([
    api("POST", `/api/record-access/challenges/${delegateChallenge.json.challenge.approvalCode}/approve`, {
      role: "dentist",
      id: delegateId,
      body: { secret: delegatePin },
    }),
    api("POST", `/api/record-access/challenges/${delegateChallenge.json.challenge.approvalCode}/approve`, {
      role: "admin",
      id: adminId,
    }),
  ]);
  assert.equal([first.status, second.status].sort().join(","), "200,409");
  const delegatedGrant = [first, second].find((item) => item.status === 200);
  assert.ok(delegatedGrant.json.grant.id);
  const grantMinutes = await db.query(`SELECT expires_at - created_at AS length FROM record_access_grants WHERE id = $1`, [
    delegatedGrant.json.grant.id,
  ]);
  const lengthMinutes = Number(grantMinutes.rows[0].length.minutes || grantMinutes.rows[0].length);
  assert.ok(lengthMinutes === 45 || String(grantMinutes.rows[0].length).includes("45"));

  const downloadGranted = await api("GET", `/api/dentist/patients/${recordId}/medical-documents/${docId}/download`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(downloadGranted.status === 403 || downloadGranted.status === 404, true);

  await db.query(
    `UPDATE record_access_grants SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`,
    [delegatedGrant.json.grant.id]
  );
  const expired = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(
    expired.json.treatments.find((row) => row.treatment === "Oral Prophylaxis").diagnosisNotes,
    ""
  );
  const downloadExpired = await api("GET", `/api/dentist/patients/${recordId}/medical-documents/${docId}/download`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(downloadExpired.status, 403);

  const created = await api("POST", `/api/dentist/patients/${recordId}/treatments`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      treatment: "Consultation",
      treatmentDate: "2026-11-16",
      diagnosisNotes: "Pasig visit note",
      toothNumber: "",
    },
  });
  assert.equal(created.status, 201, created.json.message);
  const stamped = await db.query(
    `SELECT originating_branch_id, treating_dentist_id, created_by
     FROM clinic_patient_treatments
     WHERE treatment = 'Consultation' AND clinical_record_id = $1`,
    [recordId]
  );
  assert.equal(Number(stamped.rows[0].originating_branch_id), Number(pasigId));
  assert.equal(String(stamped.rows[0].treating_dentist_id), treatingId);

  const staffView = await api("GET", `/api/staff/patients/${recordId}`, {
    role: "staff",
    id: staffId,
    branchId: pasigId,
  });
  assert.equal(staffView.status, 200, staffView.json.message);
  const staffMandaluyong = staffView.json.patient.treatments.find((row) => row.treatment === "Oral Prophylaxis");
  assert.equal(staffMandaluyong.diagnosisNotes, "");

  const job = await db.query(
    `INSERT INTO admin_portal_document_sync_jobs (
       uploaded_by, original_name, stored_name, mime_type, byte_size, source_type, status, extracted_payload, edited_payload
     ) VALUES (
       $1, 'card.pdf', 'card.pdf', 'application/pdf', 12, 'soft_copy', 'extracted',
       $2::jsonb, $2::jsonb
     ) RETURNING id`,
    [
      adminId,
      JSON.stringify({
        patient: { firstName: "Mina", lastName: "Patient", fullName: "Mina Patient" },
        procedure: {
          treatment: "Imported Cleaning",
          treatmentDate: "2026-02-02",
          dentistName: "Dr. Import",
          visits: [
            {
              treatment: "Imported Cleaning",
              treatmentDate: "2026-02-02",
              dentistName: "Dr. Import",
              amountCharged: "500",
              amountPaid: "500",
            },
          ],
        },
      }),
    ]
  );
  const commit = await api("POST", `/api/admin/sync/documents/${job.rows[0].id}/commit`, {
    role: "admin",
    id: adminId,
    body: { selectedPatientId: String(recordId), branchId: mandaluyongId },
  });
  assert.equal(commit.status, 200, commit.json.message);
  const imported = await db.query(
    `SELECT treatment, originating_branch_id FROM clinic_patient_treatments
     WHERE clinical_record_id = $1 AND treatment_date = '2026-02-02'`,
    [recordId]
  );
  assert.equal(imported.rows.length, 1);
  assert.equal(Number(imported.rows[0].originating_branch_id), Number(mandaluyongId));
  const retry = await api("POST", `/api/admin/sync/documents/${job.rows[0].id}/commit`, {
    role: "admin",
    id: adminId,
    body: { selectedPatientId: String(recordId), branchId: mandaluyongId },
  });
  assert.equal(retry.status, 409);

  const uncertainJob = await db.query(
    `INSERT INTO admin_portal_document_sync_jobs (
       uploaded_by, original_name, stored_name, mime_type, byte_size, source_type, status, extracted_payload, edited_payload
     ) VALUES (
       $1, 'twin.pdf', 'twin.pdf', 'application/pdf', 12, 'soft_copy', 'extracted',
       $2::jsonb, $2::jsonb
     ) RETURNING id`,
    [
      adminId,
      JSON.stringify({
        patient: { firstName: "Mina", lastName: "Patient", fullName: "Mina Patient" },
        procedure: { treatment: "Twin Cleaning", treatmentDate: "2026-03-03" },
      }),
    ]
  );
  await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name)
     VALUES ('CPR-MINA-2', 'Mina', 'Patient')`
  );
  const uncertain = await api("POST", `/api/admin/sync/documents/${uncertainJob.rows[0].id}/commit`, {
    role: "admin",
    id: adminId,
    body: { branchId: mandaluyongId },
  });
  assert.equal(uncertain.status, 409);
  assert.ok(uncertain.json.needsSelection || uncertain.json.needsMergeDecision || uncertain.json.matches);

  const permission = await api("PATCH", `/api/admin/dentists/${delegateId}`, {
    role: "admin",
    id: adminId,
    body: {
      firstName: "Del",
      lastName: "Egated",
      email: "del.egated@example.test",
      phone: "09170000005",
      canApproveCrossBranchAccess: false,
      branchIds: [mandaluyongId, pasigId],
    },
  });
  assert.equal(permission.status, 200, permission.json.message);
  assert.equal(permission.json.dentist.canApproveCrossBranchAccess, false);

  const dentistExport = await api("GET", "/api/admin/clinical-records/export/preview", {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(dentistExport.status, 403);
  const dentistWorkbook = await api("GET", "/api/admin/clinical-records/export.xlsx", {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(dentistWorkbook.status, 403);

  const adminPreview = await api("GET", "/api/admin/clinical-records/export/preview", {
    role: "admin",
    id: adminId,
  });
  assert.equal(adminPreview.status, 200, adminPreview.json.message);
  assert.equal(JSON.stringify(adminPreview.json).includes("Deep caries"), false);

  const staffExport = await api("GET", "/api/staff/export/check-ins", {
    role: "staff",
    id: staffId,
    branchId: pasigId,
  });
  assert.ok(staffExport.status === 200 || staffExport.status === 404, String(staffExport.status));
  assert.equal(JSON.stringify(staffExport.json).includes("Deep caries"), false);

  const setup = await api("POST", `/api/admin/dentists/${delegateId}/approval-credential`, {
    role: "admin",
    id: adminId,
    body: { action: "start_setup" },
  });
  assert.equal(setup.status, 200, setup.json.message);
  assert.equal(setup.json.dentist.approvalCredentialStatus, "not_set");
  assert.equal(setup.json.dentist.canApproveCrossBranchAccess, true);
  assert.equal(setup.json.dentist.approvalCredentialIdentifier, "PRC-DEL-0001");
  assert.equal(JSON.stringify(setup.json).includes(delegatePin), false);
  assert.equal(JSON.stringify(setup.json).toLowerCase().includes("secret_hash"), false);

  const licenseAsPin = await api("PUT", "/api/dentist/approval-credential", {
    role: "dentist",
    id: delegateId,
    body: { secret: "PRC-DEL-0001", confirmSecret: "PRC-DEL-0001" },
  });
  assert.equal(licenseAsPin.status, 400);

  const setCredential = await api("PUT", "/api/dentist/approval-credential", {
    role: "dentist",
    id: delegateId,
    body: { secret: "Fresh-pin-32", confirmSecret: "Fresh-pin-32" },
  });
  assert.equal(setCredential.status, 200, setCredential.json.message);
  assert.equal(setCredential.json.credential.approvalCredentialStatus, "active");
  assert.equal(JSON.stringify(setCredential.json).includes("Fresh-pin-32"), false);

  const storedHash = await db.query(
    `SELECT cross_branch_approval_secret_hash FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [delegateId]
  );
  assert.equal(await bcrypt.compare("Fresh-pin-32", storedHash.rows[0].cross_branch_approval_secret_hash), true);
  assert.equal(await bcrypt.compare("PRC-DEL-0001", storedHash.rows[0].cross_branch_approval_secret_hash), false);

  const reset = await api("POST", `/api/admin/dentists/${delegateId}/approval-credential`, {
    role: "admin",
    id: adminId,
    body: { action: "reset" },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.dentist.approvalCredentialStatus, "not_set");
  const afterReset = await db.query(
    `SELECT cross_branch_approval_secret_hash FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [delegateId]
  );
  assert.equal(afterReset.rows[0].cross_branch_approval_secret_hash, null);

  const restoreCredential = await api("PUT", "/api/dentist/approval-credential", {
    role: "dentist",
    id: delegateId,
    body: { secret: "Fresh-pin-32", confirmSecret: "Fresh-pin-32" },
  });
  assert.equal(restoreCredential.status, 200);

  const credChallenge = await api("POST", `/api/dentist/patients/${recordId}/access-challenges`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need notes for credential checks",
      scope: "diagnosis_notes",
    },
  });
  assert.equal(credChallenge.status, 201, credChallenge.json.message);
  const credCode = credChallenge.json.challenge.approvalCode;
  assert.equal(JSON.stringify(credChallenge.json).includes("Fresh-pin-32"), false);

  const invalidCredential = await api("POST", `/api/record-access/challenges/${credCode}/approve`, {
    role: "dentist",
    id: delegateId,
    body: { secret: "Wrong-pin-99" },
  });
  assert.equal(invalidCredential.status, 403);
  assert.equal(JSON.stringify(invalidCredential.json).includes("Fresh-pin-32"), false);
  assert.equal(JSON.stringify(invalidCredential.json).includes("Wrong-pin-99"), false);

  const selfAfterCredential = await api("POST", `/api/record-access/challenges/${credCode}/approve`, {
    role: "dentist",
    id: treatingId,
    body: { secret: "Fresh-pin-32" },
  });
  assert.equal(selfAfterCredential.status, 403);

  const wrongBranchDentist = await api("POST", `/api/record-access/challenges/${credCode}/approve`, {
    role: "dentist",
    id: coworkerId,
    body: { secret: "Fresh-pin-32" },
  });
  assert.equal(wrongBranchDentist.status, 403);

  const validCredential = await api("POST", `/api/record-access/challenges/${credCode}/approve`, {
    role: "dentist",
    id: delegateId,
    body: { secret: "Fresh-pin-32" },
  });
  assert.equal(validCredential.status, 200, validCredential.json.message);
  const bound = await db.query(
    `SELECT credential_verified_by, clinical_record_id, originating_branch_id, scope
     FROM record_access_challenges WHERE approval_code = $1`,
    [credCode]
  );
  assert.equal(String(bound.rows[0].credential_verified_by), delegateId);
  assert.equal(Number(bound.rows[0].clinical_record_id), Number(recordId));
  assert.equal(Number(bound.rows[0].originating_branch_id), Number(mandaluyongId));
  assert.equal(bound.rows[0].scope, "diagnosis_notes");

  const grantForExpiry = await db.query(
    `SELECT id FROM record_access_grants WHERE requesting_dentist_id = $1 AND clinical_record_id = $2 AND scope = 'diagnosis_notes' AND status = 'active' ORDER BY id DESC LIMIT 1`,
    [treatingId, recordId]
  );
  await db.query(`UPDATE record_access_grants SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [
    grantForExpiry.rows[0].id,
  ]);
  const expiredCredentialGrant = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(
    expiredCredentialGrant.json.treatments.find((row) => row.treatment === "Oral Prophylaxis").diagnosisNotes,
    ""
  );

  const revokePermission = await api("POST", `/api/admin/dentists/${delegateId}/approval-credential`, {
    role: "admin",
    id: adminId,
    body: { action: "revoke" },
  });
  assert.equal(revokePermission.status, 200);
  assert.equal(revokePermission.json.dentist.approvalCredentialStatus, "revoked");
  assert.equal(revokePermission.json.dentist.canApproveCrossBranchAccess, false);

  const revokedChallenge = await api("POST", `/api/dentist/patients/${recordId}/access-challenges`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need notes after revoke",
      scope: "diagnosis_notes",
    },
  });
  const revokedApprove = await api(
    "POST",
    `/api/record-access/challenges/${revokedChallenge.json.challenge.approvalCode}/approve`,
    { role: "dentist", id: delegateId, body: { secret: "Fresh-pin-32" } }
  );
  assert.equal(revokedApprove.status, 403);

  const credentialAudit = await db.query(
    `SELECT action, detail FROM admin_portal_audit_logs WHERE action LIKE 'record_access_credential_%'`
  );
  assert.ok(credentialAudit.rows.some((row) => row.action === "record_access_credential_set"));
  assert.ok(credentialAudit.rows.some((row) => row.action === "record_access_credential_reset"));
  assert.ok(credentialAudit.rows.some((row) => row.action === "record_access_credential_revoke"));
  assert.equal(
    credentialAudit.rows.filter((row) => /Fresh-pin-32|Delegate-pin-9|PRC-DEL-0001/.test(JSON.stringify(row))).length,
    0
  );

  const audit = await db.query(
    `SELECT action FROM admin_portal_audit_logs WHERE action LIKE 'record_access_%' OR action = 'cross_branch_chart_read' OR action = 'Document Data Import'`
  );
  assert.ok(audit.rows.some((row) => row.action === "record_access_requested"));
  assert.ok(audit.rows.some((row) => row.action === "record_access_approved"));
  assert.ok(audit.rows.some((row) => row.action === "Document Data Import"));
  assert.equal(
    audit.rows.filter((row) => /Deep caries|Hidden diagnosis|Pasig visit note/i.test(JSON.stringify(row))).length,
    0
  );
});
