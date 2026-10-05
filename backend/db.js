const { Pool } = require('pg');
const { loadEnv } = require('./loadEnv');

loadEnv();

const dbUser = String(process.env.DB_USER || "").trim();
if (!dbUser) {
  console.error(
    '❌ DB_USER is missing. PostgreSQL is trying to log in as your Windows user instead.'
  );
  console.error(
    '   Create C:\\DentaSync-git\\backend\\.env (see backend/.env.example) with DB_USER, DB_PASSWORD, DB_HOST, DB_PORT, and DB_NAME.'
  );
}

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// Verify connection on startup
pool.connect((err, client, release) => {
  if (err) {
    return console.error('❌ Error acquiring PostgreSQL client:', err.stack);
  }
  console.log('✅ Connected to PostgreSQL database successfully!');
  release();
});

module.exports = pool;