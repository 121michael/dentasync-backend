"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "033_account_dependents.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Account dependents migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Account dependents migration failed:", error.message);
  process.exitCode = 1;
});
