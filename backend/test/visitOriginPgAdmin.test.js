"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const test = require("node:test");
const dotenv = require("dotenv");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dbName = `ds_pgadmin_066_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});

test("pgAdmin 066 handoff SQL matches the release migration and applies on a disposable database", async (t) => {
  const migration = fs.readFileSync(
    path.join(__dirname, "..", "migrations", "066_appointment_visit_origin.sql"),
    "utf8"
  );
  const handoff = fs.readFileSync(
    path.join(__dirname, "../../ops/pgadmin/066_appointment_visit_origin_dentasync_live.sql"),
    "utf8"
  );
  assert.match(handoff, /ADD COLUMN IF NOT EXISTS visit_origin TEXT/);
  assert.match(handoff, /SET visit_origin = 'walk_in'/);
  assert.match(handoff, /SET visit_origin = 'booked'/);
  assert.match(handoff, /WHERE visit_origin IS NULL/);
  assert.match(handoff, /patient_portal_appointments_visit_origin_check/);
  assert.match(handoff, /Auto-created from RFID walk-in check-in/);
  assert.match(handoff, /Auto-created from QR walk-in check-in/);
  assert.match(migration, /visit_origin IS NULL/);

  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST || "localhost",
    database: dbName,
    password: process.env.DB_PASSWORD,
    port: Number(process.env.DB_PORT || 5432),
  });
  t.after(async () => {
    await pool.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await pool.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "002_create_patient_portal.sql"), "utf8"));
  await pool.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status
     ) VALUES
       ('1', 'cleaning', 'Cleaning', 'dr-sarah-cruz', 'Dr. Sarah Cruz', CURRENT_DATE, '09:00', 'self_pay', 500, 'confirmed'),
       ('2', 'general-consultation', 'Walk-in Consultation', 'walk-in-desk', 'Walk-in', CURRENT_DATE, '10:00', 'self_pay', 800, 'confirmed')`
  );

  await pool.query(handoff);

  const column = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_name = 'patient_portal_appointments' AND column_name = 'visit_origin'`
  );
  assert.equal(column.rows.length, 1);
  const counts = await pool.query(
    `SELECT visit_origin, COUNT(*)::int AS count
     FROM patient_portal_appointments
     GROUP BY visit_origin
     ORDER BY visit_origin`
  );
  const byOrigin = Object.fromEntries(counts.rows.map((row) => [row.visit_origin, row.count]));
  assert.equal(byOrigin.booked, 1);
  assert.equal(byOrigin.walk_in, 1);
  assert.equal(byOrigin.null, undefined);
});
