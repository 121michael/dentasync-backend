"use strict";

const db = require("../db");
const { applyAdminBackupSchema } = require("../services/backupSchema");

async function migrate() {
  const result = await applyAdminBackupSchema(db);
  console.log(`Applied ${result.file}`);
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Admin backup off-site migration failed:", error.message);
    process.exit(1);
  });
