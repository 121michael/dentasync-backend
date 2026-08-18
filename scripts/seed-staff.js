"use strict";

const bcrypt = require("bcrypt");
const db = require("../db");

async function seedStaff() {
  const email = "staff@amethyst.com";
  const phone = "639171111111";
  const password = "StaffPass123!";
  const passwordHash = await bcrypt.hash(password, 12);

  try {
    await db.query("DELETE FROM users WHERE LOWER(email) = $1 OR phone = $2", [
      email,
      phone,
    ]);

    await db.query(
      `INSERT INTO users (
         first_name, last_name, email, phone, password_hash, role, is_verified, status, is_archived
       ) VALUES (
         'Jane', 'Doe', $1, $2, $3, 'staff', TRUE, 'Active', FALSE
       )`,
      [email, phone, passwordHash]
    );

    console.log("Staff account ready.");
    console.log(`Email: ${email}`);
    console.log(`Password: ${password}`);
    console.log("Use C:\\DentaSync-backend\\client and open http://localhost:5173/login");
  } finally {
    await db.end();
  }
}

seedStaff().catch((error) => {
  console.error("Unable to create staff account:", error.message);
  process.exitCode = 1;
});
