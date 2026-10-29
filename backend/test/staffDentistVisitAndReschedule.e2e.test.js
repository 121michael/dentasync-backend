"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const bcrypt = require("bcrypt");
const db = require("../db");
const app = require("../server");
const { createUnproceededAppointmentCancelJob } = require("../services/unproceededAppointmentCancelJob");

const PATIENT = { email: "patient@amethyst.com", password: "PatientPass123!" };
const VISIT_PATIENT = {
  email: "e2e.visit@amethyst.com",
  password: "VisitPass123!",
};
const STAFF = { email: "staff@amethyst.com", password: "StaffPass123!" };
const DENTIST = { email: "dentist@amethyst.com", password: "DentistPass123!" };

async function jsonFetch(url, { method = "GET", token, body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = { raw: text };
  }
  return { status: response.status, body: payload };
}

async function ensureUser({ email, password, role, firstName, lastName, phone }) {
  const hash = await bcrypt.hash(password, 12);
  const existing = await db.query(`SELECT id, role FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`, [email]);
  if (existing.rows[0]) {
    await db.query(
      `UPDATE users
       SET password_hash = $1, role = $2, is_verified = TRUE, status = 'Active', is_archived = FALSE
       WHERE id = $3`,
      [hash, role, existing.rows[0].id]
    );
    if (role === "patient") {
      await db.query(`UPDATE users SET patient_category = COALESCE(NULLIF(patient_category, ''), 'regular') WHERE id = $1`, [
        existing.rows[0].id,
      ]).catch(() => {});
    }
    return existing.rows[0].id;
  }
  const inserted = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status, is_archived)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'Active', FALSE)
     RETURNING id`,
    [firstName, lastName, email, phone, hash, role]
  );
  if (role === "patient") {
    await db.query(`UPDATE users SET patient_category = 'regular' WHERE id = $1`, [inserted.rows[0].id]).catch(
      () => {}
    );
  }
  return inserted.rows[0].id;
}

async function login(base, account) {
  const response = await jsonFetch(`${base}/api/auth/login`, {
    method: "POST",
    body: { identifier: account.email, password: account.password },
  });
  assert.equal(response.status, 200, `login failed for ${account.email}: ${JSON.stringify(response.body)}`);
  assert.ok(response.body.token);
  return response.body.token;
}

function clinicToday() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

test("staff check-in, dentist in-chair treatment, completion, and 6pm job skip", async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

  const patientId = await ensureUser({
    ...VISIT_PATIENT,
    role: "patient",
    firstName: "Visit",
    lastName: "E2E",
    phone: "639179991111",
  });
  await db.query(
    `UPDATE patient_portal_queue_entries
     SET status = 'completed', updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1
       AND status NOT IN ('completed', 'no_show')`,
    [String(patientId)]
  );
  const staffId = await ensureUser({
    ...STAFF,
    role: "staff",
    firstName: "Jane",
    lastName: "Doe",
    phone: "639171111111",
  });
  const dentistId = await ensureUser({
    ...DENTIST,
    role: "dentist",
    firstName: "Sarah",
    lastName: "Cruz",
    phone: "639173333333",
  });
  void staffId;

  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (user_id, specialization, schedule_notes, catalog_dentist_id)
     VALUES ($1, 'Orthodontics', 'Mon–Fri', 'dr-sarah-cruz')
     ON CONFLICT (user_id) DO UPDATE SET catalog_dentist_id = 'dr-sarah-cruz'`,
    [String(dentistId)]
  ).catch(async (error) => {
    if (error.code !== "42P01") throw error;
  });

  const today = clinicToday();
  await db.query(
    `UPDATE patient_portal_appointments
     SET status = 'cancelled', cancellation_reason = 'e2e_reset', updated_at = CURRENT_TIMESTAMP
     WHERE dentist_id = 'dr-sarah-cruz'
       AND appointment_date = $1::date
       AND appointment_time = TIME '19:30'
       AND status NOT IN ('cancelled', 'no_show', 'rescheduled')`,
    [today]
  );
  const created = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, clinic_location
     ) VALUES (
       $1, 'cleaning', 'Dental Cleaning / Oral Prophylaxis', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       $2::date, '19:30', 'self_pay', 1800, 'confirmed', 'Amethyst Dental — Makati'
     )
     RETURNING id`,
    [String(patientId), today]
  );
  const appointmentId = created.rows[0].id;

  const staffToken = await login(base, STAFF);
  const dentistToken = await login(base, DENTIST);

  const checkIn = await jsonFetch(`${base}/api/staff/check-in`, {
    method: "POST",
    token: staffToken,
    body: { method: "manual", appointmentId },
  });
  assert.ok([200, 201].includes(checkIn.status), JSON.stringify(checkIn.body));
  assert.ok(!checkIn.body.alreadyCheckedIn, JSON.stringify(checkIn.body));
  assert.equal(Boolean(checkIn.body.queue?.id), true);
  assert.equal(Number(checkIn.body.appointment?.id), Number(appointmentId));
  const queueId = checkIn.body.queue.id;
  assert.ok(queueId);

  const afterCheckIn = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [appointmentId]);
  assert.equal(afterCheckIn.rows[0].status, "checked_in");

  const startChair = await jsonFetch(`${base}/api/dentist/queue/${queueId}`, {
    method: "PATCH",
    token: dentistToken,
    body: { status: "in_treatment" },
  });
  assert.equal(startChair.status, 200, JSON.stringify(startChair.body));

  const inChair = await db.query(
    `SELECT q.status AS queue_status, a.status AS appointment_status
     FROM patient_portal_queue_entries AS q
     JOIN patient_portal_appointments AS a ON a.id = q.appointment_id
     WHERE q.id = $1`,
    [queueId]
  );
  assert.equal(inChair.rows[0].queue_status, "dentist");
  assert.equal(inChair.rows[0].appointment_status, "checked_in");

  const job = createUnproceededAppointmentCancelJob({ db });
  const jobResult = await job.runOnce(new Date());
  assert.equal(jobResult.error, undefined, jobResult.error);
  const skippedInChair = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [appointmentId]);
  assert.equal(skippedInChair.rows[0].status, "checked_in");
  assert.ok(!(jobResult.ids || []).map(String).includes(String(appointmentId)));

  const complete = await jsonFetch(`${base}/api/dentist/queue/${queueId}`, {
    method: "PATCH",
    token: dentistToken,
    body: { status: "completed", durationMinutes: 25 },
  });
  assert.equal(complete.status, 200, JSON.stringify(complete.body));

  const finished = await db.query(
    `SELECT q.status AS queue_status, a.status AS appointment_status
     FROM patient_portal_queue_entries AS q
     JOIN patient_portal_appointments AS a ON a.id = q.appointment_id
     WHERE q.id = $1`,
    [queueId]
  );
  assert.equal(finished.rows[0].queue_status, "completed");
  assert.equal(finished.rows[0].appointment_status, "completed");

  const afterCompleteJob = await job.runOnce(new Date());
  assert.equal(afterCompleteJob.error, undefined);
  const stillComplete = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [appointmentId]);
  assert.equal(stillComplete.rows[0].status, "completed");

  const patientToken = await login(base, VISIT_PATIENT);
  const history = await jsonFetch(`${base}/api/patient/appointments`, { token: patientToken });
  const row = history.body.appointments.find((item) => String(item.id) === String(appointmentId));
  assert.equal(row.status, "completed");
  assert.equal(row.statusLabel, "Completed");
  assert.equal(row.canCancel, false);
});

test("reschedule rejects unavailable slots, duplicate requests, and already-rescheduled visits", async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  t.after(() => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))));

  const patientId = await ensureUser({
    ...PATIENT,
    role: "patient",
    firstName: "Test",
    lastName: "Patient",
    phone: "639172222222",
  });
  const patientToken = await login(base, PATIENT);

  await db.query(
    `UPDATE patient_portal_appointments
     SET status = 'cancelled', cancellation_reason = 'e2e_reset', updated_at = CURRENT_TIMESTAMP
     WHERE dentist_id = 'dr-sarah-cruz'
       AND (
         (appointment_date = DATE '2026-11-10' AND appointment_time = TIME '09:00')
         OR (appointment_date = DATE '2026-11-11' AND appointment_time = TIME '10:00')
         OR (appointment_date = DATE '2026-11-12' AND appointment_time = TIME '11:00')
       )
       AND status NOT IN ('cancelled', 'no_show', 'rescheduled')`
  );
  const original = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, clinic_location
     ) VALUES (
       $1, 'extraction', 'Tooth Extraction', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       '2026-11-10', '09:00', 'self_pay', 3500, 'confirmed', 'Amethyst Dental — Makati'
     )
     RETURNING id`,
    [String(patientId)]
  );
  const originalId = original.rows[0].id;

  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, clinic_location
     ) VALUES (
       $1, 'cleaning', 'Dental Cleaning / Oral Prophylaxis', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       '2026-11-11', '10:00', 'self_pay', 1800, 'confirmed', 'Amethyst Dental — Makati'
     )`,
    [String(patientId)]
  );

  const taken = await jsonFetch(`${base}/api/patient/appointments/${originalId}/reschedule`, {
    method: "POST",
    token: patientToken,
    body: { appointmentDate: "2026-11-11", appointmentTime: "10:00" },
  });
  assert.equal(taken.status, 409, JSON.stringify(taken.body));
  assert.match(String(taken.body.message), /no longer available|just booked/i);
  const unchanged = await db.query(`SELECT status FROM patient_portal_appointments WHERE id = $1`, [originalId]);
  assert.equal(unchanged.rows[0].status, "confirmed");

  const closed = await jsonFetch(`${base}/api/patient/appointments/${originalId}/reschedule`, {
    method: "POST",
    token: patientToken,
    body: { appointmentDate: "2026-11-15", appointmentTime: "10:00" },
  });
  assert.equal(closed.status, 409, JSON.stringify(closed.body));

  const duplicateBody = { appointmentDate: "2026-11-12", appointmentTime: "11:00" };
  const first = jsonFetch(`${base}/api/patient/appointments/${originalId}/reschedule`, {
    method: "POST",
    token: patientToken,
    body: duplicateBody,
  });
  const duplicate = jsonFetch(`${base}/api/patient/appointments/${originalId}/reschedule`, {
    method: "POST",
    token: patientToken,
    body: duplicateBody,
  });
  const [one, two] = await Promise.all([first, duplicate]);
  const statuses = [one.status, two.status].sort();
  assert.ok(statuses.includes(200), JSON.stringify([one, two]));
  assert.ok(statuses.includes(409), JSON.stringify([one, two]));

  const originalRow = await db.query(
    `SELECT status, rescheduled_to_id FROM patient_portal_appointments WHERE id = $1`,
    [originalId]
  );
  assert.equal(originalRow.rows[0].status, "rescheduled");
  assert.ok(originalRow.rows[0].rescheduled_to_id);

  const again = await jsonFetch(`${base}/api/patient/appointments/${originalId}/reschedule`, {
    method: "POST",
    token: patientToken,
    body: { appointmentDate: "2026-11-13", appointmentTime: "09:00" },
  });
  assert.equal(again.status, 409);
  assert.match(String(again.body.message), /no longer be rescheduled/i);
});

test("reschedule modal stays open after an unavailable slot and retries another time", { timeout: 120000 }, async (t) => {
  const frontendUrl = process.env.E2E_FRONTEND_URL || "http://127.0.0.1:5191";
  const apiUrl = process.env.E2E_API_URL || "http://127.0.0.1:5030";
  const chrome = "/usr/local/bin/google-chrome";
  const fs = require("node:fs");
  assert.ok(fs.existsSync(chrome), "google-chrome is required for the modal retry E2E");

  const health = await fetch(`${frontendUrl}/login`).catch(() => null);
  assert.ok(health?.ok, `frontend is not reachable at ${frontendUrl}`);

  const patientId = await ensureUser({
    ...PATIENT,
    role: "patient",
    firstName: "Test",
    lastName: "Patient",
    phone: "639172222222",
  });
  await db.query(
    `UPDATE patient_portal_appointments
     SET status = 'cancelled', cancellation_reason = 'e2e_reset', updated_at = CURRENT_TIMESTAMP
     WHERE dentist_id = 'dr-sarah-cruz'
       AND appointment_date = DATE '2026-11-16'
       AND appointment_time IN (TIME '10:00', TIME '10:30', TIME '09:00')
       AND status NOT IN ('cancelled', 'no_show', 'rescheduled')`
  );
  const original = await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, clinic_location
     ) VALUES (
       $1, 'extraction', 'E2E Reschedule Retry', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       '2026-11-16', '09:00', 'self_pay', 3500, 'confirmed', 'Amethyst Dental — Makati'
     )
     RETURNING id`,
    [String(patientId)]
  );
  const originalId = original.rows[0].id;
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, clinic_location
     ) VALUES (
       $1, 'cleaning', 'Occupying Slot', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       '2026-11-16', '10:00', 'self_pay', 1800, 'confirmed', 'Amethyst Dental — Makati'
     )`,
    [String(patientId)]
  );

  const login = await jsonFetch(`${apiUrl}/api/auth/login`, {
    method: "POST",
    body: { identifier: PATIENT.email, password: PATIENT.password },
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const puppeteer = require("/tmp/node_modules/puppeteer-core");
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: "new",
    protocolTimeout: 120000,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  t.after(async () => {
    await browser.close().catch(() => {});
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  await page.emulateTimezone("Asia/Manila");
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${frontendUrl}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((token) => localStorage.setItem("amethyst_access_token", token), login.body.token);
  await page.goto(`${frontendUrl}/appointments`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.body.innerText.includes("E2E Reschedule Retry"),
    { timeout: 20000 }
  );
  const opened = await page.evaluate(() => {
    const cards = [...document.querySelectorAll(".appointment-history-card")];
    const card = cards.find((item) => {
      const text = item.textContent || "";
      if (!text.includes("E2E Reschedule Retry")) return false;
      return [...item.querySelectorAll("button")].some((button) =>
        (button.textContent || "").includes("Reschedule")
      );
    });
    const button = [...(card?.querySelectorAll("button") || [])].find((item) =>
      (item.textContent || "").includes("Reschedule")
    );
    button?.scrollIntoView({ block: "center" });
    button?.click();
    return Boolean(button);
  });
  assert.equal(opened, true);
  await page.waitForSelector(".reschedule-modal");
  await page.waitForFunction(() => document.querySelectorAll(".reschedule-modal .time-slot[data-slot-time]").length > 1);
  const slotTimes = await page.evaluate(() =>
    [...document.querySelectorAll(".reschedule-modal .time-slot[data-slot-time]")].map((button) =>
      button.getAttribute("data-slot-time")
    )
  );
  const conflictTime = slotTimes[0];
  const retryTime = slotTimes[1];
  assert.ok(conflictTime && retryTime);
  const selectedDate = await page.$eval('.reschedule-modal input[type="date"]', (input) => input.value);

  await page.evaluate((time) => {
    document.querySelector(`.reschedule-modal .time-slot[data-slot-time="${time}"]`)?.click();
  }, conflictTime);
  await db.query(
    `UPDATE patient_portal_appointments
     SET status = 'cancelled', cancellation_reason = 'e2e_reset', updated_at = CURRENT_TIMESTAMP
     WHERE dentist_id = 'dr-sarah-cruz'
       AND appointment_date = $1::date
       AND appointment_time = $2::time
       AND status NOT IN ('cancelled', 'no_show', 'rescheduled')
       AND id <> $3`,
    [selectedDate, conflictTime, originalId]
  );
  await db.query(
    `INSERT INTO patient_portal_appointments (
       user_id, service_id, service_name, dentist_id, dentist_name,
       appointment_date, appointment_time, coverage_type, estimated_cost, status, clinic_location
     ) VALUES (
       $1, 'whitening', 'Late Occupying Slot', 'dr-sarah-cruz', 'Dr. Sarah Cruz',
       $2::date, $3::time, 'self_pay', 8000, 'confirmed', 'Amethyst Dental — Makati'
     )`,
    [String(patientId), selectedDate, conflictTime]
  );
  await page.evaluate(() => {
    const button = [...document.querySelectorAll(".reschedule-modal button")].find((item) =>
      (item.textContent || "").includes("Confirm Reschedule")
    );
    button?.click();
  });
  await page.waitForFunction(() => {
    const alert = document.querySelector(".reschedule-modal .inline-alert--error");
    return Boolean(alert && alert.textContent.trim());
  });
  const modalStillOpen = await page.$(".reschedule-modal");
  assert.ok(modalStillOpen);
  const errorText = await page.$eval(".reschedule-modal .inline-alert--error", (el) => el.textContent);
  assert.match(errorText, /no longer available|just booked|choose another/i);

  await page.waitForFunction(
    (time) => Boolean(document.querySelector(`.reschedule-modal .time-slot[data-slot-time="${time}"]`)),
    { timeout: 15000 },
    retryTime
  );
  await page.evaluate((time) => {
    document.querySelector(`.reschedule-modal .time-slot[data-slot-time="${time}"]`)?.click();
  }, retryTime);
  await page.waitForFunction(() => {
    const confirm = [...document.querySelectorAll(".reschedule-modal button")].find((item) =>
      (item.textContent || "").includes("Confirm Reschedule")
    );
    return Boolean(confirm && !confirm.disabled);
  });
  await page.evaluate(() => {
    const confirm = [...document.querySelectorAll(".reschedule-modal button")].find((item) =>
      (item.textContent || "").includes("Confirm Reschedule")
    );
    confirm?.click();
  });
  await page.waitForFunction(
    () => {
      if (document.querySelector(".reschedule-modal .inline-alert--error")) return false;
      const cards = [...document.querySelectorAll(".appointment-history-card")];
      return cards.some((card) => {
        const text = card.textContent || "";
        return text.includes("E2E Reschedule Retry") && /Rescheduled/i.test(text);
      });
    },
    { timeout: 20000 }
  );

  const after = await db.query(`SELECT status, rescheduled_to_id FROM patient_portal_appointments WHERE id = $1`, [
    originalId,
  ]);
  assert.equal(after.rows[0].status, "rescheduled");
  assert.ok(after.rows[0].rescheduled_to_id);
});
