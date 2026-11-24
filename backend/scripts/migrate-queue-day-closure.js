"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const files = ["062_queue_day_closure.sql", "063_queue_eod_cancelled.sql"];
  for (const name of files) {
    await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8"));
    console.log(`Applied migrations/${name}`);
  }
  console.log("At 6:00 PM Asia/Manila, Waiting/Called visits cancel; In Treatment goes to dentist review.");
}

async function rollback() {
  const files = ["063_queue_eod_cancelled_rollback.sql", "062_queue_day_closure_rollback.sql"];
  for (const name of files) {
    await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8"));
    console.log(`Reversed migrations/${name}`);
  }
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
