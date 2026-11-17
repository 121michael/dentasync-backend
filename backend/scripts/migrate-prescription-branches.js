"use strict";

const db = require("../db");
const {
  applyPrescriptionBranchSchema,
  rollbackPrescriptionBranchSchema,
} = require("../services/prescriptionSchema");

async function migrate() {
  await applyPrescriptionBranchSchema(db);
  console.log("Applied migrations/059_prescription_branch_scope.sql");
  console.log("Order: 050 prescriptions, 052 clinic branches, 053 branch operations, then 059.");
  console.log("Existing prescriptions keep their rows and signed files.");
  console.log("A branch is backfilled only from a linked appointment or treatment when those sources agree.");
  console.log("Unattributed prescriptions stay out of staff queues for Admin review.");
  console.log("Re-running this migration does not move a prescription that already has a branch.");
}

async function rollback() {
  await rollbackPrescriptionBranchSchema(db);
  console.log("Reversed migrations/059_prescription_branch_scope.sql");
  console.log("Deploy the previous application version before this rollback.");
  console.log("Prescription rows and signed files were kept.");
  console.log("Originating-branch values were removed and are not copied from current dentist assignments.");
  console.log("Re-applying 059 restores only appointment and treatment links.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
        reversing ? "Prescription branch rollback failed:" : "Prescription branch migration failed:",
        error.message
      );
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
