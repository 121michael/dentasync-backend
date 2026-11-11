"use strict";

const fs = require("fs");
const path = require("path");

const OFFSITE_MIGRATION = path.join(__dirname, "..", "migrations", "048_admin_backup_offsite.sql");
const POSTGRES_DUMP_MIGRATION = path.join(__dirname, "..", "migrations", "051_postgres_dump_backups.sql");

async function applyAdminBackupSchema(db) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Backup schema apply requires a database connection.");
  }
  const offsiteSql = fs.readFileSync(OFFSITE_MIGRATION, "utf8");
  await db.query(offsiteSql);
  const dumpSql = fs.readFileSync(POSTGRES_DUMP_MIGRATION, "utf8");
  await db.query(dumpSql);
  return { file: "migrations/048_admin_backup_offsite.sql+051_postgres_dump_backups.sql" };
}

module.exports = {
  OFFSITE_MIGRATION,
  applyAdminBackupSchema,
};
