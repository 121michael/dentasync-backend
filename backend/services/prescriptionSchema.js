"use strict";

const fs = require("fs");
const path = require("path");

const SQL_PATHS = [
  path.join(__dirname, "..", "migrations", "045_prescriptions.sql"),
  path.join(__dirname, "..", "migrations", "047_prescription_pdf_review.sql"),
  path.join(__dirname, "..", "migrations", "050_prescription_esignatures.sql"),
];
const BRANCH_SQL_PATH = path.join(__dirname, "..", "migrations", "059_prescription_branch_scope.sql");
const BRANCH_ROLLBACK_SQL_PATH = path.join(
  __dirname,
  "..",
  "migrations",
  "059_prescription_branch_scope_rollback.sql"
);
let applying = null;

function splitStatements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => {
      if (!statement) return false;
      const withoutComments = statement
        .split("\n")
        .filter((line) => !line.trim().startsWith("--"))
        .join("\n")
        .trim();
      return Boolean(withoutComments);
    });
}

async function applyPrescriptionSchema(database) {
  if (!applying) {
    applying = (async () => {
      for (const sqlPath of SQL_PATHS) {
        const sql = fs.readFileSync(sqlPath, "utf8");
        const statements = splitStatements(sql);
        for (const statement of statements) {
          await database.query(statement);
        }
      }
    })().finally(() => {
      applying = null;
    });
  }
  await applying;
}

function isMissingPrescriptionRelation(error) {
  return error?.code === "42P01" || error?.code === "42703";
}

async function applyPrescriptionBranchSchema(database) {
  const sql = fs.readFileSync(BRANCH_SQL_PATH, "utf8");
  await database.query(sql);
}

async function rollbackPrescriptionBranchSchema(database) {
  const sql = fs.readFileSync(BRANCH_ROLLBACK_SQL_PATH, "utf8");
  await database.query(sql);
}

async function withPrescriptionSchema(database, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingPrescriptionRelation(error)) throw error;
    await applyPrescriptionSchema(database);
    try {
      await applyPrescriptionBranchSchema(database);
    } catch (branchError) {
      if (branchError.code !== "42P01" && branchError.code !== "42703") throw branchError;
    }
    return operation();
  }
}

module.exports = {
  applyPrescriptionSchema,
  applyPrescriptionBranchSchema,
  rollbackPrescriptionBranchSchema,
  isMissingPrescriptionRelation,
  withPrescriptionSchema,
};
