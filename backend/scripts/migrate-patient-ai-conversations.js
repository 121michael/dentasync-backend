"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "034_patient_ai_conversations.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Patient AI conversations migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Patient AI conversations migration failed:", error.message);
  process.exitCode = 1;
});
