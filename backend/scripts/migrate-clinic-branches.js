"use strict";

const db = require("../db");
const { applyClinicBranchSchema, rollbackClinicBranchSchema } = require("../services/clinicBranches");

async function migrate() {
  await applyClinicBranchSchema(db);
  console.log("Applied migrations/052_clinic_branches.sql");
  console.log("Mandaluyong is the Main Branch. Existing staff and dentists were assigned to it when they had no branch.");
}

async function rollback() {
  await rollbackClinicBranchSchema(db);
  console.log("Reversed migrations/052_clinic_branches.sql");
  console.log("Branch and assignment rows were removed. Accounts, credentials, and other clinic records were left in place.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(reversing ? "Branch rollback failed:" : "Branch migration failed:", error.message);
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
