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

test("findMatchingClinicalPatients survives a missing patient_id column", async () => {
  const { findMatchingClinicalPatients } = require("../services/documentSyncPatientMatch");
  const missing = Object.assign(new Error("column patient_id does not exist"), { code: "42703" });
  const client = {
    async query(sql, params) {
      if (/SAVEPOINT|ROLLBACK TO|RELEASE/i.test(sql)) return { rows: [] };
      if (/patient_id/.test(sql) && /SELECT/i.test(sql)) throw missing;
      if (/regexp_replace/.test(sql)) {
        return {
          rows: [
            {
              id: 3,
              record_code: "CPR-1",
              first_name: "Algene",
              last_name: "Masayon",
              email: "",
              phone: "",
              date_of_birth: null,
            },
          ],
        };
      }
      return { rows: [] };
    },
  };
  const found = await findMatchingClinicalPatients(client, { fullName: "Algene Masayon" });
  assert.equal(found.candidates.length, 1);
  assert.equal(found.candidates[0].fullName, "Algene Masayon");
});

test("findPatientConflicts lists phone disagreements for admin choice", () => {
  const conflicts = findPatientConflicts(
    { phone: "09181234567" },
    { phone: "09171234567" }
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].field, "Phone");
});
