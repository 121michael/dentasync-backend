"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const patientIds = require("../services/patientIds");

test("normalizeCategory maps aliases", () => {
  assert.equal(patientIds.normalizeCategory("Regular"), "regular");
  assert.equal(patientIds.normalizeCategory("Senior Citizen"), "senior");
  assert.equal(patientIds.normalizeCategory("pediatric"), "pediatric");
  assert.equal(patientIds.normalizeCategory("PWD"), "pwd");
  assert.equal(patientIds.prefixForCategory("regular"), "A");
  assert.equal(patientIds.prefixForCategory("senior"), "S");
  assert.equal(patientIds.prefixForCategory("pediatric"), "P");
  assert.equal(patientIds.prefixForCategory("pwd"), "W");
});

test("formatPatientId uses prefix, year, month, and padded sequence", () => {
  assert.equal(patientIds.formatPatientId("A", 2026, 9, 1), "A202609_01");
  assert.equal(patientIds.formatPatientId("S", 2026, 9, 12), "S202609_12");
  assert.equal(patientIds.formatPatientId("P", 2026, 10, 1), "P202610_01");
  assert.equal(patientIds.isCanonicalPatientId("A202609_01"), true);
  assert.equal(patientIds.isCanonicalPatientId("A2026_01"), false);
  assert.equal(patientIds.isCanonicalPatientId("CP-123"), false);
});

test("allocatePatientId increments sequence per prefix, year, and month", async () => {
  const store = new Map();
  const db = {
    async query(sql, params = []) {
      if (/SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT/i.test(sql)) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO patient_id_sequences")) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const current = store.get(key) || 0;
        const next = current + 1;
        store.set(key, next);
        return {
          rows: [
            {
              category_prefix: params[0],
              id_year: params[1],
              id_month: params[2],
              last_sequence: next,
            },
          ],
        };
      }
      throw new Error(`Unexpected: ${sql}`);
    },
  };

  const first = await patientIds.allocatePatientId(db, {
    category: "regular",
    createdAt: "2026-09-18",
  });
  const second = await patientIds.allocatePatientId(db, {
    category: "regular",
    createdAt: "2026-09-29",
  });
  const october = await patientIds.allocatePatientId(db, {
    category: "regular",
    createdAt: "2026-10-02",
  });
  const senior = await patientIds.allocatePatientId(db, {
    category: "senior",
    createdAt: "2026-09-18",
  });

  assert.equal(first.patientId, "A202609_01");
  assert.equal(second.patientId, "A202609_02");
  assert.equal(october.patientId, "A202610_01");
  assert.equal(senior.patientId, "S202609_01");
});

test("allocatePatientId falls back when the sequences table is missing", async () => {
  const db = {
    async query(sql, params = []) {
      if (/SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT/i.test(sql)) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO patient_id_sequences")) {
        const error = new Error('relation "patient_id_sequences" does not exist');
        error.code = "42P01";
        throw error;
      }
      if (sql.includes("SELECT patient_id FROM users")) {
        return { rows: [{ patient_id: "A202609_03" }] };
      }
      if (sql.includes("SELECT patient_id FROM clinic_patient_records")) {
        const error = new Error('column "patient_id" does not exist');
        error.code = "42703";
        throw error;
      }
      throw new Error(`Unexpected: ${sql} ${JSON.stringify(params)}`);
    },
  };

  const issued = await patientIds.allocatePatientId(db, {
    category: "regular",
    createdAt: "2026-09-18",
  });
  assert.equal(issued.patientId, "A202609_04");
});

test("new monthly IDs start at 01 even when older year-only IDs already exist", async () => {
  const store = new Map();
  const db = {
    async query(sql, params = []) {
      if (/SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT/i.test(sql)) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO patient_id_sequences")) {
        const key = `${params[0]}:${params[1]}:${params[2]}`;
        const current = store.get(key) || 0;
        const next = current + 1;
        store.set(key, next);
        return {
          rows: [
            {
              category_prefix: params[0],
              id_year: params[1],
              id_month: params[2],
              last_sequence: next,
            },
          ],
        };
      }
      throw new Error(`Unexpected: ${sql}`);
    },
  };

  const nextRegular = await patientIds.allocatePatientId(db, {
    category: "regular",
    createdAt: "2026-09-29",
  });
  assert.equal(nextRegular.patientId, "A202609_01");
});
