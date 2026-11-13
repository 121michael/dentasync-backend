"use strict";

const db = require("../db");
const {
  applyBranchOperationSchema,
  rollbackBranchOperationSchema,
} = require("../services/branchAccess");

async function migrate() {
  await applyBranchOperationSchema(db);
  console.log("Applied migrations/053_branch_operations.sql");
  console.log("Existing appointments and queue rows stay on the Mandaluyong Main Branch.");
}

async function rollback() {
  await rollbackBranchOperationSchema(db);
  console.log("Reversed migrations/053_branch_operations.sql");
  console.log("Appointments, queue rows, and patient records were kept. Branch columns were removed.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(reversing ? "Branch operation rollback failed:" : "Branch operation migration failed:", error.message);
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
