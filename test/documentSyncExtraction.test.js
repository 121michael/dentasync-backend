"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractStructuredPayload,
  normalizeDate,
  normalizeAmount,
  normalizeAge,
  assessDocumentLikeness,
  parseTreatmentRecordRows,
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

test("treatment record rows auto-fill primary procedure, date, and amount", () => {
  const sample = `
TREATMENT RECORD
Name:
Age:
Gender: M/F
Date | Tooth No./s | Procedure | Dentist/s | Amount charged | Amount Paid | Balance | Next Appt.
NOV 16 2023 ORTHO INSTALLATION 5000
DEC 21 2023 ORTHO ADJUSTMENT 1250
JAN 25 2024 ORTHO ADJUSTMENT 1250
MAR 21 2024 ORTHO ADJUSTMENT 1650
MAR 11 2025 EXO 24-44
`;
  const { payload, fieldStatuses } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.treatment, "Orthodontic Installation");
  assert.equal(payload.procedure.treatmentDate, "2023-11-16");
  assert.equal(payload.procedure.amountCharged, "5000");
  assert.equal(fieldStatuses.treatment, "detected");
  assert.equal(fieldStatuses.amountCharged, "detected");
  assert.match(payload.procedure.notes, /Treatment record visits/i);
  assert.equal(payload.patient.gender, "");
  assert.equal(payload.patient.fullName, "");
});

test("printed Gender M/F prompt is not treated as Male", () => {
  const sample = `
Name: Ana Reyes
Age: 28
Gender: M/F
Procedure: Dental Cleaning
Amount: 800
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.fullName, "Ana Reyes");
  assert.equal(payload.patient.gender, "");
});

test("parseTreatmentRecordRows reads year-in-tooth-column style dates", () => {
  const rows = parseTreatmentRecordRows(`
NOV 16
2023
ORTHO INSTALLATION
5,000
DEC 21
2023
ORTHO ADJUSTMENT
1,250
`);
  assert.ok(rows.length >= 2);
  assert.equal(rows[0].treatmentDate, "2023-11-16");
  assert.equal(rows[0].treatment, "Orthodontic Installation");
  assert.equal(rows[0].amountCharged, "5000");
});
