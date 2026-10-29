"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createClinicSmsService } = require("../services/clinicSms");

function createMemoryDb({ appointment, user } = {}) {
  const reminders = [];
  const logs = [];
  const idempotency = new Map();
  const appointments = new Map();
  if (appointment) appointments.set(appointment.id, appointment);
  const users = new Map();
  if (user) users.set(String(user.id), user);

  return {
    reminders,
    logs,
    appointments,
    async query(sql, params = []) {
      const q = String(sql).replace(/\s+/g, " ");
      if (q.includes("FROM admin_portal_settings")) return { rows: [] };
      if (q.includes("FROM patient_portal_preferences")) return { rows: [] };
      if (q.includes("FROM users")) {
        return { rows: users.get(String(params[0])) ? [users.get(String(params[0]))] : [] };
      }
      if (q.includes("MAX(schedule_version)")) {
        const max = reminders
          .filter((row) => Number(row.appointment_id) === Number(params[0]))
          .reduce((current, row) => Math.max(current, Number(row.schedule_version || 0)), 0);
        return { rows: [{ next_version: max + 1 }] };
      }
      if (q.includes("UPDATE clinic_appointment_sms_reminders") && q.includes("status = 'cancelled'")) {
        const updated = [];
        for (const row of reminders) {
          if (Number(row.appointment_id) === Number(params[0]) && ["scheduled", "processing", "failed"].includes(row.status)) {
            row.status = "cancelled";
            row.last_error = params[1];
            updated.push(row);
          }
        }
        return { rows: updated };
      }
      if (q.includes("INSERT INTO clinic_appointment_sms_reminders")) {
        const row = {
          id: reminders.length + 1,
          appointment_id: params[0],
          patient_user_id: params[1],
          reminder_kind: params[2],
          schedule_version: params[3],
          appointment_at: params[4],
          scheduled_for: params[5],
          service_name: params[6],
          status: params[7],
          last_error: params[8],
          retry_count: 0,
        };
        reminders.push(row);
        return { rows: [row] };
      }
      if (q.includes("FROM patient_portal_appointments") && q.includes("user_id = $2")) {
        const row = appointments.get(params[0]);
        if (row && String(row.user_id) === String(params[1])) return { rows: [row] };
        return { rows: [] };
      }
      if (q.includes("FROM patient_portal_appointments")) {
        const row = appointments.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (q.includes("INSERT INTO clinic_sms_logs")) {
        const row = { id: logs.length + 1, delivery_status: params[6], message_type: params[4] };
        logs.push(row);
        return { rows: [row] };
      }
      if (q.includes("FROM clinic_sms_idempotency")) {
        const row = idempotency.get(params[0]);
        return { rows: row ? [row] : [] };
      }
      if (q.includes("INSERT INTO clinic_sms_idempotency")) {
        idempotency.set(params[0], {
          idempotency_key: params[0],
          sms_log_id: params[1],
          delivery_status: params[2],
        });
        return { rows: [] };
      }
      if (q.includes("SET status = 'processing'")) {
        const now = Date.now();
        const due = reminders
          .filter((row) => row.status === "scheduled" && new Date(row.scheduled_for).getTime() <= now)
          .slice(0, Number(params[0] || 25));
        due.forEach((row) => {
          row.status = "processing";
        });
        return { rows: due };
      }
      if (q.includes("UPDATE clinic_appointment_sms_reminders") && q.includes("SET status = $2")) {
        const row = reminders.find((item) => item.id === params[0]);
        if (row) {
          row.status = params[1];
          row.last_error = params[4];
        }
        return { rows: row ? [row] : [] };
      }
      if (q.includes("FROM clinic_sms_logs")) return { rows: logs };
      return { rows: [] };
    },
  };
}

const futureAppointment = {
  id: 41,
  user_id: "patient-1",
  service_name: "Oral Prophylaxis",
  appointment_date: "2026-11-10",
  appointment_time: "14:00:00",
  status: "confirmed",
};

function createService(db, fetchImpl) {
  return createClinicSmsService({
    db,
    semaphoreApiKey: "test-key",
    clinicName: "Amethyst Dental Clinic",
    fetchImpl:
      fetchImpl ||
      (async () => ({
        ok: true,
        text: async () => JSON.stringify([{ message_id: 9001, status: "Pending" }]),
      })),
    sleepImpl: async () => {},
  });
}

test("confirming an appointment schedules 24h and 10h reminders without sending them immediately", async () => {
  const db = createMemoryDb({
    appointment: futureAppointment,
    user: { id: "patient-1", phone: "09171234567", first_name: "Ana", last_name: "Cruz" },
  });
  const sms = createService(db);
  const now = new Date("2026-10-29T04:00:00Z");
  const result = await sms.handleAppointmentEvent({
    appointment: futureAppointment,
    action: "confirm",
    actorRole: "staff",
    actorId: "staff-1",
    now,
  });
  const scheduled = db.reminders.filter((row) => row.status === "scheduled");
  assert.equal(scheduled.length, 2);
  assert.deepEqual(scheduled.map((row) => row.reminder_kind).sort(), ["10h", "24h"]);
  assert.equal(result.status === "sent" || result.status === "delivered", true);
});

test("appointments booked inside 24 hours skip the stale 24h reminder", async () => {
  const appointment = {
    ...futureAppointment,
    id: 42,
    appointment_date: "2026-10-30",
    appointment_time: "10:00:00",
  };
  const db = createMemoryDb({ appointment, user: { id: "patient-1", phone: "09171234567" } });
  const sms = createService(db);
  const now = new Date("2026-10-29T18:00:00+08:00");
  await sms.scheduleRemindersForAppointment(appointment, { now });
  const byKind = Object.fromEntries(db.reminders.map((row) => [row.reminder_kind, row.status]));
  assert.equal(byKind["24h"], "skipped");
  assert.equal(byKind["10h"], "scheduled");
});

test("appointments booked inside 10 hours do not send missed reminders", async () => {
  const appointment = {
    ...futureAppointment,
    id: 43,
    appointment_date: "2026-10-29",
    appointment_time: "16:00:00",
  };
  const db = createMemoryDb({ appointment });
  const sms = createService(db);
  const now = new Date("2026-10-29T10:00:00+08:00");
  await sms.scheduleRemindersForAppointment(appointment, { now });
  assert.equal(db.reminders.every((row) => row.status === "skipped"), true);
});

test("rescheduling cancels old reminders and creates a new version", async () => {
  const db = createMemoryDb({
    appointment: futureAppointment,
    user: { id: "patient-1", phone: "09171234567" },
  });
  const sms = createService(db);
  const now = new Date("2026-10-29T04:00:00Z");
  await sms.scheduleRemindersForAppointment(futureAppointment, { now });
  const moved = {
    ...futureAppointment,
    appointment_date: "2026-11-12",
    appointment_time: "09:00:00",
  };
  db.appointments.set(moved.id, moved);
  await sms.handleAppointmentEvent({
    appointment: moved,
    previous: futureAppointment,
    action: "reschedule",
    now,
  });
  const cancelled = db.reminders.filter((row) => row.status === "cancelled");
  const active = db.reminders.filter((row) => row.status === "scheduled");
  assert.ok(cancelled.length >= 2);
  assert.equal(active.length, 2);
  assert.ok(active.every((row) => Number(row.schedule_version) >= 2));
});

test("cancellation and completion stop pending reminders", async () => {
  const db = createMemoryDb({
    appointment: futureAppointment,
    user: { id: "patient-1", phone: "09171234567" },
  });
  const sms = createService(db);
  await sms.scheduleRemindersForAppointment(futureAppointment, { now: new Date("2026-10-29T04:00:00Z") });
  await sms.handleAppointmentEvent({
    appointment: { ...futureAppointment, status: "cancelled" },
    action: "cancel",
  });
  assert.equal(db.reminders.filter((row) => row.status === "scheduled").length, 0);

  const completedDb = createMemoryDb({ appointment: futureAppointment });
  const completedSms = createService(completedDb);
  await completedSms.scheduleRemindersForAppointment(futureAppointment, { now: new Date("2026-10-29T04:00:00Z") });
  await completedSms.handleAppointmentEvent({
    appointment: { ...futureAppointment, status: "completed" },
    action: "complete",
  });
  assert.equal(completedDb.reminders.filter((row) => row.status === "scheduled").length, 0);
});

test("duplicate confirmation requests reuse the idempotency key", async () => {
  const db = createMemoryDb({
    appointment: futureAppointment,
    user: { id: "patient-1", phone: "09171234567" },
  });
  let sends = 0;
  const sms = createService(db, async () => {
    sends += 1;
    return { ok: true, text: async () => JSON.stringify([{ message_id: 1, status: "Pending" }]) };
  });
  const now = new Date("2026-10-29T04:00:00Z");
  await sms.handleAppointmentEvent({ appointment: futureAppointment, action: "confirm", now });
  const second = await sms.handleAppointmentEvent({ appointment: futureAppointment, action: "confirm", now });
  assert.equal(sends, 1);
  assert.equal(second.duplicate, true);
});

test("invalid numbers are rejected and provider failures are logged as failed not delivered", async () => {
  const db = createMemoryDb({
    appointment: futureAppointment,
    user: { id: "patient-1", phone: "123" },
  });
  const sms = createService(db);
  const invalid = await sms.sendClinicSms({
    userId: "patient-1",
    phone: "123",
    message: "Hello",
    category: "general",
    respectPreferences: false,
  });
  assert.equal(invalid.status, "failed");
  assert.match(invalid.reason, /invalid/i);

  const failing = createService(db, async () => ({
    ok: false,
    status: 500,
    text: async () => JSON.stringify({ message: "upstream" }),
  }));
  const failed = await failing.sendClinicSms({
    phone: "09171234567",
    message: "Hello",
    category: "otp",
    respectPreferences: false,
  });
  assert.equal(failed.status, "failed");
  assert.notEqual(failed.status, "delivered");
});

test("opt-out preferences skip appointment SMS", async () => {
  const db = createMemoryDb({
    appointment: futureAppointment,
    user: { id: "patient-1", phone: "09171234567" },
  });
  const original = db.query.bind(db);
  db.query = async (sql, params) => {
    if (String(sql).includes("FROM patient_portal_preferences")) {
      return {
        rows: [
          {
            notify_sms: true,
            notify_appointment_sms: false,
            notify_queue_sms: true,
            notify_cleaning_sms: true,
          },
        ],
      };
    }
    return original(sql, params);
  };
  const sms = createService(db);
  const result = await sms.sendClinicSms({
    userId: "patient-1",
    message: "Reminder",
    category: "appointment",
  });
  assert.equal(result.status, "skipped");
  assert.match(result.reason, /opted out/i);
});

test("due reminder processing rechecks status and does not send for cancelled appointments", async () => {
  const appointment = { ...futureAppointment, status: "cancelled" };
  const db = createMemoryDb({
    appointment,
    user: { id: "patient-1", phone: "09171234567" },
  });
  db.reminders.push({
    id: 1,
    appointment_id: appointment.id,
    patient_user_id: "patient-1",
    reminder_kind: "24h",
    schedule_version: 1,
    scheduled_for: new Date(Date.now() - 1000).toISOString(),
    status: "scheduled",
    retry_count: 0,
  });
  const sms = createService(db);
  const summary = await sms.processDueReminders();
  assert.equal(summary.cancelled, 1);
  assert.equal(db.reminders[0].status, "cancelled");
});
