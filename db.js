const { Pool } = require('pg');
require('dotenv').config();

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