"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createClinicSmsService, formatPhoneE164 } = require("../services/clinicSms");
const { monthsBetween } = require("../services/cleaningReminders");

test("formatPhoneE164 normalizes PH local numbers", () => {
  assert.equal(formatPhoneE164("09171234567"), "+639171234567");
  assert.equal(formatPhoneE164("639171234567"), "+639171234567");
  assert.equal(formatPhoneE164("+639171234567"), "+639171234567");
});

test("appointment SMS copy covers confirm/reschedule/cancel", () => {
  const sms = createClinicSmsService({ db: {}, clinicName: "Amethyst Dental Clinic" });
  assert.match(
    sms.appointmentMessage("confirmed", {
      serviceName: "Cleaning",
      date: "2026-08-24",
      time: "10:30:00",
      clinic: "Amethyst Dental Clinic",
    }),
    /confirmed for 2026-08-24 at 10:30/
  );
  assert.match(
    sms.appointmentMessage("rescheduled", {
      serviceName: "Cleaning",
      date: "2026-08-25",
      time: "11:00:00",
      clinic: "Amethyst Dental Clinic",
    }),
    /rescheduled to 2026-08-25 at 11:00/
  );
  assert.match(
    sms.appointmentMessage("cancelled", {
      serviceName: "Cleaning",
      date: "2026-08-24",
      time: "10:30:00",
      clinic: "Amethyst Dental Clinic",
    }),
    /was cancelled/
  );
});

test("monthsBetween supports cleaning reminder windows", () => {
  assert.equal(monthsBetween("2026-02-24", new Date("2026-08-24")), 6);
  assert.equal(monthsBetween("2026-03-24", new Date("2026-08-24")), 5);
  assert.equal(monthsBetween("2026-04-24", new Date("2026-08-24")), 4);
});
