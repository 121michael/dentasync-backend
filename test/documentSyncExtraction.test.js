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
  countReadableDocumentFields,
  ensureReadableExtraction,
  DocumentValidationError,
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
  assert.equal(payload.patient.dateOfBirth, "12/03/1995");
  assert.equal(payload.patient.age, "30");
  assert.equal(payload.patient.phone, "09171234567");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.amountCharged, "800");
  assert.equal(payload.procedure.treatmentDate, "08/20/2026");
  assert.equal(fieldStatuses.amountCharged, "detected");
  assert.equal(fieldStatuses.age, "detected");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
});

test("handwritten dental chart style labels resolve clinic procedures", () => {
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
  assert.equal(payload.patient.phone, "09171234567");
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.amountCharged, "800");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("noisy dental-chart OCR repairs age, SEPT date, amount, and procedure token", () => {
  const sample = `
NAME
ancelou Ob-Baehtnan
ADDRESS
MANDALUYONG CITY
TELEPHONE
09172444070
AGE
2r
DESCRIPTION
PrOrhIlax
DATE
(tpt-
kdvu
JtP1-
AMOUNT
b0vd
`;
  const { payload } = extractStructuredPayload(sample);
  assert.match(payload.patient.fullName, /ancelou|angelou/i);
  assert.match(payload.patient.fullName, /Ob-Baehtnan/i);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "2000");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].amountCharged, "2000");
});

