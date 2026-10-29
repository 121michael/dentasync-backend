"use strict";

const fs = require("fs");
const path = require("path");

const SQL_PATH = path.join(__dirname, "..", "migrations", "045_prescriptions.sql");
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
      const sql = fs.readFileSync(SQL_PATH, "utf8");
      const statements = splitStatements(sql);
      for (const statement of statements) {
        await database.query(statement);
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

async function withPrescriptionSchema(database, operation) {
  try {
    return await operation();
  } catch (error) {
    if (!isMissingPrescriptionRelation(error)) throw error;
    await applyPrescriptionSchema(database);
    return operation();
  }
}

module.exports = {
  applyPrescriptionSchema,
  isMissingPrescriptionRelation,
  withPrescriptionSchema,
};
