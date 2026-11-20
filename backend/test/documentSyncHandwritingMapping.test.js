"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractStructuredPayload,
  looksLikeFormDumpNotes,
  extractExplicitClinicalNotes,
  validateWrittenToothField,
} = require("../services/documentSyncExtraction");

test("labeled TOOTH NO. 14 lands in Tooth Nos on the treatment row", () => {
  const { payload, fieldStatuses } = extractStructuredPayload(`
NAME
Liza Cruz
DATE
SEPT 7, 2024
TOOTH NO.
14
DESCRIPTION
ORAL PROPHYLAXIS
AMOUNT CHARGED
800
`);
  assert.equal(payload.patient.fullName, "Liza Cruz");
  assert.equal(payload.procedure.visits[0].toothNos, "14");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.amountCharged, "800");
  assert.equal(payload.procedure.notes, "");
  assert.notEqual(fieldStatuses.toothNos, "unable_to_read");
});

test("multiple treatment rows keep each tooth on its own row", () => {
  const { payload } = extractStructuredPayload(`
TREATMENT RECORD
Date | Tooth | Procedure | Amount Charged
SEPT 7, 2024 | 14 | Oral Prophylaxis | 800
OCT 12, 2024 | 36 | Restoration | 1500
NOV 3, 2024 | 75 | EXO | 2000
`);
  assert.equal(payload.procedure.visits.length, 3);
  assert.equal(payload.procedure.visits[0].toothNos, "14");
  assert.equal(payload.procedure.visits[1].toothNos, "36");
  assert.equal(payload.procedure.visits[2].toothNos, "75");
  assert.equal(payload.procedure.visits[2].treatment, "EXO");
});

test("unreadable or invalid teeth stay blank and flagged", () => {
  const { payload, fieldStatuses } = extractStructuredPayload(`
NAME
Ana Santos
DATE
NOV 3, 2024
TOOTH NO.
DESCRIPTION
TOOTH EXTRACTION
AMOUNT CHARGED
2000
`);
  assert.equal(payload.procedure.visits[0].toothNos, "");
  assert.equal(payload.procedure.treatment, "EXO");

  const invalid = extractStructuredPayload(`
DATE SEPT 7, 2024
TOOTH NO. 99
DESCRIPTION Oral Prophylaxis
AMOUNT 800
`);
  assert.equal(invalid.payload.procedure.visits[0].toothNos, "");
  assert.equal(invalid.fieldStatuses.toothNos, "unable_to_read");
  assert.equal(validateWrittenToothField("99").ok, false);
});

test("unclear 0CT dates stay blank with original text for review", () => {
  const { payload, fieldStatuses } = extractStructuredPayload(`
NAME
Marco Reyes
DATE
0CT 12, 2024
TOOTH NO.
36
DESCRIPTION
Restoration
AMOUNT CHARGED
1500
`);
  assert.equal(payload.procedure.treatmentDate, "");
  assert.equal(payload.procedure.visits[0].treatmentDate, "");
  assert.match(payload.procedure.unclearDateText, /0CT\s*12,\s*2024/i);
  assert.equal(fieldStatuses.treatmentDate, "unable_to_read");
  assert.equal(payload.procedure.visits[0].toothNos, "36");
  assert.equal(payload.procedure.treatment, "Restoration");
});

test("readable SEPT dates are still filled", () => {
  const { payload } = extractStructuredPayload(`
NAME Maria Santos
DATE
SEPT 7, 2024
DESCRIPTION
ORAL PROPHYLAXIS
AMOUNT
800
`);
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.unclearDateText || "", "");
});

test("clinical notes come only from an explicit notes section", () => {
  const withoutNotes = extractStructuredPayload(`
NAME Liza Cruz
DATE SEPT 7, 2024
TOOTH NO. 14
DESCRIPTION ORAL PROPHYLAXIS
AMOUNT CHARGED 800
`);
  assert.equal(withoutNotes.payload.procedure.notes, "");
  assert.equal(
    looksLikeFormDumpNotes(
      "NAME Liza Cruz DATE SEPT 7, 2024 TOOTH NO. 14 DESCRIPTION ORAL PROPHYLAXIS AMOUNT CHARGED 800"
    ),
    true
  );

  const withNotes = extractStructuredPayload(`
NAME Liza Cruz
DATE SEPT 7, 2024
DESCRIPTION ORAL PROPHYLAXIS
AMOUNT 800
NOTES
Sensitive to cold on 14
`);
  assert.match(withNotes.payload.procedure.notes, /Sensitive to cold on 14/i);
  assert.equal(extractExplicitClinicalNotes("REMARKS\nWatch occlusion"), "Watch occlusion");
});

test("procedure, date, tooth, dentist, and amount stay on the same treatment row", () => {
  const { payload } = extractStructuredPayload(`
NAME
Pearl Amethyst
TREATMENT RECORD
Date | Tooth | Procedure | Dentist | Amount Charged
SEPT 7, 2024 | 14 | Oral Prophylaxis | Dr. Tala Reyes | 800
OCT 12, 2024 | 36 | Restoration | Dr. Tala Reyes | 1500
`);
  assert.equal(payload.procedure.visits.length, 2);
  assert.equal(payload.procedure.visits[0].treatmentDate.includes("SEPT") || payload.procedure.visits[0].treatmentDate.includes("Sept"), true);
  assert.equal(payload.procedure.visits[0].toothNos, "14");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].dentistName, /Tala Reyes/i);
  assert.equal(payload.procedure.visits[0].amountCharged, "800");
  assert.equal(payload.procedure.visits[1].toothNos, "36");
  assert.equal(payload.procedure.visits[1].amountCharged, "1500");
  assert.equal(payload.procedure.notes || "", "");
});

test("ambiguous teeth across two procedures stay blank", () => {
  const { payload, fieldStatuses } = extractStructuredPayload(`
TREATMENT RECORD
Date | Procedure | Amount Charged
SEPT 7, 2024 | Oral Prophylaxis | 800
OCT 12, 2024 | Restoration | 1500
TOOTH NO. 14
`);
  assert.equal(payload.procedure.visits.length, 2);
  assert.equal(payload.procedure.visits[0].toothNos, "");
  assert.equal(payload.procedure.visits[1].toothNos, "");
  assert.equal(fieldStatuses.toothNos, "unable_to_read");
});
