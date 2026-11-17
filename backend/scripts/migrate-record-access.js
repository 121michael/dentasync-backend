"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

const files = [
  "056_cross_branch_record_access.sql",
  "057_record_access_workstation_auth.sql",
  "058_record_access_isolated_approver.sql",
  "060_record_access_approval_credential.sql",
];
const rollbackFiles = [
  "060_record_access_approval_credential_rollback.sql",
  "058_record_access_isolated_approver_rollback.sql",
  "057_record_access_workstation_auth_rollback.sql",
  "056_cross_branch_record_access_rollback.sql",
];

async function main() {
  const rollback = process.argv.includes("--rollback");
  const list = rollback ? rollbackFiles : files;
  for (const name of list) {
    const sql = fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
    await db.query(sql);
    console.log(rollback ? `Rolled back ${name}` : `Applied ${name}`);
  }
  if (!rollback) {
    console.log("Workstation challenges last 5 minutes and are single-use.");
    console.log("Delegated dentists set their own hashed approval PIN after sign-in.");
    console.log("Approvers sign in separately and enter the displayed approval code.");
    console.log("New grants last 30 minutes unless Admin sets 15 to 240 minutes.");
    console.log("Legacy pending requests stay visible until a fresh workstation authorization.");
    console.log("Audit log retention is not defined in the current schema and remains for clinic review.");
  }
  await db.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
