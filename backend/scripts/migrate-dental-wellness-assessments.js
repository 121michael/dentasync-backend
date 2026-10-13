"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "036_dental_wellness_assessments.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Dental wellness assessments migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Dental wellness assessments migration failed:", error.message);
  process.exitCode = 1;
});
