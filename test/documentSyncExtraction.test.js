"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractStructuredPayload,
  normalizeDate,
  normalizeAmount,
  normalizeAge,
  assessDocumentLikeness,
} = require("../services/documentSyncExtraction");

test("document extraction pulls patient, age, procedure, and amount fields", () => {
  const sample = `
Patient Name: Juan Dela Cruz
Date of Birth: 12/03/1995
Age: 30
Cellphone: 09171234567
Procedure: Dental Cleaning
Date: 08/20/2026
Amount: ₱800
`;
  const { payload, fieldStatuses } = extractStructuredPayload(sample);
  assert.equal(payload.patient.fullName, "Juan Dela Cruz");
  assert.equal(payload.patient.firstName, "Juan");
  assert.equal(payload.patient.lastName, "Dela Cruz");
  assert.equal(payload.patient.dateOfBirth, "1995-12-03");
  assert.equal(payload.patient.age, "30");
  assert.equal(payload.patient.phone, "639171234567");
  assert.equal(payload.procedure.treatment, "Dental Cleaning");
  assert.equal(payload.procedure.treatmentDate, "2026-08-20");
  assert.equal(payload.procedure.amountCharged, "800");
  assert.equal(fieldStatuses.amountCharged, "detected");
  assert.equal(fieldStatuses.age, "detected");
});

test("handwritten dental chart style labels are parsed across lines", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09171234567
AGE
25
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
AMOUNT
800
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.fullName, "ANGELOU OBAS-BAGHTNAN");
  assert.equal(payload.patient.address.toUpperCase(), "MANDALUYONG CITY");
  assert.equal(payload.patient.phone, "639171234567");
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.treatmentDate, "2024-09-07");
  assert.equal(payload.procedure.amountCharged, "800");
});

test("missing amount stays empty instead of inventing a value", () => {
  const sample = `
Full Name: Maria Santos
Procedure: Filling
Treatment Date: 01/15/2026
`;
  const { payload, fieldStatuses } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.amountCharged, "");
  assert.equal(fieldStatuses.amountCharged, "not_detected");
});

test("normalize helpers parse clinic formats", () => {
  assert.equal(normalizeDate("08/18/2026 extra"), "2026-08-18");
  assert.equal(normalizeDate("2026-01-05"), "2026-01-05");
  assert.equal(normalizeDate("Sept 7, 2024"), "2024-09-07");
  assert.equal(normalizeAmount("₱1,250.50"), "1250.5");
  assert.equal(normalizeAge("30 years"), "30");
});

test("face-like OCR text is rejected as non-document", () => {
  const result = assessDocumentLikeness("a b c", "ocr");
  assert.equal(result.isDocument, false);
});

test("labeled dental form text is accepted as a document", () => {
  const sample = `
Patient Name: Ana Reyes
Procedure: Root Canal
Treatment Date: 03/01/2026
Phone: 09180001111
`;
  const result = assessDocumentLikeness(sample, "ocr");
  assert.equal(result.isDocument, true);
});
