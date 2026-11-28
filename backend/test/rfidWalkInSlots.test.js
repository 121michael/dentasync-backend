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

const dbName = `ds_rfid_walkin_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "Asia/Manila";

test("ESP32 RFID firmware is unchanged for walk-in slot assignment", () => {
  const sketch = fs.readFileSync(
    path.join(__dirname, "../../firmware/esp32-rfid-checkin/esp32-rfid-checkin.ino"),
    "utf8"
  );
  assert.match(sketch, /#define DEVICE_KEY/);
  assert.match(sketch, /X-RFID-Device-Key/);
  assert.match(sketch, /\/api\/public\/rfid-check-in/);
  assert.doesNotMatch(sketch, /walk-in slot/i);
  assert.doesNotMatch(sketch, /branchId/);
});

test("RFID walk-in claims the earliest remaining clinic slot", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const branchCheckIn = require("../services/branchCheckIn");
  const rfidDesk = require("../services/rfidDeskCheckIn");
  const staffCheckIn = require("../services/staffCheckIn");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
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
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS rfid_tag TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS admin_portal_settings (setting_key TEXT PRIMARY KEY, setting_value JSONB);
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT
    );
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (id BIGSERIAL PRIMARY KEY, clinical_record_id BIGINT, treatment TEXT);
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "066_appointment_visit_origin.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);

  const main = await db.query(`SELECT id, name FROM clinic_branches WHERE is_main`);
  const mainId = main.rows[0].id;
  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000002', FALSE, 'active', FALSE, TRUE)
     RETURNING id`
  );
  const pasigId = pasig.rows[0].id;

  await db.query(
    `INSERT INTO clinic_schedule_days (branch_id, schedule_date, mode, open_time, close_time)
     VALUES ($1, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, 'custom', '00:00', '23:59')
     ON CONFLICT (branch_id, schedule_date) DO UPDATE
       SET mode = 'custom', open_time = '00:00', close_time = '23:59'`,
    [mainId]
  );

  let userSeq = 0;
  async function addUser(role, email, first, rfid = null) {
    userSeq += 1;
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Walkin', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', $5, 'Regular')
       RETURNING id`,
      [first, email, `09${String(10000000 + userSeq)}`, role, rfid]
    );
    return result.rows[0].id;
  }

  const dentistUser = await addUser("dentist", "dr.walkin@example.test", "Sarah");
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-sarah-cruz')`,
    [String(dentistUser)]
  );
  const staffUser = await addUser("staff", "staff.walkin@example.test", "Minda");
  const pasigStaff = await addUser("staff", "pasig.walkin@example.test", "Pia");
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4), ($5, $6)`, [
    dentistUser,
    mainId,
    staffUser,
    mainId,
    pasigStaff,
    pasigId,
  ]);

  async function clinicClock() {
    const result = await db.query(
      `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date::text AS clinic_today,
              TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), 'HH24:MI') AS clinic_time`
    );
    return result.rows[0];
  }

  async function remainingTimes() {
    const clock = await clinicClock();
    const availability = await patientBranchBooking.availabilityForBranch(db, {
      date: clock.clinic_today,
      branchId: mainId,
    });
    return availability.slots.filter((slot) => slot.bookable && slot.time >= clock.clinic_time).map((slot) => slot.time);
  }

  async function book(userId, branchId, time, dentistId = "dr-sarah-cruz") {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $4, 'Dr. Sarah Cruz',
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2::time, 'self_pay', 500, 'confirmed', $3
       ) RETURNING id, appointment_time`,
      [String(userId), time, branchId, dentistId]
    );
    return result.rows[0];
  }

  const openTimes = await remainingTimes();
  assert.ok(openTimes.length >= 3, `need remaining clinic slots for walk-in tests, got ${openTimes.length}`);

  const bookedPatient = await addUser("patient", "booked.rfid@example.test", "Booked", "AABBCCDDEE11");
  const reservedTime = openTimes[0];
  const bookedAppointment = await book(bookedPatient, mainId, reservedTime);

  const walkInPatient = await addUser("patient", "walkin.rfid@example.test", "Walker", "AABBCCDDEE12");
  const fullPatient = await addUser("patient", "full.rfid@example.test", "Fuller", "AABBCCDDEE13");
  const raceA = await addUser("patient", "race.a@example.test", "RacerA", "AABBCCDDEE14");
  const raceB = await addUser("patient", "race.b@example.test", "RacerB", "AABBCCDDEE15");
  const otherBranchPatient = await addUser("patient", "other.branch@example.test", "Elsewhere", "AABBCCDDEE16");
  await book(otherBranchPatient, pasigId, reservedTime, "dr-james-reyes");

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  async function request(method, urlPath, { token } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const bookedCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AA:BB:CC:DD:EE:11" });
  assert.equal(bookedCheck.ok, true, JSON.stringify(bookedCheck));
  assert.equal(bookedCheck.status, 201);
  assert.equal(bookedCheck.payload.walkInCreated, false);
  assert.equal(Number(bookedCheck.payload.appointment.id), Number(bookedAppointment.id));
  assert.equal(String(bookedCheck.payload.appointment.time).slice(0, 5), reservedTime);

  const walkInCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE12" });
  assert.equal(walkInCheck.ok, true, JSON.stringify(walkInCheck));
  assert.equal(walkInCheck.status, 201);
  assert.equal(walkInCheck.payload.walkInCreated, true);
  assert.equal(walkInCheck.payload.appointment.service, "Walk-in Consultation");
  const assignedTime = String(walkInCheck.payload.appointment.time).slice(0, 5);
  assert.equal(assignedTime, openTimes[1]);
  assert.notEqual(assignedTime, reservedTime);
  assert.match(String(walkInCheck.payload.message), /Walk-in patient checked in successfully/i);

  const repeat = await rfidDesk.checkInByRfidTag(db, { rfidTag: "aabbccddee12" });
  assert.equal(repeat.ok, true, JSON.stringify(repeat));
  assert.equal(repeat.status, 200);
  assert.equal(repeat.payload.queue.id, walkInCheck.payload.queue.id);
  assert.match(String(repeat.payload.message), /already checked in/i);
  const walkInCopies = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM patient_portal_queue_entries
     WHERE user_id = $1 AND status NOT IN ('completed', 'no_show')`,
    [String(walkInPatient)]
  );
  assert.equal(walkInCopies.rows[0].count, 1);

  const otherBranch = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE16" });
  assert.equal(otherBranch.ok, false);
  assert.equal(otherBranch.status, 409);
  assert.match(String(otherBranch.message), /staffed desk/i);
  const otherQueue = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1`,
    [String(otherBranchPatient)]
  );
  assert.equal(otherQueue.rows[0].count, 0);

  const staffToken = tokenFor(staffUser, "staff");
  const pasigToken = tokenFor(pasigStaff, "staff");
  const log = await request("GET", "/api/staff/check-ins?range=today", { token: staffToken });
  assert.equal(log.status, 200, JSON.stringify(log.body));
  const logNames = (log.body.checkIns || []).map((row) => row.patientName);
  assert.ok(logNames.some((name) => /Walker/i.test(name)));
  assert.ok(logNames.some((name) => /Booked/i.test(name)));
  const walkInLog = (log.body.checkIns || []).find((row) => /Walker/i.test(row.patientName));
  assert.equal(walkInLog.checkInMethod, "rfid");
  assert.equal(String(walkInLog.appointment.time).slice(0, 5), assignedTime);

  const pasigLog = await request("GET", "/api/staff/check-ins?range=today", { token: pasigToken });
  assert.equal(pasigLog.status, 200);
  assert.equal((pasigLog.body.checkIns || []).some((row) => /Walker/i.test(row.patientName)), false);

  const queue = await request("GET", "/api/staff/queue", { token: staffToken });
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  const waiting = (queue.body.queue || []).filter((row) => row.status !== "completed" && row.status !== "no_show");
  const bookedIndex = waiting.findIndex((row) => String(row.appointment?.time || "").startsWith(reservedTime));
  const walkInIndex = waiting.findIndex((row) => String(row.appointment?.time || "").startsWith(assignedTime));
  assert.ok(bookedIndex >= 0 && walkInIndex >= 0);
  assert.ok(bookedIndex < walkInIndex, "scheduled slot stays ahead of the later walk-in slot");

  const pasigQueue = await request("GET", "/api/staff/queue", { token: pasigToken });
  assert.equal(
    (pasigQueue.body.queue || []).some((row) => String(row.queue?.token || row.token) === walkInCheck.payload.queue.token),
    false
  );

  const afterWalkIn = await remainingTimes();
  assert.ok(afterWalkIn.length >= 1, "need a last remaining slot for the race");
  const lastSlot = afterWalkIn[afterWalkIn.length - 1];
  for (const time of afterWalkIn.slice(0, -1)) {
    const filler = await addUser("patient", `fill.${time.replace(":", "")}@example.test`, `Fill${time.replace(":", "")}`);
    await book(filler, mainId, time, `dr-fill-${time.replace(":", "")}`);
  }

  const raced = await Promise.all([
    rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE14" }),
    rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE15" }),
  ]);
  const winners = raced.filter((item) => item.ok);
  const losers = raced.filter((item) => !item.ok);
  assert.equal(winners.length, 1, JSON.stringify(raced));
  assert.equal(losers.length, 1, JSON.stringify(raced));
  assert.equal(losers[0].status, 409);
  assert.equal(losers[0].message, staffCheckIn.NO_WALK_IN_SLOTS_MESSAGE);
  assert.equal(String(winners[0].payload.appointment.time).slice(0, 5), lastSlot);
  const raceQueue = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM patient_portal_queue_entries
     WHERE user_id = ANY($1::text[]) AND status NOT IN ('completed', 'no_show')`,
    [[String(raceA), String(raceB)]]
  );
  assert.equal(raceQueue.rows[0].count, 1);
  const raceAppointments = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM patient_portal_appointments
     WHERE user_id = ANY($1::text[]) AND LOWER(status) NOT IN ('cancelled', 'no_show')`,
    [[String(raceA), String(raceB)]]
  );
  assert.equal(raceAppointments.rows[0].count, 1);

  const noneLeft = await remainingTimes();
  assert.equal(noneLeft.length, 0);
  const fullCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE13" });
  assert.equal(fullCheck.ok, false, JSON.stringify(fullCheck));
  assert.equal(fullCheck.status, 409);
  assert.equal(fullCheck.message, staffCheckIn.NO_WALK_IN_SLOTS_MESSAGE);
  const fullQueue = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1`,
    [String(fullPatient)]
  );
  assert.equal(fullQueue.rows[0].count, 0);
  const fullAppointments = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_appointments WHERE user_id = $1`,
    [String(fullPatient)]
  );
  assert.equal(fullAppointments.rows[0].count, 0);
});
