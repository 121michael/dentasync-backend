"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function runMigration() {
  const migrationPath = path.join(
    __dirname,
    "..",
    "migrations",
    "000_create_users.sql"
  );
  const migration = fs.readFileSync(migrationPath, "utf8");

  try {
    await db.query(migration);
    console.log("Users table migration completed.");
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Users table migration failed:", error.message);
  process.exitCode = 1;
});
