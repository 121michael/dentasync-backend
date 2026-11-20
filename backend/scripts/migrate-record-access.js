"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

const files = [
  "056_cross_branch_record_access.sql",
  "057_record_access_workstation_auth.sql",
  "058_record_access_isolated_approver.sql",
  "060_record_access_authorization_credential.sql",
  "061_authorization_credential_secret.sql",
];
const rollbackFiles = [
  "061_authorization_credential_secret_rollback.sql",
  "060_record_access_authorization_credential_rollback.sql",
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
    console.log("Approvers sign in separately, enter the approval code, and confirm with their authorization password.");
    console.log("Delegated dentists need a hashed Set Credential before they can authorize.");
    console.log("Set DENTIST_CREDENTIAL_ENCRYPTION_KEY to store a recoverable encrypted copy for Admin viewing.");
    console.log("Rotate with DENTIST_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS; never store plaintext or commit keys.");
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
