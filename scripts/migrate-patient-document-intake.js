"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "022_patient_document_intake.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/022_patient_document_intake.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Patient document intake migration failed:", error.message);
    process.exit(1);
  });
