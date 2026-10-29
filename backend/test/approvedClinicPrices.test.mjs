import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getApprovedClinicPrice } from "../../frontend/src/clinic/approvedClinicPrices.js";
import {
  CONSULTATION_IMAGE_URL,
  CLEANING_IMAGE_URL,
  DENTAL_IMPLANTS_IMAGE_URL,
  DENTURES_IMAGE_URL,
  EXTRACTION_IMAGE_URL,
  FIXED_BRIDGE_IMAGE_URL,
  FILLING_IMAGE_URL,
  GUM_CONTOURING_IMAGE_URL,
  ORTHODONTICS_IMAGE_URL,
  ROOT_CANAL_IMAGE_URL,
  VENEERS_IMAGE_URL,
  WHITENING_IMAGE_URL,
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
  assert.match(dentures.priceLabel, /₱7,500–₱30,000/);
  assert.match(dentures.description, /removable dental appliances/);
  assert.match(dentures.compactNote, /₱7,500–₱30,000, depending on type and materials/);
  assert.match(dentures.extraNotes.join(" "), /FREE consultation/);

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
  assert.match(metal.lines.find((line) => line.label === "Included benefit")?.value, /Free cleaning/);
  assert.match(metal.notes.join(" "), /not the total cost of treatment/);
  assert.match(invisible.description, /clear aligner/);
  assert.equal(invisible.priceLabel, "Price available upon consultation");
  assert.doesNotMatch(invisible.priceLabel, /₱5,000 for upper or lower/);
  assert.doesNotMatch(invisible.details, /₱15,000/);
  assert.doesNotMatch(invisible.description, /retainer/i);
});

