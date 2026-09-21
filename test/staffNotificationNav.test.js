"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

async function loadNav() {
  return import(pathToFileURL(`${process.cwd()}/client/src/staffNotificationNav.js`).href);
}

test("staff check-in notifications open the live queue with a focus query", async () => {
  const { getStaffNotificationTarget } = await loadNav();
  const target = getStaffNotificationTarget({
    type: "check_in",
    entityType: "queue",
    entityId: "A-101",
  });
  assert.equal(target.path, "/staff/queue?focus=A-101");
});

test("staff appointment request notifications open appointments with the record id", async () => {
  const { getStaffNotificationTarget } = await loadNav();
  const target = getStaffNotificationTarget({
    type: "appointment",
    title: "New Appointment Request",
    entityType: "appointment",
    entityId: 42,
  });
  assert.match(target.path, /\/staff\/appointments\?/);
  assert.match(target.path, /focus=42/);
  assert.match(target.path, /section=pending/);
});

test("staff patient notifications open the patient record", async () => {
  const { getStaffNotificationTarget } = await loadNav();
  const target = getStaffNotificationTarget({
    type: "patient",
    entityType: "patient",
    entityId: "7",
  });
  assert.equal(target.path, "/staff/patients?focus=7");
});

test("patient queue notifications open the queue page", async () => {
  const { getPatientNotificationTarget } = await loadNav();
  assert.equal(getPatientNotificationTarget({ type: "queue" }).path, "/queue");
  assert.equal(getPatientNotificationTarget({ type: "appointment" }).path, "/appointments");
});
