"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "041_patient_medical_documents.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/041_patient_medical_documents.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Patient medical document migration failed:", error.message);
    process.exit(1);
  });
