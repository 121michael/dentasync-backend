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

const dbName = `ds_dentist_bookings_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "127.0.0.1",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
}

test("dentist dashboard and queue show booked patients until check-in, scoped to branch", async (t) => {
  await adminPool.query(`SELECT current_database()`);
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  const connected = await db.query(`SELECT current_database() AS name`);
  assert.equal(connected.rows[0].name, dbName);

  await db.query(sqlFile("000_create_users.sql"));
  await db.query(sqlFile("002_create_patient_portal.sql"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS check_in_method TEXT;
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT
    );
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
  await db.query(sqlFile("006_create_dentist_portal.sql"));
  await db.query(sqlFile("026_queue_wait_estimates.sql")).catch(() => {});
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const mandaluyongId = main.rows[0].id;
  const taguig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, email, is_main, status)
     VALUES ('BR-0002', 'Taguig', 'Synthetic Taguig', '09170002222', 'taguig@example.test', FALSE, 'active')
     RETURNING id`
  );
  const taguigId = taguig.rows[0].id;

  async function addUser(role, email, first, last) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, $2, $3, $4, 'synthetic-hash', $5, TRUE, 'Active')
       RETURNING id`,
      [first, last, email, `09${String(Math.floor(Math.random() * 1e8)).padStart(9, "0")}`, role]
    );
    return result.rows[0].id;
  }

  const bookedPatient = await addUser("patient", "ava.book@example.test", "Ava", "Booked");
  const dateOnlyPatient = await addUser("patient", "ben.date@example.test", "Ben", "Dateonly");
  const cancelledPatient = await addUser("patient", "cara.cancel@example.test", "Cara", "Cancelled");
  const otherBranchPatient = await addUser("patient", "dex.other@example.test", "Dex", "Other");
  const dentistA = await addUser("dentist", "dana.book@example.test", "Dana", "Mandaluyong");
  const dentistB = await addUser("dentist", "ellen.other@example.test", "Ellen", "Taguig");

  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4)`,
    [dentistA, mandaluyongId, dentistB, taguigId]
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id)
     VALUES ($1, 'dr-dana-book'), ($2, 'dr-ellen-other')`,
    [String(dentistA), String(dentistB)]
  );

  const today = await db.query(`SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Manila')::date AS day`);
  const clinicDay = today.rows[0].day;

  async function book({ userId, dentistId, dentistName, branchId, time, status }) {
    const result = await db.query(
      `INSERT INTO patient_portal_appointments (
         user_id, service_id, service_name, dentist_id, dentist_name,
         appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
       ) VALUES (
         $1, 'cleaning', 'Cleaning', $2, $3,
         $4::date, $5, 'self_pay', 800, $6, $7
       ) RETURNING id`,
      [String(userId), dentistId, dentistName, clinicDay, time, status, branchId]
    );
    return result.rows[0].id;
  }

  const avaId = await book({
    userId: bookedPatient,
    dentistId: "dr-dana-book",
    dentistName: "Dr. Dana Mandaluyong",
    branchId: mandaluyongId,
    time: "09:00",
    status: "confirmed",
  });
  const benId = await book({
    userId: dateOnlyPatient,
    dentistId: "dr-dana-book",
    dentistName: "Dr. Dana Mandaluyong",
    branchId: mandaluyongId,
    time: null,
    status: "confirmed",
  });
  const caraId = await book({
    userId: cancelledPatient,
    dentistId: "dr-dana-book",
    dentistName: "Dr. Dana Mandaluyong",
    branchId: mandaluyongId,
    time: "11:00",
    status: "cancelled",
  });
  await book({
    userId: otherBranchPatient,
    dentistId: "dr-ellen-other",
    dentistName: "Dr. Ellen Taguig",
    branchId: taguigId,
    time: "10:00",
    status: "confirmed",
  });

  const app = express();
  app.use(express.json());
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenA = jwt.sign({ id: String(dentistA), role: "dentist" }, jwtSecret, { expiresIn: "1h" });
  const tokenB = jwt.sign({ id: String(dentistB), role: "dentist" }, jwtSecret, { expiresIn: "1h" });

  async function request(method, urlPath, token) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: { authorization: `Bearer ${token}` },
    });
    const body = await response.json();
    return { status: response.status, body };
  }

  const dashboard = await request("GET", "/api/dentist/dashboard", tokenA);
  assert.equal(dashboard.status, 200, JSON.stringify(dashboard.body));
  assert.equal(dashboard.body.metrics.todaysTarget, dashboard.body.todayBookings.length);
  assert.equal(dashboard.body.todayBookings.length, 2);
  const names = dashboard.body.todayBookings.map((row) => row.patientName);
  assert.ok(names.includes("Ava Booked"));
  assert.ok(names.includes("Ben Dateonly"));
  assert.equal(names.includes("Cara Cancelled"), false);
  assert.equal(names.includes("Dex Other"), false);
  const ava = dashboard.body.todayBookings.find((row) => row.patientName === "Ava Booked");
  const ben = dashboard.body.todayBookings.find((row) => row.patientName === "Ben Dateonly");
  assert.equal(ava.checkedIn, false);
  assert.equal(Boolean(ava.dateOnly), false);
  assert.equal(ben.dateOnly, true);
  assert.equal(ben.time, null);

  const bookedTab = await request("GET", "/api/dentist/queue?tab=booked", tokenA);
  assert.equal(bookedTab.status, 200, JSON.stringify(bookedTab.body));
  assert.equal(bookedTab.body.counts.booked, bookedTab.body.bookedNotCheckedIn.length);
  assert.equal(bookedTab.body.bookedNotCheckedIn.length, 2);
  assert.equal(bookedTab.body.queue.length, 0);
  assert.deepEqual(
    bookedTab.body.bookedNotCheckedIn.map((row) => row.patientName).sort(),
    ["Ava Booked", "Ben Dateonly"]
  );

  const inlineBefore = await request("GET", "/api/dentist/queue?tab=inline", tokenA);
  assert.equal(inlineBefore.body.counts.inline, 0);
  assert.equal(inlineBefore.body.queue.length, 0);
  assert.equal(inlineBefore.body.counts.booked, 2);

  await db.query(
    `INSERT INTO patient_portal_queue_entries (
       user_id, appointment_id, token, position, status, estimated_wait_minutes, checked_in_at
     ) VALUES ($1, $2, 'P-AVA', 1, 'waiting', 12, CURRENT_TIMESTAMP)`,
    [String(bookedPatient), avaId]
  );

  const dashboardAfter = await request("GET", "/api/dentist/dashboard", tokenA);
  assert.equal(dashboardAfter.body.metrics.todaysTarget, dashboardAfter.body.todayBookings.length);
  assert.equal(dashboardAfter.body.todayBookings.length, 2);
  const avaAfter = dashboardAfter.body.todayBookings.find((row) => row.patientName === "Ava Booked");
  assert.equal(avaAfter.checkedIn, true);

  const bookedAfter = await request("GET", "/api/dentist/queue?tab=booked", tokenA);
  assert.equal(bookedAfter.body.counts.booked, bookedAfter.body.bookedNotCheckedIn.length);
  assert.equal(bookedAfter.body.bookedNotCheckedIn.length, 1);
  assert.equal(bookedAfter.body.bookedNotCheckedIn[0].patientName, "Ben Dateonly");
  assert.equal(
    bookedAfter.body.bookedNotCheckedIn.some((row) => row.patientName === "Ava Booked"),
    false
  );

  const inlineAfter = await request("GET", "/api/dentist/queue?tab=inline", tokenA);
  assert.equal(inlineAfter.body.counts.inline, inlineAfter.body.queue.length);
  assert.equal(inlineAfter.body.queue.length, 1);
  assert.equal(inlineAfter.body.queue[0].patientName, "Ava Booked");
  assert.equal(inlineAfter.body.counts.booked, 1);

  const otherDashboard = await request("GET", "/api/dentist/dashboard", tokenB);
  assert.equal(otherDashboard.status, 200, JSON.stringify(otherDashboard.body));
  assert.equal(otherDashboard.body.metrics.todaysTarget, otherDashboard.body.todayBookings.length);
  assert.equal(otherDashboard.body.todayBookings.length, 1);
  assert.equal(otherDashboard.body.todayBookings[0].patientName, "Dex Other");
  assert.equal(
    otherDashboard.body.todayBookings.some((row) => row.patientName === "Ava Booked"),
    false
  );

  const history = await request("GET", "/api/dentist/appointments", tokenA);
  assert.equal(history.status, 200);
  const historyNames = (history.body.todayAppointments || []).map((row) => row.patientName);
  assert.ok(historyNames.includes("Cara Cancelled"));
  void caraId;
  void benId;
});
