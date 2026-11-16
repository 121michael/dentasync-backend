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
  await db.query(sqlFile("056_cross_branch_record_access.sql"));

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

  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, specialization)
     VALUES ($1, 'General'), ($2, 'General'), ($3, 'General'), ($4, 'General')`,
    [treatingId, unrelatedId, coworkerId, delegateId]
  );
  await db.query(
    `UPDATE admin_portal_dentist_profiles SET can_approve_cross_branch_access = TRUE WHERE user_id = $1`,
    [delegateId]
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

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, notifyAdmin: async () => {} }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} }));
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

  const request = await api("POST", `/api/dentist/patients/${recordId}/access-requests`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need diagnosis for today's visit",
      scope: "diagnosis_notes",
    },
  });
  assert.equal(request.status, 201, request.json.message);
  const requestId = request.json.request.id;

  const duplicate = await api("POST", `/api/dentist/patients/${recordId}/access-requests`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: {
      requestingBranchId: pasigId,
      originatingBranchId: mandaluyongId,
      reason: "Need diagnosis for today's visit",
      scope: "diagnosis_notes",
    },
  });
  assert.equal(duplicate.status, 409);

  const stillHidden = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(
    stillHidden.json.treatments.find((row) => row.treatment === "Oral Prophylaxis").diagnosisNotes,
    ""
  );

  const staffDecision = await api("POST", `/api/admin/record-access-requests/${requestId}/decision`, {
    role: "staff",
    id: staffId,
    body: { decision: "approved" },
  });
  assert.equal(staffDecision.status, 403);

  const ordinaryDecision = await api("POST", `/api/dentist/record-access-requests/${requestId}/decision`, {
    role: "dentist",
    id: coworkerId,
    branchId: mandaluyongId,
    body: { decision: "approved" },
  });
  assert.equal(ordinaryDecision.status, 403);

  const selfDecision = await api("POST", `/api/dentist/record-access-requests/${requestId}/decision`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
    body: { decision: "approved" },
  });
  assert.equal(selfDecision.status, 403);

  const outOfScope = await api("POST", `/api/dentist/record-access-requests/${requestId}/decision`, {
    role: "dentist",
    id: delegateId,
    branchId: pasigId,
    body: { decision: "approved" },
  });
  assert.equal(outOfScope.status, 403);

  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`, [
    delegateId,
    mandaluyongId,
  ]);

  const [first, second] = await Promise.all([
    api("POST", `/api/admin/record-access-requests/${requestId}/decision`, {
      role: "admin",
      id: adminId,
      body: { decision: "approved" },
    }),
    api("POST", `/api/admin/record-access-requests/${requestId}/decision`, {
      role: "admin",
      id: adminId,
      body: { decision: "approved" },
    }),
  ]);
  assert.equal(first.status, 200, first.json.message);
  assert.equal(second.status, 200, second.json.message);
  const grants = await db.query(`SELECT id, status FROM record_access_grants WHERE request_id = $1`, [requestId]);
  assert.equal(grants.rows.filter((row) => row.status === "active").length, 1);

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

  const otherPatientChart = await api("GET", `/api/dentist/patients/${otherRecordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(otherPatientChart.status, 200);
  assert.equal((otherPatientChart.json.treatments || []).length, 0);

  const wellnessGrant = await api("POST", `/api/dentist/patients/${recordId}/access-requests`, {
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
  assert.equal(wellnessGrant.status, 201);
  const grantedDiagnosisStill = await api("GET", `/api/dentist/patients/${recordId}`, {
    role: "dentist",
    id: treatingId,
    branchId: pasigId,
  });
  assert.equal(grantedDiagnosisStill.json.wellness?.restricted, true);

  const deniedReq = await api("POST", `/api/dentist/patients/${recordId}/access-requests`, {
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
  const denied = await api("POST", `/api/admin/record-access-requests/${deniedReq.json.request.id}/decision`, {
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

  const delegateReq = await api("POST", `/api/dentist/patients/${recordId}/access-requests`, {
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
  const delegated = await api("POST", `/api/dentist/record-access-requests/${delegateReq.json.request.id}/decision`, {
    role: "dentist",
    id: delegateId,
    branchId: mandaluyongId,
    body: { decision: "approved" },
  });
  assert.equal(delegated.status, 200, delegated.json.message);

  await db.query(
    `UPDATE record_access_grants SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE request_id = $1`,
    [delegateReq.json.request.id]
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
