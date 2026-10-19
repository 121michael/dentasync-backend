"use strict";

const fs = require("fs");
const path = require("path");
const db = require("../db");

async function migrate() {
  const sqlPath = path.join(__dirname, "..", "migrations", "037_ai_usage_events.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  await db.query(sql);
  console.log("Applied migrations/037_ai_usage_events.sql");
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("AI usage events migration failed:", error.message);
    process.exit(1);
  });
