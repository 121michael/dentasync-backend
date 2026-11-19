"use strict";

const db = require("../db");
const {
  applyHmoVerificationSchema,
  rollbackHmoVerificationSchema,
} = require("../services/hmoVerification");

async function migrate() {
  await applyHmoVerificationSchema(db);
  console.log("Applied migrations/061_hmo_verification_submissions.sql");
  console.log("Order: 013 paper-gap HMO columns, 052 clinic branches, 054 patient branch booking, then 061.");
  console.log("Appointment status and HMO verification stay separate.");
  console.log("Existing pending HMO appointments and profile coverage are backfilled as review submissions.");
  console.log("Re-running this migration does not duplicate a pending review for the same patient and coverage.");
}

async function rollback() {
  await rollbackHmoVerificationSchema(db);
  console.log("Reversed migrations/061_hmo_verification_submissions.sql");
  console.log("Deploy the previous application version before this rollback.");
  console.log("Appointment rows and profile HMO fields were kept.");
}

if (require.main === module) {
  const reversing = process.argv.includes("--rollback");
  (reversing ? rollback() : migrate())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(
        reversing ? "HMO verification rollback failed:" : "HMO verification migration failed:",
        error.message
      );
      process.exit(1);
    });
}

module.exports = { migrate, rollback };
