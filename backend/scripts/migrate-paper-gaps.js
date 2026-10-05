"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "013_paper_gap_features.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Paper gap features migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Paper gap features migration failed:", error.message);
  process.exitCode = 1;
});
