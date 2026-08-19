"use strict";

const bcrypt = require("bcrypt");
const db = require("../db");

const PATIENT_EMAIL = "patient@amethyst.com";
const PATIENT_PHONE = "639172222222";
const PATIENT_PASSWORD = "PatientPass123!";

async function columnNames() {
  const result = await db.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'users'`
  );
  return new Set(result.rows.map((row) => row.column_name));
}

async function seedPatient() {
  const hash = await bcrypt.hash(PATIENT_PASSWORD, 12);
  const columns = await columnNames();

  if (!columns.has("email") || !columns.has("password_hash") || !columns.has("role")) {
    throw new Error("users table is missing required columns (email, password_hash, role).");
  }

  const updated = await db.query(
    `UPDATE users
     SET
       first_name = 'Test',
       last_name = 'Patient',
       phone = $1,
       password_hash = $2,
       role = 'patient',
       is_verified = TRUE
       ${columns.has("status") ? ", status = 'Active'" : ""}
       ${columns.has("is_archived") ? ", is_archived = FALSE" : ""}
     WHERE LOWER(email) = LOWER($3)
     RETURNING id, email, role, is_verified`,
    [PATIENT_PHONE, hash, PATIENT_EMAIL]
  );

  if (!updated.rows.length) {
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
      "Test",
      "Patient",
      PATIENT_EMAIL,
      PATIENT_PHONE,
      hash,
      "patient",
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
    await db.query(
      `INSERT INTO users (${insertColumns.join(", ")})
       VALUES (${placeholders})`,
      insertValues
    );
  }

  console.log("Patient account ready.");
  console.log(`Email: ${PATIENT_EMAIL}`);
  console.log(`Password: ${PATIENT_PASSWORD}`);
  console.log("Dashboard: http://localhost:5173/dashboard");
  console.log("Use C:\\DentaSync-backend\\client (not an older DentaSync\\frontend folder).");
}

seedPatient()
  .catch((error) => {
    console.error("Unable to create patient account:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await db.end();
    } catch {
      // ignore
    }
  });
