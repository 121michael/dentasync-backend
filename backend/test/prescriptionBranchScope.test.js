"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dbName = `ds_rx_branch_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "127.0.0.1",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

const TEST_SIGNATURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
}

test("prescription processing stays inside the originating branch", async (t) => {
  await adminPool.query(`SELECT current_database(), inet_server_port()`);
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const {
    applyPrescriptionSchema,
    applyPrescriptionBranchSchema,
    rollbackPrescriptionBranchSchema,
  } = require("../services/prescriptionSchema");
  const { notifyActiveStaff } = require("../services/staffNotifications");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  const identity = await db.query(`SELECT current_database() AS name, inet_server_port() AS port`);
  assert.equal(identity.rows[0].name, dbName);
  assert.equal(Number(identity.rows[0].port), Number(process.env.DB_PORT || 5432));

  await db.query(sqlFile("000_create_users.sql"));
  await db.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE`);
  await db.query(sqlFile("002_create_patient_portal.sql"));
  await db.query(sqlFile("004_create_staff_portal.sql"));
  await db.query(sqlFile("009_create_clinical_patient_records.sql"));
  await db.query(`ALTER TABLE clinic_patient_records ADD COLUMN IF NOT EXISTS patient_id TEXT`);
  await db.query(`
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
      target_type TEXT,
      target_id TEXT,
      detail TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT,
      license_number TEXT,
      ptr_number TEXT,
      professional_designation TEXT,
      license_verified BOOLEAN NOT NULL DEFAULT FALSE
    );
  `);
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await applyPrescriptionSchema(db);
  await applyPrescriptionBranchSchema(db);

  const main = await db.query(`SELECT id, name FROM clinic_branches WHERE is_main`);
  const taguig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status)
     VALUES ('BR-0002', 'Taguig', '12 Synthetic Street', '09170002222', 'taguig@example.test', FALSE, 'active')
     RETURNING id, name`
  );
  const mandaluyongId = main.rows[0].id;
  const taguigId = taguig.rows[0].id;
  assert.match(main.rows[0].name, /Mandaluyong/);
  assert.equal(taguig.rows[0].name, "Taguig");

  async function addUser(role, label) {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, status, is_verified)
       VALUES ($1, 'Scope', $2, $3, 'x', $4, 'Active', TRUE)
       RETURNING id`,
      [label, `${label}.${suffix}@rxbranch.test`, `639${String(suffix).slice(-9)}`, role]
    );
    return String(result.rows[0].id);
  }

  const dentistId = await addUser("dentist", "Dra");
  const mandaluyongStaff = await addUser("staff", "Minda");
  const taguigStaff = await addUser("staff", "Tessa");
  const adminId = await addUser("admin", "Ada");
  const patientUserId = await addUser("patient", "Pia");
  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($1, $3), ($4, $2), ($5, $3)`,
    [dentistId, mandaluyongId, taguigId, mandaluyongStaff, taguigStaff]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (
       user_id, license_number, license_verified, professional_designation, catalog_dentist_id
     ) VALUES ($1, '12345', TRUE, 'DMD', 'dr-dra')`,
    [dentistId]
  );
  const record = await db.query(
    `INSERT INTO clinic_patient_records (
       record_code, first_name, last_name, email, phone, date_of_birth, gender, linked_user_id, created_by, created_by_role, patient_id
     ) VALUES ($1, 'Synthetic', 'Patient', $2, '639171110000', '1994-03-18', 'Female', $3, $4, 'dentist', 'A202611_01')
     RETURNING id`,
    [`CPR-RXB-${dentistId}`, `patient.${dentistId}@rxbranch.test`, patientUserId, dentistId]
  );
  const clinicalRecordId = record.rows[0].id;

  async function book(branchId, time) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', 'dr-dra', 'Dra Scope',
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2::time, 'self_pay', 500, 'confirmed', $3
       ) RETURNING id, branch_id`,
      [patientUserId, time, branchId]
    );
    return result.rows[0];
  }

  const mandaluyongVisit = await book(mandaluyongId, "09:00");
  const taguigVisit = await book(taguigId, "11:00");

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  const authenticateToken = (req, _res, next) => {
    req.user = { id: req.get("x-test-user"), role: req.get("x-test-role") };
    next();
  };
  app.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken,
      passwordResetService: { requestReset: async () => ({}) },
      notifyStaff: (notice) => notifyActiveStaff(db, notice),
    })
  );
  app.use(
    "/api/dentist",
    createDentistPortalRouter({
      db,
      authenticateToken,
      notifyStaff: (notice) => notifyActiveStaff(db, notice),
    })
  );
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db,
      authenticateToken,
      passwordResetService: { requestReset: async () => ({}) },
    })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function request(method, urlPath, { user, role, body, branchId } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        "x-test-user": String(user),
        "x-test-role": role,
        ...(branchId ? { "x-dentasync-branch": String(branchId) } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const medication = {
    medicationName: "Amoxicillin 500 mg",
    dosage: "1 capsule",
    quantity: "21",
    sig: "Take after meals every 8 hours for 7 days",
  };

  async function signAndSend({ appointmentId, branchId }) {
    const created = await request("POST", "/api/dentist/prescriptions", {
      user: dentistId,
      role: "dentist",
      branchId,
      body: { clinicalRecordId, appointmentId, items: [medication] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(Number(created.body.prescription.originatingBranchId), Number(branchId));
    const id = created.body.prescription.id;
    const authorized = await request("POST", `/api/dentist/prescriptions/${id}/authorize`, {
      user: dentistId,
      role: "dentist",
      branchId,
      body: { signaturePng: `data:image/png;base64,${TEST_SIGNATURE_PNG.toString("base64")}` },
    });
    assert.equal(authorized.status, 200, JSON.stringify(authorized.body));
    assert.equal(authorized.body.prescription.workflowStatus, "authorized");
    assert.ok(authorized.body.prescription.signedAt);
    const sent = await request("POST", `/api/dentist/prescriptions/${id}/submit`, {
      user: dentistId,
      role: "dentist",
      branchId,
    });
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.equal(sent.body.prescription.workflowStatus, "authorized");
    return sent.body.prescription;
  }

  const beforeMandaluyong = await request("GET", "/api/staff/notifications", {
    user: mandaluyongStaff,
    role: "staff",
  });
  const beforeTaguig = await request("GET", "/api/staff/notifications", { user: taguigStaff, role: "staff" });
  assert.equal(beforeMandaluyong.body.unreadCount, 0);
  assert.equal(beforeTaguig.body.unreadCount, 0);

  const mandaluyongRx = await signAndSend({ appointmentId: mandaluyongVisit.id, branchId: mandaluyongId });
  const mandaluyongNotices = await request("GET", "/api/staff/notifications", {
    user: mandaluyongStaff,
    role: "staff",
  });
  const taguigAfterMandaluyong = await request("GET", "/api/staff/notifications", {
    user: taguigStaff,
    role: "staff",
  });
  const mandaluyongDash = await request("GET", "/api/staff/dashboard", { user: mandaluyongStaff, role: "staff" });
  const taguigDash = await request("GET", "/api/staff/dashboard", { user: taguigStaff, role: "staff" });
  assert.equal(mandaluyongNotices.body.unreadCount, 1);
  assert.equal(mandaluyongNotices.body.notifications.length, 1);
  assert.equal(mandaluyongNotices.body.notifications[0].entityId, mandaluyongRx.id);
  assert.equal(taguigAfterMandaluyong.body.unreadCount, 0);
  assert.equal(taguigAfterMandaluyong.body.notifications.length, 0);
  assert.equal(mandaluyongDash.body.metrics.unreadNotifications, 1);
  assert.equal(taguigDash.body.metrics.unreadNotifications, 0);

  const mandaluyongQueue = await request("GET", "/api/staff/prescriptions", {
    user: mandaluyongStaff,
    role: "staff",
  });
  const taguigQueue = await request("GET", "/api/staff/prescriptions", { user: taguigStaff, role: "staff" });
  assert.equal(mandaluyongQueue.body.prescriptions.length, 1);
  assert.equal(mandaluyongQueue.body.prescriptions[0].id, mandaluyongRx.id);
  assert.equal(taguigQueue.body.prescriptions.length, 0);
  const processed = await request("POST", `/api/staff/prescriptions/${mandaluyongRx.id}/process`, {
    user: mandaluyongStaff,
    role: "staff",
  });
  assert.equal(processed.status, 200, JSON.stringify(processed.body));
  assert.equal(
    (await request("POST", `/api/staff/prescriptions/${mandaluyongRx.id}/process`, { user: taguigStaff, role: "staff" }))
      .status,
    403
  );

  const taguigRx = await signAndSend({ appointmentId: taguigVisit.id, branchId: taguigId });
  const taguigNotices = await request("GET", "/api/staff/notifications", { user: taguigStaff, role: "staff" });
  const mandaluyongAfterTaguig = await request("GET", "/api/staff/notifications", {
    user: mandaluyongStaff,
    role: "staff",
  });
  assert.equal(taguigNotices.body.unreadCount, 1);
  assert.equal(taguigNotices.body.notifications[0].entityId, taguigRx.id);
  assert.equal(
    mandaluyongAfterTaguig.body.notifications.some((item) => item.entityId === taguigRx.id),
    false
  );
  assert.equal(mandaluyongAfterTaguig.body.unreadCount, 1);

  const mandaluyongBoth = await request("GET", "/api/staff/prescriptions", {
    user: mandaluyongStaff,
    role: "staff",
  });
  const taguigBoth = await request("GET", "/api/staff/prescriptions", { user: taguigStaff, role: "staff" });
  assert.deepEqual(mandaluyongBoth.body.prescriptions.map((row) => row.id), [mandaluyongRx.id]);
  assert.deepEqual(taguigBoth.body.prescriptions.map((row) => row.id), [taguigRx.id]);
  assert.equal(mandaluyongBoth.body.prescriptions[0].clinicalRecordId, clinicalRecordId);
  assert.equal(taguigBoth.body.prescriptions[0].clinicalRecordId, clinicalRecordId);

  const patientList = await request("GET", `/api/staff/patients/${clinicalRecordId}/prescriptions`, {
    user: taguigStaff,
    role: "staff",
  });
  assert.deepEqual(patientList.body.prescriptions.map((row) => row.id), [taguigRx.id]);

  for (const [method, urlPath] of [
    ["GET", `/api/staff/prescriptions/${mandaluyongRx.id}`],
    ["GET", `/api/staff/prescriptions/${mandaluyongRx.id}/pdf`],
    ["GET", `/api/staff/prescriptions/${mandaluyongRx.id}/pdf?inline=1`],
    ["GET", `/api/staff/prescriptions/${mandaluyongRx.id}/jpeg`],
    ["POST", `/api/staff/prescriptions/${mandaluyongRx.id}/process`],
    ["POST", `/api/staff/prescriptions/${mandaluyongRx.id}/generate`],
  ]) {
    const denied = await request(method, urlPath, { user: taguigStaff, role: "staff" });
    assert.equal(denied.status, 403, `${method} ${urlPath} ${JSON.stringify(denied.body)}`);
  }
  const headerDenied = await request("GET", `/api/staff/prescriptions/${mandaluyongRx.id}`, {
    user: taguigStaff,
    role: "staff",
    branchId: mandaluyongId,
  });
  assert.equal(headerDenied.status, 403);
  const queryDenied = await request(
    "GET",
    `/api/staff/prescriptions?branchId=${mandaluyongId}`,
    { user: taguigStaff, role: "staff" }
  );
  assert.equal(queryDenied.status, 403);
  const bodyDenied = await request("POST", `/api/staff/prescriptions/${mandaluyongRx.id}/process`, {
    user: taguigStaff,
    role: "staff",
    body: { branchId: mandaluyongId },
  });
  assert.equal(bodyDenied.status, 403);

  await db.query(
    `CREATE TABLE IF NOT EXISTS record_access_requests (
       id BIGSERIAL PRIMARY KEY,
       clinical_record_id BIGINT NOT NULL,
       requesting_dentist_id TEXT NOT NULL,
       requesting_branch_id BIGINT NOT NULL,
       originating_branch_id BIGINT NOT NULL,
       reason TEXT NOT NULL,
       scope TEXT NOT NULL
     )`
  );
  await db.query(
    `CREATE TABLE IF NOT EXISTS record_access_grants (
       id BIGSERIAL PRIMARY KEY,
       request_id BIGINT NOT NULL,
       requesting_dentist_id TEXT NOT NULL,
       clinical_record_id BIGINT NOT NULL,
       originating_branch_id BIGINT NOT NULL,
       scope TEXT NOT NULL,
       status TEXT NOT NULL DEFAULT 'active',
       expires_at TIMESTAMPTZ NOT NULL
     )`
  );
  const accessRequest = await db.query(
    `INSERT INTO record_access_requests (
       clinical_record_id, requesting_dentist_id, requesting_branch_id, originating_branch_id, reason, scope
     ) VALUES ($1, $2, $3, $4, 'Review medications', 'diagnosis_notes')
     RETURNING id`,
    [clinicalRecordId, dentistId, taguigId, mandaluyongId]
  );
  await db.query(
    `INSERT INTO record_access_grants (
       request_id, requesting_dentist_id, clinical_record_id, originating_branch_id, scope, expires_at
     ) VALUES ($1, $2, $3, $4, 'diagnosis_notes', CURRENT_TIMESTAMP + INTERVAL '30 minutes')`,
    [accessRequest.rows[0].id, dentistId, clinicalRecordId, mandaluyongId]
  );
  const grantDenied = await request("GET", `/api/staff/prescriptions/${mandaluyongRx.id}/pdf?inline=1`, {
    user: taguigStaff,
    role: "staff",
  });
  assert.equal(grantDenied.status, 403);

  const conflict = await request("POST", "/api/dentist/prescriptions", {
    user: dentistId,
    role: "dentist",
    branchId: mandaluyongId,
    body: { clinicalRecordId, appointmentId: taguigVisit.id, items: [medication] },
  });
  assert.equal(conflict.status, 409);
  const suppliedConflict = await request("POST", "/api/dentist/prescriptions", {
    user: dentistId,
    role: "dentist",
    branchId: mandaluyongId,
    body: { clinicalRecordId, branchId: taguigId, items: [medication] },
  });
  assert.equal(suppliedConflict.status, 409);

  await db.query(`DELETE FROM clinic_branch_assignments WHERE user_id = $1 AND branch_id = $2`, [
    dentistId,
    mandaluyongId,
  ]);
  const stored = await db.query(
    `SELECT id, originating_branch_id FROM prescriptions WHERE id = ANY($1::uuid[]) ORDER BY id`,
    [[mandaluyongRx.id, taguigRx.id]]
  );
  const branchById = new Map(stored.rows.map((row) => [row.id, Number(row.originating_branch_id)]));
  assert.equal(branchById.get(mandaluyongRx.id), Number(mandaluyongId));
  assert.equal(branchById.get(taguigRx.id), Number(taguigId));
  const afterReassignMandaluyong = await request("GET", "/api/staff/prescriptions", {
    user: mandaluyongStaff,
    role: "staff",
  });
  const afterReassignTaguig = await request("GET", "/api/staff/prescriptions", {
    user: taguigStaff,
    role: "staff",
  });
  assert.deepEqual(afterReassignMandaluyong.body.prescriptions.map((row) => row.id), [mandaluyongRx.id]);
  assert.deepEqual(afterReassignTaguig.body.prescriptions.map((row) => row.id), [taguigRx.id]);

  const unknownId = "11111111-1111-4111-8111-111111111111";
  await db.query(
    `INSERT INTO prescriptions (
       id, prescription_number, clinical_record_id, current_version, workflow_status,
       created_by_dentist_id, originating_branch_id, attribution_review
     ) VALUES ($1, 'RX-UNKNOWN-0001', $2, 1, 'sent_to_staff', $3, NULL, TRUE)`,
    [unknownId, clinicalRecordId, dentistId]
  );
  await db.query(
    `INSERT INTO prescription_versions (
       id, prescription_id, version, content_hash, snapshot, created_by, created_by_role
     ) VALUES ($1, $2, 1, 'abc', '{"patient":{"fullName":"Synthetic Patient"}}'::jsonb, $3, 'dentist')`,
    ["22222222-2222-4222-8222-222222222222", unknownId, dentistId]
  );
  const unknownMandaluyong = await request("GET", "/api/staff/prescriptions", {
    user: mandaluyongStaff,
    role: "staff",
  });
  const unknownTaguig = await request("GET", "/api/staff/prescriptions", { user: taguigStaff, role: "staff" });
  assert.equal(unknownMandaluyong.body.prescriptions.some((row) => row.id === unknownId), false);
  assert.equal(unknownTaguig.body.prescriptions.some((row) => row.id === unknownId), false);
  const review = await request("GET", "/api/admin/prescription-attribution-review", {
    user: adminId,
    role: "admin",
  });
  assert.equal(review.status, 200, JSON.stringify(review.body));
  assert.ok(review.body.prescriptions.some((row) => row.id === unknownId));
  const staffReview = await request("GET", "/api/admin/prescription-attribution-review", {
    user: mandaluyongStaff,
    role: "staff",
  });
  assert.equal(staffReview.status, 403);

  const backfillId = "33333333-3333-4333-8333-333333333333";
  await db.query(
    `INSERT INTO prescriptions (
       id, prescription_number, clinical_record_id, appointment_id, current_version, workflow_status,
       created_by_dentist_id, originating_branch_id, attribution_review
     ) VALUES ($1, 'RX-BACKFILL-0001', $2, $3, 1, 'sent_to_staff', $4, NULL, TRUE)`,
    [backfillId, clinicalRecordId, mandaluyongVisit.id, dentistId]
  );
  await db.query(
    `INSERT INTO prescription_versions (
       id, prescription_id, version, content_hash, snapshot, created_by, created_by_role
     ) VALUES ($1, $2, 1, 'def', '{"patient":{"fullName":"Synthetic Patient"}}'::jsonb, $3, 'dentist')`,
    ["44444444-4444-4444-8444-444444444444", backfillId, dentistId]
  );
  const conflictId = "55555555-5555-4555-8555-555555555555";
  const treatment = await db.query(
    `INSERT INTO clinic_patient_treatments (clinical_record_id, treatment, originating_branch_id)
     VALUES ($1, 'Cleaning', $2) RETURNING id`,
    [clinicalRecordId, taguigId]
  );
  await db.query(
    `INSERT INTO prescriptions (
       id, prescription_number, clinical_record_id, appointment_id, treatment_id, current_version,
       workflow_status, created_by_dentist_id, originating_branch_id, attribution_review
     ) VALUES ($1, 'RX-CONFLICT-0001', $2, $3, $4, 1, 'sent_to_staff', $5, NULL, FALSE)`,
    [conflictId, clinicalRecordId, mandaluyongVisit.id, treatment.rows[0].id, dentistId]
  );
  await applyPrescriptionBranchSchema(db);
  const backfilled = await db.query(
    `SELECT originating_branch_id, attribution_review FROM prescriptions WHERE id = $1`,
    [backfillId]
  );
  const conflicted = await db.query(
    `SELECT originating_branch_id, attribution_review FROM prescriptions WHERE id = $1`,
    [conflictId]
  );
  assert.equal(Number(backfilled.rows[0].originating_branch_id), Number(mandaluyongId));
  assert.equal(conflicted.rows[0].originating_branch_id, null);
  assert.equal(conflicted.rows[0].attribution_review, true);
  const untouched = await db.query(`SELECT originating_branch_id FROM prescriptions WHERE id = $1`, [mandaluyongRx.id]);
  assert.equal(Number(untouched.rows[0].originating_branch_id), Number(mandaluyongId));

  const signature = await db.query(
    `SELECT stored_name FROM prescription_signatures WHERE prescription_id = $1`,
    [mandaluyongRx.id]
  );
  const signaturePath = path.join(process.cwd(), "uploads", "prescription-signatures", signature.rows[0].stored_name);
  assert.equal(fs.existsSync(signaturePath), true);
  const beforeRollback = await db.query(`SELECT COUNT(*)::int AS count FROM prescriptions`);
  await rollbackPrescriptionBranchSchema(db);
  const afterRollback = await db.query(`SELECT COUNT(*)::int AS count FROM prescriptions`);
  assert.equal(afterRollback.rows[0].count, beforeRollback.rows[0].count);
  assert.equal(fs.existsSync(signaturePath), true);
  const column = await db.query(
    `SELECT 1 FROM information_schema.columns
     WHERE table_name = 'prescriptions' AND column_name = 'originating_branch_id'`
  );
  assert.equal(column.rows.length, 0);
  await applyPrescriptionBranchSchema(db);
  const restored = await db.query(
    `SELECT id, originating_branch_id FROM prescriptions WHERE id = ANY($1::uuid[])`,
    [[mandaluyongRx.id, unknownId]]
  );
  const restoredById = new Map(restored.rows.map((row) => [row.id, row.originating_branch_id]));
  assert.equal(Number(restoredById.get(mandaluyongRx.id)), Number(mandaluyongId));
  assert.equal(restoredById.get(unknownId), null);
});
