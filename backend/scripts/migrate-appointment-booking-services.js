"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "064_appointment_booking_services.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied migrations/064_appointment_booking_services.sql");
  console.log("Patients can book up to three services on one appointment. Duration is the sum of selected services.");
}

async function rollback() {
  const sqlPath = path.join(__dirname, "..", "migrations", "064_appointment_booking_services_rollback.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Reversed migrations/064_appointment_booking_services.sql");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
        reversing
          ? "Appointment booking services rollback failed:"
          : "Appointment booking services migration failed:",
        error.message
      );
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
