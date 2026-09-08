"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrations = [
    "007_create_document_sync.sql",
    "018_document_sync_temp_files.sql",
  ];

  try {
    for (const fileName of migrations) {
      const migrationPath = path.join(__dirname, "..", "migrations", fileName);
      const migration = fs.readFileSync(migrationPath, "utf8");
      await db.query(migration);
      console.log(`Applied ${fileName}`);
    }
    console.log("Document synchronization storage migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Document synchronization migration failed:", error.message);
  process.exitCode = 1;
});
