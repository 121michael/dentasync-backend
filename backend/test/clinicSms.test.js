"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createClinicSmsService, formatPhoneE164, formatPhoneSemaphore, isValidPhMobile } = require("../services/clinicSms");
const { monthsBetween } = require("../services/cleaningReminders");
const {
  planReminderTimes,
  reminderMessage,
  rescheduleMessage,
  whenPhrase,
} = require("../services/appointmentSms");

test("formatPhoneE164 normalizes PH local numbers", () => {
  assert.equal(formatPhoneE164("09171234567"), "+639171234567");
  assert.equal(formatPhoneE164("639171234567"), "+639171234567");
  assert.equal(formatPhoneE164("+639171234567"), "+639171234567");
});

test("formatPhoneSemaphore uses PH format without plus", () => {
  assert.equal(formatPhoneSemaphore("09171234567"), "639171234567");
  assert.equal(formatPhoneSemaphore("+639171234567"), "639171234567");
  assert.equal(isValidPhMobile("09171234567"), true);
  assert.equal(isValidPhMobile("123"), false);
});

test("appointment SMS copy covers confirm/reschedule/cancel and reminder wording", () => {
  const sms = createClinicSmsService({ db: { query: async () => ({ rows: [] }) }, clinicName: "Amethyst Dental Clinic" });
  assert.match(
    sms.appointmentMessage("confirmed", {
      serviceName: "Oral Prophylaxis",
      date: "2026-08-24",
      time: "14:00:00",
    }),
    /Oral Prophylaxis/
  );
  assert.match(
    sms.appointmentMessage("rescheduled", {
      serviceName: "Oral Prophylaxis",
      date: "2026-10-30",
      time: "14:00:00",
    }),
    /rescheduled to October 30, 2026 at 2:00 PM/
  );
  assert.match(
    sms.appointmentMessage("cancelled", {
      serviceName: "Cleaning",
      date: "2026-08-24",
      time: "10:30:00",
    }),
    /cancelled/
  );
});

test("reminder copy uses tomorrow only when the appointment is the next clinic day", () => {
  const now = new Date("2026-10-29T02:00:00Z");
  const message = reminderMessage({
    serviceName: "Oral Prophylaxis",
    date: "2026-10-30",
    time: "14:00",
    now,
    timeZone: "Asia/Manila",
  });
  assert.match(message, /tomorrow at 2:00 PM/);
  assert.match(message, /arrive on or before 2:00 PM/);
  const later = reminderMessage({
    serviceName: "Oral Prophylaxis",
    date: "2026-11-04",
    time: "14:00",
    now,
    timeZone: "Asia/Manila",
  });
  assert.match(later, /November 4, 2026 at 2:00 PM/);
  assert.equal(whenPhrase({ date: "2026-10-29", time: "14:00", now, timeZone: "Asia/Manila" }).includes("today"), true);
});

test("planReminderTimes skips windows that already passed", () => {
  const appointmentAt = new Date("2026-10-30T06:00:00.000Z");
  const fifteenHoursBefore = new Date(appointmentAt.getTime() - 15 * 60 * 60 * 1000);
  const plan = planReminderTimes({ appointmentAt, now: fifteenHoursBefore });
  const map = Object.fromEntries(plan.map((item) => [item.kind, item.eligible]));
  assert.equal(map["24h"], false);
  assert.equal(map["10h"], true);

  const fiveHoursBefore = new Date(appointmentAt.getTime() - 5 * 60 * 60 * 1000);
  const late = planReminderTimes({ appointmentAt, now: fiveHoursBefore });
  assert.equal(late.every((item) => item.eligible === false), true);
});

test("monthsBetween supports cleaning reminder windows", () => {
  assert.equal(monthsBetween("2026-02-24", new Date("2026-08-24")), 6);
  assert.equal(monthsBetween("2026-03-24", new Date("2026-08-24")), 5);
  assert.equal(monthsBetween("2026-04-24", new Date("2026-08-24")), 4);
});

test("reschedule message uses the updated appointment details", () => {
  assert.equal(
    rescheduleMessage({ serviceName: "Oral Prophylaxis", date: "2026-10-30", time: "14:00" }),
    "Your appointment for Oral Prophylaxis has been rescheduled to October 30, 2026 at 2:00 PM. Please arrive on or before 2:00 PM. Thank you."
  );
});
