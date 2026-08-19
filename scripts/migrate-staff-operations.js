"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run migrate:staff-operations.");
  }

  const sqlPath = path.join(__dirname, "..", "migrations", "010_create_staff_operations.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");
  const pool = new Pool({ connectionString });

  try {
    await pool.query(sql);
    console.log("Staff operations migration applied (billing + SMS log + RFID tag).");
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
