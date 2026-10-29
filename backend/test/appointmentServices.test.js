"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { SERVICES } = require("../routes/patientPortal");

function publicServices() {
  return SERVICES.filter((service) => service.bookable !== false);
}

test("patient bookable services use the updated clinic names", () => {
  const names = publicServices().map((service) => service.name);
  const ids = publicServices().map((service) => service.id);
  assert.ok(names.includes("Dental Cleaning / Oral Prophylaxis"));
  assert.ok(names.includes("Tooth Extraction"));
  assert.ok(names.includes("Permanent Filling / Restoration"));
  assert.ok(names.includes("Root Canal Treatment"));
  assert.ok(names.includes("Orthodontics / Braces"));
  assert.ok(names.includes("Ortho Adjustment"));
  assert.ok(names.includes("Teeth Whitening"));
  assert.ok(names.includes("Oral Examination / Consultation"));
  assert.equal(names.includes("Emergency Dental Care"), false);
  assert.equal(ids.includes("emergency-care"), false);
  assert.equal(names.includes("Oral Surgery"), false);
  assert.ok(names.includes("Odontectomy"));
  assert.ok(names.includes("Frenectomy"));
  assert.ok(names.includes("Dentures"));
  assert.ok(names.includes("Fixed Bridge / Dental Crowns"));
  assert.equal(names.includes("Fixed Bridge"), false);
  assert.equal(names.includes("Dental Crowns"), false);
  assert.ok(names.includes("Veneers"));
  assert.ok(names.includes("Dental Implant"));
  assert.ok(names.includes("Gum Contouring"));
  assert.equal(names.includes("Dentures / Fixed Bridge / Crown"), false);
  assert.deepEqual(
    ["dentures", "fixed-bridge", "veneers", "dental-implants", "gum-contouring"].sort(),
    ids
      .filter((id) =>
        ["dentures", "fixed-bridge", "veneers", "dental-implants", "gum-contouring"].includes(id)
      )
      .sort()
  );
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes("dental-crowns"), false);
  assert.ok(SERVICES.some((service) => service.id === "emergency-care" && service.bookable === false));
  assert.ok(SERVICES.some((service) => service.id === "dental-crowns" && service.bookable === false));
  assert.ok(SERVICES.some((service) => service.id === "oral-surgery" && service.bookable === false));
  const rootCanal = publicServices().find((service) => service.id === "root-canal");
  assert.equal(rootCanal.estimatedCost, 5000);
  const implant = publicServices().find((service) => service.id === "dental-implants");
  assert.equal(implant.estimatedCost, 100000);
  for (const service of publicServices()) {
    assert.equal(typeof service.durationMinutes, "number");
    assert.equal(typeof service.description, "string");
    assert.ok(service.description.length > 0);
    assert.equal(service.duration, undefined);
  }
});
