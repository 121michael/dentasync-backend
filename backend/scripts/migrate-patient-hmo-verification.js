"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function run() {
  const reversing = process.argv.includes("--rollback");
  const file = reversing
    ? "061_patient_hmo_verification_rollback.sql"
    : "061_patient_hmo_verification.sql";
  const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", file), "utf8");
  try {
    await db.query(sql);
    console.log(reversing ? "Rolled back patient HMO verification columns." : "Patient HMO verification migration completed.");
  } finally {
    await db.end();
  }
}

run().catch((error) => {
  console.error("Patient HMO verification migration failed:", error.message);
  process.exitCode = 1;
});
