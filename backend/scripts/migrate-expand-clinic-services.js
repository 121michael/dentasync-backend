"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "038_expand_clinic_service_catalog.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Expanded clinic service catalog migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Expanded clinic service catalog migration failed:", error.message);
  process.exitCode = 1;
});
