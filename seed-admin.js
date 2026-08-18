"use strict";

const bcrypt = require("bcrypt");
const db = require("./db");

const ADMIN_EMAIL = "admin@amethyst.com";
const ADMIN_PHONE = "639000000000";
const ADMIN_PASSWORD = "admin123";

async function columnNames() {
  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'`
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function createAdmin() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const columns = await columnNames();

  if (!columns.has("email") || !columns.has("password_hash") || !columns.has("role")) {
    throw new Error("users table is missing required columns (email, password_hash, role).");
  }

  const updated = await db.query(
    `UPDATE users
     SET
       first_name = 'Admin',
       last_name = 'User',
       phone = $1,
       password_hash = $2,
       role = 'admin',
       is_verified = TRUE
       ${columns.has("status") ? ", status = 'Active'" : ""}
       ${columns.has("is_archived") ? ", is_archived = FALSE" : ""}
     WHERE LOWER(email) = LOWER($3)
     RETURNING id, email, role, is_verified`,
    [ADMIN_PHONE, hash, ADMIN_EMAIL]
  );

  if (updated.rows.length) {
    console.log("Admin password reset successfully.");
    console.log(`Updated account id: ${updated.rows[0].id}`);
  } else {
    const insertColumns = [
      "first_name",
      "last_name",
      "email",
      "phone",
      "password_hash",
      "role",
      "is_verified",
    ];
    const insertValues = [
      "Admin",
      "User",
      ADMIN_EMAIL,
      ADMIN_PHONE,
      hash,
      "admin",
      true,
    ];

    if (columns.has("status")) {
      insertColumns.push("status");
      insertValues.push("Active");
    }
    if (columns.has("is_archived")) {
      insertColumns.push("is_archived");
      insertValues.push(false);
    }

    const placeholders = insertValues.map((_, index) => `$${index + 1}`).join(", ");
    const inserted = await db.query(
      `INSERT INTO users (${insertColumns.join(", ")})
       VALUES (${placeholders})
       RETURNING id, email, role, is_verified`,
      insertValues
    );
    console.log("Admin account created successfully.");
    console.log(`Created account id: ${inserted.rows[0].id}`);
  }

  const check = await db.query(
    `SELECT id, email, role, is_verified, phone
     FROM users
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [ADMIN_EMAIL]
  );
  const admin = check.rows[0];
  const matches = await bcrypt.compare(ADMIN_PASSWORD, (await db.query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [admin.id]
  )).rows[0].password_hash);

  console.log("");
  console.log("Use these credentials on the Vite client login page:");
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD}`);
  console.log(`  Role:     ${admin.role}`);
  console.log(`  Verified: ${admin.is_verified}`);
  console.log(`  Password hash check: ${matches ? "OK" : "FAILED"}`);
  console.log("  Open: C:\\DentaSync-backend\\client → http://localhost:5173/login");
}

createAdmin()
  .catch((error) => {
    console.error("Error resetting admin:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch {
      // ignore close errors
    }
  });
