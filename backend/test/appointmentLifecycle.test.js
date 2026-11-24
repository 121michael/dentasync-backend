"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const lifecycle = require("../services/appointmentLifecycle");
const { createUnproceededAppointmentCancelJob, AUTO_REASON } = require("../services/unproceededAppointmentCancelJob");

test("patient-facing labels distinguish checked in from completed", () => {
  assert.equal(lifecycle.displayAppointmentStatus("pending"), "Pending");
  assert.equal(lifecycle.displayAppointmentStatus("confirmed"), "Confirmed");
  assert.equal(lifecycle.displayAppointmentStatus("checked_in"), "Checked In");
  assert.equal(lifecycle.displayAppointmentStatus("completed"), "Completed");
  assert.equal(lifecycle.displayAppointmentStatus("cancelled"), "Cancelled");
  assert.equal(lifecycle.displayAppointmentStatus("rescheduled"), "Rescheduled");
  assert.equal(lifecycle.displayAppointmentStatus("no_show"), "No-show");
});

test("patients cannot cancel or reschedule a visit already with the dentist", () => {
  assert.equal(lifecycle.canPatientCancel("checked_in", "waiting"), true);
  assert.equal(lifecycle.canPatientCancel("checked_in", "dentist"), false);
  assert.equal(lifecycle.canPatientCancel("completed"), false);
  assert.equal(lifecycle.canPatientReschedule("confirmed", "checked_in"), true);
  assert.equal(lifecycle.canPatientReschedule("rescheduled"), false);
});

test("waited-too-long uses check-in time and ignores inactive or in-chair visits", () => {
  const now = new Date("2026-10-29T10:00:00.000Z");
  assert.equal(
    lifecycle.waitedTooLong({
      checkedInAt: "2026-10-29T07:59:00.000Z",
      queueStatus: "waiting",
      now,
    }),
    true
  );
  assert.equal(
    lifecycle.waitedTooLong({
      checkedInAt: "2026-10-29T08:01:00.000Z",
      queueStatus: "waiting",
      now,
    }),
    false
  );
  assert.equal(
    lifecycle.waitedTooLong({
      checkedInAt: "2026-10-29T07:00:00.000Z",
      queueStatus: "dentist",
      now,
    }),
    false
  );
  assert.equal(
    lifecycle.waitedTooLong({
      checkedInAt: "2026-10-29T07:00:00.000Z",
      queueStatus: "completed",
      now,
    }),
    false
  );
});

test("missed visits become no-show at 6 PM Manila on the clinic date, not at the scheduled start", () => {
  const beforeSlot = new Date("2026-10-29T02:01:00.000Z");
  const beforeSix = new Date("2026-10-29T09:59:00.000Z");
  const atSix = new Date("2026-10-29T10:00:00.000Z");
  assert.equal(
    lifecycle.missedCutoffPassed({
      appointmentDate: "2026-10-29",
      appointmentTime: "10:00",
      now: beforeSlot,
    }),
    false
  );
  assert.equal(
    lifecycle.missedCutoffPassed({
      appointmentDate: "2026-10-29",
      appointmentTime: "10:00",
      now: beforeSix,
    }),
    false
  );
  assert.equal(
    lifecycle.missedCutoffPassed({
      appointmentDate: "2026-10-29",
      appointmentTime: "10:00",
      now: atSix,
    }),
    true
  );
  assert.equal(
    lifecycle.missedCutoffPassed({
      appointmentDate: "2026-10-29",
      appointmentTime: null,
      now: new Date("2026-10-29T09:59:00.000Z"),
    }),
    false
  );
  assert.equal(
    lifecycle.missedCutoffPassed({
      appointmentDate: "2026-10-29",
      appointmentTime: null,
      now: new Date("2026-10-29T10:00:00.000Z"),
    }),
    true
  );
});

test("missed appointment job is idempotent and never targets checked-in visits", async () => {
  const updates = [];
  const db = {
    async query(sql, params) {
      updates.push({ sql, params });
      if (sql.includes("UPDATE patient_portal_appointments")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };
  const job = createUnproceededAppointmentCancelJob({ db });
  const morning = await job.runOnce(new Date("2026-10-29T01:00:00.000Z"));
  assert.equal(morning.skipped, false);
  assert.equal(morning.cancelled, 0);

  const update = updates.find((entry) => entry.sql.includes("UPDATE patient_portal_appointments"));
  assert.ok(update);
  assert.match(update.sql, /status IN \('pending', 'confirmed'\)/);
  assert.doesNotMatch(update.sql, /status IN \('pending', 'confirmed', 'checked_in'\)/);
  assert.match(update.sql, /EXTRACT\(HOUR FROM/);
  assert.match(update.sql, /FOR UPDATE SKIP LOCKED/);
  assert.equal(update.params[1], "Asia/Manila");
  assert.equal(update.params[2], AUTO_REASON);

  const again = await job.runOnce(new Date("2026-10-29T01:05:00.000Z"));
  assert.equal(again.cancelled, 0);
});
