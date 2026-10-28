"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "039_admin_backups.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/039_admin_backups.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Admin backups migration failed:", error.message);
    process.exit(1);
  });
