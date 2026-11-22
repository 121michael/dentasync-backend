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

const dbName = `ds_remain_${process.pid}_${Date.now().toString(36)}`;
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

test("remaining chair time plus added procedures publish to the patient queue APIs", { timeout: 90000 }, async (t) => {
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
      last_name TEXT,
      linked_user_id TEXT
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

  const chair = await addUser("Cara", "Chair", "cara.chair@example.test", "09170008001");
  const nextPatient = await addUser("Ned", "Next", "ned.next@example.test", "09170008002");
  const laterPatient = await addUser("Lara", "Later", "lara.later@example.test", "09170008003");
  const otherDentistPatient = await addUser("Omar", "Other", "omar.other@example.test", "09170008004");
  const otherBranchPatient = await addUser("Bea", "Branch", "bea.branch@example.test", "09170008005");

  async function addVisit({
    userId,
    token,
    dentistId,
    time,
    status,
    position,
    branchId,
    procedures,
  }) {
    const appt = await db.query(
      `INSERT INTO patient_portal_appointments
        (user_id, service_id, service_name, dentist_id, dentist_name, appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id)
       VALUES ($1, 'cleaning', 'Cleaning', $2, 'Dr Test', CURRENT_DATE, $3, 'self_pay', 1000, 'checked_in', $4)
       RETURNING id`,
      [userId, dentistId, time, branchId]
    );
    const queue = await db.query(
      `INSERT INTO patient_portal_queue_entries
        (user_id, appointment_id, token, position, status, estimated_wait_minutes, branch_id, serving_started_at)
       VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
       RETURNING id`,
      [
        userId,
        appt.rows[0].id,
        token,
        position,
        status,
        branchId,
        status === "dentist" ? new Date() : null,
      ]
    );
    const record = await db.query(
      `INSERT INTO clinic_patient_records (record_code, first_name, last_name, linked_user_id)
       VALUES ($1, 'Synth', 'Record', $2) RETURNING id`,
      [`CR-${token}`, userId]
    );
    let sequence = 1;
    for (const procedure of procedures || []) {
      await db.query(
        `INSERT INTO clinic_patient_treatments
          (clinical_record_id, treatment, status, duration_minutes, queue_entry_id, appointment_id, visit_sequence, started_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          record.rows[0].id,
          procedure.treatment,
          procedure.status,
          procedure.duration,
          queue.rows[0].id,
          appt.rows[0].id,
          sequence,
          procedure.startedAt || null,
        ]
      );
      sequence += 1;
    }
    return { appointmentId: appt.rows[0].id, queueId: queue.rows[0].id };
  }

  const serving = await addVisit({
    userId: chair,
    token: "A-101",
    dentistId: "d1",
    time: "09:00",
    status: "dentist",
    position: 1,
    branchId: 1,
    procedures: [
      {
        treatment: "Cleaning",
        status: "in_progress",
        duration: 8,
        startedAt: new Date(),
      },
    ],
  });
  await addVisit({
    userId: nextPatient,
    token: "A-102",
    dentistId: "d1",
    time: "09:20",
    status: "waiting",
    position: 2,
    branchId: 1,
    procedures: [{ treatment: "Exam", status: "planned", duration: 10 }],
  });
  await addVisit({
    userId: laterPatient,
    token: "A-103",
    dentistId: "d1",
    time: "09:40",
    status: "waiting",
    position: 3,
    branchId: 1,
    procedures: [{ treatment: "Filling", status: "planned", duration: 15 }],
  });
  await addVisit({
    userId: otherDentistPatient,
    token: "A-201",
    dentistId: "d2",
    time: "09:10",
    status: "waiting",
    position: 4,
    branchId: 1,
    procedures: [{ treatment: "Exam", status: "planned", duration: 10 }],
  });
  await addVisit({
    userId: otherBranchPatient,
    token: "B-001",
    dentistId: "d1",
    time: "10:00",
    status: "waiting",
    position: 1,
    branchId: 2,
    procedures: [{ treatment: "Exam", status: "planned", duration: 10 }],
  });

  async function waits() {
    invalidateDurationStatsCache();
    const result = await recalculateQueueWaitEstimates(db, { branchId: 1 });
    assert.equal(result.ok, true);
    return result;
  }

  await waits();

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

  function minutesFor(json, token) {
    const rows = Array.isArray(json?.queue)
      ? json.queue
      : Array.isArray(json?.queueBoard?.entries)
        ? json.queueBoard.entries
        : [];
    const row = rows.find((item) => item.token === token);
    return row?.waitEstimate || json?.queue?.waitEstimate || null;
  }

  const firstLoad = await asUser(nextPatient, "/api/patient/queue");
  assert.equal(firstLoad.status, 200, firstLoad.json.message);
  const firstNext = minutesFor(firstLoad.json, "A-102").estimatedWaitMinutes.min;
  const firstLater = minutesFor(firstLoad.json, "A-103").estimatedWaitMinutes.min;
  assert.ok(firstNext >= 7 && firstNext <= 8, `next wait ${firstNext}`);
  assert.ok(firstLater >= 17 && firstLater <= 18, `later wait ${firstLater}`);
  assert.equal(minutesFor(firstLoad.json, "A-201").estimatedWaitMinutes.min, 0);
  assert.equal(
    JSON.stringify(firstLoad.json).includes("Cara"),
    false
  );

  const dashboard = await asUser(nextPatient, "/api/patient/dashboard");
  assert.equal(minutesFor(dashboard.json, "A-102").estimatedWaitMinutes.min, firstNext);
  assert.equal(dashboard.json.queueBoard.entries.some((row) => row.token === "B-001"), false);

  await db.query(
    `INSERT INTO clinic_patient_treatments
      (clinical_record_id, treatment, status, duration_minutes, queue_entry_id, appointment_id, visit_sequence)
     SELECT clinical_record_id, 'X-ray', 'planned', 12, queue_entry_id, appointment_id, 2
     FROM clinic_patient_treatments WHERE queue_entry_id = $1 AND visit_sequence = 1`,
    [serving.queueId]
  );
  await waits();

  const afterAdd = await asUser(nextPatient, "/api/patient/queue");
  const afterNext = minutesFor(afterAdd.json, "A-102").estimatedWaitMinutes.min;
  const afterLater = minutesFor(afterAdd.json, "A-103").estimatedWaitMinutes.min;
  assert.ok(afterNext >= 19 && afterNext <= 20, `next after add ${afterNext}`);
  assert.ok(afterLater >= 29 && afterLater <= 30, `later after add ${afterLater}`);
  const afterAddDash = await asUser(nextPatient, "/api/patient/dashboard");
  assert.equal(minutesFor(afterAddDash.json, "A-102").estimatedWaitMinutes.min, afterNext);

  await db.query(
    `INSERT INTO clinic_patient_treatments
      (clinical_record_id, treatment, status, duration_minutes, queue_entry_id, appointment_id, visit_sequence)
     SELECT clinical_record_id, 'X-ray', 'planned', 12, queue_entry_id, appointment_id, 2
     FROM clinic_patient_treatments WHERE queue_entry_id = $1 AND visit_sequence = 1`,
    [serving.queueId]
  ).catch(() => {});
  await waits();
  const duplicate = await asUser(nextPatient, "/api/patient/queue");
  assert.equal(minutesFor(duplicate.json, "A-102").estimatedWaitMinutes.min, afterNext);

  await db.query(
    `UPDATE clinic_patient_treatments SET status = 'cancelled'
     WHERE queue_entry_id = $1 AND treatment = 'X-ray'`,
    [serving.queueId]
  );
  await waits();
  const cancelled = await asUser(nextPatient, "/api/patient/queue");
  const cancelledNext = minutesFor(cancelled.json, "A-102").estimatedWaitMinutes.min;
  assert.ok(cancelledNext >= 7 && cancelledNext <= 8, `cancelled wait ${cancelledNext}`);

  await db.query(
    `UPDATE clinic_patient_treatments
     SET status = 'completed'
     WHERE queue_entry_id = $1 AND treatment = 'Cleaning'`,
    [serving.queueId]
  );
  await db.query(
    `INSERT INTO clinic_patient_treatments
      (clinical_record_id, treatment, status, duration_minutes, queue_entry_id, appointment_id, visit_sequence)
     SELECT clinical_record_id, 'Polish', 'planned', 5, queue_entry_id, appointment_id, 5
     FROM clinic_patient_treatments WHERE queue_entry_id = $1 LIMIT 1`,
    [serving.queueId]
  );
  await waits();
  const afterComplete = await asUser(nextPatient, "/api/patient/queue");
  assert.equal(minutesFor(afterComplete.json, "A-102").estimatedWaitMinutes.min, 5);

  await db.query(
    `UPDATE clinic_patient_treatments SET status = 'in_progress', duration_minutes = 8,
            started_at = '2026-11-22T01:00:00.000Z'
     WHERE queue_entry_id = $1 AND treatment = 'Polish'`,
    [serving.queueId]
  );
  await waits();
  const overrun = await asUser(nextPatient, "/api/patient/queue");
  assert.equal(minutesFor(overrun.json, "A-102").treatmentOverrun, true);
  assert.equal(minutesFor(overrun.json, "A-102").unavailable, false);
  assert.equal(minutesFor(overrun.json, "A-102").estimatedWaitMinutes, null);

  await db.query(
    `UPDATE clinic_patient_treatments SET duration_minutes = NULL, started_at = CURRENT_TIMESTAMP, status = 'in_progress'
     WHERE queue_entry_id = $1 AND treatment = 'Polish'`,
    [serving.queueId]
  );
  await waits();
  const missing = await asUser(nextPatient, "/api/patient/queue");
  assert.equal(minutesFor(missing.json, "A-102").unavailable, true);
});
