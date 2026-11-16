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

const dbName = `ds_cal_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("admin calendar lists appointments for the selected branch only", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
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
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);

  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.cal@example.test', '09170002001', 'synthetic-hash', 'admin', TRUE, 'Active')
     RETURNING id`
  );
  const mina = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Mina', 'Mandaluyong', 'mina.cal@example.test', '09170002002', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const paz = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Paz', 'Pasig', 'paz.cal@example.test', '09170002003', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const dana = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Dana', 'Dateonly', 'dana.cal@example.test', '09170002004', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);
  const mandaluyongId = main.rows[0].id;
  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000002', FALSE, 'active')
     RETURNING id`
  );
  const pasigId = pasig.rows[0].id;
  await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0003', 'Closed Desk', 'Synthetic inactive', '09180000003', FALSE, 'inactive')`
  );

  const bookDate = "2099-03-02";
  const mandaluyongAppt = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES ($1, 'cleaning', 'Cleaning', 'dr-ada', 'Dr. Ada', $2::date, '10:00', 'self_pay', 500, 'confirmed', $3)
     RETURNING id`,
    [String(mina.rows[0].id), bookDate, mandaluyongId]
  );
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES ($1, 'cleaning', 'Cleaning', 'dr-bea', 'Dr. Bea', $2::date, '11:00', 'self_pay', 500, 'confirmed', $3)`,
    [String(paz.rows[0].id), bookDate, pasigId]
  );
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES ($1, 'cleaning', 'Cleaning', 'dr-ada', 'Dr. Ada', $2::date, NULL, 'self_pay', 500, 'confirmed', $3)`,
    [String(dana.rows[0].id), bookDate, mandaluyongId]
  );

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const token = jwt.sign({ id: String(admin.rows[0].id), role: "admin" }, jwtSecret, { expiresIn: "1h" });

  async function request(method, urlPath, body) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const month = await request("GET", "/api/admin/clinic-schedule?year=2099&month=3");
  assert.equal(month.status, 200, JSON.stringify(month.body));
  assert.equal(month.body.branch?.name, "Mandaluyong");
  assert.equal(month.body.branch?.isMain, true);
  const names = (month.body.branches || []).map((row) => row.name);
  assert.ok(names.includes("Mandaluyong"));
  assert.ok(names.includes("Pasig"));
  assert.ok(names.includes("Closed Desk"));
  const inactive = month.body.branches.find((row) => row.name === "Closed Desk");
  assert.equal(inactive.inactive, true);
  assert.equal(inactive.status, "inactive");
  const bookedDay = month.body.days.find((day) => day.date === bookDate);
  assert.equal(bookedDay.hasBookings, true);
  assert.equal(bookedDay.bookedCount, 2);

  const pasigMonth = await request(
    "GET",
    `/api/admin/clinic-schedule?year=2099&month=3&branchId=${pasigId}`
  );
  assert.equal(pasigMonth.status, 200);
  assert.equal(pasigMonth.body.branch?.name, "Pasig");
  const pasigDay = pasigMonth.body.days.find((day) => day.date === bookDate);
  assert.equal(pasigDay.bookedCount, 1);
  assert.equal(pasigDay.hasBookings, true);

  const mandaluyongDay = await request(
    "GET",
    `/api/admin/clinic-schedule/day?date=${bookDate}&branchId=${mandaluyongId}`
  );
  assert.equal(mandaluyongDay.status, 200);
  assert.deepEqual(
    mandaluyongDay.body.appointments.map((row) => row.patientName).sort(),
    ["Dana Dateonly", "Mina Mandaluyong"]
  );
  const dateOnly = mandaluyongDay.body.appointments.find((row) => row.patientName === "Dana Dateonly");
  assert.equal(dateOnly.time, null);
  assert.equal(dateOnly.status, "confirmed");

  const pasigDetail = await request(
    "GET",
    `/api/admin/clinic-schedule/day?date=${bookDate}&branchId=${pasigId}`
  );
  assert.equal(pasigDetail.status, 200);
  assert.equal(pasigDetail.body.appointments.length, 1);
  assert.equal(pasigDetail.body.appointments[0].patientName, "Paz Pasig");

  await db.query(`UPDATE patient_portal_appointments SET status = 'checked_in' WHERE id = $1`, [
    mandaluyongAppt.rows[0].id,
  ]);
  const afterCheckIn = await request(
    "GET",
    `/api/admin/clinic-schedule/day?date=${bookDate}&branchId=${mandaluyongId}`
  );
  assert.equal(afterCheckIn.status, 200);
  assert.equal(afterCheckIn.body.appointments.length, 2);
  const checked = afterCheckIn.body.appointments.find((row) => row.id === mandaluyongAppt.rows[0].id);
  assert.equal(checked.status, "checked_in");
  const copies = await db.query(
    `SELECT COUNT(*)::int AS count FROM patient_portal_appointments
     WHERE user_id = $1 AND appointment_date = $2::date AND branch_id = $3`,
    [String(mina.rows[0].id), bookDate, mandaluyongId]
  );
  assert.equal(copies.rows[0].count, 1);

  const savePasig = await request("PUT", "/api/admin/clinic-schedule/day", {
    date: bookDate,
    branchId: String(pasigId),
    mode: "custom",
    isHoliday: false,
    openTime: "08:00",
    closeTime: "12:00",
  });
  assert.equal(savePasig.status, 200, JSON.stringify(savePasig.body));
  assert.match(String(savePasig.body.message || ""), /Pasig/);
  assert.equal(savePasig.body.hours.open, "08:00");

  const pasigAfter = await request(
    "GET",
    `/api/admin/clinic-schedule/day?date=${bookDate}&branchId=${pasigId}`
  );
  assert.equal(pasigAfter.body.hours.open, "08:00");
  const mandaluyongAfter = await request(
    "GET",
    `/api/admin/clinic-schedule/day?date=${bookDate}&branchId=${mandaluyongId}`
  );
  assert.notEqual(mandaluyongAfter.body.hours.open, "08:00");
  assert.equal(mandaluyongAfter.body.hours.source, "weekday");

  const invalid = await request("GET", "/api/admin/clinic-schedule?year=2099&month=3&branchId=99999");
  assert.equal(invalid.status, 400);
});
