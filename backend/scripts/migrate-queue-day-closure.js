"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "062_queue_day_closure.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Applied migrations/062_queue_day_closure.sql");
  console.log("Queue entries can now close as Not Served or Needs Review at clinic closing time.");
}

async function rollback() {
  const sqlPath = path.join(__dirname, "..", "migrations", "062_queue_day_closure_rollback.sql");
  await db.query(fs.readFileSync(sqlPath, "utf8"));
  console.log("Reversed migrations/062_queue_day_closure.sql");
  console.log("Queue tickets were kept. Not Served became Skipped and Needs Review returned to In Treatment.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(reversing ? "Queue day closure rollback failed:" : "Queue day closure migration failed:", error.message);
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
