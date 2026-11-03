"use strict";

const fs = require("fs");
const path = require("path");

const OFFSITE_MIGRATION = path.join(__dirname, "..", "migrations", "048_admin_backup_offsite.sql");

async function applyAdminBackupSchema(db) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Backup schema apply requires a database connection.");
  }
  const sql = fs.readFileSync(OFFSITE_MIGRATION, "utf8");
  await db.query(sql);
  return { file: "migrations/048_admin_backup_offsite.sql" };
}

module.exports = {
  OFFSITE_MIGRATION,
  applyAdminBackupSchema,
};
