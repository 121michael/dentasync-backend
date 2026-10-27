"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SERVICES } = require("../routes/patientPortal");

test("patient bookable services use the updated clinic names", () => {
  const names = SERVICES.map((service) => service.name);
  const ids = SERVICES.map((service) => service.id);
  assert.ok(names.includes("Dental Cleaning / Oral Prophylaxis"));
  assert.ok(names.includes("Tooth Extraction"));
  assert.ok(names.includes("Permanent Filling / Restoration"));
  assert.ok(names.includes("Root Canal Treatment"));
  assert.ok(names.includes("Orthodontics / Braces"));
  assert.ok(names.includes("Teeth Whitening"));
  assert.ok(names.includes("Oral Examination / Consultation"));
  assert.ok(names.includes("Emergency Dental Care"));
  assert.ok(names.includes("Oral Surgery"));
  assert.ok(names.includes("Dentures"));
  assert.ok(names.includes("Fixed Bridge"));
  assert.ok(names.includes("Dental Crowns"));
  assert.ok(names.includes("Veneers"));
  assert.ok(names.includes("Dental Implants"));
  assert.ok(names.includes("Gum Contouring"));
  assert.equal(names.includes("Dentures / Fixed Bridge / Crown"), false);
  assert.deepEqual(
    ["dentures", "fixed-bridge", "dental-crowns", "veneers", "dental-implants", "gum-contouring"].sort(),
    ids.filter((id) =>
      ["dentures", "fixed-bridge", "dental-crowns", "veneers", "dental-implants", "gum-contouring"].includes(id)
    ).sort()
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(SERVICES.length, 15);
  for (const service of SERVICES) {
    assert.equal(typeof service.durationMinutes, "number");
    assert.equal(typeof service.description, "string");
    assert.ok(service.description.length > 0);
    assert.equal(service.duration, undefined);
  }
});
