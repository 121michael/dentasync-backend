"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extractStructuredPayload } = require("../services/documentSyncExtraction");

const HELD_OUT = [
  {
    id: "D-two-visit-slash-dates",
    expected: {
      fullName: "Jonah Villanueva",
      age: "41",
      phone: "09180001111",
      notes: "",
      visits: [
        { treatmentDate: "12/01/2024", toothNos: "26", treatment: "Composite Filling", dentistName: "Dr. Tala Reyes", amountCharged: "3500" },
        { treatmentDate: "01/15/2025", toothNos: "27", treatment: "RCT", dentistName: "Dr. Tala Reyes", amountCharged: "8000" },
      ],
    },
    text: `Patient Information Form
Full name: Jonah Villanueva
Age: 41
Mobile: 09180001111
Treatment history
12/01/2024  #26  Composite Filling  Dr. Tala Reyes  3500
01/15/2025  #27  RCT  Dr. Tala Reyes  8000`,
  },
  {
    id: "E-single-line-chart",
    expected: {
      fullName: "Nina Gomez",
      age: "32",
      notes: "",
      visits: [
        {
          treatmentDate: "Nov 20, 2026",
          toothNos: "11",
          treatment: "Cleaning / Oral Prophylaxis",
          dentistName: "Dr Cruz",
          amountCharged: "900",
        },
      ],
    },
    text: `AMETHYST DENTAL
Chart
Nina Gomez 32 F
Phone 0922-333-4444
Proc: Cleaning / Oral Prophylaxis Date: Nov 20, 2026 Tooth: 11 Amt: 900 Dentist: Dr Cruz`,
  },
];

function scoreField(actual, expected) {
  const got = String(actual || "").replace(/\s+/g, " ").trim().toLowerCase();
  const want = String(expected || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!want) return got ? "extra" : "blank-ok";
  if (!got) return "blank";
  if (got.includes(want) || want.includes(got)) return "correct";
  return "incorrect";
}

test("held-out forms map without parser tailoring", () => {
  const report = [];
  for (const form of HELD_OUT) {
    const { payload } = extractStructuredPayload(form.text);
    const visits = payload.procedure.visits || [];
    const row = {
      id: form.id,
      fullName: scoreField(payload.patient.fullName, form.expected.fullName),
      age: scoreField(payload.patient.age, form.expected.age),
      notes: scoreField(payload.procedure.notes, form.expected.notes),
      visitCount: visits.length === form.expected.visits.length ? "correct" : `incorrect:${visits.length}`,
      visits: form.expected.visits.map((want, index) => ({
        treatmentDate: scoreField(visits[index]?.treatmentDate, want.treatmentDate),
        toothNos: scoreField(visits[index]?.toothNos, want.toothNos),
        treatment: scoreField(visits[index]?.treatment, want.treatment),
        dentistName: scoreField(visits[index]?.dentistName, want.dentistName),
        amountCharged: scoreField(visits[index]?.amountCharged, want.amountCharged),
      })),
    };
    report.push(row);
    assert.equal(payload.procedure.notes || "", "", `${form.id} must not dump OCR into clinical notes`);
  }
  // Keep the comparison report in the TAP output; do not retune the parser to these two forms.
  console.log(JSON.stringify({ heldOutMapping: report }, null, 2));
});
