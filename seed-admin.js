const db = require('./db');
const bcrypt = require('bcrypt');

async function createAdmin() {
  try {
    const hash = await bcrypt.hash('admin123', 10);

    await db.query("DELETE FROM users WHERE email = 'admin@amethyst.com' OR phone = '09000000000'");

    await db.query(
      `INSERT INTO users (
         first_name, last_name, email, phone, password_hash, role,
         is_verified, status, is_archived
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        'Admin',
        'User',
        'admin@amethyst.com',
        '09000000000',
        hash,
        'admin',
        true,
        'Active',
        false,
      ]
    );

    console.log('Admin account created/reset successfully!');
    console.log('Login: admin@amethyst.com / admin123 → /admin/dashboard');
  } catch (err) {
    console.error('Error resetting admin:', err.message);
    process.exitCode = 1;
  } finally {
    process.exit();
  }
}

createAdmin();
