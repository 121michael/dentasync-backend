"use strict";

const db = require("../db");
const { applyPasswordResetSchema } = require("../services/passwordResetSchema");

async function runMigration() {
  try {
    const result = await applyPasswordResetSchema(db);
    console.log(`Password reset storage migration completed (${result.file}).`);
  } finally {
    await db.end();
  }
}

runMigration().catch((error) => {
  console.error("Password reset storage migration failed:", error.message);
  process.exitCode = 1;
});
