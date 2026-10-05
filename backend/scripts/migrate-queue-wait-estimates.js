"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "026_queue_wait_estimates.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Queue wait-estimate migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Queue wait-estimate migration failed:", error.message);
  process.exitCode = 1;
});
