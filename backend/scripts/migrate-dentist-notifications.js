"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "024_dentist_portal_notifications.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Dentist portal notifications migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Dentist portal notifications migration failed:", error.message);
  process.exitCode = 1;
});
