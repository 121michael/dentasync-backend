"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "054_patient_branch_booking.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied migrations/054_patient_branch_booking.sql");
  console.log("Appointment time is optional. Existing times were left unchanged.");
  console.log("Mandaluyong keeps the stored clinic schedule. Other branches count separately.");
}

async function rollback() {
  const sqlPath = path.join(__dirname, "..", "migrations", "054_patient_branch_booking_rollback.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Reversed migrations/054_patient_branch_booking.sql");
  console.log("Date-only appointments were kept. Their time stays empty until someone records one.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
        reversing ? "Patient branch booking rollback failed:" : "Patient branch booking migration failed:",
        error.message
      );
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
