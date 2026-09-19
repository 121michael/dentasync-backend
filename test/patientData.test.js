"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const patientData = require("../services/patientData");

test("normalizeSex maps every spelling to the canonical value", () => {
  for (const raw of ["MALE", "Male", "male", "m", " M. "]) {
    assert.equal(patientData.normalizeSex(raw), "Male", raw);
  }
  for (const raw of ["FEMALE", "female", "F", "Fem"]) {
    assert.equal(patientData.normalizeSex(raw), "Female", raw);
  }
  assert.equal(patientData.normalizeSex("non-binary"), "Non-binary");
  assert.equal(patientData.normalizeSex(""), "");
});

test("normalizePhone produces one internal format for PH numbers", () => {
  assert.equal(patientData.normalizePhone("0917 123 4567"), "639171234567");
  assert.equal(patientData.normalizePhone("09171234567"), "639171234567");
  assert.equal(patientData.normalizePhone("+63 917 123 4567"), "639171234567");
  assert.equal(patientData.normalizePhone("917-123-4567"), "639171234567");
  assert.equal(patientData.formatPhoneForDisplay("639171234567"), "09171234567");
  assert.equal(patientData.isValidPhone("123"), false);
});

test("normalizeIsoDate handles common document date formats", () => {
  assert.equal(patientData.normalizeIsoDate("January 10, 2005"), "2005-01-10");
  assert.equal(patientData.normalizeIsoDate("Jan. 10 2005"), "2005-01-10");
  assert.equal(patientData.normalizeIsoDate("10 January 2005"), "2005-01-10");
  assert.equal(patientData.normalizeIsoDate("01/10/2005"), "2005-01-10");
  assert.equal(patientData.normalizeIsoDate("25/12/2005"), "2005-12-25");
  assert.equal(patientData.normalizeIsoDate("2005-01-10"), "2005-01-10");
  assert.equal(patientData.normalizeIsoDate("2005-01-10T00:00:00.000Z"), "2005-01-10");
  assert.equal(patientData.normalizeIsoDate("not a date"), "");
});

test("age is derived from birthdate rather than stored", () => {
  const today = new Date("2026-09-19T00:00:00.000Z");
  assert.equal(patientData.ageFromDateOfBirth("2005-01-10", today), 21);
  assert.equal(patientData.ageFromDateOfBirth("2005-09-20", today), 20);
  assert.equal(patientData.ageFromDateOfBirth(null, today), null);
});

test("canonicalTreatmentName collapses spellings into the treatment taxonomy", () => {
  for (const raw of ["Root Canal", "ROOT CANAL", "root canal treatment", "Root-canal", "RCT"]) {
    assert.equal(patientData.canonicalTreatmentName(raw), "Root Canal", raw);
  }
  for (const raw of ["Dental Filling", "Tooth Restoration", "dental restoration", "composite filling"]) {
    assert.equal(patientData.canonicalTreatmentName(raw), "Dental Filling", raw);
  }
  assert.equal(patientData.canonicalTreatmentName("Extraction of tooth 36"), "Extraction");
  assert.equal(patientData.canonicalTreatmentName("Consultation"), "Consultation");
});

test("payment status and balance are computed from one payment record", () => {
  assert.deepEqual(patientData.paymentSummary(5000, 1500), {
    amountCharged: 5000,
    amountPaid: 1500,
    balance: 3500,
    paymentStatus: "partially_paid",
  });
  assert.equal(patientData.paymentStatus(5000, 0), "pending");
  assert.equal(patientData.paymentStatus(5000, 5000), "paid");
  assert.equal(patientData.parseMoney("₱1,500.00"), 1500);
  assert.equal(patientData.parseMoney("-5"), null);
});

test("parseFullName handles SURNAME, GIVEN and compound Filipino surnames", () => {
  assert.deepEqual(patientData.parseFullName("DELA CRUZ, JUAN"), {
    firstName: "Juan",
    middleName: "",
    lastName: "Dela Cruz",
    fullName: "Juan Dela Cruz",
  });
  assert.deepEqual(patientData.parseFullName("Juan Dela Cruz"), {
    firstName: "Juan",
    middleName: "",
    lastName: "Dela Cruz",
    fullName: "Juan Dela Cruz",
  });
  assert.deepEqual(patientData.parseFullName("Maria Santos Reyes"), {
    firstName: "Maria",
    middleName: "Santos",
    lastName: "Reyes",
    fullName: "Maria Santos Reyes",
  });
  assert.equal(patientData.parseFullName("Ana De los Santos").lastName, "De Los Santos");
  assert.equal(patientData.parseFullName("Reyes, Maria S.").middleName, "S.");
});

test("account status codes are canonical", () => {
  assert.equal(patientData.normalizeAccountStatus({ status: "Active", isVerified: true }), "verified");
  assert.equal(patientData.normalizeAccountStatus({ status: "Pending", isVerified: false }), "pending");
  assert.equal(patientData.normalizeAccountStatus({ status: "Rejected", isVerified: false }), "rejected");
  assert.equal(patientData.normalizeAccountStatus({ status: "Inactive", isVerified: true }), "inactive");
});