test("Joju/Buvd dental-chart OCR still fills Document Table date, procedure, and amount", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
AGE
25
DESCRIPTION
TIME
DEBIT
CREDIT
DATE
AMOUNT
BALANCE
(tpt-
1
Joju
URa
prOrhila/i{
Buvd
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "2000");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].amountCharged, "2000");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("glued junk amounts like 19002 are rejected", () => {
  const sample = `
NAME
Ana Reyes
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
AMOUNT
19002
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.notEqual(payload.procedure.amountCharged, "19002");
});

test("multi-row treatment visits are not collapsed into a single primary row", () => {
  const sample = `
TREATMENT RECORD
Name: Algene Matayon
Age: 22
Gender: F
Date Tooth No Procedure Amount charged
NOV 16 2023 ORTHO INSTALLATION 5000
DEC 21 2023 ORTHO ADJUSTMENT 1250
MAR 11 2025 EXO 24-44
`;
  const { payload } = extractStructuredPayload(sample);
  assert.ok(payload.procedure.visits.length >= 3);
  const treatments = payload.procedure.visits.map((row) => row.treatment).join(" | ");
  assert.match(treatments, /Ortho Installation/i);
  assert.match(treatments, /Ortho Adjustment/i);
  assert.match(treatments, /EXO/i);
});

test("handwritten clinic keywords resolve to usual procedure labels", () => {
  const cases = [
    ["OP", "Oral Prophylaxis"],
    ["ORAL PROPHYLAXIS", "Oral Prophylaxis"],
    ["PrOrhIlax", "Oral Prophylaxis"],
    ["deep scaling", "Deep Scaling"],
    ["ORTHO ADJUSTMENT", "Ortho Adjustment"],
    ["adiumcat", "Ortho Adjustment"],
    ["IKTAUATD", "Ortho Installation"],
    ["EXO 24-44", "EXO 24-44"],
    ["resto", "Restoration"],
    ["restoration", "Restoration"],
    ["retainer", "Retainer"],
    ["mouthguard", "Mouthguard"],
    ["denture", "Denture"],
    ["FPD", "FPD"],
    ["fixed bridge", "FPD"],
    ["crown", "Crown"],
    ["teeth whitening", "Teeth Whitening"],
    ["bleaching", "Teeth Whitening"],
  ];
  const { resolveClinicProcedure } = require("../services/documentSyncExtraction");
  for (const [input, expected] of cases) {
    assert.equal(resolveClinicProcedure(input), expected, `${input} -> ${expected}`);
  }

  const sample = `
NAME: Ana Reyes
DESCRIPTION
ORTHO INSTALLATION
DATE
NOV 16, 2023
AMOUNT
5,000
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.treatment, "Ortho Installation");
  assert.equal(payload.procedure.amountCharged, "5,000");
  assert.match(payload.procedure.treatmentDate, /NOV\s*16,\s*2023/i);
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

test("treatment record copies clinic procedure keywords and table rows", () => {
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
  assert.equal(payload.procedure.treatment, "Ortho Installation");
  assert.match(payload.procedure.treatmentDate, /NOV\s*16/i);
  assert.equal(payload.procedure.amountCharged, "5000");
  assert.equal(fieldStatuses.treatment, "detected");
  assert.equal(payload.procedure.notes, "");
  assert.equal(payload.patient.gender, "");
  assert.equal(payload.patient.fullName, "");
  assert.ok(payload.procedure.visits.length >= 4);
  assert.equal(payload.procedure.visits[0].treatment, "Ortho Installation");
  assert.equal(payload.procedure.visits[1].treatment, "Ortho Adjustment");
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

test("parseTreatmentRecordRows resolves clinic keywords and written dates", () => {
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
  assert.equal(rows[0].treatment, "Ortho Installation");
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
  assert.equal(payload.procedure.visits.length, 0);
  assert.equal(payload.procedure.treatment, "");
  assert.equal(payload.procedure.amountCharged, "");
  assert.equal(payload.procedure.notes, "");
});

test("treatment record labeled fields still fill the Document Table when row parse fails", () => {
  const sample = `
TREATMENT RECORD
Name: Algene Reyes
Age: 22
Gender: M/F
Date Tooth No./s Procedure Dentist/s Amount charged
DESCRIPTION
ORTHO INSTALLATION
DATE
NOV 16, 2023
AMOUNT
5,000
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.documentForm, "treatment_record");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Ortho Installation");
  assert.match(payload.procedure.visits[0].treatmentDate, /NOV\s*16,\s*2023/i);
  assert.equal(payload.procedure.visits[0].amountCharged, "5,000");
});

test("slash-dated treatment rows are copied into the Document Table", () => {
  const sample = `
TREATMENT RECORD
Date Tooth No Procedure Amount charged
11/16/2023 ORTHO INSTALLATION 5000
12/21/2023 ORTHO ADJUSTMENT 1250
`;
  const { payload } = extractStructuredPayload(sample);
  assert.ok(payload.procedure.visits.length >= 2);
  assert.equal(payload.procedure.visits[0].treatment, "Ortho Installation");
  assert.equal(payload.procedure.visits[0].amountCharged, "5000");
  assert.match(payload.procedure.visits[0].treatmentDate, /11\/16\/2023/);
});

test("ensureReadableExtraction errors when no document fields can be read", () => {
  const { payload } = extractStructuredPayload(`
TREATMENT RECORD
Name
Age
Gender M/F
Date Tooth No Procedure Dentist Amount charged
`);
  assert.equal(countReadableDocumentFields(payload), 0);
  assert.throws(
    () => ensureReadableExtraction(payload),
    (error) =>
      error instanceof DocumentValidationError &&
      /Unable to read the uploaded or scanned document/i.test(error.message)
  );
});

test("ensureReadableExtraction accepts payloads with exact visit values", () => {
  const { payload } = extractStructuredPayload(`
TREATMENT RECORD
Name: Ana Reyes
Age: 28
Gender: F
Date | Tooth No./s | Procedure | Dentist/s | Amount charged | Amount Paid | Balance | Next Appt.
NOV 16 2023 ORTHO INSTALLATION 5000
`);
  assert.ok(countReadableDocumentFields(payload) > 0);
  assert.equal(ensureReadableExtraction(payload), countReadableDocumentFields(payload));
  assert.equal(payload.patient.fullName, "Ana Reyes");
  assert.equal(payload.procedure.visits[0].treatment, "Ortho Installation");
});

test("treatment record visits stay editable with clinic procedure keywords", () => {
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
  assert.equal(payload.procedure.visits[0].treatment, "Ortho Installation");
  assert.match(payload.procedure.visits[0].treatmentDate, /NOV\s*16/i);
  assert.equal(payload.procedure.visits[0].amountCharged, "5000");
  assert.equal(payload.procedure.visits[2].toothNos, "24-44");
  assert.match(payload.procedure.visits[2].treatment, /EXO/i);
});

test("ISO treatment dates are kept during sanitize so autofill is not wiped", () => {
  const { payload } = extractStructuredPayload(`
NAME: Ana Reyes
DESCRIPTION
Oral Prophylaxis
DATE
SEPT 7, 2024
AMOUNT
2000
`);
  payload.procedure.treatmentDate = "2024-09-07";
  payload.procedure.visits = [
    {
      treatmentDate: "2024-09-07",
      treatment: "Oral Prophylaxis",
      amountCharged: "2000",
      toothNos: "",
      dentistName: "",
      amountPaid: "",
      balance: "",
      nextAppt: "",
    },
  ];
  ensureReadableExtraction(payload);
  assert.equal(payload.procedure.treatmentDate, "2024-09-07");
  assert.equal(payload.procedure.visits[0].treatmentDate, "2024-09-07");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
});

test("tess soup dental-chart fills address, age, and Oral Prophylaxis", () => {
  const sample = `
ana el ODES
Aboress MANOALUYONG Cy
TeLepnoneOQUCUIMTD noe 20
occupation DANING
status MARRIED
Rano naue ANGEVOU 0B AS - BAGHTNAN
name ANGELOU 0B pg - BREHTNAN
ApDREss MANOALUYONG Cy
reLeronc OGUINT ror 20 ace U8
(ter. ae rea peoPtLatig | [IT Tewd ||
DATE = — | BALANCE
`;
  const { payload } = extractStructuredPayload(sample);
  assert.match(payload.patient.fullName, /ANGELOU/i);
  assert.match(payload.patient.fullName, /OBAS/i);
  assert.equal(payload.patient.address, "MANDALUYONG CITY");
  assert.ok(payload.patient.age === "20" || payload.patient.age === "25" || payload.patient.age === "48");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
});

test("peoPtLatig OCR token resolves to Oral Prophylaxis", () => {
  const { resolveClinicProcedure } = require("../services/documentSyncExtraction");
  assert.equal(resolveClinicProcedure("peoPtLatig"), "Oral Prophylaxis");
  assert.equal(resolveClinicProcedure("DOCUMENT DATA EXTRACTION"), "");
});

test("UI chrome instructional text is not kept as address", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
DOCUMENT DATA EXTRACTION EXTRACTED Review & confirm The table below is copied
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
AMOUNT
800
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.fullName, "ANGELOU OBAS-BAGHTNAN");
  assert.equal(payload.patient.address, "");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
});

test("rOrhilax and Jaju OCR fill Oral Prophylaxis and SEPT date", () => {
  const sample = `
NAME
ancelou Baehtnan
ADDRESS
MANDALUYONG CITY
AGE
2r
DESCRIPTION
DATE
DEBIT
CREDIT
(tpt- n Jaju Ia rOrhilax{ e17
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("IRQtial OCR token resolves to Oral Prophylaxis", () => {
  const { resolveClinicProcedure } = require("../services/documentSyncExtraction");
  assert.equal(resolveClinicProcedure("IRQtial"), "Oral Prophylaxis");
  assert.equal(resolveClinicProcedure("rOrhilax"), "Oral Prophylaxis");
});

test("SEPT date with prophylaxis OCR fills Oral Prophylaxis exactly from document tokens", () => {
  const sample = `
NAME
BNEELOU ORS-SAEHTNAN
ADDRESS
MANDALUYONG CITY
AGE
25
DATE
NO
DESCRIPTION
TIME
DEBIT
CREDIT
AMOUNT
BALANCE
(tpt-
Jaju
rOrhilax
3148
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.address, "MANDALUYONG CITY");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("SEPT date alone does not invent a procedure when DESCRIPTION is unread", () => {
  const sample = `
NAME
Ana Reyes
ADDRESS
MANDALUYONG CITY
AGE
30
DATE
NO
DESCRIPTION
TIME
DEBIT
CREDIT
(tpt-
Jaju
`;
  const { payload } = extractStructuredPayload(sample);
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.treatment, "");
});

test("dental chart AGE 2r and TELEPHONE 09 digits fill patient fields", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09454141070
AGE
2r
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
AMOUNT
800
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.patient.phone, "09454141070");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.amountCharged, "800");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("OCR procedure soup becomes the readable Oral Prophylaxis label", () => {
  const { resolveClinicProcedure, toReadableClinicProcedure } = require("../services/documentSyncExtraction");
  const tokens = [
    "PrOrhIlax",
    "prOrhila/i{",
    "rOrhilax",
    "IRQtial",
    "peoPtLatig",
    "peorenarn",
    "OP",
  ];
  for (const token of tokens) {
    assert.equal(resolveClinicProcedure(token), "Oral Prophylaxis", token);
    assert.equal(toReadableClinicProcedure(token), "Oral Prophylaxis", token);
  }
  assert.equal(resolveClinicProcedure("EXTRACTION"), "");
  assert.equal(toReadableClinicProcedure("EXTRACTION"), "");
  assert.equal(resolveClinicProcedure("DOCUMENT DATA EXTRACTION"), "");
});

test("full noisy chart fills readable procedure plus age phone date amount", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09172444070
AGE
2r
DESCRIPTION
TIME
DEBIT
CREDIT
prOrhila/i{
DATE
(tpt-
1
Joju
AMOUNT
b0vd
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.patient.phone, "09172444070");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "2000");
  assert.ok(payload.procedure.visits.length >= 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].amountCharged, "2000");
});

test("screenshot dental chart places Date Procedure Amount in correct columns", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09456449510
AGE
25
OCCUPATION
DINING STAFF
STATUS
MARRIED
DATE NO TIME DESCRIPTION DEBIT CREDIT BALANCE
SEPT 7, 2024
ORAL PROPHYLAXIS
3000
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.fullName, "ANGELOU OBAS-BAGHTNAN");
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.patient.phone, "09456449510");
  assert.equal(payload.patient.address.toUpperCase(), "MANDALUYONG CITY");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,?\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "3000");
  assert.equal(payload.procedure.visits.length, 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,?\s*2024/i);
  assert.equal(payload.procedure.visits[0].amountCharged, "3000");
  // Procedure must not be misplaced into tooth/dentist columns.
  assert.equal(payload.procedure.visits[0].toothNos, "");
  assert.equal(payload.procedure.visits[0].dentistName, "");
});

test("labeled AGE 25 is not overwritten and phone is recovered under TELEPHONE", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09154441570
AGE
25
OCCUPATION
DINING STAFF
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT. 7, 2024
CREDIT
800
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.patient.phone, "09154441570");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,?\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "800");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].amountCharged, "800");
});

test("hard EasyOCR procedure garble still maps to Oral Prophylaxis in the Procedure column", () => {
  const { resolveClinicProcedure } = require("../services/documentSyncExtraction");
  for (const token of ["FRLERALANI", "FRCrKLATI", "ROt1al", "[ROt1al", "frleralani"]) {
    assert.equal(resolveClinicProcedure(token), "Oral Prophylaxis", token);
  }
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
AGE
35
TELEPHONE
09456449510
DESCRIPTION
FRCrKLATI
DATE
SEPT 7, 2024
CREDIT
800
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].amountCharged, "800");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7/i);
  assert.equal(payload.patient.phone, "09456449510");
});

test("amount is kept exactly as written and a blank procedure is not invented", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
AGE
35
AMOUNT
3100
CREDIT
3100
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.procedure.treatment, "");
  assert.equal(payload.procedure.amountCharged, "3100");
  assert.equal(payload.procedure.visits[0].amountCharged, "3100");
  assert.equal(payload.procedure.visits[0].treatment, "");
});

test("when prophylaxis text exists with a 3100 fee, Procedure Date and Amount Charged all fill", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09154441570
AGE
25
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
CREDIT
3100
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.patient.phone, "09154441570");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7/i);
  assert.equal(payload.procedure.amountCharged, "3100");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].amountCharged, "3100");
  assert.equal(payload.procedure.visits[0].amountPaid, "");
});

test("age panel 25 beats misread whole-page AGE 35", () => {
  const {
    pickBestDentalChartAge,
    extractStructuredPayload,
    forceFillDentalChartTreatment,
  } = require("../services/documentSyncExtraction");

  assert.equal(pickBestDentalChartAge("AGE\n35\nDESCRIPTION\nOP", "25", "35"), "25");
  assert.equal(pickBestDentalChartAge("AGE\n2r\nDESCRIPTION\nOP", "35", "35"), "25");
  assert.equal(pickBestDentalChartAge("AGE\n25\nDESCRIPTION\nOP", "", ""), "25");

  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09456449510
AGE
35
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
CREDIT
800
`;
  const { payload } = extractStructuredPayload(sample);
  forceFillDentalChartTreatment(payload, sample, { age: "25", procedure: "ORAL PROPHYLAXIS" });
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7/i);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7/i);
});

test("repaired AGE soup 2r stays 25 even when panel guesses 35", () => {
  const { extractStructuredPayload, forceFillDentalChartTreatment } = require("../services/documentSyncExtraction");
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
AGE
2r
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
AMOUNT
800
`;
  const { payload } = extractStructuredPayload(sample);
  forceFillDentalChartTreatment(payload, sample, { age: "35" });
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7/i);
});

test("Jqju year token alone with DATE fills SEPT 7, 2024", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
AGE
2r
DATE
Jqju
DESCRIPTION
FRlrK1L4
CREDIT
3000
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "3000");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("UI chrome does not wipe AGE 25 and FRCrRAL4T fills Procedure", () => {
  const {
    extractStructuredPayload,
    forceFillDentalChartTreatment,
    pickBestDentalChartAge,
  } = require("../services/documentSyncExtraction");
  assert.equal(
    pickBestDentalChartAge(
      "NAME\nANGELOU\nAGE\n25\nDATE\nJqju\nDESCRIPTION\nFRCrRAL4T",
      "71",
      ""
    ),
    "25"
  );
  const sample = `
DOCUMENT DATA EXTRACTION
Review & Confirm
Document Table
Tooth
Procedure
Amount Charged
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
09204441070
AGE
25
DATE
Jqju
DESCRIPTION
FRCrRAL4T
CREDIT
3000
`;
  const { payload } = extractStructuredPayload(sample);
  forceFillDentalChartTreatment(payload, sample, {
    age: "71",
    procedure: "FRCrRAL4T",
    amountCharged: "3000",
  });
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "3000");
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.equal(payload.procedure.visits[0].amountCharged, "3000");
  assert.equal(payload.procedure.visits[0].amountPaid, "");
});

test("dental chart with only name+amount still flags missing Age Procedure Date", () => {
  const {
    emptyPayload,
    dentalChartMissingCriticalFields,
    looksLikeDentalChartDocument,
  } = require("../services/documentSyncExtraction");
  const payload = emptyPayload();
  payload.patient.fullName = "ANGELOU OBAS-BAGHTNAN";
  payload.patient.address = "MANDALUYONG CITY";
  payload.procedure.amountCharged = "3000";
  assert.equal(dentalChartMissingCriticalFields(payload), true);
  assert.equal(
    looksLikeDentalChartDocument(
      "NAME\nANGELOU\nADDRESS\nMANDALUYONG\nAGE\nDATE\nDESCRIPTION\nCREDIT",
      { fullName: "ANGELOU", address: "MANDALUYONG" }
    ),
    true
  );
  payload.patient.age = "25";
  payload.procedure.treatment = "Oral Prophylaxis";
  payload.procedure.treatmentDate = "SEPT 7, 2024";
  assert.equal(dentalChartMissingCriticalFields(payload), false);
});
