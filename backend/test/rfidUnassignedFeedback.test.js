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

const dbName = `ds_rfid_unassigned_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || "Asia/Manila";
process.env.RFID_DEVICE_SECRET = process.env.RFID_DEVICE_SECRET || "synthetic-reader-secret";

test("ESP32 RFID firmware is unchanged for unassigned-card feedback", () => {
  const sketch = fs.readFileSync(
    path.join(__dirname, "../../firmware/esp32-rfid-checkin/esp32-rfid-checkin.ino"),
    "utf8"
  );
  assert.match(sketch, /#define DEVICE_KEY/);
  assert.match(sketch, /X-RFID-Device-Key/);
  assert.match(sketch, /\/api\/public\/rfid-check-in/);
  assert.doesNotMatch(sketch, /RFID_UNASSIGNED/);
  assert.doesNotMatch(sketch, /walk-in slot/i);
});

test("unassigned RFID cards fail before walk-in slots and reach the reader branch Staff page", async (t) => {
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
  const staffRfidEvents = require("../services/staffRfidEvents");
  const rfidScanErrors = require("../services/rfidScanErrors");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { registerPublicRfidRoutes } = require("../routes/publicRfid");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  staffRfidEvents.resetRfidEvents();
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
  async function addUser(role, email, first, rfid = null, status = "Active") {
    userSeq += 1;
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Card', $2, $3, 'synthetic-hash', $4, TRUE, $6, $5, 'Regular')
       RETURNING id`,
      [first, email, `09${String(20000000 + userSeq)}`, role, rfid, status]
    );
    return result.rows[0].id;
  }

  const dentistUser = await addUser("dentist", "dr.unassigned@example.test", "Sarah");
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-sarah-cruz')`,
    [String(dentistUser)]
  );
  const staffUser = await addUser("staff", "staff.unassigned@example.test", "Minda");
  const pasigStaff = await addUser("staff", "pasig.unassigned@example.test", "Pia");
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

  async function counts() {
    const appointments = await db.query(`SELECT COUNT(*)::int AS count FROM patient_portal_appointments`);
    const queue = await db.query(`SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries`);
    return { appointments: appointments.rows[0].count, queue: queue.rows[0].count };
  }

  const openTimes = await remainingTimes();
  assert.ok(openTimes.length >= 2, `need remaining clinic slots, got ${openTimes.length}`);

  const bookedPatient = await addUser("patient", "booked.unassigned@example.test", "Booked", "AABBCCDDEE21");
  const reservedTime = openTimes[0];
  const bookedAppointment = await book(bookedPatient, mainId, reservedTime);
  const walkInPatient = await addUser("patient", "walkin.unassigned@example.test", "Walker", "AABBCCDDEE22");
  const closedWalkIn = await addUser("patient", "closed.walkin@example.test", "AfterHours", "AABBCCDDEE23");
  const inactivePatient = await addUser("patient", "inactive.rfid@example.test", "Inactive", "AABBCCDDEE24", "Inactive");
  const otherBranchPatient = await addUser("patient", "other.unassigned@example.test", "Elsewhere", "AABBCCDDEE25");
  await book(otherBranchPatient, pasigId, reservedTime, "dr-james-reyes");

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} })
  );
  registerPublicRfidRoutes(app, {
    db,
    notifyActiveStaff() {},
    notifyDentists() {},
  });
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  async function request(method, urlPath, { token, headers, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(headers || {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const staffToken = tokenFor(staffUser, "staff");
  const pasigToken = tokenFor(pasigStaff, "staff");
  const beforeUnassigned = await counts();

  const unassignedOpen = await rfidDesk.checkInByRfidTag(db, { rfidTag: "DE:AD:BE:EF" });
  assert.equal(unassignedOpen.ok, false);
  assert.equal(unassignedOpen.status, 404);
  assert.equal(unassignedOpen.errorCode, rfidScanErrors.RFID_ERROR_CODES.UNASSIGNED);
  assert.equal(unassignedOpen.message, rfidScanErrors.RFID_UNASSIGNED_MESSAGE);
  assert.deepEqual(await counts(), beforeUnassigned);

  const publicUnassigned = await request("POST", "/api/public/rfid-check-in", {
    headers: { "X-RFID-Device-Key": process.env.RFID_DEVICE_SECRET },
    body: { uid: "CAFEBABE" },
  });
  assert.equal(publicUnassigned.status, 404);
  assert.equal(publicUnassigned.body.errorCode, "RFID_UNASSIGNED");
  assert.equal(publicUnassigned.body.message, rfidScanErrors.RFID_UNASSIGNED_MESSAGE);

  const mainEvents = await request("GET", "/api/staff/rfid-events", { token: staffToken });
  const pasigEvents = await request("GET", "/api/staff/rfid-events", { token: pasigToken });
  assert.equal(mainEvents.status, 200);
  assert.ok(mainEvents.body.events.some((event) => event.errorCode === "RFID_UNASSIGNED"));
  assert.equal(mainEvents.body.latest.errorCode, "RFID_UNASSIGNED");
  assert.equal(mainEvents.body.latest.message, rfidScanErrors.RFID_UNASSIGNED_MESSAGE);
  assert.equal(
    pasigEvents.body.events.some((event) => event.errorCode === "RFID_UNASSIGNED"),
    false
  );

  const inactive = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE24" });
  assert.equal(inactive.ok, false);
  assert.equal(inactive.status, 403);
  assert.equal(inactive.errorCode, rfidScanErrors.RFID_ERROR_CODES.INACTIVE);
  assert.equal(inactive.message, rfidScanErrors.RFID_INACTIVE_MESSAGE);
  const inactiveQueue = await db.query(`SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1`, [
    String(inactivePatient),
  ]);
  assert.equal(inactiveQueue.rows[0].count, 0);

  const bookedCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AA:BB:CC:DD:EE:21" });
  assert.equal(bookedCheck.ok, true, JSON.stringify(bookedCheck));
  assert.equal(bookedCheck.payload.walkInCreated, false);
  assert.equal(Number(bookedCheck.payload.appointment.id), Number(bookedAppointment.id));

  const walkInCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE22" });
  assert.equal(walkInCheck.ok, true, JSON.stringify(walkInCheck));
  assert.equal(walkInCheck.payload.walkInCreated, true);

  const repeat = await rfidDesk.checkInByRfidTag(db, { rfidTag: "aabbccddee22" });
  assert.equal(repeat.ok, true);
  assert.equal(repeat.status, 200);
  assert.match(String(repeat.payload.message), /already checked in/i);
  const walkInCopies = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1 AND status NOT IN ('completed', 'no_show')`,
    [String(walkInPatient)]
  );
  assert.equal(walkInCopies.rows[0].count, 1);

  const otherBranch = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE25" });
  assert.equal(otherBranch.ok, false);
  assert.equal(otherBranch.status, 409);
  assert.equal(otherBranch.errorCode, rfidScanErrors.RFID_ERROR_CODES.WRONG_BRANCH);
  assert.match(String(otherBranch.message), /staffed desk/i);

  await db.query(
    `UPDATE clinic_schedule_days
     SET mode = 'closed', open_time = NULL, close_time = NULL
     WHERE branch_id = $1 AND schedule_date = (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date`,
    [mainId]
  );

  const unassignedClosed = await rfidDesk.checkInByRfidTag(db, { rfidTag: "DEADBEEF" });
  assert.equal(unassignedClosed.errorCode, rfidScanErrors.RFID_ERROR_CODES.UNASSIGNED);
  assert.equal(unassignedClosed.message, rfidScanErrors.RFID_UNASSIGNED_MESSAGE);
  assert.notEqual(unassignedClosed.message, staffCheckIn.NO_WALK_IN_SLOTS_MESSAGE);

  const afterClose = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE23" });
  assert.equal(afterClose.ok, false);
  assert.equal(afterClose.status, 409);
  assert.equal(afterClose.errorCode, rfidScanErrors.RFID_ERROR_CODES.NO_WALK_IN_SLOT);
  assert.equal(afterClose.message, staffCheckIn.NO_WALK_IN_SLOTS_MESSAGE);
  const closedQueue = await db.query(`SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1`, [
    String(closedWalkIn),
  ]);
  assert.equal(closedQueue.rows[0].count, 0);

  const latestMain = await request("GET", "/api/staff/rfid-events", { token: staffToken });
  assert.equal(latestMain.body.latest.errorCode, rfidScanErrors.RFID_ERROR_CODES.NO_WALK_IN_SLOT);
  assert.equal(latestMain.body.latest.message, staffCheckIn.NO_WALK_IN_SLOTS_MESSAGE);
  const unassignedStillListed = latestMain.body.events.find((event) => event.rfidTag === "DEADBEEF");
  assert.equal(unassignedStillListed.errorCode, "RFID_UNASSIGNED");

  const pasigAfter = await request("GET", "/api/staff/rfid-events", { token: pasigToken });
  assert.equal(pasigAfter.body.events.length, 0);

  const codes = new Set(latestMain.body.events.map((event) => event.errorCode).filter(Boolean));
  assert.ok(codes.has("RFID_UNASSIGNED"));
  assert.ok(codes.has("RFID_INACTIVE"));
  assert.ok(codes.has("RFID_WRONG_BRANCH"));
  assert.ok(codes.has("RFID_NO_WALK_IN_SLOT"));
});
