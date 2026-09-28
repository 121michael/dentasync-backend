"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicSchedule = require("../services/clinicSchedule");

test("weekdays use 9:00–16:00 and weekends use 11:00–16:00 by default", () => {
  const monday = clinicSchedule.resolveOperatingHours("2026-09-28", null);
  const saturday = clinicSchedule.resolveOperatingHours("2026-09-26", null);
  const sunday = clinicSchedule.resolveOperatingHours("2026-09-27", null);
  assert.equal(monday.source, "weekday");
  assert.equal(monday.open, "09:00");
  assert.equal(monday.close, "16:00");
  assert.equal(monday.compact, "9-4");
  assert.equal(saturday.source, "weekend");
  assert.equal(saturday.open, "11:00");
  assert.equal(sunday.open, "11:00");
  assert.equal(sunday.close, "16:00");
});

test("holiday hours take precedence over weekday hours", () => {
  const hours = clinicSchedule.resolveOperatingHours("2026-09-28", { is_holiday: true, mode: "default" });
  assert.equal(hours.source, "holiday");
  assert.equal(hours.open, "11:00");
  assert.equal(hours.close, "16:00");
  assert.equal(hours.isHoliday, true);
});

test("explicit custom hours and closures override holidays", () => {
  const custom = clinicSchedule.resolveOperatingHours("2026-09-29", {
    mode: "custom",
    is_holiday: true,
    open_time: "11:00",
    close_time: "16:00",
  });
  const closed = clinicSchedule.resolveOperatingHours("2026-09-29", { mode: "closed", is_holiday: true });
  assert.equal(custom.source, "custom");
  assert.equal(custom.open, "11:00");
  assert.equal(closed.source, "closed");
  assert.equal(closed.closed, true);
});

test("slots are generated inside operating hours and skip booked or unavailable times", () => {
  const hours = clinicSchedule.resolveOperatingHours("2026-09-29", {
    mode: "custom",
    open_time: "11:00",
    close_time: "16:00",
  });
  const times = clinicSchedule.generateSlotTimes(hours.open, hours.close, 30);
  assert.deepEqual(times.slice(0, 2), ["11:00", "11:30"]);
  assert.equal(times.at(-1), "15:30");
  assert.equal(times.includes("16:00"), false);

  const slots = clinicSchedule.buildSlots(
    hours,
    clinicSchedule.DEFAULTS,
    new Map([["12:00", "unavailable"]]),
    new Map([["11:00", 1]])
  );
  assert.equal(slots.find((slot) => slot.time === "11:00").status, "booked");
  assert.equal(slots.find((slot) => slot.time === "12:00").status, "unavailable");
  assert.equal(slots.find((slot) => slot.time === "11:30").bookable, true);
  assert.equal(clinicSchedule.isSlotBookable(hours, clinicSchedule.DEFAULTS, new Map(), new Map(), "16:00"), false);
  assert.equal(
    clinicSchedule.isSlotBookable({ ...hours, closed: true }, clinicSchedule.DEFAULTS, new Map(), new Map(), "11:00"),
    false
  );
});
