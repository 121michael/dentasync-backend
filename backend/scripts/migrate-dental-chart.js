"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "014_dental_chart_enrichment.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Dental chart enrichment migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Dental chart enrichment migration failed:", error.message);
  process.exitCode = 1;
});
