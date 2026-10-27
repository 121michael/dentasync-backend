import assert from "node:assert/strict";
import test from "node:test";
import { getApprovedClinicPrice } from "../../frontend/src/clinic/approvedClinicPrices.js";

test("split denture bridge and crown services keep distinct verified prices", () => {
  const dentures = getApprovedClinicPrice({ id: "dentures", name: "Dentures" });
  assert.equal(dentures.verified, true);
  assert.match(dentures.priceLabel, /₱7,500/);

  const bridge = getApprovedClinicPrice({ id: "fixed-bridge", name: "Fixed Bridge" });
  assert.equal(bridge.verified, true);
  assert.match(bridge.priceLabel, /₱7,000 per unit/);
  assert.notEqual(bridge.id, dentures.id);

  const crowns = getApprovedClinicPrice({ id: "dental-crowns", name: "Dental Crowns" });
  assert.equal(crowns.verified, true);
  assert.match(crowns.details, /₱7,000/);
  assert.match(crowns.details, /₱15,000/);
});

test("orthodontics shows metal braces prices and not retainer fees for invisible braces", () => {
  const price = getApprovedClinicPrice({ id: "orthodontic-consultation", name: "Orthodontics / Braces" });
  const metal = price.options.find((option) => option.id === "metal-braces");
  const invisible = price.options.find((option) => option.id === "invisible-braces");
  assert.match(metal.priceLabel, /₱5,000/);
  assert.match(metal.details, /₱1,250/);
  assert.equal(invisible.priceLabel, "Price available upon consultation");
  assert.doesNotMatch(invisible.priceLabel, /₱5,000 for upper or lower/);
  assert.doesNotMatch(invisible.details, /₱15,000/);
});

test("veneers implants and gum contouring do not invent peso prices", () => {
  for (const service of [
    { id: "veneers", name: "Veneers" },
    { id: "dental-implants", name: "Dental Implants" },
    { id: "gum-contouring", name: "Gum Contouring" },
  ]) {
    const price = getApprovedClinicPrice(service);
    assert.equal(price.priceLabel, "Available upon consultation");
    assert.doesNotMatch(price.priceLabel, /₱\d/);
    assert.doesNotMatch(price.details, /₱\d/);
  }
});
