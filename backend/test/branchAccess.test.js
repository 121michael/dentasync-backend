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

const dbName = `ds_branch_access_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

const { resolveAppSecrets } = require("../lib/securityConfig");
const { applyClinicBranchSchema } = require("../services/clinicBranches");
const { applyBranchOperationSchema } = require("../services/branchAccess");
const staffCheckIn = require("../services/staffCheckIn");

let db;
let server;

function tokenFor(id, role) {
  const { jwtSecret } = resolveAppSecrets(process.env);
  return jwt.sign({ id, role }, jwtSecret, { expiresIn: "1h" });
}

async function request(method, urlPath, { token, body, branchId } = {}) {
  const response = await fetch(`http://127.0.0.1:${server.address().port}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(branchId ? { "x-dentasync-branch": String(branchId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : {} };
}

test("staff and dentist branch access", async (t) => {
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await adminPool.query(`CREATE DATABASE ${dbName}`);
  db = require("../db");
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "002_create_patient_portal.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT,
      license_number TEXT,
      license_verified BOOLEAN NOT NULL DEFAULT FALSE
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
    ALTER TABLE patient_portal_queue_entries
      ADD COLUMN IF NOT EXISTS wait_estimate_min_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS wait_estimate_max_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS wait_estimate_duration_minutes INTEGER,
      ADD COLUMN IF NOT EXISTS wait_estimate_call_start TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS wait_estimate_call_end TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS wait_estimate_method TEXT,
      ADD COLUMN IF NOT EXISTS wait_estimate_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS serving_started_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS check_in_method TEXT;
  `);

  const patient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Pat', 'Patient', 'pat.access@example.test', '09170002001', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const keptAppointment = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status
     ) VALUES ($1, 'cleaning', 'Cleaning', 'dr-ada', 'Dr. Ada', CURRENT_DATE, '09:00', 'self_pay', 500, 'confirmed')
     RETURNING id`,
    [String(patient.rows[0].id)]
  );
  const keptQueue = await db.query(
    `INSERT INTO patient_portal_queue_entries (user_id, appointment_id, token, position, status)
     VALUES ($1, $2, 'A-001', 1, 'waiting')
     RETURNING id`,
    [String(patient.rows[0].id), keptAppointment.rows[0].id]
  );

  await applyClinicBranchSchema(db);
  await applyBranchOperationSchema(db);

  const preserved = await db.query(
    `SELECT appointment.id AS appointment_id, appointment.branch_id, queue.id AS queue_id, queue.branch_id AS queue_branch
     FROM patient_portal_appointments AS appointment
     JOIN patient_portal_queue_entries AS queue ON queue.id = $2
     WHERE appointment.id = $1`,
    [keptAppointment.rows[0].id, keptQueue.rows[0].id]
  );
  const main = await db.query(`SELECT id, name, status FROM clinic_branches WHERE is_main`);
  assert.equal(main.rows.length, 1);
  assert.equal(main.rows[0].name, "Mandaluyong");
  assert.equal(Number(preserved.rows[0].appointment_id), Number(keptAppointment.rows[0].id));
  assert.equal(Number(preserved.rows[0].queue_id), Number(keptQueue.rows[0].id));
  assert.equal(Number(preserved.rows[0].branch_id), Number(main.rows[0].id));
  assert.equal(Number(preserved.rows[0].queue_branch), Number(main.rows[0].id));

  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig address', '09180002002', FALSE, 'active')
     RETURNING id`
  );
  async function addUser(role, email, phone, first) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Access', $2, $3, 'synthetic-hash', $4, TRUE, 'Active')
       RETURNING id`,
      [first, email, phone, role]
    );
    return result.rows[0].id;
  }
  const mandaluyongStaff = await addUser("staff", "m.staff@example.test", "09170002002", "Minda");
  const pasigStaff = await addUser("staff", "p.staff@example.test", "09170002003", "Pia");
  const dentistId = await addUser("dentist", "dee.access@example.test", "09170002004", "Dee");
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4)`, [
    mandaluyongStaff,
    main.rows[0].id,
    pasigStaff,
    pasig.rows[0].id,
  ]);
  await db.query(`INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($1, $3)`, [
    dentistId,
    main.rows[0].id,
    pasig.rows[0].id,
  ]);
  await db.query(`UPDATE patient_portal_appointments SET dentist_id = $1 WHERE branch_id = $2`, [
    String(dentistId),
    main.rows[0].id,
  ]);
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, branch_id
     ) VALUES
       ($1, 'filling', 'Filling', $2, 'Dr. Dee', CURRENT_DATE, '10:00', 'self_pay', 700, 'confirmed', $3)`,
    [String(patient.rows[0].id), String(dentistId), pasig.rows[0].id]
  );
  await db.query(
    `INSERT INTO patient_portal_queue_entries (user_id, appointment_id, token, position, status, branch_id)
     SELECT $1, id, 'A-001', 1, 'waiting', $2
     FROM patient_portal_appointments
     WHERE branch_id = $2
     LIMIT 1`,
    [String(patient.rows[0].id), pasig.rows[0].id]
  );

  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const app = express();
  app.use(express.json());
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  const mToken = tokenFor(mandaluyongStaff, "staff");
  const pToken = tokenFor(pasigStaff, "staff");
  const dToken = tokenFor(dentistId, "dentist");

  const mQueue = await request("GET", "/api/staff/queue", { token: mToken });
  assert.equal(mQueue.status, 200);
  assert.equal(mQueue.body.branch.name, "Mandaluyong");
  assert.ok(mQueue.body.queue.some((row) => row.token === "A-001"));
  assert.equal(mQueue.body.queue.length, 1);

  const pQueue = await request("GET", "/api/staff/queue", { token: pToken });
  assert.equal(pQueue.status, 200);
  assert.equal(pQueue.body.branch.name, "Pasig");
  assert.equal(pQueue.body.queue.length, 1);
  assert.equal(pQueue.body.queue[0].token, "A-001");

  const crossed = await request("GET", "/api/staff/queue", { token: mToken, branchId: pasig.rows[0].id });
  assert.equal(crossed.status, 403);

  const dentistMain = await request("GET", "/api/dentist/queue", { token: dToken, branchId: main.rows[0].id });
  assert.equal(dentistMain.status, 200);
  const dentistPasig = await request("GET", "/api/dentist/queue", { token: dToken, branchId: pasig.rows[0].id });
  assert.equal(dentistPasig.status, 200);
  assert.equal(dentistMain.body.queue.length, 1);
  assert.equal(dentistMain.body.queue[0].procedure, "Cleaning");
  assert.equal(dentistPasig.body.queue.length, 1);
  assert.equal(dentistPasig.body.queue[0].procedure, "Filling");
  assert.equal(String(dentistMain.body.queue[0].patientId), String(dentistPasig.body.queue[0].patientId));

  const outsider = await request("GET", "/api/dentist/queue", { token: dToken, branchId: 999999 });
  assert.equal(outsider.status, 403);

  const samePatient = await db.query(
    `SELECT COUNT(DISTINCT user_id) AS patients, COUNT(*) AS visits
     FROM patient_portal_appointments`
  );
  assert.equal(Number(samePatient.rows[0].patients), 1);
  assert.ok(Number(samePatient.rows[0].visits) >= 2);

  await db.query(`UPDATE clinic_branches SET status = 'inactive' WHERE id = $1`, [pasig.rows[0].id]);
  const paused = await request("GET", "/api/staff/queue", { token: pToken });
  assert.equal(paused.status, 200);
  assert.match(paused.body.message, /inactive/i);
  assert.equal(paused.body.queue.length, 0);
  const blocked = await request("POST", "/api/staff/queue/reset", { token: pToken, body: {} });
  assert.equal(blocked.status, 409);
  const stillThere = await db.query(
    `SELECT id, status FROM patient_portal_queue_entries WHERE branch_id = $1`,
    [pasig.rows[0].id]
  );
  assert.equal(stillThere.rows[0].status, "waiting");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const found = await staffCheckIn.findAppointmentForCheckIn(client, {
      patientId: patient.rows[0].id,
      branchId: "main",
    });
    assert.equal(Number(found.branch_id), Number(main.rows[0].id));
    const checked = await staffCheckIn.performStaffCheckIn(client, {
      appointment: found,
      staff: null,
      notifyClinicStaff: async () => {},
      notifyClinicDentists: async () => {},
      checkInMethod: "rfid",
      branchId: "main",
    });
    assert.equal(Number(checked.queueEntry.branch_id || found.branch_id), Number(main.rows[0].id));
    await client.query("ROLLBACK");
  } finally {
    client.release();
  }
});
