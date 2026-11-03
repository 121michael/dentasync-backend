"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { Pool } = require("pg");
const {
  gzipJson,
  createBackupRecoveryService,
  BACKUP_MAGIC,
} = require("../services/backupRecovery");
const { applyAdminBackupSchema } = require("../services/backupSchema");

const enabled = process.env.SKIP_PG_UPLOAD_MIGRATION_TEST !== "1";
const SCHEMA = `backup_upload_fix_${process.pid}_${Date.now()}`;

function adminPool() {
  return new Pool({
    user: process.env.DB_USER || "postgres",
    host: process.env.DB_HOST || "127.0.0.1",
    database: process.env.DB_NAME || "postgres",
    password: process.env.DB_PASSWORD || "postgres",
    port: Number(process.env.DB_PORT || 5432),
  });
}

function wrapDb(pool) {
  async function withSearchPath(work) {
    const client = await pool.connect();
    try {
      await client.query(`SET search_path TO ${SCHEMA}, public`);
      return await work(client);
    } finally {
      client.release();
    }
  }
  return {
    query: (text, params) => withSearchPath((client) => client.query(text, params)),
    connect: async () => {
      const client = await pool.connect();
      await client.query(`SET search_path TO ${SCHEMA}, public`);
      return client;
    },
  };
}

test("legacy backup catalog can be upgraded and accept a v1 upload without restoring", { skip: !enabled }, async () => {
  const pool = adminPool();
  const db = wrapDb(pool);

  try {
    await pool.query(`CREATE SCHEMA ${SCHEMA}`);
    await pool.query(`SET search_path TO ${SCHEMA}, public`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${SCHEMA}.admin_portal_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value JSONB,
      updated_at TIMESTAMPTZ,
      updated_by TEXT
    )`);
    await pool.query(`CREATE TABLE ${SCHEMA}.users (
      id TEXT PRIMARY KEY,
      email TEXT
    )`);
    await pool.query(`INSERT INTO ${SCHEMA}.users (id, email) VALUES ('live', 'unchanged@example.test')`);
    const legacySql = fs.readFileSync(
      path.join(__dirname, "..", "migrations", "039_admin_backups.sql"),
      "utf8"
    );
    await db.query(legacySql);

    const missing = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'admin_portal_backups' AND column_name = 'pipeline_status'`,
      [SCHEMA]
    );
    assert.equal(missing.rows.length, 0);

    const legacy = await db.query(
      `INSERT INTO admin_portal_backups (
         backup_type, status, file_name, byte_size, checksum_sha256, table_count, row_count, notes
       ) VALUES ('manual', 'success', 'legacy-keep.dsb', 12, 'abc', 1, 1, 'keep-me')
       RETURNING id`
    );
    const legacyId = legacy.rows[0].id;

    const service = createBackupRecoveryService({
      db,
      env: { BACKUP_SKIP_PG_DUMP: "true" },
      notifyAdmin: async () => 0,
    });
    const fixture = gzipJson({
      magic: BACKUP_MAGIC,
      formatVersion: 1,
      tableOrder: ["users"],
      rowCounts: { users: 1 },
      tables: { users: { rows: [{ id: "synthetic-upload", email: "synthetic@example.test" }] } },
    });
    const uploaded = await service.storeUploadedBackup({
      buffer: fixture,
      originalName: "synthetic-v1.dsb",
      actor: { id: "admin-test", first_name: "Ada" },
    });
    assert.equal(uploaded.status, "success");
    assert.equal(uploaded.backupType, "upload");

    const usersBeforeUpgrade = await db.query("SELECT id, email FROM users ORDER BY id");
    assert.equal(usersBeforeUpgrade.rows.length, 1);
    assert.equal(usersBeforeUpgrade.rows[0].id, "live");

    await applyAdminBackupSchema(db);
    const added = await pool.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'admin_portal_backups' AND column_name = 'pipeline_status'`,
      [SCHEMA]
    );
    assert.equal(added.rows.length, 1);

    const kept = await db.query(`SELECT id, file_name, notes FROM admin_portal_backups WHERE id = $1`, [legacyId]);
    assert.equal(kept.rows[0].file_name, "legacy-keep.dsb");
    assert.equal(kept.rows[0].notes, "keep-me");

    const uploads = await db.query(`SELECT backup_type, status FROM admin_portal_backups WHERE id = $1`, [
      uploaded.id,
    ]);
    assert.equal(uploads.rows[0].backup_type, "upload");
    assert.equal(uploads.rows[0].status, "success");

    const uploadedAfter = await service.storeUploadedBackup({
      buffer: fixture,
      originalName: "synthetic-v1-after-migration.dsb",
      actor: { id: "admin-test", first_name: "Ada" },
    });
    assert.equal(uploadedAfter.status, "success");
    assert.equal(uploadedAfter.backupType, "upload");

    const usersAfter = await db.query("SELECT id, email FROM users ORDER BY id");
    assert.equal(usersAfter.rows.length, 1);
    assert.equal(usersAfter.rows[0].id, "live");
    assert.equal(usersAfter.rows[0].email, "unchanged@example.test");
  } finally {
    await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`).catch(() => {});
    await pool.end();
  }
});
