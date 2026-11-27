"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  await db.query(
    fs.readFileSync(path.join(__dirname, "..", "migrations", "066_appointment_visit_origin.sql"), "utf8")
  );
  console.log("Applied migrations/066_appointment_visit_origin.sql");
}

async function rollback() {
  await db.query(
    fs.readFileSync(path.join(__dirname, "..", "migrations", "066_appointment_visit_origin_rollback.sql"), "utf8")
  );
  console.log("Reversed migrations/066_appointment_visit_origin_rollback.sql");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(reversing ? "Visit origin rollback failed:" : "Visit origin migration failed:", error.message);
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
