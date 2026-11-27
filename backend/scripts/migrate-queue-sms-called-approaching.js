"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  await db.query(
    fs.readFileSync(path.join(__dirname, "..", "migrations", "065_queue_sms_called_approaching.sql"), "utf8")
  );
  console.log("Applied migrations/065_queue_sms_called_approaching.sql");
}

async function rollback() {
  await db.query(
    fs.readFileSync(
      path.join(__dirname, "..", "migrations", "065_queue_sms_called_approaching_rollback.sql"),
      "utf8"
    )
  );
  console.log("Reversed migrations/065_queue_sms_called_approaching_rollback.sql");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
        reversing ? "Queue SMS trigger rollback failed:" : "Queue SMS trigger migration failed:",
        error.message
      );
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
