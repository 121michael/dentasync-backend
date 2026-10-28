import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getApprovedClinicPrice } from "../../frontend/src/clinic/approvedClinicPrices.js";
import {
  DENTURES_IMAGE_URL,
  ORTHODONTICS_IMAGE_URL,
  attachServiceVisual,
} from "../../frontend/src/clinic/serviceVisuals.js";

const frontendRoot = join(dirname(fileURLToPath(import.meta.url)), "../../frontend");

test("split denture bridge and crown services keep distinct verified prices", () => {
  const dentures = getApprovedClinicPrice({
    id: "dentures",
    name: "Dentures",
    description:
      "Dentures are removable dental appliances designed to replace missing teeth and help restore everyday oral function and appearance. The suitable denture type and materials depend on the patient's needs and the dentist's assessment.",
  });
  assert.equal(dentures.verified, true);
  assert.match(dentures.priceLabel, /Starting at ₱7,500/);
  assert.match(dentures.description, /removable dental appliances/);
  assert.match(dentures.compactNote, /denture type, materials, and individual dental needs/);
  assert.match(dentures.extraNotes.join(" "), /not a guaranteed final cost/);

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
  assert.match(metal.description, /brackets and wires/);
  assert.match(metal.priceLabel, /₱5,000/);
  assert.match(metal.details, /₱1,250/);
  assert.equal(metal.lines.find((line) => line.label === "Down payment")?.value, "₱5,000");
  assert.equal(metal.lines.find((line) => line.label === "Monthly adjustment")?.value, "₱1,250");
  assert.match(metal.lines.find((line) => line.label === "Monthly cleaning")?.value, /Free cleaning/);
  assert.match(metal.notes.join(" "), /not the total cost of treatment/);
  assert.match(invisible.description, /clear aligner/);
  assert.equal(invisible.priceLabel, "Price available upon consultation");
  assert.doesNotMatch(invisible.priceLabel, /₱5,000 for upper or lower/);
  assert.doesNotMatch(invisible.details, /₱15,000/);
  assert.doesNotMatch(invisible.description, /retainer/i);
});

test("dentures and orthodontics reuse one public image asset each", () => {
  const dentures = attachServiceVisual({ id: "dentures", name: "Dentures" });
  const braces = attachServiceVisual({ id: "orthodontic-consultation", name: "Orthodontics / Braces" });
  assert.equal(dentures.imageUrl, DENTURES_IMAGE_URL);
  assert.equal(dentures.imageFit, "contain");
  assert.equal(braces.imageUrl, ORTHODONTICS_IMAGE_URL);
  assert.notEqual(dentures.imageUrl, braces.imageUrl);
  assert.equal(existsSync(join(frontendRoot, "public", dentures.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", braces.imageUrl.replace(/^\//, ""))), true);
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
