"use strict";

const db = require("../db");
const { applyPrescriptionSchema } = require("../services/prescriptionSchema");

async function migrate() {
  await applyPrescriptionSchema(db);
  console.log("Applied migrations/045_prescriptions.sql");
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("Prescription migration failed:", error.message);
      process.exit(1);
    });
}

module.exports = { migrate };
