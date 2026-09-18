"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "020_clinical_next_appointment.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/020_clinical_next_appointment.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Clinical next-appointment migration failed:", error.message);
    process.exit(1);
  });
