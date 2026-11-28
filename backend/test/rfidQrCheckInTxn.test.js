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

const dbName = `ds_rfid_qr_txn_${process.pid}_${Date.now().toString(36)}`;
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

test("RFID/QR check-in recovers from missing visit_origin and stays atomic", { timeout: 120000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const branchCheckIn = require("../services/branchCheckIn");
  const rfidDesk = require("../services/rfidDeskCheckIn");
  const staffWalkInQr = require("../services/staffWalkInQr");
  const staffRfidEvents = require("../services/staffRfidEvents");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
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
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS branch_id INTEGER;
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
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);

  const main = await db.query(`SELECT id, name FROM clinic_branches WHERE is_main`);
  const mainId = main.rows[0].id;
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
       VALUES ($1, 'Txn', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', $5, 'Regular')
       RETURNING id`,
      [first, email, `09${String(30000000 + userSeq)}`, role, rfid]
    );
    return result.rows[0].id;
  }

  const dentistUser = await addUser("dentist", "dr.txn@example.test", "Sarah");
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-sarah-cruz')`,
    [String(dentistUser)]
  );
  const staffUser = await addUser("staff", "staff.txn@example.test", "Minda");
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4)`, [
    dentistUser,
    mainId,
    staffUser,
    mainId,
  ]);

  const qrBeforeSchema = await staffWalkInQr.createWalkInQrSession(db, {
    staffId: staffUser,
    branchId: mainId,
    ttlSeconds: 600,
  });
  assert.ok(qrBeforeSchema.token);
  assert.equal(qrBeforeSchema.branchId, mainId);

  const bookedBeforePatient = await addUser("patient", "booked.before@example.test", "BookedBefore", "TXNDEADBEEF00");
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'cleaning', 'Cleaning', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, '09:00'::time, 'self_pay', 500, 'confirmed', $2
     )`,
    [String(bookedBeforePatient), mainId]
  );
  const bookedBefore = await rfidDesk.checkInByRfidTag(db, { rfidTag: "TXNDEADBEEF00" });
  assert.equal(bookedBefore.ok, true, JSON.stringify(bookedBefore));
  assert.equal(bookedBefore.payload.walkInCreated, false);

  const missingColumnPatient = await addUser("patient", "missing.origin@example.test", "Origin", "TXNDEADBEEF01");
  const setupFail = await rfidDesk.checkInByRfidTag(db, { rfidTag: "TXNDEADBEEF01" });
  assert.equal(setupFail.ok, false, JSON.stringify(setupFail));
  assert.equal(setupFail.status, 503);
  assert.equal(setupFail.code, "SETUP_REQUIRED");
  assert.equal(
    setupFail.message,
    "Check-in is temporarily unavailable. Contact an administrator to complete setup."
  );
  assert.doesNotMatch(String(setupFail.message), /066_appointment_visit_origin/);
  assert.doesNotMatch(String(setupFail.message), /aborted/);
  const leaked = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_appointments WHERE user_id = $1`,
    [String(missingColumnPatient)]
  );
  assert.equal(leaked.rows[0].count, 0);
  const leakedQueue = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1`,
    [String(missingColumnPatient)]
  );
  assert.equal(leakedQueue.rows[0].count, 0);

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "066_appointment_visit_origin.sql"), "utf8"));

  const recovered = await rfidDesk.checkInByRfidTag(db, { rfidTag: "TXNDEADBEEF01" });
  assert.equal(recovered.ok, true, JSON.stringify(recovered));
  assert.equal(recovered.status, 201);
  assert.equal(recovered.payload.walkInCreated, true);
  const originRow = await db.query(
    `SELECT visit_origin FROM patient_portal_appointments WHERE user_id = $1`,
    [String(missingColumnPatient)]
  );
  assert.equal(originRow.rows[0].visit_origin, "walk_in");

  const unassigned = await rfidDesk.checkInByRfidTag(db, { rfidTag: "FFFFFFFFFFFF" });
  assert.equal(unassigned.ok, false);
  assert.equal(unassigned.status, 404);
  assert.equal(unassigned.errorCode, "RFID_UNASSIGNED");

  const bookedPatient = await addUser("patient", "booked.txn@example.test", "Booked", "TXNDEADBEEF02");
  const clock = await db.query(
    `SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date::text AS clinic_today,
            TO_CHAR((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila'), 'HH24:MI') AS clinic_time`
  );
  const availability = await patientBranchBooking.availabilityForBranch(db, {
    date: clock.rows[0].clinic_today,
    branchId: mainId,
  });
  const openTimes = availability.slots
    .filter((slot) => slot.bookable && slot.time >= clock.rows[0].clinic_time)
    .map((slot) => slot.time);
  assert.ok(openTimes.length >= 2, `need remaining slots, got ${openTimes.length}`);
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id, visit_origin
     ) VALUES (
       $1, 'cleaning', 'Cleaning', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2::time, 'self_pay', 500, 'confirmed', $3, 'booked'
     )`,
    [String(bookedPatient), openTimes[0], mainId]
  );
  const bookedCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "TXNDEADBEEF02" });
  assert.equal(bookedCheck.ok, true, JSON.stringify(bookedCheck));
  assert.equal(bookedCheck.payload.walkInCreated, false);
  const bookedOrigin = await db.query(
    `SELECT visit_origin FROM patient_portal_appointments WHERE user_id = $1`,
    [String(bookedPatient)]
  );
  assert.equal(bookedOrigin.rows[0].visit_origin, "booked");

  const qrPatient = await addUser("patient", "qr.txn@example.test", "Qrista", "TXNDEADBEEF03");
  const qrSession = await staffWalkInQr.createWalkInQrSession(db, {
    staffId: staffUser,
    branchId: mainId,
    ttlSeconds: 600,
  });
  const invalidPublic = await staffWalkInQr.findValidWalkInQrSession(db, "not-a-real-token-value-xxx");
  assert.equal(invalidPublic.status, "invalid");
  await db.query(`UPDATE staff_walkin_qr_sessions SET expires_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [
    qrSession.id,
  ]);
  const expired = await staffWalkInQr.findValidWalkInQrSession(db, qrSession.token);
  assert.equal(expired.status, "expired");
  await db.query(`UPDATE staff_walkin_qr_sessions SET expires_at = CURRENT_TIMESTAMP + INTERVAL '10 minutes' WHERE id = $1`, [
    qrSession.id,
  ]);

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} })
  );
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db,
      authenticateToken,
      notifyStaff: async () => {},
      notifyAdmin: async () => {},
      notifyDentist: async () => {},
    })
  );
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  async function request(method, urlPath, { token, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: "http://127.0.0.1:5173",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const qrRedeem = await request("POST", "/api/patient/walk-in-check-in", {
    token: tokenFor(qrPatient, "patient"),
    body: { token: qrSession.token },
  });
  assert.equal(qrRedeem.status, 201, JSON.stringify(qrRedeem.body));
  assert.equal(qrRedeem.body.alreadyCheckedIn, false);
  const qrRepeat = await request("POST", "/api/patient/walk-in-check-in", {
    token: tokenFor(qrPatient, "patient"),
    body: { token: qrSession.token },
  });
  assert.equal(qrRepeat.status, 200, JSON.stringify(qrRepeat.body));
  assert.equal(qrRepeat.body.alreadyCheckedIn, true);
  assert.equal(qrRepeat.body.queue.id, qrRedeem.body.queue.id);

  const dualPatient = await addUser("patient", "dual.txn@example.test", "Dual", "TXNDEADBEEF04");
  const dualSession = await staffWalkInQr.createWalkInQrSession(db, {
    staffId: staffUser,
    branchId: mainId,
    ttlSeconds: 600,
  });
  const raced = await Promise.all([
    rfidDesk.checkInByRfidTag(db, { rfidTag: "TXNDEADBEEF04" }),
    request("POST", "/api/patient/walk-in-check-in", {
      token: tokenFor(dualPatient, "patient"),
      body: { token: dualSession.token },
    }),
  ]);
  const rfidResult = raced[0];
  const qrResult = raced[1];
  const rfidOk = rfidResult.ok === true;
  const qrOk = qrResult.status === 200 || qrResult.status === 201;
  assert.equal(rfidOk && qrOk, true, JSON.stringify(raced));
  const already = [rfidResult.status === 200, qrResult.body.alreadyCheckedIn === true].filter(Boolean).length;
  assert.ok(already >= 1, "one of the simultaneous RFID/QR requests must reuse the visit");
  const dualQueue = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_queue_entries WHERE user_id = $1 AND status NOT IN ('completed', 'no_show')`,
    [String(dualPatient)]
  );
  assert.equal(dualQueue.rows[0].count, 1);

  const staffToken = tokenFor(staffUser, "staff");
  const log = await request("GET", "/api/staff/check-ins?range=today", { token: staffToken });
  assert.equal(log.status, 200, JSON.stringify(log.body));
  const names = (log.body.checkIns || []).map((row) => row.patientName);
  assert.ok(names.some((name) => /Origin/i.test(name)));
  assert.ok(names.some((name) => /Booked/i.test(name)));
  assert.ok(names.some((name) => /Qrista/i.test(name)));

  const queue = await request("GET", "/api/staff/queue", { token: staffToken });
  assert.equal(queue.status, 200);
  const tokens = (queue.body.queue || []).map((row) => row.token || row.queue?.token);
  assert.ok(tokens.includes(recovered.payload.queue.token));
  assert.ok(tokens.includes(bookedCheck.payload.queue.token));
  assert.ok(tokens.includes(qrRedeem.body.queue.token));
});
