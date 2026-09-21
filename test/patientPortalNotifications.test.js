"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { mapPatientNotification } = require("../services/patientPortalNotifications");

test("patient notification mapper exposes entity fields for source links", () => {
  const mapped = mapPatientNotification({
    id: 9,
    type: "appointment",
    title: "Appointment confirmed",
    body: "Tomorrow at 10:00.",
    entity_type: "appointment",
    entity_id: "44",
    read_at: null,
    created_at: "2026-09-21T00:00:00.000Z",
  });
  assert.equal(mapped.entityType, "appointment");
  assert.equal(mapped.entityId, "44");
  assert.equal(mapped.read, false);
});
