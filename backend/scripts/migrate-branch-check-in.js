"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "055_branch_check_in.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied migrations/055_branch_check_in.sql");
  console.log("Mandaluyong RFID and QR are enabled. Pasig QR is enabled and RFID is off.");
  console.log("Existing appointment times were left unchanged.");
}

async function rollback() {
  const sqlPath = path.join(__dirname, "..", "migrations", "055_branch_check_in_rollback.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Reversed migrations/055_branch_check_in.sql");
  console.log("Queue tickets and appointments were kept.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(reversing ? "Branch check-in rollback failed:" : "Branch check-in migration failed:", error.message);
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
