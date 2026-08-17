"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "002_create_patient_portal.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Patient portal storage migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Patient portal storage migration failed:", error.message);
  process.exitCode = 1;
});
