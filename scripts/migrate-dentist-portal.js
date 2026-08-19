"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "006_create_dentist_portal.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Dentist portal storage migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Dentist portal storage migration failed:", error.message);
  process.exitCode = 1;
});
