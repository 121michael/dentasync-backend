"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "035_daily_queue_numbers.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Daily queue numbers migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Daily queue numbers migration failed:", error.message);
  process.exitCode = 1;
});
