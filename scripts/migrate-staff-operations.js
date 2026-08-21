"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "010_create_staff_operations.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Staff operations migration completed (billing + SMS log + RFID tag).");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Staff operations migration failed:", error.message);
  process.exitCode = 1;
});
