"use strict";

const bcrypt = require("bcrypt");
const db = require("../db");

const DENTIST_EMAIL = "dentist@amethyst.com";
const DENTIST_PHONE = "639173333333";
const DENTIST_PASSWORD = "DentistPass123!";
const CATALOG_DENTIST_ID = "dr-sarah-cruz";

async function columnNames(tableName) {
  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1`,
    [tableName]
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function seedDentist() {
  const hash = await bcrypt.hash(DENTIST_PASSWORD, 12);
  const userColumns = await columnNames("users");

  if (!userColumns.has("email") || !userColumns.has("password_hash") || !userColumns.has("role")) {
    throw new Error("users table is missing required columns.");
  }

  const updated = await db.query(
    `UPDATE users
     SET
       first_name = 'Sarah',
       last_name = 'Cruz',
       phone = $1,
       password_hash = $2,
       role = 'dentist',
       is_verified = TRUE
       ${userColumns.has("status") ? ", status = 'Active'" : ""}
       ${userColumns.has("is_archived") ? ", is_archived = FALSE" : ""}
     WHERE LOWER(email) = LOWER($3)
     RETURNING id`,
    [DENTIST_PHONE, hash, DENTIST_EMAIL]
  );

  let dentistId;
  if (updated.rows.length) {
    dentistId = updated.rows[0].id;
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
      "Sarah",
      "Cruz",
      DENTIST_EMAIL,
      DENTIST_PHONE,
      hash,
      "dentist",
      true,
    ];
    if (userColumns.has("status")) {
      insertColumns.push("status");
      insertValues.push("Active");
    }
    if (userColumns.has("is_archived")) {
      insertColumns.push("is_archived");
      insertValues.push(false);
    }
    const placeholders = insertValues.map((_, index) => `$${index + 1}`).join(", ");
    const inserted = await db.query(
      `INSERT INTO users (${insertColumns.join(", ")})
       VALUES (${placeholders})
       RETURNING id`,
      insertValues
    );
    dentistId = inserted.rows[0].id;
  }

  await db.query(
    `INSERT INTO admin_portal_dentist_profiles (
       user_id, specialization, schedule_notes, catalog_dentist_id
     ) VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id) DO UPDATE SET
       specialization = EXCLUDED.specialization,
       schedule_notes = EXCLUDED.schedule_notes,
       catalog_dentist_id = EXCLUDED.catalog_dentist_id,
       updated_at = CURRENT_TIMESTAMP`,
    [
      String(dentistId),
      "Orthodontics and Dentofacial Orthopedics",
      "Mon–Fri · 9:00 AM – 5:00 PM",
      CATALOG_DENTIST_ID,
    ]
  );

  console.log("Dentist account ready.");
  console.log(`Email: ${DENTIST_EMAIL}`);
  console.log(`Password: ${DENTIST_PASSWORD}`);
  console.log(`Catalog dentist id: ${CATALOG_DENTIST_ID}`);
  console.log("Dashboard: http://localhost:5173/dentist/dashboard");
}

seedDentist()
  .catch((error) => {
    console.error("Unable to create dentist account:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch {
      // ignore
    }
  });
