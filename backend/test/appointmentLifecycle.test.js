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

test("auto-cancel runs at or after 18:00 Asia/Manila", () => {
  assert.equal(lifecycle.shouldRunAutoCancel(new Date("2026-10-29T09:59:00.000Z"), "Asia/Manila"), false);
  assert.equal(lifecycle.shouldRunAutoCancel(new Date("2026-10-29T10:00:00.000Z"), "Asia/Manila"), true);
});

test("unproceeded job is idempotent and skips in-treatment visits", async () => {
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
  const beforeCutoff = await job.runOnce(new Date("2026-10-29T09:00:00.000Z"));
  assert.equal(beforeCutoff.skipped, true);
  assert.equal(beforeCutoff.cancelled, 0);

  const afterCutoff = await job.runOnce(new Date("2026-10-29T11:00:00.000Z"));
  assert.equal(afterCutoff.cancelled, 0);
  const update = updates.find((entry) => entry.sql.includes("UPDATE patient_portal_appointments"));
  assert.ok(update);
  assert.match(update.sql, /status IN \('pending', 'confirmed', 'checked_in'\)/);
  assert.match(update.sql, /preparing', 'called', 'dentist/);
  assert.equal(update.params[1], AUTO_REASON);

  const again = await job.runOnce(new Date("2026-10-29T11:05:00.000Z"));
  assert.equal(again.cancelled, 0);
});
