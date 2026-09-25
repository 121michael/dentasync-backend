"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizePersonName,
  compactPersonName,
  namesMatch,
  inferPatientCategory,
  findPatientConflicts,
} = require("../services/documentSyncPatientMatch");

test("normalizePersonName ignores case, extra spaces, and punctuation", () => {
  assert.equal(normalizePersonName("Algene Masayon"), "algene masayon");
  assert.equal(normalizePersonName("ALGENE MASAYON"), "algene masayon");
  assert.equal(normalizePersonName("  Algene   Masayon  "), "algene masayon");
  assert.equal(compactPersonName("Algene-Masayon"), compactPersonName("Algene Masayon"));
  assert.equal(namesMatch("Algene Masayon", "ALGENE   MASAYON"), true);
  assert.equal(namesMatch("Algene Masayon", "Maria Santos"), false);
});

test("inferPatientCategory follows existing A/S/P prefixes", () => {
  assert.equal(inferPatientCategory(8), "pediatric");
  assert.equal(inferPatientCategory(21), "regular");
  assert.equal(inferPatientCategory(65), "senior");
});

test("findPatientConflicts does not treat matching phones as a conflict", () => {
  const conflicts = findPatientConflicts(
    { phone: "09171234567", email: "a@example.com" },
    { phone: "639171234567", email: "a@example.com" }
  );
  assert.equal(conflicts.length, 0);
});

test("findPatientConflicts lists phone disagreements for admin choice", () => {
  const conflicts = findPatientConflicts(
    { phone: "09181234567" },
    { phone: "09171234567" }
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "Phone");
});
