"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const intake = require("../services/patientIntakeFields");

function extraction(overrides = {}) {
  return {
    method: "pdf-text",
    rawText: "",
    fieldStatuses: { fullName: "detected", dateOfBirth: "detected", gender: "detected", phone: "detected", address: "detected" },
    payload: {
      patient: {
        fullName: "Juan Dela Cruz",
        dateOfBirth: "January 10, 2005",
        gender: "MALE",
        phone: "0912 345 6789",
        address: "Pateros, Metro Manila",
        email: "",
        ...overrides,
      },
    },
  };
}

test("document extraction maps onto the existing patient fields with normalized values", () => {
  const fields = intake.buildFieldsFromExtraction(extraction(), { id: 1, originalName: "Valid ID.pdf" });
  assert.equal(fields.firstName.value, "Juan");
  assert.equal(fields.lastName.value, "Dela Cruz");
  assert.equal(fields.dateOfBirth.value, "2005-01-10");
  assert.equal(fields.sex.value, "Male");
  assert.equal(fields.phone.value, "639123456789");
  assert.equal(fields.address.value, "Pateros, Metro Manila");
  assert.equal(fields.firstName.status, "extracted");
  assert.equal(fields.firstName.source.documentName, "Valid ID.pdf");
  assert.ok(fields.firstName.confidence > 0.9);
  assert.ok(fields.address.confidence < fields.firstName.confidence, "address is flagged as lower confidence");
  assert.equal(fields.patientCategory.status, "missing", "category is never auto-set from OCR alone");
});

test("merging documents keeps the best value, tracks its source, and flags conflicts", () => {
  const idDoc = { id: 1, originalName: "Valid ID.pdf", fields: intake.buildFieldsFromExtraction(extraction(), { id: 1, originalName: "Valid ID.pdf" }) };
  const birthCert = {
    id: 2,
    originalName: "Birth Certificate.jpg",
    fields: intake.buildFieldsFromExtraction(
      { ...extraction({ dateOfBirth: "January 11, 2005", phone: "" }), method: "ocr" },
      { id: 2, originalName: "Birth Certificate.jpg" }
    ),
  };

  const { fields, conflicts } = intake.mergeDocumentFields([idDoc, birthCert]);
  assert.equal(fields.dateOfBirth.value, "2005-01-10", "higher-confidence PDF wins");
  assert.equal(fields.dateOfBirth.source.documentName, "Valid ID.pdf");
  assert.equal(fields.phone.value, "639123456789", "blank value on another page/document never overwrites");
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "dateOfBirth");
  assert.deepEqual(
    conflicts[0].options.map((option) => option.value),
    ["2005-01-10", "2005-01-11"]
  );
});

test("manual Admin edits win over documents and clear the conflict", () => {
  const doc = { id: 1, originalName: "A.pdf", fields: intake.buildFieldsFromExtraction(extraction(), { id: 1 }) };
  const other = {
    id: 2,
    originalName: "B.pdf",
    fields: intake.buildFieldsFromExtraction(extraction({ dateOfBirth: "2005-01-11" }), { id: 2 }),
  };
  const manual = intake.applyManualEdits({}, { dateOfBirth: "Jan 12, 2005", patientCategory: "regular" });
  assert.equal(manual.dateOfBirth.status, "manual");
  assert.equal(manual.dateOfBirth.value, "2005-01-12");

  const { fields, conflicts } = intake.mergeDocumentFields([doc, other], manual);
  assert.equal(fields.dateOfBirth.value, "2005-01-12");
  assert.equal(fields.dateOfBirth.confidence, 1);
  assert.equal(conflicts.length, 0);
});

test("validation reports missing required fields, invalid values, and low confidence", () => {
  const fields = intake.buildFieldsFromExtraction(
    { ...extraction({ dateOfBirth: "", phone: "12" }), method: "ocr" },
    { id: 1 }
  );
  const result = intake.validateIntakeFields(fields, { categoryConfirmed: false });
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes("dateOfBirth"));
  assert.ok(result.missing.includes("patientCategory"));
  assert.ok(result.invalid.some((item) => item.key === "phone"));
  assert.ok(result.lowConfidence.includes("address"));

  const complete = intake.applyManualEdits(fields, {
    dateOfBirth: "2005-01-10",
    phone: "09123456789",
    patientCategory: "regular",
  });
  const ok = intake.validateIntakeFields(complete, { categoryConfirmed: true });
  assert.equal(ok.valid, true, JSON.stringify(ok));
});

test("patient category is only suggested and requires confirmation", () => {
  const today = new Date();
  const childYear = today.getFullYear() - 10;
  const seniorYear = today.getFullYear() - 65;
  assert.equal(intake.suggestPatientCategory({ dateOfBirth: `${childYear}-01-01` }).category, "pediatric");
  assert.equal(intake.suggestPatientCategory({ dateOfBirth: `${seniorYear}-01-01` }).category, "senior");
  assert.equal(intake.suggestPatientCategory({ dateOfBirth: "2005-01-10", rawText: "PWD ID No. 123" }).category, "pwd");
  assert.equal(intake.suggestPatientCategory({ dateOfBirth: "2005-01-10" }).category, "regular");
});

test("confirmed intake maps onto the canonical clinical record input", () => {
  const fields = intake.applyManualEdits(intake.buildFieldsFromExtraction(extraction(), { id: 1 }), {
    middleName: "Santos",
    patientCategory: "regular",
  });
  const input = intake.toClinicalRecordInput(fields);
  assert.equal(input.firstName, "Juan");
  assert.equal(input.lastName, "Dela Cruz");
  assert.equal(input.gender, "Male");
  assert.equal(input.phone, "639123456789");
  assert.equal(input.dateOfBirth, "2005-01-10");
  assert.equal(input.patientCategory, "regular");
  assert.match(input.notes, /Middle name: Santos/);
});
