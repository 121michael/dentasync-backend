"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  extractStructuredPayload,
  parseTreatmentRecordRows,
  resolveClinicProcedure,
} = require("../services/documentSyncExtraction");

function visitsOf(text) {
  return extractStructuredPayload(text).payload.procedure.visits;
}

test("Test A — one treatment fills patient fields and a single table row", () => {
  const { payload } = extractStructuredPayload(`
PATIENT INFORMATION
Name: ANGELOU OBAS-BAGTAN
Age: 26
Telephone: 09123456789

TREATMENT
09/10/2026  Oral Prophylaxis  P1,000
`);
  assert.equal(payload.patient.fullName, "ANGELOU OBAS-BAGTAN");
  assert.equal(payload.patient.age, "26");
  assert.equal(payload.patient.phone, "09123456789");
  assert.equal(payload.procedure.visits.length, 1);
  assert.deepEqual(
    {
      date: payload.procedure.visits[0].treatmentDate,
      procedure: payload.procedure.visits[0].treatment,
      amount: payload.procedure.visits[0].amountCharged,
    },
    { date: "09/10/2026", procedure: "Oral Prophylaxis", amount: "1,000" }
  );
});

test("Test B — every treatment on the document becomes its own row", () => {
  const visits = visitsOf(`
Name: Maria Santos
Age: 42
Cellphone: 09181234567
09/10/2026  Oral Prophylaxis  1,000
09/20/2026  Restoration       1,500
10/05/2026  Extraction        2,000
10/20/2026  Ortho Adjustment  1,200
`);
  assert.equal(visits.length, 4);
  assert.deepEqual(
    visits.map((row) => [row.treatmentDate, row.treatment, row.amountCharged]),
    [
      ["09/10/2026", "Oral Prophylaxis", "1,000"],
      ["09/20/2026", "Restoration", "1,500"],
      ["10/05/2026", "EXO", "2,000"],
      ["10/20/2026", "Ortho Adjustment", "1,200"],
    ]
  );
});

test("each date stays attached to its own treatment", () => {
  const visits = visitsOf(`
Name: Ana Reyes
09/01/2026 Oral Prophylaxis 800
09/08/2026 Restoration 1,500
09/15/2026 Dentures 8,000
`);
  assert.deepEqual(
    visits.map((row) => `${row.treatmentDate} → ${row.treatment} → ${row.amountCharged}`),
    [
      "09/01/2026 → Oral Prophylaxis → 800",
      "09/08/2026 → Restoration → 1,500",
      "09/15/2026 → Denture → 8,000",
    ]
  );
});

test("pipe-delimited table headers place each value in its own column", () => {
  const visits = visitsOf(`
TREATMENT RECORD
Name: Jose Rizal
Date | Tooth | Procedure | Dentist | Amount Charged | Amount Paid | Balance | Next Appt
09/20/2026 | 16 | Restoration | Dr. Cruz | 1,500 | 500 | 1,000 |
10/05/2026 | 24-44 | Extraction | | 2,000 | | |
`);
  assert.equal(visits.length, 2);
  assert.deepEqual(visits[0], {
    treatmentDate: "09/20/2026",
    toothNos: "16",
    treatment: "Restoration",
    dentistName: "Dr. Cruz",
    amountCharged: "1,500",
    amountPaid: "500",
    balance: "1,000",
    nextAppt: "",
  });
  assert.equal(visits[1].toothNos, "24-44");
  assert.match(visits[1].treatment, /EXO/);
});

test("Test E — columns the document does not provide stay blank", () => {
  const { payload } = extractStructuredPayload(`
Name: Lito Garcia
Age: 40
09/01/2026 Oral Prophylaxis 1000
`);
  assert.equal(payload.patient.phone, "");
  const [row] = payload.procedure.visits;
  assert.equal(row.dentistName, "");
  assert.equal(row.amountPaid, "");
  assert.equal(row.balance, "");
  assert.equal(row.nextAppt, "");
  assert.equal(row.toothNos, "");
});

test("Test F — a different document extracts that document's own values", () => {
  const first = extractStructuredPayload(`
Name: ANGELOU OBAS-BAGTAN
Age: 26
Telephone: 09123456789
09/10/2026 Oral Prophylaxis 1,000
`).payload;
  const second = extractStructuredPayload(`
Name: Maria Santos
Age: 42
Telephone: 09181234567
01/05/2026 Retainers 3,250
`).payload;
  assert.equal(second.patient.fullName, "Maria Santos");
  assert.equal(second.patient.age, "42");
  assert.equal(second.patient.phone, "09181234567");
  assert.notEqual(second.patient.fullName, first.patient.fullName);
  assert.equal(second.procedure.visits.length, 1);
  assert.equal(second.procedure.visits[0].treatment, "Retainer");
  assert.equal(second.procedure.visits[0].amountCharged, "3,250");
});

test("amounts are stored exactly as written, never rounded to a usual fee", () => {
  const visits = visitsOf(`
Name: Ana Reyes
09/01/2026 Oral Prophylaxis 1,250.50
09/08/2026 Restoration PHP 1750
09/15/2026 Crown / Fixed Bridge 12,000
`);
  assert.deepEqual(
    visits.map((row) => row.amountCharged),
    ["1,250.50", "1750", "12,000"]
  );
});

test("age is not derived when the document has no age", () => {
  const { payload } = extractStructuredPayload(`
Name: Ramon Cruz
Date of Birth: 12/03/1995
09/01/2026 Oral Prophylaxis 800
`);
  assert.equal(payload.patient.age, "");
  assert.equal(payload.patient.dateOfBirth, "12/03/1995");
});

