"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");

/**
 * Minimal clinic_patient_treatments / clinic_dental_chart_entries stub.
 * `treatments` is the table state the chart rebuild reads back.
 */
function createDb({ existing, treatmentsAfterChange }) {
  const calls = [];
  const chartUpserts = [];
  let orphanClear = null;

  const db = {
    calls,
    chartUpserts,
    get orphanClear() {
      return orphanClear;
    },
    async query(sql, params = []) {
      calls.push({ sql, params });

      if (sql.includes("FROM clinic_patient_treatments") && sql.includes("LIMIT 1")) {
        return { rows: existing ? [existing] : [] };
      }
      if (sql.startsWith("UPDATE clinic_patient_treatments")) {
        return { rows: [{ ...existing, ...decodeUpdate(sql, params) }] };
      }
      if (sql.startsWith("DELETE FROM clinic_patient_treatments")) {
        return { rows: existing ? [existing] : [] };
      }
      if (sql.startsWith("UPDATE clinic_patient_records")) {
        return { rows: [{ id: params[0] }] };
      }
      if (sql.includes("FROM clinic_patient_treatments") && sql.includes("ORDER BY treatment_date")) {
        return { rows: treatmentsAfterChange };
      }
      if (sql.startsWith("DELETE FROM clinic_dental_chart_entries")) {
        orphanClear = params[1];
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO clinic_dental_chart_entries")) {
        chartUpserts.push({
          toothNumber: params[1],
          conditionLabel: params[2],
          status: params[6],
          conditions: JSON.parse(params[7]),
          treatments: JSON.parse(params[8]),
        });
        return { rows: [{ tooth_number: params[1], tooth_status: params[6] }] };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  return db;
}

/** Map the dynamic UPDATE back onto row columns so the stub returns the new values. */
function decodeUpdate(sql, params) {
  const row = {};
  const assignments = sql.slice(sql.indexOf("SET ") + 4, sql.indexOf("WHERE")).split(",");
  for (const assignment of assignments) {
    const match = assignment.trim().match(/^([a-z_]+) = (?:COALESCE\()?\$(\d+)/);
    if (!match) continue;
    const value = params[Number(match[2]) - 1];
    if (value !== null && value !== undefined) row[match[1]] = value;
  }
  return row;
}

const rootCanalRow = {
  id: 9,
  clinical_record_id: 3,
  treatment: "Root Canal",
  treatment_date: "2026-09-18",
  tooth_number: "36",
  diagnosis_notes: "Irreversible pulpitis",
  notes: "Irreversible pulpitis",
  amount_charged: 5000,
  amount_paid: 1500,
  status: "completed",
};

test("editing a treatment rewrites the chart status for that tooth", async () => {
  const db = createDb({
    existing: rootCanalRow,
    treatmentsAfterChange: [
      {
        id: 9,
        treatment: "Dental Filling",
        treatment_date: "2026-09-18",
        tooth_number: "36",
        diagnosis_notes: "Dental Caries",
      },
    ],
  });

  const updated = await clinicalPatients.updateClinicalTreatment(
    db,
    3,
    9,
    {
      treatment: "Dental Filling",
      treatmentDate: "2026-09-18",
      diagnosisNotes: "Dental Caries",
      toothNumber: "36",
    },
    { id: "dentist-1", role: "dentist" }
  );

  assert.equal(updated.treatment, "Dental Filling");
  assert.equal(updated.diagnosis, "Dental Caries");
  assert.equal(updated.toothNumber, "36");
  // Amount paid is staff-owned: untouched when the dentist edits clinical fields.
  assert.equal(updated.amountPaid, 1500);
  assert.deepEqual(db.chartUpserts, [
    {
      toothNumber: "36",
      conditionLabel: "filling",
      status: "treated",
      conditions: ["filling"],
      treatments: ["filling"],
    },
  ]);
});

test("moving a treatment to another tooth clears the old tooth status", async () => {
  const db = createDb({
    existing: rootCanalRow,
    treatmentsAfterChange: [
      {
        id: 9,
        treatment: "Root Canal",
        treatment_date: "2026-09-18",
        tooth_number: "35",
        diagnosis_notes: "Irreversible pulpitis",
      },
    ],
  });

  await clinicalPatients.updateClinicalTreatment(
    db,
    3,
    9,
    {
      treatment: "Root Canal",
      treatmentDate: "2026-09-18",
      diagnosisNotes: "Irreversible pulpitis",
      toothNumber: "35",
    },
    { id: "dentist-1", role: "dentist" }
  );

  assert.deepEqual(db.orphanClear, ["35"]);
  assert.equal(db.chartUpserts[0].toothNumber, "35");
});

test("editing rejects a tooth-specific treatment with no tooth selected", async () => {
  const db = createDb({ existing: rootCanalRow, treatmentsAfterChange: [] });

  await assert.rejects(
    () =>
      clinicalPatients.updateClinicalTreatment(
        db,
        3,
        9,
        { treatment: "Root Canal", treatmentDate: "2026-09-18", toothNumber: "" },
        { id: "dentist-1", role: "dentist" }
      ),
    /Affected tooth is required/
  );
  assert.equal(db.chartUpserts.length, 0);
});

test("deleting a treatment restores the previous treatment status on that tooth", async () => {
  const db = createDb({
    existing: rootCanalRow,
    treatmentsAfterChange: [
      {
        id: 4,
        treatment: "Dental Filling",
        treatment_date: "2026-09-01",
        tooth_number: "36",
        diagnosis_notes: "Dental Caries",
      },
    ],
  });

  const deleted = await clinicalPatients.deleteClinicalTreatment(db, 3, 9, {
    id: "dentist-1",
    role: "dentist",
  });

  assert.equal(deleted.id, 9);
  assert.ok(db.calls.some((call) => call.sql.startsWith("DELETE FROM clinic_patient_treatments")));
  assert.deepEqual(db.chartUpserts, [
    {
      toothNumber: "36",
      conditionLabel: "filling",
      status: "treated",
      conditions: ["filling"],
      treatments: ["filling"],
    },
  ]);
});

test("deleting the only treatment on a tooth clears its chart status", async () => {
  const db = createDb({ existing: rootCanalRow, treatmentsAfterChange: [] });

  await clinicalPatients.deleteClinicalTreatment(db, 3, 9, { id: "dentist-1", role: "dentist" });

  assert.deepEqual(db.orphanClear, []);
  assert.equal(db.chartUpserts.length, 0);
});

test("deleting a treatment that is not on the record is rejected", async () => {
  const db = createDb({ existing: null, treatmentsAfterChange: [] });

  await assert.rejects(
    () => clinicalPatients.deleteClinicalTreatment(db, 3, 9, { id: "dentist-1", role: "dentist" }),
    /not found/
  );
});
