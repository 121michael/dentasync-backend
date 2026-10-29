"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "043_medical_document_types.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/043_medical_document_types.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Medical document type migration failed:", error.message);
    process.exit(1);
  });
