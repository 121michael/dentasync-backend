"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SERVICES } = require("../routes/patientPortal");

test("patient bookable services use the updated clinic names", () => {
  const names = SERVICES.map((service) => service.name);
  assert.ok(names.includes("Dental Cleaning / Oral Prophylaxis"));
  assert.ok(names.includes("Tooth Extraction"));
  assert.ok(names.includes("Permanent Filling / Restoration"));
  assert.ok(names.includes("Root Canal Treatment"));
  assert.ok(names.includes("Orthodontic Consultation"));
  assert.ok(names.includes("Teeth Whitening"));
  assert.ok(names.includes("Oral Examination / Consultation"));
  assert.ok(names.includes("Emergency Dental Care"));
  assert.ok(names.includes("Oral Surgery"));
  assert.ok(names.includes("Dentures / Fixed Bridge / Crown"));
  assert.equal(SERVICES.length, 10);
  for (const service of SERVICES) {
    assert.equal(typeof service.durationMinutes, "number");
    assert.equal(service.duration, undefined);
  }
});