test("ISO dates, tooth numbers and dentists are read from plain rows", () => {
  const rows = parseTreatmentRecordRows(`
2026-02-11 tooth 16 Prophylaxis Dr. Reyes 950
2026-03-04 #24 Filling 1,275.50
`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].treatmentDate, "2026-02-11");
  assert.equal(rows[0].toothNos, "16");
  assert.equal(rows[0].dentistName, "Dr. Reyes");
  assert.equal(rows[0].treatment, "Oral Prophylaxis");
  assert.equal(rows[0].amountCharged, "950");
  assert.equal(rows[1].toothNos, "24");
  assert.equal(rows[1].treatment, "Restoration");
  assert.equal(rows[1].amountCharged, "1,275.50");
});

test("document wording maps to the clinic's own treatment names", () => {
  const cases = [
    ["Cleaning", "Oral Prophylaxis"],
    ["Prophylaxis", "Oral Prophylaxis"],
    ["Filling", "Restoration"],
    ["Dental Restoration", "Restoration"],
    ["Dentures", "Denture"],
    ["Retainers", "Retainer"],
    ["Fixed Bridge", "FPD"],
    ["Oral Surgery", "Oral Surgery"],
    ["Ortho Adjustment", "Ortho Adjustment"],
  ];
  for (const [written, expected] of cases) {
    assert.equal(resolveClinicProcedure(written), expected, `${written} -> ${expected}`);
  }
  // A bare "Extraction" is a tooth extraction inside a treatment row only.
  assert.equal(resolveClinicProcedure("Extraction"), "");
  assert.equal(resolveClinicProcedure("Extraction", { allowBareExtraction: true }), "EXO");
});

test("page timestamps and file paths are not read as treatments", () => {
  const visits = visitsOf(`
9/19/26, 1:31 PM
file:///tmp/record.html 1/1
Name: Ana Reyes
09/01/2026 Oral Prophylaxis 1,000
`);
  assert.equal(visits.length, 1);
  assert.equal(visits[0].treatment, "Oral Prophylaxis");
});

test("Tests C and D — merged multi-pass OCR text of a scanned page fills every column", () => {
  // Text as the OCR passes actually return it for a scanned page: cell-per-line
  // output from one pass, mangled pipe delimiters from another.
  const { payload } = extractStructuredPayload(`
9/19/26, 1:31 PM
file:///tmp/scan.html 1/1
PATIENT INFORMATION
Name: JUAN DELA CRUZ
Age: 35
Telephone: 09171234567
TREATMENT HISTORY
Date
Procedure
Amount
09/01/2026
Oral Prophylaxis
1,000
09/15/2026
Restoration
1,500
10/01/2026
Extraction
2,000
Date       Procedure    Amount
09/01/2026 || Oral Prophylaxis || 1,000
09/15/2026 | Restoration       1,500
10/01/2026 2,000
`);
  assert.equal(payload.patient.fullName, "JUAN DELA CRUZ");
  assert.equal(payload.patient.age, "35");
  assert.equal(payload.patient.phone, "09171234567");
  assert.deepEqual(
    payload.procedure.visits.map((row) => [row.treatmentDate, row.treatment, row.amountCharged]),
    [
      ["09/01/2026", "Oral Prophylaxis", "1,000"],
      ["09/15/2026", "Restoration", "1,500"],
      ["10/01/2026", "EXO", "2,000"],
    ]
  );
});

test("section headings are never used as the patient name", () => {
  const { payload } = extractStructuredPayload(`
PATIENT INFORMATION
TREATMENT HISTORY
09/01/2026 Oral Prophylaxis 1,000
`);
  assert.equal(payload.patient.fullName, "");
});

test("handwritten dental chart fills Age, Date, and Procedure; Gender/DOB stay blank", () => {
  const sample = `
NAME
ANGELOU OBAS-BAGHTNAN
ADDRESS
MANDALUYONG CITY
TELEPHONE
OQUCUIMTD
AGE
2s
OCCUPATION
Dining staff
STATUS
Married
DATE NO DESCRIPTION TIME DEBIT CREDIT AMOUNT BALANCE
SEPT. 7, 2024 JOJU oral PROPHTLAXIS 8100
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.fullName, "ANGELOU OBAS-BAGHTNAN");
  assert.equal(payload.patient.address, "MANDALUYONG CITY");
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.patient.phone, "");
  assert.equal(payload.patient.gender, "");
  assert.equal(payload.patient.dateOfBirth, "");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.amountCharged, "8100");
  assert.equal(payload.procedure.visits.length, 1);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.visits[0].amountCharged, "8100");
});

test("JOJU NO. column and PROPHTLAXIS still fill the treatment row", () => {
  const sample = `
NAME ANGELOU OBAS-BAGHTNAN
ADDRESS MANDALUYONG CITY
AGE 25
DATE NO DESCRIPTION TIME DEBIT CREDIT
SEPT 7 JOJU PROPHTLAXIS
`;
  const { payload } = extractStructuredPayload(sample);
  assert.equal(payload.patient.age, "25");
  assert.equal(payload.procedure.treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  assert.equal(payload.procedure.visits[0].treatment, "Oral Prophylaxis");
  assert.match(payload.procedure.visits[0].treatmentDate, /SEPT\s*7,\s*2024/i);
});

test("written chart dates convert to ISO so Confirm & Save does not 400", () => {
  const { toIsoDocumentDate } = require("../services/documentSyncExtraction");
  assert.equal(toIsoDocumentDate("SEPT 7, 2024"), "2024-09-07");
  assert.equal(toIsoDocumentDate("SEPT. 7, 2024"), "2024-09-07");
  assert.equal(toIsoDocumentDate("09/07/2024"), "2024-09-07");
  assert.equal(toIsoDocumentDate("2024-09-07"), "2024-09-07");
  assert.equal(toIsoDocumentDate(""), "");
});
