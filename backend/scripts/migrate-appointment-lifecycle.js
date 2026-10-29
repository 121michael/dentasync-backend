"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "042_appointment_lifecycle.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/042_appointment_lifecycle.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Appointment lifecycle migration failed:", error.message);
    process.exit(1);
  });
