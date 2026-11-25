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

const dbName = `ds_taguig_staff_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("Taguig Staff cannot read or change Mandaluyong operational records", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const branchCheckIn = require("../services/branchCheckIn");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
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
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "009_create_clinical_patient_records.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "010_create_staff_operations.sql"), "utf8"));
  await db.query(`ALTER TABLE staff_portal_notifications ADD COLUMN IF NOT EXISTS branch_id BIGINT`);
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS originating_branch_id BIGINT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS amount_charged NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS amount_paid NUMERIC(10,2) DEFAULT 0;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS diagnosis_notes TEXT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS appointment_id BIGINT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS queue_entry_id BIGINT;
    ALTER TABLE clinic_patient_treatments ADD COLUMN IF NOT EXISTS visit_sequence INTEGER;
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT,
      license_number TEXT,
      ptr_number TEXT,
      professional_designation TEXT,
      license_verified BOOLEAN
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
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "026_queue_wait_estimates.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const taguig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-0002', 'Taguig', '12 Synthetic Street', '09170002222', 'taguig@example.test', FALSE, 'active', TRUE, FALSE)
     RETURNING id`
  );
  await db.query(`UPDATE clinic_branches SET name = 'Mandaluyong', rfid_enabled = TRUE, qr_enabled = TRUE WHERE id = $1`, [
    main.rows[0].id,
  ]);
  const mandaluyongId = main.rows[0].id;
  const taguigId = taguig.rows[0].id;

  async function addUser(role, email, first, rfid = null) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Restrict', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', $5, 'regular')
       RETURNING id`,
      [first, email, `09${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, role, rfid]
    );
    return result.rows[0].id;
  }

  const mandaluyongPatient = await addUser("patient", "m.patient.restrict@example.test", "Mina", "AABBCCDDEE31");
  const taguigPatient = await addUser("patient", "t.patient.restrict@example.test", "Tomas", "AABBCCDDEE32");
  const mandaluyongStaff = await addUser("staff", "m.staff.restrict@example.test", "Minda");
  const taguigStaff = await addUser("staff", "t.staff.restrict@example.test", "Tessa");
  const unassignedStaff = await addUser("staff", "u.staff.restrict@example.test", "Una");
  const mandaluyongDentist = await addUser("dentist", "m.dentist.restrict@example.test", "Marco");
  const taguigDentist = await addUser("dentist", "t.dentist.restrict@example.test", "Tala");
  const admin = await addUser("admin", "admin.restrict@example.test", "Ada");
  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4), ($5, $2), ($6, $4)`,
    [mandaluyongStaff, mandaluyongId, taguigStaff, taguigId, mandaluyongDentist, taguigDentist]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-marco'), ($2, 'dr-tala')`,
    [String(mandaluyongDentist), String(taguigDentist)]
  );

  async function book(userId, branchId, dentistId, dentistName, time) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $2, $3,
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $4::time, 'hmo', 500, 'confirmed', $5
       ) RETURNING id, branch_id`,
      [String(userId), dentistId, dentistName, time, branchId]
    );
    return result.rows[0];
  }

  const mandaluyongVisit = await book(mandaluyongPatient, mandaluyongId, "dr-marco", "Dr. Marco Restrict", "09:30");
  const taguigVisit = await book(taguigPatient, taguigId, "dr-tala", "Dr. Tala Restrict", "10:30");

  const mandaluyongRecord = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CR-M-1', 'Mina', 'Restrict', $1) RETURNING id`,
    [String(mandaluyongPatient)]
  );
  const taguigRecord = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CR-T-1', 'Tomas', 'Restrict', $1) RETURNING id`,
    [String(taguigPatient)]
  );
  const mandaluyongTreatment = await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, diagnosis_notes, originating_branch_id, amount_charged
     ) VALUES ($1, 'Mandaluyong filling', 'Dr. Marco Restrict', 'completed', 'Deep caries', $2, 800)
     RETURNING id`,
    [mandaluyongRecord.rows[0].id, mandaluyongId]
  );
  await db.query(
    `INSERT INTO clinic_patient_treatments (
       clinical_record_id, treatment, dentist_name, status, diagnosis_notes, originating_branch_id, amount_charged
     ) VALUES ($1, 'Taguig cleaning', 'Dr. Tala Restrict', 'completed', 'Mild stain', $2, 500)`,
    [taguigRecord.rows[0].id, taguigId]
  );

  await db.query(
    `INSERT INTO staff_portal_dentist_availability (
       dentist_id, dentist_name, availability_date, start_time, end_time, status
     ) VALUES
       ('dr-marco', 'Dr. Marco Restrict', CURRENT_DATE, '09:00', '12:00', 'available'),
       ('dr-tala', 'Dr. Tala Restrict', CURRENT_DATE, '13:00', '16:00', 'available')`
  );

  const clinicSms = {
    isValidPhMobile: (phone) => /^09\d{9}$/.test(String(phone || "").replace(/\s/g, "")),
    formatPhoneSemaphore: (phone) => phone,
    maskPhone: (phone) => String(phone || "").replace(/\d(?=\d{4})/g, "*"),
    previewMessage: ({ appointment, customMessage }) =>
      customMessage || `${appointment?.service_name || "visit"} at ${appointment?.dentist_name || "clinic"}`,
    getSmsSettings: async () => ({ clinicName: "Synthetic Clinic" }),
    listSmsLogs: async () => [],
    sendClinicSms: async () => {
      throw new Error("Tests must not send SMS.");
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken,
      clinicSms,
      notifyStaff: async () => 0,
      notifyDentist: async () => 0,
    })
  );
  app.use(
    "/api/admin",
    createAdminPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } })
  );
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
    let parsed = text;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = text;
    }
    return { status: response.status, body: parsed, text };
  }

  const mStaff = tokenFor(mandaluyongStaff, "staff");
  const tStaff = tokenFor(taguigStaff, "staff");
  const uStaff = tokenFor(unassignedStaff, "staff");
  const adminToken = tokenFor(admin, "admin");

  const unassignedQueue = await request("GET", "/api/staff/queue", { token: uStaff });
  assert.equal(unassignedQueue.status, 403);
  const unassignedContext = await request("GET", "/api/staff/branch-context", { token: uStaff });
  assert.equal(unassignedContext.status, 200);
  assert.match(String(unassignedContext.body.message || ""), /No branch is assigned/i);

  const forged = await request("GET", "/api/staff/queue", {
    token: tStaff,
    headers: { "x-dentasync-branch": String(mandaluyongId) },
  });
  assert.equal(forged.status, 403);

  const tAppointments = await request("GET", "/api/staff/appointments?tab=today", { token: tStaff });
  const mAppointments = await request("GET", "/api/staff/appointments?tab=today", { token: mStaff });
  assert.equal(tAppointments.status, 200, JSON.stringify(tAppointments.body));
  assert.equal(tAppointments.body.appointments.length, 1);
  assert.match(String(tAppointments.body.appointments[0].patientName), /Tomas/);
  assert.equal(mAppointments.body.appointments.length, 1);
  assert.match(String(mAppointments.body.appointments[0].patientName), /Mina/);

  const tCrossAppointment = await request("GET", `/api/staff/appointments/${mandaluyongVisit.id}`, { token: tStaff });
  assert.equal(tCrossAppointment.status, 404);

  const tDash = await request("GET", "/api/staff/dashboard", { token: tStaff });
  const mDash = await request("GET", "/api/staff/dashboard", { token: mStaff });
  assert.equal(tDash.body.metrics.todaysAppointments, 1);
  assert.equal(mDash.body.metrics.todaysAppointments, 1);

  const tQrWrongBranch = await request("POST", "/api/staff/check-in", {
    token: tStaff,
    body: { method: "qr", appointmentId: mandaluyongVisit.id },
  });
  assert.equal(tQrWrongBranch.status, 409);

  const tQrDisabled = await request("POST", "/api/staff/check-in", {
    token: tStaff,
    body: { method: "qr", appointmentId: taguigVisit.id },
  });
  assert.equal(tQrDisabled.status, 409);

  const tRfid = await request("POST", "/api/staff/check-in", {
    token: tStaff,
    body: { method: "rfid", rfidTag: "AABBCCDDEE32" },
  });
  assert.equal(tRfid.status, 201, JSON.stringify(tRfid.body));
  const mRfid = await request("POST", "/api/staff/check-in", {
    token: mStaff,
    body: { method: "rfid", rfidTag: "AABBCCDDEE31" },
  });
  assert.equal(mRfid.status, 201, JSON.stringify(mRfid.body));

  const tQueue = await request("GET", "/api/staff/queue", { token: tStaff });
  const mQueue = await request("GET", "/api/staff/queue", { token: mStaff });
  assert.equal(tQueue.body.queue.length, 1);
  assert.match(String(tQueue.body.queue[0].patientName), /Tomas/);
  assert.equal(mQueue.body.queue.length, 1);
  assert.match(String(mQueue.body.queue[0].patientName), /Mina/);

  const tExport = await request("GET", "/api/staff/export/check-ins", { token: tStaff });
  const mExport = await request("GET", "/api/staff/export/check-ins", { token: mStaff });
  assert.equal(tExport.status, 200);
  assert.match(String(tExport.body || tExport.text), /Tomas/);
  assert.equal(String(tExport.body || tExport.text).includes("Mina"), false);
  assert.match(String(mExport.body || mExport.text), /Mina/);
  assert.equal(String(mExport.body || mExport.text).includes("Tomas"), false);

  const tApptExport = await request("GET", "/api/staff/export/appointments", { token: tStaff });
  assert.equal(String(tApptExport.body || tApptExport.text).includes("Mina"), false);
  assert.match(String(tApptExport.body || tApptExport.text), /Tomas/);

  const mInvoice = await request("POST", "/api/staff/billing", {
    token: mStaff,
    body: {
      patientName: "Mina Restrict",
      patientUserId: String(mandaluyongPatient),
      appointmentId: mandaluyongVisit.id,
      serviceName: "Mandaluyong filling",
      amount: 800,
      amountPaid: 0,
    },
  });
  assert.equal(mInvoice.status, 201, JSON.stringify(mInvoice.body));
  const tInvoice = await request("POST", "/api/staff/billing", {
    token: tStaff,
    body: {
      patientName: "Tomas Restrict",
      patientUserId: String(taguigPatient),
      appointmentId: taguigVisit.id,
      serviceName: "Taguig cleaning",
      amount: 500,
      amountPaid: 0,
    },
  });
  assert.equal(tInvoice.status, 201, JSON.stringify(tInvoice.body));

  const tStealInvoice = await request("POST", "/api/staff/billing", {
    token: tStaff,
    body: {
      patientName: "Mina Restrict",
      appointmentId: mandaluyongVisit.id,
      serviceName: "Stolen invoice",
      amount: 1,
    },
  });
  assert.equal(tStealInvoice.status, 403);

  const tBilling = await request("GET", "/api/staff/billing", { token: tStaff });
  const mBilling = await request("GET", "/api/staff/billing", { token: mStaff });
  assert.equal(tBilling.body.invoices.length, 1);
  assert.equal(tBilling.body.invoices[0].serviceName, "Taguig cleaning");
  assert.equal(mBilling.body.invoices.length, 1);
  assert.equal(mBilling.body.invoices[0].serviceName, "Mandaluyong filling");

  const tReadMInvoice = await request("GET", `/api/staff/billing/${mInvoice.body.invoice.id}`, { token: tStaff });
  assert.equal(tReadMInvoice.status, 404);
  const tPatchMInvoice = await request("PATCH", `/api/staff/billing/${mInvoice.body.invoice.id}`, {
    token: tStaff,
    body: { amountPaid: 800, paymentStatus: "paid" },
  });
  assert.equal(tPatchMInvoice.status, 404);

  const tSms = await request("POST", "/api/staff/notifications/sms/preview", {
    token: tStaff,
    body: { phone: "09171234567", appointmentId: mandaluyongVisit.id, messageType: "manual", message: "Hello" },
  });
  assert.equal(tSms.status, 403);

  const tSmsOwn = await request("POST", "/api/staff/notifications/sms/preview", {
    token: tStaff,
    body: { phone: "09171234567", appointmentId: taguigVisit.id, messageType: "manual", message: "Hello Taguig" },
  });
  assert.equal(tSmsOwn.status, 200, JSON.stringify(tSmsOwn.body));
  assert.match(String(tSmsOwn.body.message), /Hello Taguig/);

  const patients = await request("GET", "/api/staff/patients", { token: tStaff });
  assert.equal(patients.status, 200, JSON.stringify(patients.body));
  const names = (patients.body.patients || []).map((row) => row.fullName || row.patientName || "");
  assert.equal(names.some((name) => name.includes("Mina")), false);
  assert.ok(names.some((name) => name.includes("Tomas")));
  assert.equal(patients.body.total, 1);

  const tPatient = await request("GET", `/api/staff/patients/${taguigRecord.rows[0].id}`, { token: tStaff });
  assert.equal(tPatient.status, 200, JSON.stringify(tPatient.body));
  assert.equal((tPatient.body.patient.treatments || []).length, 1);
  assert.equal(tPatient.body.patient.treatments[0].treatment, "Taguig cleaning");
  assert.equal(tPatient.body.patient.treatments[0].diagnosisNotes, "Mild stain");
  assert.ok(tPatient.body.patient.currentVisit);
  assert.equal(Number(tPatient.body.patient.currentVisit.appointmentId), Number(taguigVisit.id));

  const tOtherPatient = await request("GET", `/api/staff/patients/${mandaluyongRecord.rows[0].id}`, { token: tStaff });
  assert.equal(tOtherPatient.status, 404);
  assert.equal(tOtherPatient.body.patient, undefined);
  assert.equal(JSON.stringify(tOtherPatient.body).includes("Mild stain"), false);
  assert.equal(JSON.stringify(tOtherPatient.body).includes("Mina"), false);

  const tPayOther = await request(
    "PATCH",
    `/api/staff/patients/${mandaluyongRecord.rows[0].id}/treatments/${mandaluyongTreatment.rows[0].id}`,
    {
      token: tStaff,
      body: { amountPaid: 1 },
    }
  );
  assert.equal(tPayOther.status, 404);

  const availability = await request("GET", "/api/staff/dentist-availability", { token: tStaff });
  assert.equal(availability.status, 200, JSON.stringify(availability.body));
  assert.equal((availability.body.availability || []).every((row) => row.dentistId === "dr-tala"), true);
  assert.equal((availability.body.availability || []).some((row) => row.dentistId === "dr-marco"), false);

  const adminList = await request("GET", "/api/admin/appointments", { token: adminToken });
  assert.equal(adminList.status, 200, JSON.stringify(adminList.body));
  const adminNames = (adminList.body.appointments || []).map((row) => row.patientName || "");
  assert.ok(adminNames.some((name) => name.includes("Mina")));
  assert.ok(adminNames.some((name) => name.includes("Tomas")));
});
