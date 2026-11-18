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

const dbName = `ds_missed_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("missed appointments become no-shows after 6 PM Manila and update the branch calendar", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const {
    createUnproceededAppointmentCancelJob,
    AUTO_REASON,
    NOTICE_TITLE,
  } = require("../services/unproceededAppointmentCancelJob");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  const identity = await db.query(`SELECT current_database() AS name`);
  assert.equal(identity.rows[0].name, dbName);

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "002_create_patient_portal.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS admin_portal_settings (setting_key TEXT PRIMARY KEY, setting_value JSONB);
    CREATE TABLE IF NOT EXISTS clinic_daily_queue_counters (
      clinic_date DATE NOT NULL,
      prefix TEXT NOT NULL,
      last_sequence INTEGER NOT NULL,
      PRIMARY KEY (clinic_date, prefix)
    );
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT,
      treatment TEXT
    );
    ALTER TABLE patient_portal_notifications
      ADD COLUMN IF NOT EXISTS entity_type TEXT,
      ADD COLUMN IF NOT EXISTS entity_id TEXT;
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "042_appointment_lifecycle.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);

  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.missed@example.test', '09170003001', 'synthetic-hash', 'admin', TRUE, 'Active')
     RETURNING id`
  );
  async function addPatient(first, email) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Missed', $2, $3, 'synthetic-hash', 'patient', TRUE, 'Active')
       RETURNING id`,
      [first, email, `09${Math.floor(Math.random() * 1e8)}`]
    );
    return result.rows[0].id;
  }
  const onePmPatient = await addPatient("Ava", "ava.missed@example.test");
  const futurePatient = await addPatient("Future", "future.missed@example.test");
  const dateOnlyPatient = await addPatient("Dana", "dana.missed@example.test");
  const checkedPatient = await addPatient("Rico", "rico.missed@example.test");
  const pasigPatient = await addPatient("Paz", "paz.missed@example.test");
  const eveningPatient = await addPatient("Eve", "eve.missed@example.test");
  const manualPatient = await addPatient("Max", "max.missed@example.test");

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const mandaluyongId = main.rows[0].id;
  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000022', FALSE, 'active')
     RETURNING id`
  );
  const pasigId = pasig.rows[0].id;

  async function book({ userId, date, time, status, branchId, reason = null, cancelledBy = null }) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id,
         cancellation_reason, cancelled_by
       ) VALUES (
         $1, 'cleaning', 'Cleaning', 'dr-ada', 'Dr. Ada',
         $2::date, $3, 'self_pay', 500, $4, $5, $6, $7
       ) RETURNING id`,
      [String(userId), date, time, status, branchId, reason, cancelledBy]
    );
    return result.rows[0].id;
  }

  const onePmId = await book({
    userId: onePmPatient,
    date: "2026-10-29",
    time: "13:00",
    status: "confirmed",
    branchId: mandaluyongId,
  });
  const futureId = await book({
    userId: futurePatient,
    date: "2026-11-02",
    time: "16:00",
    status: "pending",
    branchId: mandaluyongId,
  });
  const dateOnlyId = await book({
    userId: dateOnlyPatient,
    date: "2026-10-29",
    time: null,
    status: "confirmed",
    branchId: mandaluyongId,
  });
  const checkedId = await book({
    userId: checkedPatient,
    date: "2026-10-29",
    time: "09:00",
    status: "checked_in",
    branchId: mandaluyongId,
  });
  const pasigPastId = await book({
    userId: pasigPatient,
    date: "2026-10-29",
    time: "14:00",
    status: "confirmed",
    branchId: pasigId,
  });
  const eveningId = await book({
    userId: eveningPatient,
    date: "2026-10-29",
    time: "19:00",
    status: "confirmed",
    branchId: mandaluyongId,
  });
  const manualId = await book({
    userId: manualPatient,
    date: "2026-10-29",
    time: "11:00",
    status: "cancelled",
    branchId: mandaluyongId,
    reason: "patient_request",
    cancelledBy: "staff",
  });

  await db.query(
    `INSERT INTO patient_portal_queue_entries (user_id, appointment_id, token, position, status)
     VALUES ($1, $2, 'Q-RICO', 1, 'waiting')`,
    [String(checkedPatient), checkedId]
  ).catch(async () => {
    await db.query(
      `INSERT INTO patient_portal_queue_entries (user_id, appointment_id, token, position, status, estimated_wait_minutes)
       VALUES ($1, $2, 'Q-RICO', 1, 'waiting', 0)`,
      [String(checkedPatient), checkedId]
    );
  });

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const token = jwt.sign({ id: String(admin.rows[0].id), role: "admin" }, jwtSecret, { expiresIn: "1h" });
  async function adminGet(urlPath) {
    const response = await fetch(`${base}${urlPath}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return { status: response.status, body: await response.json() };
  }

  async function statuses() {
    const result = await db.query(
      `SELECT id, status, cancellation_reason, cancelled_by FROM patient_portal_appointments WHERE id = ANY($1::bigint[])`,
      [[onePmId, futureId, dateOnlyId, checkedId, pasigPastId, eveningId, manualId]]
    );
    return Object.fromEntries(result.rows.map((row) => [String(row.id), row]));
  }

  const job = createUnproceededAppointmentCancelJob({ db });
  const at559 = await job.runOnce(new Date("2026-10-29T09:59:00.000Z"));
  assert.equal(at559.error, undefined, at559.error);
  assert.equal(at559.cancelled, 0);
  const beforeCutoff = await statuses();
  assert.equal(beforeCutoff[String(onePmId)].status, "confirmed");
  assert.equal(beforeCutoff[String(dateOnlyId)].status, "confirmed");
  assert.equal(beforeCutoff[String(pasigPastId)].status, "confirmed");
  assert.equal(beforeCutoff[String(eveningId)].status, "confirmed");
  assert.equal(beforeCutoff[String(checkedId)].status, "checked_in");
  assert.equal(beforeCutoff[String(manualId)].status, "cancelled");
  assert.equal(beforeCutoff[String(futureId)].status, "pending");

  const at600 = await job.runOnce(new Date("2026-10-29T10:00:00.000Z"));
  assert.equal(at600.error, undefined, at600.error);
  assert.ok((at600.ids || []).map(String).includes(String(onePmId)));
  assert.ok((at600.ids || []).map(String).includes(String(dateOnlyId)));
  const afterCutoff = await statuses();
  assert.equal(afterCutoff[String(onePmId)].status, "no_show");
  assert.equal(afterCutoff[String(onePmId)].cancellation_reason, AUTO_REASON);
  assert.equal(afterCutoff[String(onePmId)].cancelled_by, "system");
  assert.equal(afterCutoff[String(dateOnlyId)].status, "no_show");
  assert.equal(afterCutoff[String(pasigPastId)].status, "no_show");
  assert.equal(afterCutoff[String(eveningId)].status, "confirmed");
  assert.equal(afterCutoff[String(checkedId)].status, "checked_in");
  assert.equal(afterCutoff[String(manualId)].status, "cancelled");
  assert.equal(afterCutoff[String(manualId)].cancellation_reason, "patient_request");
  assert.equal(afterCutoff[String(futureId)].status, "pending");

  const notices = await db.query(
    `SELECT title, body, entity_id FROM patient_portal_notifications WHERE entity_id = $1`,
    [String(onePmId)]
  );
  assert.equal(notices.rows.length, 1);
  assert.equal(notices.rows[0].title, NOTICE_TITLE);
  assert.match(notices.rows[0].body, /October 29, 2026/);
  assert.doesNotMatch(notices.rows[0].body, /GMT|T16:00:00|00:00:00.000Z/i);
  assert.match(notices.rows[0].body, /No-show because there was no check-in by 6:00 PM/);

  const retry = await job.runOnce(new Date("2026-10-29T10:01:00.000Z"));
  assert.equal(retry.cancelled, 0);
  const noticesAgain = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_notifications WHERE entity_id = $1`,
    [String(onePmId)]
  );
  assert.equal(noticesAgain.rows[0].count, 1);

  const month = await adminGet(`/api/admin/clinic-schedule?year=2026&month=10&branchId=${mandaluyongId}`);
  assert.equal(month.status, 200, JSON.stringify(month.body));
  const dayCell = month.body.days.find((day) => day.date === "2026-10-29");
  assert.equal(dayCell.bookedCount, 2);
  assert.equal(dayCell.hasBookings, true);

  const afterEvening = await job.runOnce(new Date("2026-10-29T11:00:00.000Z"));
  assert.ok((afterEvening.ids || []).map(String).includes(String(eveningId)));
  const eveningRow = await db.query(`SELECT status, cancellation_reason FROM patient_portal_appointments WHERE id = $1`, [
    eveningId,
  ]);
  assert.equal(eveningRow.rows[0].status, "no_show");
  assert.equal(eveningRow.rows[0].cancellation_reason, AUTO_REASON);
  const checkedStill = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [checkedId]);
  assert.equal(checkedStill.rows[0].status, "checked_in");

  const afterDateOnly = await adminGet(`/api/admin/clinic-schedule?year=2026&month=10&branchId=${mandaluyongId}`);
  assert.equal(afterDateOnly.body.days.find((day) => day.date === "2026-10-29").bookedCount, 1);

  const detail = await adminGet(`/api/admin/clinic-schedule/day?date=2026-10-29&branchId=${mandaluyongId}`);
  const autoNoShow = detail.body.appointments.find((row) => Number(row.id) === Number(onePmId));
  assert.equal(autoNoShow.status, "no_show");
  const checked = detail.body.appointments.find((row) => Number(row.id) === Number(checkedId));
  assert.equal(checked.status, "checked_in");
  const manual = detail.body.appointments.find((row) => Number(row.id) === Number(manualId));
  assert.equal(manual.status, "cancelled");
  assert.equal(
    detail.body.appointments.some((row) => Number(row.id) === Number(pasigPastId)),
    false
  );

  await db.query(`UPDATE patient_portal_appointments SET status = 'cancelled' WHERE id = ANY($1::bigint[])`, [
    [futureId, dateOnlyId, checkedId],
  ]);
  const onlyCancelled = await adminGet(`/api/admin/clinic-schedule?year=2026&month=10&branchId=${mandaluyongId}`);
  const emptyDay = onlyCancelled.body.days.find((day) => day.date === "2026-10-29");
  assert.equal(emptyDay.bookedCount, 0);
  assert.equal(emptyDay.hasBookings, false);

  const pasigMonth = await adminGet(`/api/admin/clinic-schedule?year=2026&month=10&branchId=${pasigId}`);
  const pasigDay = pasigMonth.body.days.find((day) => day.date === "2026-10-29");
  assert.equal(pasigDay.bookedCount, 0);
  const pasigDetail = await adminGet(`/api/admin/clinic-schedule/day?date=2026-10-29&branchId=${pasigId}`);
  assert.equal(pasigDetail.body.appointments[0].status, "no_show");
});
