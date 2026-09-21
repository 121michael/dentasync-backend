"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "025_patient_notification_entities.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Patient notification entity columns migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Patient notification entity columns migration failed:", error.message);
  process.exitCode = 1;
});
