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

function assertLocalPostgresOnly() {
  if (String(process.env.DATABASE_URL || "").trim()) {
    throw new Error("DATABASE_URL must be unset for local disposable PostgreSQL tests.");
  }
  const host = String(process.env.DB_HOST || "localhost").trim();
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Refusing non-local DB_HOST ${host}`);
  }
}

assertLocalPostgresOnly();

const dbName = `ds_qnoshow_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-disposable-jwt-secret";
process.env.CLINIC_TIMEZONE = "Asia/Manila";

const migrations = path.join(__dirname, "..", "migrations");
function sqlFile(name) {
  return fs.readFileSync(path.join(migrations, name), "utf8");
}

test("current queue tickets stay on the Manila clinic day and missed visits become no-show at 6 PM", { timeout: 120000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const { applyQueueDayClosureSchema } = require("../services/queueDayClosure");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const { createUnproceededAppointmentCancelJob, AUTO_REASON, NO_SHOW_TITLE } = require("../services/unproceededAppointmentCancelJob");
  const staffCheckIn = require("../services/staffCheckIn");

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
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    ALTER TABLE patient_portal_notifications ADD COLUMN IF NOT EXISTS entity_type TEXT;
    ALTER TABLE patient_portal_notifications ADD COLUMN IF NOT EXISTS entity_id TEXT;
    ALTER TABLE patient_portal_profiles ADD COLUMN IF NOT EXISTS hmo_verified_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT,
      treatment TEXT
    );
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
  `);
  await db.query(sqlFile("042_appointment_lifecycle.sql"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await applyQueueDayClosureSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const mainId = main.rows[0].id;
  const other = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000022', FALSE, 'active')
     RETURNING id`
  );
  const pasigId = other.rows[0].id;

  async function addUser(first, email, role, phone) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, patient_category)
       VALUES ($1, 'Ticket', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', 'Regular')
       RETURNING id`,
      [first, email, phone, role]
    );
    return String(result.rows[0].id);
  }

  const patientId = await addUser("Algene", "algene.ticket@example.test", "patient", "09170004001");
  const otherPatientId = await addUser("Nico", "nico.ticket@example.test", "patient", "09170004002");
  const staffId = await addUser("Sana", "sana.ticket@example.test", "staff", "09170004003");
  const dentistId = await addUser("Dina", "dina.ticket@example.test", "dentist", "09170004004");

  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const yesterdayDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", {
    timeZone: "Asia/Manila",
  });

  async function book({ userId, date, time, status, service, notes, branchId }) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, notes, status, branch_id
       ) VALUES (
         $1, 'consult', $2, $3, 'Dr. Dina', $4::date, $5, 'self_pay', 800, $6, $7, $8
       ) RETURNING id`,
      [String(userId), service, dentistId, date, time, notes, status, branchId]
    );
    return result.rows[0].id;
  }

  const staleWalkIn = await book({
    userId: patientId,
    date: yesterdayDate,
    time: "11:30",
    status: "checked_in",
    service: "Walk-in Consultation",
    notes: "Auto-created from RFID walk-in check-in.",
    branchId: mainId,
  });
  await db.query(
    `INSERT INTO patient_portal_queue_entries (
       user_id, appointment_id, token, position, status, estimated_wait_minutes, checked_in_at, branch_id, check_in_method
     ) VALUES ($1, $2, 'Y-001', 1, 'waiting', 10, $3::timestamptz, $4, 'rfid')`,
    [patientId, staleWalkIn, `${yesterdayDate}T03:30:00.000Z`, mainId]
  );

  const futureBooked = await book({
    userId: patientId,
    date: "2026-12-02",
    time: "09:00",
    status: "confirmed",
    service: "Dental Cleaning / Oral Prophylaxis",
    notes: null,
    branchId: mainId,
  });
  const todayBooked = await book({
    userId: patientId,
    date: today,
    time: "10:00",
    status: "confirmed",
    service: "Oral Examination / Consultation",
    notes: null,
    branchId: mainId,
  });
  const completedPast = await book({
    userId: patientId,
    date: yesterdayDate,
    time: "08:00",
    status: "completed",
    service: "Permanent Filling / Restoration",
    notes: null,
    branchId: mainId,
  });
  const cancelledPast = await book({
    userId: patientId,
    date: yesterdayDate,
    time: "09:00",
    status: "cancelled",
    service: "Dental Cleaning / Oral Prophylaxis",
    notes: "Patient cancelled",
    branchId: mainId,
  });
  const otherBranchToday = await book({
    userId: otherPatientId,
    date: today,
    time: "10:30",
    status: "confirmed",
    service: "Walk-in Consultation",
    notes: "Auto-created from RFID walk-in check-in.",
    branchId: pasigId,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/patient", createPatientPortalRouter({ db, authenticateToken }));
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);

  function tokenFor(id, role) {
    return jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  }

  async function api(method, urlPath, { id, role, body, headers } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${tokenFor(id, role)}`,
        "Content-Type": "application/json",
        ...(headers || {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  const emptyDash = await api("GET", "/api/patient/dashboard", { id: patientId, role: "patient" });
  assert.equal(emptyDash.status, 200, JSON.stringify(emptyDash.json));
  assert.equal(emptyDash.json.queue, null);
  assert.equal(emptyDash.json.metrics.queueToken, null);

  const emptyQueue = await api("GET", "/api/patient/queue", { id: patientId, role: "patient" });
  assert.equal(emptyQueue.json.current, null);

  const staffEmpty = await api("GET", "/api/staff/queue", {
    id: staffId,
    role: "staff",
    headers: { "X-DentaSync-Branch": String(mainId) },
  });
  if (staffEmpty.status === 200) {
    const staffTokens = (staffEmpty.json.queue || []).map((row) => row.token || row.queueNumber);
    assert.equal(staffTokens.includes("Y-001"), false);
  }

  const dentistEmpty = await api("GET", "/api/dentist/queue", { id: dentistId, role: "dentist" });
  if (dentistEmpty.status === 200) {
    const dentistTokens = (dentistEmpty.json.queue || []).map((row) => row.token || row.queueNumber);
    assert.equal(dentistTokens.includes("Y-001"), false);
  }

  const todayAppointment = (
    await db.query(`SELECT * FROM patient_portal_appointments WHERE id = $1`, [todayBooked])
  ).rows[0];
  const client = await db.connect();
  let todayToken;
  try {
    await client.query("BEGIN");
    const checkIn = await staffCheckIn.performStaffCheckIn(client, {
      appointment: todayAppointment,
      staff: { id: staffId, role: "staff" },
      notifyClinicStaff: async () => {},
      notifyClinicDentists: async () => {},
      checkInMethod: "manual",
      branchId: mainId,
      patientId,
    });
    assert.equal(Boolean(checkIn.alreadyCheckedIn), false, JSON.stringify(checkIn));
    todayToken = checkIn.queueEntry.token;
    assert.ok(todayToken);
    const duplicate = await staffCheckIn.performStaffCheckIn(client, {
      appointment: { ...todayAppointment, status: "checked_in" },
      staff: { id: staffId, role: "staff" },
      notifyClinicStaff: async () => {},
      notifyClinicDentists: async () => {},
      checkInMethod: "manual",
      branchId: mainId,
      patientId,
    });
    assert.equal(duplicate.alreadyCheckedIn, true);
    assert.equal(duplicate.queueEntry.token, todayToken);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const liveDash = await api("GET", "/api/patient/dashboard", { id: patientId, role: "patient" });
  assert.equal(liveDash.json.queue.token, todayToken);
  assert.notEqual(liveDash.json.queue.token, "Y-001");

  const liveQueue = await api("GET", "/api/patient/queue", { id: patientId, role: "patient" });
  assert.equal(liveQueue.json.current.token, todayToken);
  assert.equal(liveQueue.json.current.visitType, "booked");

  const appointments = await api("GET", "/api/patient/appointments", { id: patientId, role: "patient" });
  const staleCard = appointments.json.appointments.find((row) => Number(row.id) === Number(staleWalkIn));
  assert.equal(staleCard.visitType, "walk_in");
  assert.equal(staleCard.status, "checked_in");
  const todayCard = appointments.json.appointments.find((row) => Number(row.id) === Number(todayBooked));
  assert.equal(todayCard.status, "checked_in");
  assert.equal(todayCard.visitType, "booked");
  const completedCard = appointments.json.appointments.find((row) => Number(row.id) === Number(completedPast));
  assert.equal(completedCard.status, "completed");
  const cancelledCard = appointments.json.appointments.find((row) => Number(row.id) === Number(cancelledPast));
  assert.equal(cancelledCard.status, "cancelled");

  await db.query(
    `UPDATE patient_portal_queue_entries
     SET status = 'not_served', closed_operating_date = $2::date
     WHERE appointment_id = $1`,
    [staleWalkIn, yesterdayDate]
  );
  const afterClose = await api("GET", "/api/patient/appointments", { id: patientId, role: "patient" });
  const overlay = afterClose.json.appointments.find((row) => Number(row.id) === Number(staleWalkIn));
  assert.equal(overlay.statusLabel, "Not served");
  assert.equal(overlay.canCancel, false);

  const switched = await api("GET", "/api/patient/dashboard", { id: otherPatientId, role: "patient" });
  assert.equal(switched.json.queue, null);

  const job = createUnproceededAppointmentCancelJob({ db });
  const beforeSix = await job.runOnce(new Date(`${today}T09:00:00+08:00`));
  assert.equal(beforeSix.error, undefined, beforeSix.error);
  const stillOpen = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [futureBooked]);
  assert.equal(stillOpen.rows[0].status, "confirmed");
  const todayStill = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [todayBooked]);
  assert.equal(todayStill.rows[0].status, "checked_in");

  const missedId = await book({
    userId: otherPatientId,
    date: today,
    time: "08:00",
    status: "confirmed",
    service: "Dental Cleaning / Oral Prophylaxis",
    notes: null,
    branchId: mainId,
  });
  const morning = await job.runOnce(new Date(`${today}T17:59:00+08:00`));
  const missedMorning = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [missedId]);
  assert.equal(missedMorning.rows[0].status, "confirmed");
  assert.equal(morning.noShows, 0);

  const evening = await job.runOnce(new Date(`${today}T18:00:00+08:00`));
  const missedEvening = await db.query(`SELECT status, cancellation_reason FROM patient_portal_appointments WHERE id = $1`, [
    missedId,
  ]);
  assert.equal(missedEvening.rows[0].status, "no_show");
  assert.equal(missedEvening.rows[0].cancellation_reason, AUTO_REASON);
  assert.ok((evening.ids || []).map(String).includes(String(missedId)));

  const again = await job.runOnce(new Date(`${today}T18:05:00+08:00`));
  assert.equal(again.noShows, 0);

  const notices = await db.query(
    `SELECT title FROM patient_portal_notifications WHERE entity_id = $1`,
    [String(missedId)]
  );
  assert.equal(notices.rows.filter((row) => row.title === NO_SHOW_TITLE).length, 1);
  await notifyAgainSafe(job, today, missedId, db, NO_SHOW_TITLE);

  const restart = await job.runOnce(new Date(`${today}T19:00:00+08:00`));
  assert.equal(restart.noShows, 0);

  const otherBranch = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [otherBranchToday]);
  assert.ok(["confirmed", "no_show"].includes(otherBranch.rows[0].status));

  const futureAfter = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [futureBooked]);
  assert.equal(futureAfter.rows[0].status, "confirmed");
  const checkedAfter = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [todayBooked]);
  assert.equal(checkedAfter.rows[0].status, "checked_in");
});

async function notifyAgainSafe(job, today, missedId, db, title) {
  await job.runOnce(new Date(`${today}T18:10:00+08:00`));
  const notices = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_notifications WHERE entity_id = $1 AND title = $2`,
    [String(missedId), title]
  );
  assert.equal(notices.rows[0].count, 1);
}
