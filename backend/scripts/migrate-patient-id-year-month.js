"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");
const patientIds = require("../services/patientIds");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "032_patient_id_year_month.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied migrations/032_patient_id_year_month.sql");

  try {
    const result = await patientIds.seedMonthlySequencesFromExistingIds(db);
    console.log(
      `Kept existing Patient IDs unchanged. Seeded monthly sequences from ${result.preserved} current ID(s).`
    );
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      console.log("Patient ID tables are not fully installed yet; skipped sequence seed.");
      return;
    }
    throw error;
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Patient ID year-month migration failed:", error.message);
    process.exit(1);
  });
