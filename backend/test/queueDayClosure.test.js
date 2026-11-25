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

if (!process.env.DB_USER) {
  throw new Error("DB_USER is required to run queueDayClosure.test.js against disposable PostgreSQL.");
}

const dbName = `ds_queue_eod_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.CLINIC_TIMEZONE = "Asia/Manila";

function manilaInstant(ymd, hm) {
  return new Date(`${ymd}T${hm}:00+08:00`);
}

test("end-of-day queue closure and dentist review", { timeout: 120000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const branchCheckIn = require("../services/branchCheckIn");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const {
    applyQueueDayClosureSchema,
    closeDueQueueDays,
    closeBranchOperatingDate,
    finalizeNeedsReviewVisit,
    END_OF_DAY_CANCEL_REASON,
  } = require("../services/queueDayClosure");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const { createUnproceededAppointmentCancelJob } = require("../services/unproceededAppointmentCancelJob");
  const lifecycle = require("../services/appointmentLifecycle");

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
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "005_create_admin_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "008_create_admin_command_center.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "009_create_clinical_patient_records.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    ALTER TABLE clinic_patient_records ADD COLUMN IF NOT EXISTS archived BOOLEAN DEFAULT FALSE;
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT
    );
    ALTER TABLE admin_portal_dentist_profiles ADD COLUMN IF NOT EXISTS catalog_dentist_id TEXT;
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "026_queue_wait_estimates.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "042_appointment_lifecycle.sql"), "utf8"));
  await applyQueueDayClosureSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const other = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-0002', 'Taguig', '12 Synthetic Street', '09170002222', 'taguig@example.test', FALSE, 'active', TRUE, TRUE)
     RETURNING id`
  );
  const mainId = Number(main.rows[0].id);
  const taguigId = Number(other.rows[0].id);
  await db.query(
    `INSERT INTO clinic_schedule_days (branch_id, schedule_date, mode, open_time, close_time)
     VALUES ($1, '2026-11-20', 'custom', '09:00', '20:00')
     ON CONFLICT (branch_id, schedule_date) DO UPDATE SET mode = 'custom', open_time = '09:00', close_time = '20:00'`,
    [taguigId]
  );

  async function addUser(role, email, first) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Queue', $2, $3, 'synthetic-hash', $4, TRUE, 'Active')
       RETURNING id`,
      [first, email, `09${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`.slice(0, 11), role]
    );
    return result.rows[0].id;
  }

  const patient = await addUser("patient", "pearl.eod@example.test", "Pearl");
  const patientB = await addUser("patient", "rio.eod@example.test", "Rio");
  const staff = await addUser("staff", "staff.eod@example.test", "Sable");
  const dentist = await addUser("dentist", "dentist.eod@example.test", "Tala");
  const otherDentist = await addUser("dentist", "other.dentist.eod@example.test", "Nico");
  const admin = await addUser("admin", "admin.eod@example.test", "Ada");

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $2), ($3, $4), ($5, $2)`,
    [String(staff), mainId, String(dentist), taguigId, String(otherDentist)]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, $1)`,
    [String(dentist)]
  );

  const appointment = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'cleaning', 'Cleaning', $2, 'Dr. Tala Queue',
       '2026-11-20', '10:00', 'self_pay', 500, 'checked_in', $3
     ) RETURNING id`,
    [String(patient), String(dentist), mainId]
  );
  const appointmentId = appointment.rows[0].id;
  const treatingAppointment = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'filling', 'Filling', $2, 'Dr. Tala Queue',
       '2026-11-20', '10:30', 'self_pay', 800, 'checked_in', $3
     ) RETURNING id`,
    [String(patient), String(dentist), mainId]
  );
  const treatingAppointmentId = treatingAppointment.rows[0].id;

  const clinical = await db.query(
    `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
     VALUES ('CR-EOD', 'Pearl', 'Queue', $1) RETURNING id`,
    [String(patient)]
  );
  const recordId = clinical.rows[0].id;

  async function insertQueue({ userId = patient, branchId = mainId, status, token, at, appointmentId: appt = null }) {
    const result = await db.query(
      `INSERT INTO patient_portal_queue_entries (
         user_id, appointment_id, token, position, status, branch_id, checked_in_at, updated_at
       ) VALUES ($1, $2, $3, 1, $4, $5, $6, $6)
       RETURNING id, status, checked_in_at`,
      [String(userId), appt, token, status, branchId, at]
    );
    return result.rows[0];
  }

  const day = "2026-11-20";
  const checkIn = manilaInstant(day, "10:00");
  const waiting = await insertQueue({ status: "waiting", token: "A-001", at: checkIn, appointmentId });
  const called = await insertQueue({ status: "preparing", token: "A-002", at: checkIn, userId: patientB });
  const calledTicket = await insertQueue({ status: "called", token: "A-002c", at: checkIn, userId: patientB });
  const treating = await insertQueue({
    status: "dentist",
    token: "A-003",
    at: checkIn,
    appointmentId: treatingAppointmentId,
  });
  const done = await insertQueue({ status: "completed", token: "A-004", at: checkIn });
  await db.query(
    `INSERT INTO clinic_patient_treatments (clinical_record_id, treatment, treatment_date, status, notes)
     VALUES ($1, 'Cleaning / Oral Prophylaxis', $2::date, 'completed', 'Keep after EOD cancel')`,
    [recordId, day]
  );
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'consult', 'Consultation', $2, 'Dr. Tala Queue',
       '2026-11-21', '09:00', 'self_pay', 500, 'confirmed', $3
     )`,
    [String(patient), String(dentist), mainId]
  );
  const neverCheckedIn = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'cleaning', 'Cleaning', $2, 'Dr. Tala Queue',
       '2026-11-20', '14:00', 'self_pay', 500, 'confirmed', $3
     ) RETURNING id, status`,
    [String(patientB), String(dentist), mainId]
  );
  const otherBranch = await insertQueue({
    status: "waiting",
    token: "T-001",
    at: checkIn,
    branchId: taguigId,
    userId: patientB,
  });

  const before = await closeDueQueueDays(db, manilaInstant(day, "17:59"));
  assert.equal(before.closed, 0, "closing before 6:00 PM must leave the queue unchanged");
  const stillWaiting = await db.query(`SELECT status FROM patient_portal_queue_entries WHERE id = $1`, [waiting.id]);
  assert.equal(stillWaiting.rows[0].status, "waiting");

  const mainOnlyClient = await db.connect();
  try {
    await mainOnlyClient.query("BEGIN");
    await closeBranchOperatingDate(mainOnlyClient, {
      branchId: mainId,
      operatingDate: day,
      now: manilaInstant(day, "18:00"),
    });
    await mainOnlyClient.query("COMMIT");
  } catch (error) {
    await mainOnlyClient.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    mainOnlyClient.release();
  }
  const isolated = await db.query(`SELECT status FROM patient_portal_queue_entries WHERE id = $1`, [otherBranch.id]);
  assert.equal(isolated.rows[0].status, "waiting", "closing one branch must not rewrite another branch's queue");

  const atCutoff = await closeDueQueueDays(db, manilaInstant(day, "18:00"));
  assert.ok(atCutoff.closed >= 1);
  const afterClose = await db.query(
    `SELECT id, status, checked_in_at, closed_at FROM patient_portal_queue_entries WHERE id = ANY($1::bigint[]) ORDER BY token`,
    [[waiting.id, called.id, calledTicket.id, treating.id, done.id, otherBranch.id]]
  );
  const byId = Object.fromEntries(afterClose.rows.map((row) => [Number(row.id), row]));
  assert.equal(byId[waiting.id].status, "cancelled");
  assert.equal(byId[called.id].status, "cancelled");
  assert.equal(byId[calledTicket.id].status, "cancelled");
  assert.equal(byId[treating.id].status, "needs_review");
  assert.equal(byId[done.id].status, "completed");
  assert.equal(byId[otherBranch.id].status, "cancelled");
  assert.equal(new Date(byId[waiting.id].checked_in_at).toISOString(), checkIn.toISOString());
  assert.ok(byId[waiting.id].closed_at);
  const cancelledAppointment = await db.query(
    `SELECT status, cancellation_reason FROM patient_portal_appointments WHERE id = $1`,
    [appointmentId]
  );
  assert.equal(cancelledAppointment.rows[0].status, "cancelled");
  assert.equal(cancelledAppointment.rows[0].cancellation_reason, END_OF_DAY_CANCEL_REASON);
  const missedStillOpen = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [
    neverCheckedIn.rows[0].id,
  ]);
  assert.equal(
    missedStillOpen.rows[0].status,
    "confirmed",
    "never-checked-in bookings stay on the separate 6 PM no-show job"
  );
  const overlayCancelled = lifecycle.overlayAppointmentStatus(
    cancelledAppointment.rows[0].status,
    "cancelled"
  );
  assert.equal(overlayCancelled.statusLabel, "Cancelled");
  const overlayReview = lifecycle.overlayAppointmentStatus("checked_in", byId[treating.id].status);
  assert.equal(overlayReview.statusLabel, "Needs end-of-day review");

  const missedJob = createUnproceededAppointmentCancelJob({ db });
  const missedAfterQueue = await missedJob.runOnce(manilaInstant(day, "18:02"));
  const queuedStayCancelled = await db.query(
    `SELECT status, cancellation_reason FROM patient_portal_appointments WHERE id = $1`,
    [appointmentId]
  );
  assert.equal(queuedStayCancelled.rows[0].status, "cancelled");
  assert.equal(queuedStayCancelled.rows[0].cancellation_reason, END_OF_DAY_CANCEL_REASON);
  const treatingStayOpen = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [
    treatingAppointmentId,
  ]);
  assert.equal(treatingStayOpen.rows[0].status, "checked_in");
  const neverCheckedAfter = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [
    neverCheckedIn.rows[0].id,
  ]);
  assert.equal(neverCheckedAfter.rows[0].status, "no_show");
  assert.ok((missedAfterQueue.ids || []).map(String).includes(String(neverCheckedIn.rows[0].id)));
  assert.equal((missedAfterQueue.ids || []).map(String).includes(String(appointmentId)), false);

  const audits = await db.query(
    `SELECT COUNT(*)::int AS count FROM admin_portal_audit_logs WHERE action = 'queue_day_closure'`
  );
  assert.equal(audits.rows[0].count, 5);

  const retry = await closeDueQueueDays(db, manilaInstant(day, "18:05"));
  assert.equal(retry.closed, 0);
  const auditsAgain = await db.query(
    `SELECT COUNT(*)::int AS count FROM admin_portal_audit_logs WHERE action = 'queue_day_closure'`
  );
  assert.equal(auditsAgain.rows[0].count, 5);

  const leftover = await insertQueue({
    status: "waiting",
    token: "A-005",
    at: manilaInstant("2026-11-19", "11:00"),
  });
  const catchUp = await closeDueQueueDays(db, manilaInstant(day, "09:00"));
  assert.ok(catchUp.closed >= 1);
  const leftoverRow = await db.query(`SELECT status FROM patient_portal_queue_entries WHERE id = $1`, [leftover.id]);
  assert.equal(leftoverRow.rows[0].status, "cancelled");

  const concurrentA = insertQueue({
    status: "waiting",
    token: "A-006",
    at: manilaInstant("2026-11-18", "09:30"),
  });
  const concurrentRow = await concurrentA;
  const [first, second] = await Promise.all([
    closeDueQueueDays(db, manilaInstant(day, "10:00")),
    closeDueQueueDays(db, manilaInstant(day, "10:00")),
  ]);
  const concurrentClosed = first.closed + second.closed;
  assert.ok(concurrentClosed >= 1);
  const concurrentStatus = await db.query(`SELECT status FROM patient_portal_queue_entries WHERE id = $1`, [
    concurrentRow.id,
  ]);
  assert.equal(concurrentStatus.rows[0].status, "cancelled");

  const nextDay = await insertQueue({
    status: "waiting",
    token: "A-101",
    at: manilaInstant("2026-11-21", "09:15"),
  });
  const nextDayCloseTooEarly = await closeDueQueueDays(db, manilaInstant("2026-11-21", "15:00"));
  const nextDayRow = await db.query(`SELECT status FROM patient_portal_queue_entries WHERE id = $1`, [nextDay.id]);
  assert.equal(nextDayRow.rows[0].status, "waiting");
  assert.equal(
    nextDayCloseTooEarly.results.some((row) => row.operatingDate === "2026-11-21" && row.updated > 0),
    false
  );

  const reviewed = await finalizeNeedsReviewVisit(db, {
    queueId: treating.id,
    patientUserId: String(patient),
    branchId: mainId,
    outcome: "completed",
    actor: { actorId: String(dentist), actorName: "Dr. Tala Queue", actorRole: "dentist" },
  });
  assert.equal(reviewed.status, "completed");
  assert.ok(reviewed.reviewed_at);
  assert.equal(new Date(reviewed.checked_in_at).toISOString(), checkIn.toISOString());

  await assert.rejects(
    () =>
      finalizeNeedsReviewVisit(db, {
        queueId: treating.id,
        patientUserId: String(patient),
        branchId: mainId,
        outcome: "cancelled",
        reason: "Visit not finished",
        actor: { actorId: String(dentist), actorRole: "dentist" },
      }),
    (error) => error.status === 409
  );

  const secondReview = await insertQueue({ status: "dentist", token: "A-007", at: checkIn, userId: patient });
  await closeDueQueueDays(db, manilaInstant(day, "18:30"));
  const cancelledReview = await finalizeNeedsReviewVisit(db, {
    queueId: secondReview.id,
    patientUserId: String(patient),
    branchId: mainId,
    outcome: "cancelled",
    reason: "Visit not processed after dentist review",
    actor: { actorId: String(dentist), actorName: "Dr. Tala Queue", actorRole: "dentist" },
  });
  assert.equal(cancelledReview.status, "cancelled");
  const keptTreatment = await db.query(
    `SELECT COUNT(*)::int AS count FROM clinic_patient_treatments WHERE notes = 'Keep after EOD cancel'`
  );
  assert.ok(keptTreatment.rows[0].count >= 1);

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

  async function request(method, urlPath, { id, role, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(id, role)}`,
        "Content-Type": "application/json",
        "X-DentaSync-Branch": String(mainId),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const payload = await response.json().catch(() => ({}));
    return { status: response.status, payload };
  }

  const staffPatch = await request("PATCH", `/api/staff/queue/${waiting.id}`, {
    id: staff,
    role: "staff",
    body: { status: "waiting" },
  });
  assert.equal(staffPatch.status, 409);

  const staffDenied = await request("POST", `/api/dentist/patients/${recordId}/queue-visits/${treating.id}/review`, {
    id: staff,
    role: "staff",
    body: { outcome: "completed" },
  });
  assert.equal(staffDenied.status, 403);

  const adminDenied = await request("POST", `/api/dentist/patients/${recordId}/queue-visits/${treating.id}/review`, {
    id: admin,
    role: "admin",
    body: { outcome: "completed" },
  });
  assert.equal(adminDenied.status, 403);

  const racing = await insertQueue({ status: "waiting", token: "A-006b", at: checkIn, userId: patient });
  await db.query(`UPDATE patient_portal_queue_entries SET status = 'dentist' WHERE id = $1`, [racing.id]);
  await closeDueQueueDays(db, manilaInstant(day, "18:40"));
  const raced = await db.query(`SELECT status FROM patient_portal_queue_entries WHERE id = $1`, [racing.id]);
  assert.equal(raced.rows[0].status, "needs_review");

  const reviewAppointment = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'filling', 'Filling', $2, 'Dr. Tala Queue',
       '2026-11-20', '16:00', 'self_pay', 800, 'checked_in', $3
     ) RETURNING id`,
    [String(patient), String(dentist), mainId]
  );
  const needsReviewVisit = await insertQueue({
    status: "dentist",
    token: "A-008",
    at: checkIn,
    userId: patient,
    appointmentId: reviewAppointment.rows[0].id,
  });
  await closeDueQueueDays(db, manilaInstant(day, "18:45"));
  const dentistDenied = await request(
    "POST",
    `/api/dentist/patients/${recordId}/queue-visits/${needsReviewVisit.id}/review`,
    { id: otherDentist, role: "dentist", body: { outcome: "completed" } }
  );
  assert.equal(dentistDenied.status, 403, JSON.stringify(dentistDenied.payload));

  const dentistOk = await request(
    "POST",
    `/api/dentist/patients/${recordId}/queue-visits/${needsReviewVisit.id}/review`,
    { id: dentist, role: "dentist", body: { outcome: "completed" } }
  );
  assert.equal(dentistOk.status, 200, JSON.stringify(dentistOk.payload));
  assert.equal(dentistOk.payload.visit.status, "completed");

  const wrongPatient = await request(
    "POST",
    `/api/dentist/patients/${recordId}/queue-visits/${called.id}/review`,
    { id: dentist, role: "dentist", body: { outcome: "cancelled", reason: "Wrong patient" } }
  );
  assert.ok(wrongPatient.status === 409 || wrongPatient.status === 403);

  const checkIns = await request("GET", `/api/staff/check-ins?range=date&date=${day}`, {
    id: staff,
    role: "staff",
  });
  assert.equal(checkIns.status, 200, JSON.stringify(checkIns.payload));
  const source = checkIns.payload.checkIns || [];
  const waitingLog = source.find((row) => String(row.id) === String(waiting.id) || row.token === "A-001");
  const treatingLog = source.find((row) => String(row.id) === String(treating.id) || row.token === "A-003");
  assert.ok(waitingLog, "check-in log should keep the original waiting visit");
  assert.equal(waitingLog.status, "cancelled");
  assert.ok(treatingLog);
  assert.equal(treatingLog.status, "completed");

  const todayQueue = await request("GET", "/api/staff/queue", { id: staff, role: "staff" });
  assert.equal(todayQueue.status, 200);
  const liveTokens = (todayQueue.payload.queue || []).map((row) => row.token);
  assert.equal(liveTokens.includes("A-001"), false);
  assert.equal(liveTokens.includes("A-003"), false);

  const completedAppointment = await db.query(
    `SELECT status FROM patient_portal_appointments WHERE id = $1`,
    [reviewAppointment.rows[0].id]
  );
  assert.equal(completedAppointment.rows[0].status, "completed");
});
