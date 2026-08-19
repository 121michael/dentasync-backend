"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "009_create_clinical_patient_records.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Clinical patient records migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Clinical patient records migration failed:", error.message);
  process.exitCode = 1;
});
