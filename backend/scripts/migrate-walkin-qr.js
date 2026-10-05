"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(__dirname, "..", "migrations", "016_staff_walkin_qr.sql");
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Staff walk-in QR migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Staff walk-in QR migration failed:", error.message);
  process.exitCode = 1;
});
