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

const dbName = `ds_checkin_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("branch check-in and scheduled queue", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const branchCheckIn = require("../services/branchCheckIn");
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
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (id BIGSERIAL PRIMARY KEY, clinical_record_id BIGINT, treatment TEXT);
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await branchCheckIn.applyBranchCheckInSchema(db);

  const main = await db.query(`SELECT id, rfid_enabled, qr_enabled FROM clinic_branches WHERE is_main`);
  assert.equal(main.rows[0].rfid_enabled, true);
  assert.equal(main.rows[0].qr_enabled, true);
  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status, rfid_enabled, qr_enabled)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000002', FALSE, 'active', FALSE, TRUE)
     RETURNING id, rfid_enabled, qr_enabled`
  );
  assert.equal(pasig.rows[0].rfid_enabled, false);
  assert.equal(pasig.rows[0].qr_enabled, true);

  async function addUser(role, email, first, rfid) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, rfid_tag, patient_category)
       VALUES ($1, 'Queue', $2, $3, 'synthetic-hash', $4, TRUE, 'Active', $5, 'Regular')
       RETURNING id`,
      [first, email, `09${Math.floor(Math.random() * 1e8)}`, role, rfid]
    );
    return result.rows[0].id;
  }
  const earlyPatient = await addUser("patient", "early.check@example.test", "Early", "AABBCCDDEE01");
  const latePatient = await addUser("patient", "late.check@example.test", "Late", "AABBCCDDEE02");
  const pasigPatient = await addUser("patient", "pasig.check@example.test", "Paz", null);
  const mandaluyongStaff = await addUser("staff", "m.check@example.test", "Minda", null);
  const pasigStaff = await addUser("staff", "p.check@example.test", "Pia", null);
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4)`, [
    mandaluyongStaff,
    main.rows[0].id,
    pasigStaff,
    pasig.rows[0].id,
  ]);

  async function book(userId, branchId, time, dentistId = "dr-ada") {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $4, 'Dr. Ada',
         (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, $2::time, 'self_pay', 500, 'confirmed', $3
       ) RETURNING id`,
      [String(userId), time, branchId, dentistId]
    );
    return result.rows[0].id;
  }
  const lateAppointment = await book(latePatient, main.rows[0].id, "11:00");
  const earlyAppointment = await book(earlyPatient, main.rows[0].id, "09:00");
  const pasigAppointment = await book(pasigPatient, pasig.rows[0].id, "10:00");
  const dateOnlyPatient = await addUser("patient", "dateonly.check@example.test", "Dana", null);
  const legacy = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES (
       $1, 'cleaning', 'Cleaning', 'dr-ada', 'Dr. Ada',
       (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date, NULL, 'self_pay', 500, 'confirmed', $2
     ) RETURNING id`,
    [String(dateOnlyPatient), main.rows[0].id]
  );

  const app = express();
  app.use(express.json());
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyDentist: async () => {} }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  async function request(method, urlPath, { token, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const mToken = tokenFor(mandaluyongStaff, "staff");
  const pToken = tokenFor(pasigStaff, "staff");
  const laterFirst = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "rfid", rfidTag: "AABBCCDDEE02" },
  });
  assert.equal(laterFirst.status, 201, JSON.stringify(laterFirst.body));
  const laterToken = laterFirst.body.queue.token;
  const earlierSecond = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "qr", appointmentId: earlyAppointment },
  });
  assert.equal(earlierSecond.status, 201, JSON.stringify(earlierSecond.body));
  const earlierToken = earlierSecond.body.queue.token;
  assert.notEqual(earlierToken, laterToken);

  const queue = await request("GET", "/api/staff/queue", { token: mToken });
  const waiting = queue.body.queue.filter((row) => row.status !== "completed" && row.status !== "no_show");
  assert.equal(waiting[0].token, earlierToken);
  assert.equal(waiting[1].token, laterToken);
  assert.equal(waiting[0].appointment.time.slice(0, 5), "09:00");
  assert.equal(waiting[1].token, laterToken);

  await db.query(`UPDATE patient_portal_queue_entries SET status = 'dentist' WHERE appointment_id = $1`, [lateAppointment]);
  const chairBefore = await db.query(
    `SELECT token, position, status FROM patient_portal_queue_entries WHERE appointment_id = $1`,
    [lateAppointment]
  );
  const eightPatient = await addUser("patient", "eight.check@example.test", "Eight", null);
  const eightAppointment = await book(eightPatient, main.rows[0].id, "08:00");
  const eightCheck = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "qr", appointmentId: eightAppointment },
  });
  assert.equal(eightCheck.status, 201, JSON.stringify(eightCheck.body));
  const chairAfter = await db.query(
    `SELECT token, position, status FROM patient_portal_queue_entries WHERE appointment_id = $1`,
    [lateAppointment]
  );
  assert.equal(chairAfter.rows[0].status, "dentist");
  assert.equal(chairAfter.rows[0].token, chairBefore.rows[0].token);
  assert.equal(Number(chairAfter.rows[0].position), Number(chairBefore.rows[0].position));
  await db.query(`UPDATE patient_portal_queue_entries SET status = 'checked_in' WHERE appointment_id = $1`, [lateAppointment]);

  const tieSooner = await addUser("patient", "tie.soon@example.test", "Soon", null);
  const tieLater = await addUser("patient", "tie.late@example.test", "Later", null);
  const soonerAppointment = await book(tieSooner, main.rows[0].id, "12:00", "dr-ada");
  const laterTieAppointment = await book(tieLater, main.rows[0].id, "12:00", "dr-bea");
  await db.query(
    `UPDATE patient_portal_appointments SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1`,
    [soonerAppointment]
  );
  await db.query(
    `UPDATE patient_portal_appointments SET created_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`,
    [laterTieAppointment]
  );
  const tieLateCheck = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "qr", appointmentId: laterTieAppointment },
  });
  const tieSoonCheck = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "rfid", appointmentId: soonerAppointment },
  });
  assert.equal(tieLateCheck.status, 201, JSON.stringify(tieLateCheck.body));
  assert.equal(tieSoonCheck.status, 201, JSON.stringify(tieSoonCheck.body));
  const tieQueue = await request("GET", "/api/staff/queue", { token: mToken });
  const tieRows = tieQueue.body.queue.filter((row) => String(row.appointment?.time || "").startsWith("12:00"));
  assert.equal(tieRows[0].token, tieSoonCheck.body.queue.token);
  assert.equal(tieRows[1].token, tieLateCheck.body.queue.token);

  const duplicate = await Promise.all([
    request("POST", "/api/staff/check-in", { token: mToken, body: { method: "rfid", appointmentId: lateAppointment } }),
    request("POST", "/api/staff/check-in", { token: mToken, body: { method: "qr", appointmentId: lateAppointment } }),
  ]);
  assert.ok(duplicate.every((item) => item.status === 200 || item.status === 201));
  const copies = await db.query(
    `SELECT COUNT(*) AS count FROM patient_portal_queue_entries WHERE appointment_id = $1 AND status NOT IN ('completed', 'no_show')`,
    [lateAppointment]
  );
  assert.equal(Number(copies.rows[0].count), 1);
  const stable = await db.query(`SELECT token FROM patient_portal_queue_entries WHERE appointment_id = $1`, [lateAppointment]);
  assert.equal(stable.rows[0].token, laterToken);

  const pasigRfid = await request("POST", "/api/staff/check-in", {
    token: pToken,
    body: { method: "rfid", appointmentId: pasigAppointment },
  });
  assert.equal(pasigRfid.status, 409);
  assert.match(pasigRfid.body.message, /RFID check-in is turned off/i);

  const wrongDesk = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "qr", appointmentId: pasigAppointment },
  });
  assert.equal(wrongDesk.status, 409);
  assert.match(wrongDesk.body.message, /staffed desk/i);

  const pasigQr = await request("POST", "/api/staff/check-in", {
    token: pToken,
    body: { method: "qr", appointmentId: pasigAppointment },
  });
  assert.equal(pasigQr.status, 201, JSON.stringify(pasigQr.body));
  assert.equal(pasigQr.body.queue.checkInMethod || pasigQr.body.method, "qr");

  const noTime = await request("POST", "/api/staff/check-in", {
    token: mToken,
    body: { method: "qr", appointmentId: legacy.rows[0].id },
  });
  assert.equal(noTime.status, 201, JSON.stringify(noTime.body));
  const keptTime = await db.query(`SELECT appointment_time, branch_id FROM patient_portal_appointments WHERE id = $1`, [
    legacy.rows[0].id,
  ]);
  assert.equal(keptTime.rows[0].appointment_time, null);
  assert.equal(String(keptTime.rows[0].branch_id), String(main.rows[0].id));
  const withDateOnly = await request("GET", "/api/staff/queue", { token: mToken });
  const waitingWithDateOnly = withDateOnly.body.queue.filter(
    (row) => row.status !== "completed" && row.status !== "no_show"
  );
  const dateOnlyToken = noTime.body.queue.token;
  assert.equal(waitingWithDateOnly[waitingWithDateOnly.length - 1].token, dateOnlyToken);
  const nineIndex = waitingWithDateOnly.findIndex((row) => String(row.appointment?.time || "").startsWith("09:00"));
  const elevenIndex = waitingWithDateOnly.findIndex((row) => String(row.appointment?.time || "").startsWith("11:00"));
  const dateOnlyIndex = waitingWithDateOnly.findIndex((row) => row.token === dateOnlyToken);
  assert.ok(nineIndex >= 0 && elevenIndex >= 0);
  assert.ok(nineIndex < elevenIndex);
  assert.ok(elevenIndex < dateOnlyIndex);

  await db.query(`UPDATE patient_portal_queue_entries SET status = 'dentist' WHERE appointment_id = $1`, [pasigAppointment]);
  await db.query(`UPDATE clinic_branches SET status = 'inactive' WHERE id = $1`, [pasig.rows[0].id]);
  const pausedCheckIn = await request("POST", "/api/staff/check-in", {
    token: pToken,
    body: { method: "qr", appointmentId: pasigAppointment },
  });
  assert.equal(pausedCheckIn.status, 409);
  const finish = await request("PATCH", `/api/staff/queue/${pasigQr.body.queue.id}`, {
    token: pToken,
    body: { status: "completed" },
  });
  assert.equal(finish.status, 200, JSON.stringify(finish.body));
  const stillMandaluyong = await request("GET", "/api/staff/queue", { token: mToken });
  assert.equal(stillMandaluyong.status, 200);
  assert.ok(stillMandaluyong.body.queue.some((row) => row.token === earlierToken));

  const rfidDesk = require("../services/rfidDeskCheckIn");
  const readerPatient = await addUser("patient", "reader.check@example.test", "Reader", "AABBCCDDEE03");
  const readerAppointment = await book(readerPatient, main.rows[0].id, "13:00");
  const readerCheck = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE03" });
  assert.equal(readerCheck.status, 201, JSON.stringify(readerCheck.payload || readerCheck));
  const readerBranch = await db.query(
    `SELECT branch_id FROM patient_portal_queue_entries WHERE appointment_id = $1`,
    [readerAppointment]
  );
  assert.equal(Number(readerBranch.rows[0].branch_id), Number(main.rows[0].id));
  const pasigOnly = await addUser("patient", "pasig.rfid@example.test", "PiaCard", "AABBCCDDEE04");
  const pasigOnlyAppointment = await book(pasigOnly, pasig.rows[0].id, "14:00");
  const rejectedReader = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE04" });
  assert.equal(rejectedReader.ok, false);
  const pasigOnlyQueue = await db.query(
    `SELECT id FROM patient_portal_queue_entries WHERE appointment_id = $1`,
    [pasigOnlyAppointment]
  );
  assert.equal(pasigOnlyQueue.rows.length, 0);
  await db.query(`UPDATE clinic_branches SET rfid_enabled = FALSE WHERE id = $1`, [main.rows[0].id]);
  const disabledReader = await rfidDesk.checkInByRfidTag(db, { rfidTag: "AABBCCDDEE03" });
  assert.equal(disabledReader.status, 409);
  assert.match(disabledReader.message, /RFID check-in is turned off/i);
  await db.query(`UPDATE clinic_branches SET rfid_enabled = TRUE WHERE id = $1`, [main.rows[0].id]);

  const board = await branchCheckIn.publicQueueBoard(db, {});
  assert.equal(board.body.clinicName, "Mandaluyong");
  assert.equal(Object.prototype.hasOwnProperty.call(board.body.queue[0] || {}, "procedure"), false);
  const foreign = await db.query(
    `SELECT id FROM patient_portal_queue_entries WHERE appointment_id = $1 AND branch_id = $2`,
    [pasigAppointment, main.rows[0].id]
  );
  assert.equal(foreign.rows.length, 0);
  assert.equal(branchCheckIn.LATE_ARRIVAL_POLICY, "undefined");
});
