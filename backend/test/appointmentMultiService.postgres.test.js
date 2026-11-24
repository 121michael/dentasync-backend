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
process.env.DB_USER = process.env.DB_USER || "postgres";
process.env.DB_PASSWORD = process.env.DB_PASSWORD || "postgres";
process.env.DB_HOST = process.env.DB_HOST || "localhost";
process.env.DB_PORT = process.env.DB_PORT || "5432";
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-disposable-jwt-secret";

const dbName = `ds_multi_svc_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

function futureMonday() {
  const date = new Date(Date.UTC(2099, 0, 5));
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("one appointment can hold up to three services and reserves consecutive slots", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "002_create_patient_portal.sql"), "utf8"));
  await db.query(`
    CREATE TABLE IF NOT EXISTS admin_portal_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
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
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "031_clinic_schedule.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "042_appointment_lifecycle.sql"), "utf8"));
  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);
  await patientBranchBooking.applyPatientBranchBookingSchema(db);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "064_appointment_booking_services.sql"), "utf8"));

  const main = await db.query(`SELECT id FROM clinic_branches WHERE is_main`);
  const patient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Multi', 'Book', 'multi.book@example.test', '09170004001', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const other = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Other', 'Book', 'other.book@example.test', '09170004002', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const dentist = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Dee', 'Book', 'dee.multi@example.test', '09170004003', 'synthetic-hash', 'dentist', TRUE, 'Active')
     RETURNING id`
  );
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-dee-multi')`,
    [String(dentist.rows[0].id)]
  );
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)`, [
    dentist.rows[0].id,
    main.rows[0].id,
  ]);

  const day = futureMonday();
  const app = express();
  app.use(express.json());
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
  const tokenFor = (id) => jwt.sign({ id: String(id), role: "patient" }, jwtSecret, { expiresIn: "1h" });
  async function request(method, urlPath, { token, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const token = tokenFor(patient.rows[0].id);
  const tooMany = await request("POST", "/api/patient/appointments", {
    token,
    body: {
      serviceIds: ["cleaning", "filling", "whitening", "extraction"],
      appointmentDate: day,
      appointmentTime: "09:00",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(tooMany.status, 400);

  const booked = await request("POST", "/api/patient/appointments", {
    token,
    body: {
      serviceIds: ["cleaning", "filling"],
      appointmentDate: day,
      appointmentTime: "09:00",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(booked.status, 201, JSON.stringify(booked.body));
  assert.match(booked.body.appointment.treatment, /Dental Cleaning/);
  assert.match(booked.body.appointment.treatment, /Permanent Filling/);
  assert.equal(booked.body.appointment.services.length, 2);
  assert.equal(booked.body.appointment.durationMinutes, 90);

  const stored = await db.query(
    `SELECT duration_minutes,
            (SELECT COUNT(*)::int FROM patient_portal_appointment_services WHERE appointment_id = $1) AS count
     FROM patient_portal_appointments WHERE id = $1`,
    [booked.body.appointment.id]
  );
  assert.equal(stored.rows[0].count, 2);
  assert.equal(Number(stored.rows[0].duration_minutes), 90);

  const tickets = await db.query(`SELECT COUNT(*)::int AS count FROM patient_portal_appointments WHERE appointment_date = $1::date`, [
    day,
  ]);
  assert.equal(tickets.rows[0].count, 1);

  const overlap = await request("POST", "/api/patient/appointments", {
    token: tokenFor(other.rows[0].id),
    body: {
      serviceId: "general-consultation",
      appointmentDate: day,
      appointmentTime: "09:30",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(overlap.status, 409);

  const later = await request("POST", "/api/patient/appointments", {
    token: tokenFor(other.rows[0].id),
    body: {
      serviceId: "general-consultation",
      appointmentDate: day,
      appointmentTime: "10:30",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(later.status, 201, JSON.stringify(later.body));

  const availability = await request(
    "GET",
    `/api/patient/availability?date=${day}&branchId=${main.rows[0].id}&durationMinutes=90`,
    { token }
  );
  assert.equal(availability.status, 200);
  assert.equal(availability.body.availableTimes.includes("09:00"), false);
  assert.equal(availability.body.availableTimes.includes("09:30"), false);
});
