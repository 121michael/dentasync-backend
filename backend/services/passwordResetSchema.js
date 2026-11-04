"use strict";

const fs = require("fs");
const path = require("path");
const { isMissingPasswordChangedAtColumn, schemaPasswordChangedAtError } = require("./sessionRevocation");

const PASSWORD_RESET_MIGRATION = path.join(
  __dirname,
  "..",
  "migrations",
  "003_create_password_reset_requests.sql"
);

async function applyPasswordResetSchema(db) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Password reset schema apply requires a database connection.");
  }
  const sql = fs.readFileSync(PASSWORD_RESET_MIGRATION, "utf8");
  await db.query(sql);
  return { file: "migrations/003_create_password_reset_requests.sql" };
}

async function assertPasswordChangedAtReady(db) {
  try {
    await db.query("SELECT password_changed_at FROM users LIMIT 0");
  } catch (error) {
    if (isMissingPasswordChangedAtColumn(error) || error?.code === "42P01") {
      throw schemaPasswordChangedAtError();
    }
    throw error;
  }
}

module.exports = {
  PASSWORD_RESET_MIGRATION,
  applyPasswordResetSchema,
  assertPasswordChangedAtReady,
};
