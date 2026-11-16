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
const clinicSchedule = require("../services/clinicSchedule");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dbName = `ds_branch_book_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

function futureMonday() {
  const date = new Date(Date.UTC(2099, 0, 4));
  while (date.getUTCDay() !== 1) date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

test("date-only bookings consume a place without reserving a clock time", () => {
  const hours = { closed: false, open: "09:00", close: "10:00" };
  const defaults = { slotMinutes: 30 };
  const saved = new Map();
  const booked = new Map();
  const open = clinicSchedule.assessCapacity(hours, defaults, saved, booked, 0);
  assert.equal(open.capacity, 2);
  assert.equal(open.remaining, 2);
  const held = clinicSchedule.buildSlots(hours, defaults, saved, booked, 1);
  assert.equal(held.filter((slot) => slot.bookable).length, 2);
  assert.equal(held.some((slot) => slot.booked), false);
  const full = clinicSchedule.buildSlots(hours, defaults, saved, booked, 2);
  assert.equal(full.every((slot) => slot.status === "full"), true);
  assert.equal(clinicSchedule.isDateOnlyBookable(hours, defaults, saved, booked, 2), false);
});

test("patient branch booking", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { applyBranchOperationSchema } = require("../services/branchAccess");
  const patientBranchBooking = require("../services/patientBranchBooking");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const { createDentistPortalRouter } = require("../routes/dentistPortal");
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

  const main = await db.query(`SELECT id, name FROM clinic_branches WHERE is_main`);
  assert.equal(main.rows[0].name, "Mandaluyong");
  await assert.rejects(
    () => db.query(`UPDATE clinic_branches SET status = 'inactive' WHERE id = $1`, [main.rows[0].id]),
    /cannot be deactivated/i
  );

  const pasig = await db.query(
    `INSERT INTO clinic_branches (branch_code, name, address, contact_number, is_main, status)
     VALUES ('BR-0002', 'Pasig', 'Synthetic Pasig', '09180000002', FALSE, 'active')
     RETURNING id`
  );
  async function addUser(role, email, phone, first) {
    const result = await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
       VALUES ($1, 'Booking', $2, $3, 'synthetic-hash', $4, TRUE, 'Active')
       RETURNING id`,
      [first, email, phone, role]
    );
    return result.rows[0].id;
  }
  const patientId = await addUser("patient", "pat.book@example.test", "09170003001", "Pia");
  const secondPatientId = await addUser("patient", "pat2.book@example.test", "09170003002", "Pedro");
  const mandaluyongStaff = await addUser("staff", "m.book@example.test", "09170003003", "Minda");
  const pasigStaff = await addUser("staff", "p.book@example.test", "09170003004", "Paz");
  const dentistUserId = await addUser("dentist", "dee.book@example.test", "09170003005", "Dee");
  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, catalog_dentist_id) VALUES ($1, 'dr-dee-book')`,
    [String(dentistUserId)]
  );
  await db.query(
    `INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2), ($3, $4), ($5, $2), ($5, $4)`,
    [mandaluyongStaff, main.rows[0].id, pasigStaff, pasig.rows[0].id, dentistUserId]
  );

  const day = futureMonday();
  await db.query(
    `INSERT INTO clinic_schedule_days (branch_id, schedule_date, mode, open_time, close_time)
     VALUES ($1, $2::date, 'custom', '09:00', '09:30'), ($3, $2::date, 'closed', NULL, NULL)`,
    [main.rows[0].id, day, pasig.rows[0].id]
  );

  const app = express();
  app.use(express.json());
  app.use("/api/patient", createPatientPortalRouter({ db, authenticateToken, notifyStaff: async () => {}, notifyAdmin: async () => {}, notifyDentist: async () => {} }));
  app.use("/api/staff", createStaffPortalRouter({ db, authenticateToken }));
  app.use("/api/dentist", createDentistPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const tokenFor = (id, role) => jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
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

  const patientToken = tokenFor(patientId, "patient");
  const branches = await request("GET", "/api/patient/branches", { token: patientToken });
  assert.equal(branches.status, 200);
  assert.equal(branches.body.requiresSelection, true);
  assert.equal(branches.body.branches.length, 2);

  const missingBranch = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: { serviceId: "cleaning", appointmentDate: day, coverageType: "self_pay" },
  });
  assert.equal(missingBranch.status, 400);

  const invalid = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: { serviceId: "cleaning", appointmentDate: day, coverageType: "self_pay", branchId: 999999 },
  });
  assert.equal(invalid.status, 400);

  const pasigClosed = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: { serviceId: "cleaning", appointmentDate: day, coverageType: "self_pay", branchId: pasig.rows[0].id },
  });
  assert.equal(pasigClosed.status, 409);

  const invalidTime = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: {
      serviceId: "cleaning",
      appointmentDate: day,
      appointmentTime: "not-a-time",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(invalidTime.status, 400);

  const unavailableTime = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: {
      serviceId: "cleaning",
      appointmentDate: day,
      appointmentTime: "08:00",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(unavailableTime.status, 409);

  async function assertUnspecifiedTime(body) {
    const booked = await request("POST", "/api/patient/appointments", {
      token: patientToken,
      body: {
        serviceId: "cleaning",
        appointmentDate: day,
        coverageType: "self_pay",
        branchId: main.rows[0].id,
        ...body,
      },
    });
    assert.equal(booked.status, 201, JSON.stringify(booked.body));
    assert.equal(booked.body.appointment.time, null);
    assert.equal(booked.body.appointment.status, "pending");
    assert.equal(String(booked.body.appointment.branchId), String(main.rows[0].id));
    assert.equal(String(booked.body.appointment.date).slice(0, 10), day);
    assert.match(booked.body.message, /clinic confirmation/i);
    assert.equal(JSON.stringify(booked.body).includes("09:00"), false);
    const stored = await db.query(
      `SELECT appointment_time, appointment_date, branch_id FROM patient_portal_appointments WHERE id = $1`,
      [booked.body.appointment.id]
    );
    assert.equal(stored.rows[0].appointment_time, null);
    assert.equal(String(stored.rows[0].branch_id), String(main.rows[0].id));
    await db.query(`DELETE FROM patient_portal_appointments WHERE id = $1`, [booked.body.appointment.id]);
  }

  await assertUnspecifiedTime({});
  await assertUnspecifiedTime({ appointmentTime: null });
  await assertUnspecifiedTime({ appointmentTime: "" });
  await assertUnspecifiedTime({ appointmentTime: "   " });

  const dateOnly = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: { serviceId: "cleaning", appointmentDate: day, coverageType: "self_pay", branchId: main.rows[0].id },
  });
  assert.equal(dateOnly.status, 201, JSON.stringify(dateOnly.body));
  assert.equal(dateOnly.body.appointment.time, null);
  assert.equal(String(dateOnly.body.appointment.branchId), String(main.rows[0].id));

  const secondDateOnly = await request("POST", "/api/patient/appointments", {
    token: tokenFor(secondPatientId, "patient"),
    body: { serviceId: "extraction", appointmentDate: day, coverageType: "self_pay", branchId: main.rows[0].id },
  });
  assert.equal(secondDateOnly.status, 409);

  const timedAfterFull = await request("POST", "/api/patient/appointments", {
    token: tokenFor(secondPatientId, "patient"),
    body: {
      serviceId: "cleaning",
      appointmentDate: day,
      appointmentTime: "09:00",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(timedAfterFull.status, 409);

  await db.query(`DELETE FROM patient_portal_appointments WHERE appointment_date = $1::date`, [day]);
  const timedOk = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: {
      serviceId: "cleaning",
      appointmentDate: day,
      appointmentTime: "09:00",
      coverageType: "self_pay",
      branchId: main.rows[0].id,
    },
  });
  assert.equal(timedOk.status, 201, JSON.stringify(timedOk.body));
  assert.equal(String(timedOk.body.appointment.time).slice(0, 5), "09:00");
  assert.equal(String(timedOk.body.appointment.branchId), String(main.rows[0].id));

  await db.query(`DELETE FROM patient_portal_appointments WHERE appointment_date = $1::date`, [day]);
  const pasigDay = futureMonday().replace(/..$/, "18");
  const openPasig = "2099-01-19";
  await db.query(
    `INSERT INTO clinic_schedule_days (branch_id, schedule_date, mode, open_time, close_time)
     VALUES ($1, $2::date, 'closed', NULL, NULL), ($3, $2::date, 'custom', '11:00', '11:30')
     ON CONFLICT (branch_id, schedule_date) DO UPDATE SET mode = EXCLUDED.mode, open_time = EXCLUDED.open_time, close_time = EXCLUDED.close_time`,
    [main.rows[0].id, openPasig, pasig.rows[0].id]
  );
  const pasigTimed = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: {
      serviceId: "cleaning",
      appointmentDate: openPasig,
      appointmentTime: "11:00",
      coverageType: "self_pay",
      branchId: pasig.rows[0].id,
    },
  });
  assert.equal(pasigTimed.status, 201, JSON.stringify(pasigTimed.body));
  const mainSameDay = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: { serviceId: "extraction", appointmentDate: openPasig, coverageType: "self_pay", branchId: main.rows[0].id },
  });
  assert.equal(mainSameDay.status, 409);

  const history = await request("GET", "/api/patient/appointments", { token: patientToken });
  assert.equal(history.status, 200);
  assert.ok(history.body.appointments.some((row) => row.branchName === "Pasig" && row.time === "11:00"));

  const cross = await request("POST", `/api/patient/appointments/${pasigTimed.body.appointment.id}/reschedule`, {
    token: patientToken,
    body: { appointmentDate: "2099-01-20", appointmentTime: "11:00", branchId: main.rows[0].id },
  });
  assert.equal(cross.status, 409);
  assert.match(cross.body.message, /original clinic branch/i);

  const rescheduled = await request("POST", `/api/patient/appointments/${pasigTimed.body.appointment.id}/reschedule`, {
    token: patientToken,
    body: { appointmentDate: "2099-01-20", appointmentTime: "11:00" },
  });
  assert.equal(rescheduled.status, 200, JSON.stringify(rescheduled.body));
  assert.equal(String(rescheduled.body.appointment.time).slice(0, 5), "11:00");
  const stored = await db.query(`SELECT branch_id, appointment_time FROM patient_portal_appointments WHERE id = $1`, [
    rescheduled.body.appointment.id,
  ]);
  assert.equal(String(stored.rows[0].branch_id), String(pasig.rows[0].id));
  assert.equal(String(stored.rows[0].appointment_time).slice(0, 5), "11:00");

  await db.query(`UPDATE clinic_branches SET status = 'inactive' WHERE id = $1`, [pasig.rows[0].id]);
  const inactiveBook = await request("POST", "/api/patient/appointments", {
    token: patientToken,
    body: { serviceId: "cleaning", appointmentDate: "2099-01-21", appointmentTime: "11:00", coverageType: "self_pay", branchId: pasig.rows[0].id },
  });
  assert.equal(inactiveBook.status, 409);
  const review = await patientBranchBooking.listInactiveBranchReview(db);
  assert.ok(review.some((row) => String(row.branch_id) === String(pasig.rows[0].id)));
  const onlyMain = await request("GET", "/api/patient/branches", { token: patientToken });
  assert.equal(onlyMain.body.requiresSelection, false);
  assert.equal(String(onlyMain.body.autoSelectedBranchId), String(main.rows[0].id));

  await db.query(`UPDATE clinic_branches SET status = 'active' WHERE id = $1`, [pasig.rows[0].id]);
  await db.query(
    `INSERT INTO clinic_schedule_days (branch_id, schedule_date, mode, open_time, close_time)
     VALUES ($1, '2099-02-02'::date, 'custom', '09:00', '09:30')
     ON CONFLICT (branch_id, schedule_date) DO NOTHING`,
    [main.rows[0].id]
  );
  const raceTokenA = tokenFor(patientId, "patient");
  const raceTokenB = tokenFor(secondPatientId, "patient");
  const raceBody = {
    serviceId: "cleaning",
    appointmentDate: "2099-02-02",
    appointmentTime: "09:00",
    coverageType: "self_pay",
    branchId: main.rows[0].id,
  };
  const [raceA, raceB] = await Promise.all([
    request("POST", "/api/patient/appointments", { token: raceTokenA, body: raceBody }),
    request("POST", "/api/patient/appointments", { token: raceTokenB, body: raceBody }),
  ]);
  const raceStatuses = [raceA.status, raceB.status].sort();
  assert.deepEqual(raceStatuses, [201, 409], JSON.stringify([raceA.body, raceB.body]));

  const mStaff = await request("GET", "/api/staff/appointments?tab=all", { token: tokenFor(mandaluyongStaff, "staff") });
  const pStaff = await request("GET", "/api/staff/appointments?tab=all", { token: tokenFor(pasigStaff, "staff") });
  assert.equal(mStaff.status, 200, JSON.stringify(mStaff.body));
  assert.equal(pStaff.status, 200, JSON.stringify(pStaff.body));
  const mainRows = await db.query(`SELECT id FROM patient_portal_appointments WHERE branch_id = $1`, [main.rows[0].id]);
  const pasigRows = await db.query(`SELECT id FROM patient_portal_appointments WHERE branch_id = $1`, [pasig.rows[0].id]);
  const mIds = new Set(mStaff.body.appointments.map((row) => String(row.id)));
  const pIds = new Set(pStaff.body.appointments.map((row) => String(row.id)));
  assert.ok(mainRows.rows.every((row) => mIds.has(String(row.id))));
  assert.ok(pasigRows.rows.every((row) => pIds.has(String(row.id))));
  assert.equal([...mIds].some((id) => pIds.has(id)), false);

  const dentistToken = tokenFor(dentistUserId, "dentist");
  const dentistPasig = await request("GET", `/api/dentist/appointments`, {
    token: dentistToken,
    body: undefined,
  });
  assert.equal(dentistPasig.status, 200);

  const pasigAppointment = rescheduled.body.appointment.id;
  const wrongDesk = await request("POST", "/api/staff/check-in", {
    token: tokenFor(mandaluyongStaff, "staff"),
    body: { method: "manual", appointmentId: pasigAppointment },
  });
  assert.equal(wrongDesk.status, 409, JSON.stringify(wrongDesk.body));
  assert.match(wrongDesk.body.message, /staffed desk/i);

  const zeroChoices = await patientBranchBooking.publicBranchChoices({
    async query(sql) {
      if (sql.includes("patient_booking_active_branches")) return { rows: [] };
      throw new Error(sql);
    },
  });
  assert.equal(zeroChoices.message, patientBranchBooking.NO_BRANCHES_MESSAGE);
  await assert.rejects(
    () => patientBranchBooking.resolveBookingBranch({
      async query(sql) {
        if (sql.includes("patient_booking_active_branches")) return { rows: [] };
        return { rows: [] };
      },
    }, null),
    /No clinic branches are currently available/
  );
});
