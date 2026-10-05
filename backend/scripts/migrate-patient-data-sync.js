"use strict";

/**
 * Data synchronization cleanup.
 *  1. Apply migrations/023_patient_data_sync_cleanup.sql (normalize sex, phone, statuses,
 *     link records to accounts, propagate Patient IDs, drop orphaned chart rows).
 *  2. Canonicalize treatment names through the shared taxonomy.
 *  3. Allocate missing Patient IDs for patient accounts and unlinked clinical records.
 *  4. Rebuild every dental chart from treatment history (chart = derived data).
 */

const fs = require("fs");
const path = require("path");
const db = require("../db");
const patientData = require("../services/patientData");
const patientIds = require("../services/patientIds");
const dentalChartSync = require("../services/dentalChartSync");

async function applySql() {
  const sqlPath = path.join(__dirname, "..", "migrations", "023_patient_data_sync_cleanup.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied migrations/023_patient_data_sync_cleanup.sql");
}

async function canonicalizeTreatments() {
  const result = await db.query(`SELECT id, treatment FROM clinic_patient_treatments`);
  let changed = 0;
  for (const row of result.rows) {
    const canonical = patientData.canonicalTreatmentName(row.treatment);
    if (canonical && canonical !== row.treatment) {
      await db.query(`UPDATE clinic_patient_treatments SET treatment = $1 WHERE id = $2`, [canonical, row.id]);
      changed += 1;
    }
  }
  console.log(`Canonicalized ${changed} treatment name(s).`);
}

async function allocateMissingPatientIds() {
  const users = await db.query(
    `SELECT id, patient_category, created_at
     FROM users
     WHERE LOWER(role) = 'patient' AND patient_id IS NULL
     ORDER BY created_at, id`
  );
  for (const row of users.rows) {
    const allocated = await patientIds.allocatePatientId(db, {
      category: row.patient_category || "regular",
      createdAt: row.created_at,
    });
    await db.query(
      `UPDATE users SET patient_id = $1, patient_category = COALESCE(patient_category, $2) WHERE id = $3`,
      [allocated.patientId, allocated.category, row.id]
    );
    await db.query(
      `UPDATE clinic_patient_records
       SET patient_id = $1, patient_category = COALESCE(patient_category, $2)
       WHERE linked_user_id = $3::text`,
      [allocated.patientId, allocated.category, String(row.id)]
    );
  }
  console.log(`Allocated Patient IDs for ${users.rows.length} account(s).`);

  const records = await db.query(
    `SELECT id, patient_category, created_at
     FROM clinic_patient_records
     WHERE patient_id IS NULL AND linked_user_id IS NULL AND COALESCE(is_archived, FALSE) = FALSE
     ORDER BY created_at, id`
  );
  for (const row of records.rows) {
    const allocated = await patientIds.allocatePatientId(db, {
      category: row.patient_category || "regular",
      createdAt: row.created_at,
    });
    await db.query(
      `UPDATE clinic_patient_records SET patient_id = $1, patient_category = COALESCE(patient_category, $2) WHERE id = $3`,
      [allocated.patientId, allocated.category, row.id]
    );
  }
  console.log(`Allocated Patient IDs for ${records.rows.length} walk-in record(s).`);
}

async function rebuildCharts() {
  const result = await db.query(
    `SELECT id FROM clinic_patient_records WHERE COALESCE(is_archived, FALSE) = FALSE`
  );
  for (const row of result.rows) {
    await dentalChartSync.rebuildChartFromTreatments(db, row.id, { id: "system", role: "migration" });
    const treatments = await db.query(
      `SELECT tooth_number FROM clinic_patient_treatments WHERE clinical_record_id = $1`,
      [row.id]
    );
    const teeth = new Set();
    for (const treatment of treatments.rows) {
      for (const tooth of dentalChartSync.parseAffectedTeeth(treatment.tooth_number)) teeth.add(tooth);
    }
    await dentalChartSync.clearOrphanedChartEntries(db, row.id, [...teeth]);
  }
  console.log(`Rebuilt dental charts for ${result.rows.length} patient record(s).`);
}

async function run() {
  await applySql();
  await canonicalizeTreatments();
  await allocateMissingPatientIds();
  await rebuildCharts();
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Patient data sync cleanup failed:", error.message);
    process.exit(1);
  });
