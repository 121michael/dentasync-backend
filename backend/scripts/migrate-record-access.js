"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

const applyPath = path.join(__dirname, "..", "migrations", "056_cross_branch_record_access.sql");
const rollbackPath = path.join(__dirname, "..", "migrations", "056_cross_branch_record_access_rollback.sql");

async function main() {
  const rollback = process.argv.includes("--rollback");
  const sql = fs.readFileSync(rollback ? rollbackPath : applyPath, "utf8");
  await db.query(sql);
  console.log(rollback ? "Rolled back migrations/056_cross_branch_record_access.sql" : "Applied migrations/056_cross_branch_record_access.sql");
  console.log("Grants last 30 minutes. Allowed range if configuration is added later: 15 to 240 minutes.");
  console.log("Audit log retention is not defined in the current schema and remains for clinic review.");
  await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
