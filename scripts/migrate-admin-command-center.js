"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "008_create_admin_command_center.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Admin command center migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Admin command center migration failed:", error.message);
  process.exitCode = 1;
});
