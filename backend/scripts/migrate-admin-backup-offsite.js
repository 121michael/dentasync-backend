"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "048_admin_backup_offsite.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/048_admin_backup_offsite.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Admin backup off-site migration failed:", error.message);
    process.exit(1);
  });
