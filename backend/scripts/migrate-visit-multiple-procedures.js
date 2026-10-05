"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "027_visit_multiple_procedures.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Visit multiple-procedures migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Visit multiple-procedures migration failed:", error.message);
  process.exitCode = 1;
});
