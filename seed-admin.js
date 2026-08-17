const db = require('./db');
const bcrypt = require('bcrypt');

async function createAdmin() {
  try {
    const hash = await bcrypt.hash('admin123', 10);

    // Delete existing admin entry if it exists
    await db.query("DELETE FROM users WHERE email = 'admin@amethyst.com' OR phone = '09000000000'");

    // Insert fresh, verified admin account
    await db.query(
      `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, is_archived) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      ['Admin', 'User', 'admin@amethyst.com', '09000000000', hash, 'admin', true, false]
    );
  
    console.log('✅ Admin account created/reset successfully!');
  } catch (err) {
    console.error('❌ Error resetting admin:', err.message);
  } finally {
    process.exit();
  }
}

createAdmin();