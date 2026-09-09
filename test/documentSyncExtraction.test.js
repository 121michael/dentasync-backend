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
  assert.equal(payload.procedure.amountCharged, "800");
  assert.equal(fieldStatuses.amountCharged, "detected");
  assert.equal(fieldStatuses.age, "detected");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Dental Cleaning");
});

test("handwritten dental chart style labels keep OCR wording", () => {
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
  assert.equal(payload.procedure.treatment, "ORAL PROPHYLAXIS");
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

test("treatment record copies literal procedure text and table rows", () => {
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
  assert.equal(payload.documentForm, "treatment_record");
  assert.equal(payload.procedure.treatment, "ORTHO INSTALLATION");
  assert.match(payload.procedure.treatmentDate, /NOV\s*16/i);
  assert.equal(payload.procedure.amountCharged, "5000");
  assert.equal(fieldStatuses.treatment, "detected");
  assert.equal(payload.procedure.notes, "");
  assert.equal(payload.patient.gender, "");
  assert.equal(payload.patient.fullName, "");
  assert.ok(payload.procedure.visits.length >= 4);
  assert.equal(payload.procedure.visits[0].treatment, "ORTHO INSTALLATION");
  assert.equal(payload.procedure.visits[1].treatment, "ORTHO ADJUSTMENT");
  assert.equal(payload.procedure.visits[0].amountPaid, "");
  assert.equal(payload.procedure.visits[0].balance, "");
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

test("parseTreatmentRecordRows keeps OCR wording and written dates", () => {
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
  assert.match(rows[0].treatmentDate, /NOV\s*16.*2023/i);
  assert.equal(rows[0].treatment, "ORTHO INSTALLATION");
  assert.equal(rows[0].amountCharged, "5,000");
});

test("unreadable treatment-record OCR leaves cells empty instead of inventing values", () => {
  const sample = `
TREATMENT RECORD
Name
Age
Gender M/F
Date Tooth No Procedure Dentist Amount charged
Tooth
No./s
LENCORD
Amount
charged
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.documentForm, "treatment_record");
  assert.ok(Array.isArray(payload.procedure.visits));
  assert.equal(payload.procedure.visits.length, 1);
  assert.equal(payload.procedure.visits[0].treatment, "");
  assert.equal(payload.procedure.visits[0].amountCharged, "");
  assert.equal(payload.procedure.notes, "");
});

test("treatment record visits stay editable table data without catalog rename", () => {
  const sample = `
TREATMENT RECORD
Name:
Age:
Gender: M/F
Date | Tooth No./s | Procedure | Dentist/s | Amount charged | Amount Paid | Balance | Next Appt.
NOV 16 2023 ORTHO INSTALLATION 5000
DEC 21 2023 ORTHO ADJUSTMENT 1250
MAR 11 2025 EXO 24-44
`;
  const { payload } = extractStructuredPayload(sample);
  assert.ok(Array.isArray(payload.procedure.visits));
  assert.ok(payload.procedure.visits.length >= 2);
  assert.equal(payload.procedure.visits[0].treatment, "ORTHO INSTALLATION");
  assert.match(payload.procedure.visits[0].treatmentDate, /NOV\s*16/i);
  assert.equal(payload.procedure.visits[0].amountCharged, "5000");
  assert.equal(payload.procedure.visits[2].toothNos, "24-44");
  assert.match(payload.procedure.visits[2].treatment, /EXO/i);
});
