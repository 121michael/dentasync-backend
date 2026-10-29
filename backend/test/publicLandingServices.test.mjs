import assert from "node:assert/strict";
import test from "node:test";
import {
  BRIDGE_CROWN_PUBLIC_DESCRIPTION,
  BRIDGE_CROWN_PUBLIC_NAME,
  isCombinedBridgeCrownService,
  presentPublicLandingServices,
} from "../../frontend/src/clinic/publicLandingServices.js";

test("public landing combines Fixed Bridge / Dental Crowns and omits Emergency Dental Care", () => {
  const presented = presentPublicLandingServices([
    { id: "cleaning", name: "Dental Cleaning / Oral Prophylaxis", description: "Professional dental cleaning." },
    { id: "emergency-care", name: "Emergency Dental Care", description: "Emergency dental care." },
    { id: "fixed-bridge", name: "Fixed Bridge", description: "A fixed bridge to replace missing teeth." },
    { id: "dental-crowns", name: "Dental Crowns", description: "A dental crown to restore a tooth." },
    { id: "veneers", name: "Veneers" },
  ]);
  const names = presented.map((service) => service.name);
  const ids = presented.map((service) => service.id);

  assert.equal(names.includes("Emergency Dental Care"), false);
  assert.equal(ids.includes("emergency-care"), false);
  assert.equal(names.includes("Fixed Bridge"), false);
  assert.equal(names.includes("Dental Crowns"), false);
  assert.equal(names.filter((name) => name === BRIDGE_CROWN_PUBLIC_NAME).length, 1);
  assert.equal(ids.filter((id) => id === "fixed-bridge").length, 1);

  const combined = presented.find((service) => service.id === "fixed-bridge");
  assert.equal(isCombinedBridgeCrownService(combined), true);
  assert.equal(combined.description, BRIDGE_CROWN_PUBLIC_DESCRIPTION);
  assert.match(combined.description, /missing teeth/);
  assert.match(combined.description, /individual tooth/);
  assert.doesNotMatch(combined.description, /₱/);
  assert.equal(Boolean(combined.imageUrl), true);
  assert.equal(
    presented.some((service) => /₱|starting at/i.test(`${service.name} ${service.description}`)),
    false
  );
});

test("public landing keeps other services and still works if only crowns exist", () => {
  const presented = presentPublicLandingServices([
    { id: "emergency-care", name: "Emergency Dental Care" },
    { id: "veneers", name: "Veneers" },
    { id: "dental-crowns", name: "Dental Crowns", description: "A dental crown to restore a tooth." },
  ]);
  assert.deepEqual(
    presented.map((service) => service.id),
    ["veneers", "fixed-bridge"]
  );
  assert.equal(presented[1].name, BRIDGE_CROWN_PUBLIC_NAME);
});

test("public landing presentation does not mutate the original catalog entries", () => {
  const original = [
    { id: "emergency-care", name: "Emergency Dental Care" },
    { id: "fixed-bridge", name: "Fixed Bridge", description: "priced per unit" },
    { id: "dental-crowns", name: "Dental Crowns" },
  ];
  presentPublicLandingServices(original);
  assert.equal(original.length, 3);
  assert.equal(original[1].name, "Fixed Bridge");
  assert.equal(original[1].description, "priced per unit");
});
