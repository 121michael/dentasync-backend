"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "017_queue_check_in_method.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");
  try {
    await db.query(migration);
    console.log("Queue check-in method migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Queue check-in method migration failed:", error.message);
  process.exitCode = 1;
});
