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

test("missed appointments cancel after the clinic cutoff and update the branch calendar", async (t) => {
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
    PENDING_CANCEL_REASON,
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
  const pastPatient = await addPatient("Past", "past.missed@example.test");
  const futurePatient = await addPatient("Future", "future.missed@example.test");
  const dateOnlyPatient = await addPatient("Dana", "dana.missed@example.test");
  const checkedPatient = await addPatient("Rico", "rico.missed@example.test");
  const pasigPatient = await addPatient("Paz", "paz.missed@example.test");

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const mandaluyongId = main.rows[0].id;
  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000022', FALSE, 'active')
     RETURNING id`
  );
  const pasigId = pasig.rows[0].id;

  async function book({ userId, date, time, status, branchId }) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', 'dr-ada', 'Dr. Ada',
         $2::date, $3, 'self_pay', 500, $4, $5
       ) RETURNING id`,
      [String(userId), date, time, status, branchId]
    );
    return result.rows[0].id;
  }

  const pastId = await book({
    userId: pastPatient,
    date: "2026-10-29",
    time: "10:00",
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
    time: "11:00",
    status: "confirmed",
    branchId: pasigId,
  });
  const pendingTodayId = await book({
    userId: futurePatient,
    date: "2026-10-29",
    time: "13:00",
    status: "pending",
    branchId: mandaluyongId,
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

  const job = createUnproceededAppointmentCancelJob({ db });
  const beforeSix = await job.runOnce(new Date("2026-10-29T03:30:00.000Z"));
  assert.equal(beforeSix.error, undefined, beforeSix.error);
  const afterMorning = await db.query(
    `SELECT id, status FROM patient_portal_appointments WHERE id = ANY($1::bigint[])`,
    [[pastId, futureId, dateOnlyId, checkedId, pasigPastId, pendingTodayId]]
  );
  const byId = Object.fromEntries(afterMorning.rows.map((row) => [String(row.id), row.status]));
  assert.equal(byId[String(pastId)], "confirmed");
  assert.equal(byId[String(pasigPastId)], "confirmed");
  assert.equal(byId[String(futureId)], "pending");
  assert.equal(byId[String(pendingTodayId)], "pending");
  assert.equal(byId[String(dateOnlyId)], "confirmed");
  assert.equal(byId[String(checkedId)], "checked_in");

  const retry = await job.runOnce(new Date("2026-10-29T09:59:00.000Z"));
  assert.equal(retry.cancelled, 0);
  assert.equal(retry.noShows, 0);

  const month = await adminGet(`/api/admin/clinic-schedule?year=2026&month=10&branchId=${mandaluyongId}`);
  assert.equal(month.status, 200, JSON.stringify(month.body));
  const dayCell = month.body.days.find((day) => day.date === "2026-10-29");
  assert.equal(dayCell.bookedCount, 4);
  assert.equal(dayCell.hasBookings, true);

  const atSix = await job.runOnce(new Date("2026-10-29T10:00:00.000Z"));
  assert.ok((atSix.ids || []).map(String).includes(String(pastId)));
  assert.ok((atSix.ids || []).map(String).includes(String(dateOnlyId)));
  const dateOnlyRow = await db.query(`SELECT status, cancellation_reason FROM patient_portal_appointments WHERE id = $1`, [
    dateOnlyId,
  ]);
  assert.equal(dateOnlyRow.rows[0].status, "no_show");
  assert.equal(dateOnlyRow.rows[0].cancellation_reason, AUTO_REASON);
  const pastRow = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [pastId]);
  assert.equal(pastRow.rows[0].status, "no_show");
  const futureStill = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [futureId]);
  assert.equal(futureStill.rows[0].status, "pending");
  const pendingToday = await db.query(
    `SELECT status, cancellation_reason FROM patient_portal_appointments WHERE id = $1`,
    [pendingTodayId]
  );
  assert.equal(pendingToday.rows[0].status, "cancelled");
  assert.equal(pendingToday.rows[0].cancellation_reason, PENDING_CANCEL_REASON);
  assert.ok((atSix.ids || []).map(String).includes(String(pendingTodayId)));
  assert.equal(atSix.cancelled, 1);
  const checkedStill = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [checkedId]);
  assert.equal(checkedStill.rows[0].status, "checked_in");
  const again = await job.runOnce(new Date("2026-10-29T10:05:00.000Z"));
  assert.equal(again.noShows, 0);
  assert.equal(again.cancelled, 0);

  const afterDateOnly = await adminGet(`/api/admin/clinic-schedule?year=2026&month=10&branchId=${mandaluyongId}`);
  assert.equal(afterDateOnly.body.days.find((day) => day.date === "2026-10-29").bookedCount, 1);

  const detail = await adminGet(`/api/admin/clinic-schedule/day?date=2026-10-29&branchId=${mandaluyongId}`);
  const cancelled = detail.body.appointments.find((row) => Number(row.id) === Number(pastId));
  assert.equal(cancelled.status, "no_show");
  const checked = detail.body.appointments.find((row) => Number(row.id) === Number(checkedId));
  assert.equal(checked.status, "checked_in");
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
