import assert from "node:assert/strict";
import test from "node:test";
import {
  hidePatientBookingPriceLines,
  hidePatientBookingPriceNotes,
  isPatientBookingPriceCopy,
} from "./patientBookingDisplay.js";

test("detects peso and price phrases used on booking cards", () => {
  assert.equal(isPatientBookingPriceCopy("₱1,500–₱5,000"), true);
  assert.equal(isPatientBookingPriceCopy("Price available upon consultation"), true);
  assert.equal(isPatientBookingPriceCopy("Final price depends on assessment"), true);
  assert.equal(isPatientBookingPriceCopy("Dental Cleaning / Oral Prophylaxis"), false);
  assert.equal(isPatientBookingPriceCopy("Mandaluyong"), false);
});

test("drops priced detail lines and keeps clinical notes", () => {
  assert.deepEqual(
    hidePatientBookingPriceLines([
      { label: "Mild", value: "₱1,000–₱1,500" },
      { label: "Visit length", value: "About 45 minutes" },
    ]),
    [{ label: "Visit length", value: "About 45 minutes" }]
  );
  assert.deepEqual(
    hidePatientBookingPriceNotes([
      "₱5,000 down payment",
      "Book a FREE consultation / oral examination so our dentist can assess your needs.",
    ]),
    ["Book a FREE consultation / oral examination so our dentist can assess your needs."]
  );
});
