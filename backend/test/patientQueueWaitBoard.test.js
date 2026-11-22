"use strict";

const assert = require("node:assert/strict");
const fs = require("fs");
const http = require("http");
const path = require("path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const envPath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

function assertLocalPostgresOnly() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) throw new Error("DATABASE_URL must be unset for local disposable PostgreSQL tests.");
  const host = String(process.env.DB_HOST || "localhost").trim();
  if (!["localhost", "127.0.0.1"].includes(host)) throw new Error(`Refusing non-local DB_HOST ${host}`);
  if (!String(process.env.DB_USER || "").trim()) throw new Error("DB_USER is required.");
}

assertLocalPostgresOnly();

const dbName = `ds_qwait_${process.pid}_${Date.now().toString(36)}`;
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

test("Patient queue board estimates wait per dentist without leaking other names", { timeout: 90000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const { recalculateQueueWaitEstimates, invalidateDurationStatsCache } = require("../services/queueWaitPrediction");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "002_create_patient_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "005_create_admin_portal.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE patient_portal_appointments ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    ALTER TABLE patient_portal_queue_entries ADD COLUMN IF NOT EXISTS branch_id BIGINT;
    ALTER TABLE patient_portal_profiles ADD COLUMN IF NOT EXISTS hmo_verified_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS clinic_service_durations (
      service_id TEXT PRIMARY KEY,
      service_name TEXT,
      default_duration_minutes INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS clinic_patient_records (
      id BIGSERIAL PRIMARY KEY,
      record_code TEXT,
      first_name TEXT,
      last_name TEXT
    );
    CREATE TABLE IF NOT EXISTS clinic_patient_treatments (
      id BIGSERIAL PRIMARY KEY,
      clinical_record_id BIGINT,
      treatment TEXT,
      status TEXT,
      duration_minutes INTEGER,
      queue_entry_id BIGINT,
      appointment_id BIGINT,
      visit_sequence INTEGER,
      started_at TIMESTAMPTZ
    );
  `);
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "026_queue_wait_estimates.sql"), "utf8"));
  await db.query(
    `INSERT INTO clinic_service_durations (service_id, service_name, default_duration_minutes)
     VALUES ('cleaning', 'Cleaning', 20), ('filling', 'Filling', 40)
     ON CONFLICT (service_id) DO NOTHING`
  );
  await db.query(
    `INSERT INTO admin_portal_settings (setting_key, setting_value)
     VALUES ('ai', '{"amethystAiEnabled": true, "waitingTimePrediction": true}'::jsonb)
     ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`
  );

  async function addUser(first, last, email, phone) {
    const row = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, $2, $3, $4, 'hash', 'patient', TRUE, 'Active')
       RETURNING id`,
      [first, last, email, phone]
    );
    return String(row.rows[0].id);
  }

  const nico = await addUser("Nico", "Wait", "nico.wait@example.test", "09170006001");
  const remy = await addUser("Remy", "Lane", "remy.lane@example.test", "09170006002");
  const lila = await addUser("Lila", "Other", "lila.other@example.test", "09170006003");
  const otherBranchPatient = await addUser("Omar", "Branch", "omar.branch@example.test", "09170006004");

  async function addVisit({ userId, token, dentistId, service, time, status, position, branchId, duration }) {
    const appt = await db.query(
      `INSERT INTO patient_portal_appointments
        (user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id)
       VALUES ($1, $2, $3, $4, 'Dr Test', CURRENT_DATE, $5, 'self_pay', 1000, 'checked_in', $6)
       RETURNING id`,
      [userId, service, service === "cleaning" ? "Cleaning" : "Filling", dentistId, time, branchId]
    );
    const queue = await db.query(
      `INSERT INTO patient_portal_queue_entries
        (user_id, appointment_id, token, position, status, estimated_wait_minutes, branch_id)
       VALUES ($1, $2, $3, $4, $5, 0, $6)
       RETURNING id`,
      [userId, appt.rows[0].id, token, position, status, branchId]
    );
    if (duration) {
      const record = await db.query(
        `INSERT INTO clinic_patient_records (record_code, first_name, last_name) VALUES ($1, 'Synth', 'Record') RETURNING id`,
        [`CR-${token}`]
      );
      await db.query(
        `INSERT INTO clinic_patient_treatments (clinical_record_id, treatment, status, duration_minutes, queue_entry_id, appointment_id, visit_sequence)
         VALUES ($1, $2, $3, $4, $5, $6, 1)`,
        [
          record.rows[0].id,
          service === "cleaning" ? "Cleaning" : "Filling",
          status === "dentist" ? "in_progress" : "planned",
          duration,
          queue.rows[0].id,
          appt.rows[0].id,
        ]
      );
    }
    return { appointmentId: appt.rows[0].id, queueId: queue.rows[0].id };
  }

  await addVisit({
    userId: nico,
    token: "A-101",
    dentistId: "d1",
    service: "cleaning",
    time: "09:00",
    status: "dentist",
    position: 1,
    branchId: 1,
    duration: 20,
  });
  await addVisit({
    userId: remy,
    token: "A-102",
    dentistId: "d1",
    service: "cleaning",
    time: "09:20",
    status: "waiting",
    position: 2,
    branchId: 1,
    duration: 20,
  });
  await addVisit({
    userId: lila,
    token: "A-201",
    dentistId: "d2",
    service: "filling",
    time: "09:10",
    status: "waiting",
    position: 3,
    branchId: 1,
    duration: 40,
  });
  await addVisit({
    userId: otherBranchPatient,
    token: "B-001",
    dentistId: "d1",
    service: "cleaning",
    time: "10:00",
    status: "waiting",
    position: 1,
    branchId: 2,
    duration: 20,
  });

  invalidateDurationStatsCache();
  const recalculated = await recalculateQueueWaitEstimates(db, { branchId: 1 });
  assert.equal(recalculated.ok, true);

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/patient", createPatientPortalRouter({ db, authenticateToken, jwtSecret, notifyStaff: async () => {} }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function asUser(userId, urlPath) {
    const token = jwt.sign({ id: String(userId), role: "patient" }, jwtSecret, { expiresIn: "1h" });
    const response = await fetch(`${base}${urlPath}`, { headers: { authorization: `Bearer ${token}` } });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  const dashboard = await asUser(remy, "/api/patient/dashboard");
  assert.equal(dashboard.status, 200, dashboard.json.message);
  const board = dashboard.json.queueBoard.entries;
  assert.ok(board.some((row) => row.token === "A-102" && row.isCurrentPatient));
  assert.ok(board.some((row) => row.token === "A-101"));
  assert.ok(board.some((row) => row.token === "A-201"));
  assert.equal(board.some((row) => row.token === "B-001"), false);
  const leaked = JSON.stringify(dashboard.json.queueBoard);
  assert.equal(leaked.includes("Nico"), false);
  assert.equal(leaked.includes("nico.wait@example.test"), false);
  assert.equal(leaked.includes("Remy"), false);
  assert.equal(leaked.includes("Cleaning"), false);

  const remyRow = board.find((row) => row.token === "A-102");
  assert.equal(remyRow.waitEstimate?.unavailable, false);
  assert.ok(remyRow.waitEstimate.estimatedWaitMinutes.min >= 18);
  assert.ok(remyRow.waitEstimate.estimatedWaitMinutes.max <= 25);

  const lilaRow = board.find((row) => row.token === "A-201");
  assert.equal(lilaRow.waitEstimate?.unavailable, false);
  assert.equal(lilaRow.waitEstimate.estimatedWaitMinutes.min, 0);

  const queuePage = await asUser(remy, "/api/patient/queue");
  assert.equal(queuePage.status, 200);
  const queueRemy = queuePage.json.queue.find((row) => row.token === "A-102");
  assert.equal(
    queueRemy.waitEstimate.estimatedWaitMinutes.min,
    remyRow.waitEstimate.estimatedWaitMinutes.min
  );

  await db.query(`UPDATE patient_portal_queue_entries SET status = 'completed' WHERE token = 'A-101'`);
  invalidateDurationStatsCache();
  await recalculateQueueWaitEstimates(db, { branchId: 1 });
  const afterComplete = await asUser(remy, "/api/patient/queue");
  const remyAfter = afterComplete.json.queue.find((row) => row.token === "A-102");
  assert.equal(remyAfter.waitEstimate.estimatedWaitMinutes.min, 0);

  const empty = await asUser(
    (
      await db.query(
        `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
         VALUES ('Empty', 'Queue', 'empty.queue@example.test', '09170006009', 'hash', 'patient', TRUE, 'Active')
         RETURNING id`
      )
    ).rows[0].id,
    "/api/patient/dashboard"
  );
  assert.equal(empty.json.queue, null);
  assert.deepEqual(empty.json.queueBoard.entries, []);
});
