"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "021_patient_clinic_ids.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/021_patient_clinic_ids.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Patient clinic ID migration failed:", error.message);
    process.exit(1);
  });
