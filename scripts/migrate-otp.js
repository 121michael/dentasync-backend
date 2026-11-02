"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigrationFile(fileName) {
  const migrationPath = path.join(__dirname, "..", "migrations", fileName);
  const migration = fs.readFileSync(migrationPath, "utf8");
  await db.query(migration);
  console.log(`Applied ${fileName}`);
}

async function runMigration() {
  try {
    await runMigrationFile("001_create_otp_verification_requests.sql");
    await runMigrationFile("012_otp_attempt_lockout.sql");
    console.log("OTP verification storage migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("OTP verification storage migration failed:", error.message);
  process.exitCode = 1;
});