test("dentures orthodontics implants veneers and cleaning reuse one public image asset each", () => {
  const dentures = attachServiceVisual({ id: "dentures", name: "Dentures" });
  const braces = attachServiceVisual({ id: "orthodontic-consultation", name: "Orthodontics / Braces" });
  const implants = attachServiceVisual({ id: "dental-implants", name: "Dental Implants" });
  const veneers = attachServiceVisual({ id: "veneers", name: "Veneers" });
  const cleaning = attachServiceVisual({ id: "cleaning", name: "Dental Cleaning / Oral Prophylaxis" });
  const extraction = attachServiceVisual({ id: "extraction", name: "Tooth Extraction" });
  const filling = attachServiceVisual({ id: "filling", name: "Permanent Filling / Restoration" });
  const rootCanal = attachServiceVisual({ id: "root-canal", name: "Root Canal Treatment" });
  const whitening = attachServiceVisual({ id: "whitening", name: "Teeth Whitening" });
  const consultation = attachServiceVisual({ id: "general-consultation", name: "Oral Examination / Consultation" });
  const bridgeVisual = attachServiceVisual({ id: "fixed-bridge", name: "Fixed Bridge" });
  const gumContouring = attachServiceVisual({ id: "gum-contouring", name: "Gum Contouring" });
  assert.equal(dentures.imageUrl, DENTURES_IMAGE_URL);
  assert.equal(dentures.imageFit, "contain");
  assert.equal(braces.imageUrl, ORTHODONTICS_IMAGE_URL);
  assert.equal(implants.imageUrl, DENTAL_IMPLANTS_IMAGE_URL);
  assert.equal(implants.imageFit, "contain");
  assert.equal(veneers.imageUrl, VENEERS_IMAGE_URL);
  assert.equal(veneers.imageFit, "cover");
  assert.equal(cleaning.imageUrl, CLEANING_IMAGE_URL);
  assert.equal(cleaning.imageFit, "contain");
  assert.equal(extraction.imageUrl, EXTRACTION_IMAGE_URL);
  assert.equal(extraction.imageFit, "contain");
  assert.notEqual(cleaning.imageUrl, veneers.imageUrl);
  assert.notEqual(cleaning.imageUrl, dentures.imageUrl);
  assert.notEqual(extraction.imageUrl, cleaning.imageUrl);
  assert.equal(filling.imageUrl, FILLING_IMAGE_URL);
  assert.equal(filling.imageFit, "contain");
  assert.notEqual(filling.imageUrl, extraction.imageUrl);
  assert.equal(rootCanal.imageUrl, ROOT_CANAL_IMAGE_URL);
  assert.equal(rootCanal.imageFit, "contain");
  assert.notEqual(rootCanal.imageUrl, filling.imageUrl);
  assert.equal(whitening.imageUrl, WHITENING_IMAGE_URL);
  assert.equal(whitening.imageFit, "cover");
  assert.notEqual(whitening.imageUrl, rootCanal.imageUrl);
  assert.equal(consultation.imageUrl, CONSULTATION_IMAGE_URL);
  assert.equal(consultation.imageFit, "cover");
  assert.notEqual(consultation.imageUrl, whitening.imageUrl);
  assert.equal(bridgeVisual.imageUrl, FIXED_BRIDGE_IMAGE_URL);
  assert.equal(bridgeVisual.imageFit, "contain");
  assert.notEqual(bridgeVisual.imageUrl, dentures.imageUrl);
  assert.equal(gumContouring.imageUrl, GUM_CONTOURING_IMAGE_URL);
  assert.equal(gumContouring.imageFit, "contain");
  assert.notEqual(gumContouring.imageUrl, bridgeVisual.imageUrl);
  assert.equal(existsSync(join(frontendRoot, "public", dentures.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", braces.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", implants.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", veneers.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", cleaning.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", extraction.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", filling.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", rootCanal.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", whitening.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", consultation.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", bridgeVisual.imageUrl.replace(/^\//, ""))), true);
  assert.equal(existsSync(join(frontendRoot, "public", gumContouring.imageUrl.replace(/^\//, ""))), true);
});

test("dental cleaning shows three severity-based price ranges", () => {
  const cleaning = getApprovedClinicPrice({
    id: "cleaning",
    name: "Dental Cleaning / Oral Prophylaxis",
    description:
      "Professional dental cleaning helps remove plaque and hardened deposits from the teeth. The recommended cleaning approach depends on your oral health and the dentist's assessment.",
  });
  assert.equal(cleaning.verified, true);
  assert.match(cleaning.priceLabel, /₱1,000–₱1,500/);
  assert.match(cleaning.details, /₱2,000–₱2,500/);
  assert.match(cleaning.details, /₱4,000 and above/);
  assert.equal(cleaning.lines.find((line) => line.label === "Mild cleaning")?.value, "₱1,000–₱1,500");
  assert.equal(cleaning.lines.find((line) => line.label === "Moderate cleaning")?.value, "₱2,000–₱2,500");
  assert.match(cleaning.lines.find((line) => line.label === "More extensive cleaning")?.value, /₱4,000/);
  assert.match(cleaning.description, /plaque and hardened deposits/);
  assert.match(cleaning.extraNotes.join(" "), /does not guarantee the same result/);
});

test("veneers and implants do not invent peso prices", () => {
  const veneers = getApprovedClinicPrice({ id: "veneers", name: "Veneers" });
  const implants = getApprovedClinicPrice({ id: "dental-implants", name: "Dental Implants" });
  assert.equal(veneers.priceLabel, "Price available upon consultation");
  assert.match(veneers.description, /thin restorations placed over the front surfaces/);
  assert.match(veneers.compactNote, /treatment plan/);
  assert.equal(implants.priceLabel, "Price available upon consultation");
  assert.match(implants.description, /implant placed in the jawbone/);
  assert.match(implants.compactNote, /dentist's assessment/);
  for (const price of [veneers, implants]) {
    assert.doesNotMatch(price.priceLabel, /₱\d/);
    assert.doesNotMatch(price.details, /₱\d/);
  }
});

test("gum contouring filling and dentures keep unit and range wording", () => {
  const gums = getApprovedClinicPrice({ id: "gum-contouring", name: "Gum Contouring" });
  const filling = getApprovedClinicPrice({ id: "filling", name: "Permanent Filling / Restoration" });
  const extraction = getApprovedClinicPrice({ id: "extraction", name: "Tooth Extraction" });
  assert.equal(gums.priceLabel, "₱1,000 per tooth");
  assert.equal(filling.priceLabel, "₱1,000 per surface");
  assert.equal(extraction.priceLabel, "₱1,500–₱5,000");
});
