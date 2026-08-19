"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractStructuredPayload,
  normalizeDate,
} = require("../services/documentSyncExtraction");

test("document extraction pulls patient and procedure fields from dental text", () => {
  const sample = `
Patient Name: Maria Santos
Email: maria.santos@example.com
Phone: 09102223333
Date of Birth: 05/12/2002
Gender: Female
Procedure: Routine Orthodontic Adjustment
Dentist: Dr. Sarah Cruz
Treatment Date: 08/18/2026
Coverage: HMO
Notes: Mild sensitivity
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.firstName, "Maria");
  assert.equal(payload.patient.lastName, "Santos");
  assert.equal(payload.patient.email, "maria.santos@example.com");
  assert.equal(payload.patient.phone, "639102223333");
  assert.equal(payload.patient.dateOfBirth, "2002-05-12");
  assert.equal(payload.procedure.treatment, "Routine Orthodontic Adjustment");
  assert.equal(payload.procedure.dentistName, "Dr. Sarah Cruz");
  assert.equal(payload.procedure.treatmentDate, "2026-08-18");
});

test("normalizeDate accepts slash-formatted clinic dates", () => {
  assert.equal(normalizeDate("08/18/2026 extra"), "2026-08-18");
  assert.equal(normalizeDate("2026-01-05"), "2026-01-05");
});
