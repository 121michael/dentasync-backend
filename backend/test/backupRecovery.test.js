"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");
const {
  gzipJson,
  gunzipJson,
  payloadContainsSecrets,
  normalizeSettings,
  createBackupRecoveryService,
  BACKUP_MAGIC,
  FORMAT_VERSION,
} = require("../services/backupRecovery");

function createMemoryDb() {
  const tables = {
    users: [{ id: "p1", email: "patient@example.test", role: "patient" }],
    appointments: [{ id: "a1", user_id: "p1", status: "confirmed", created_at: "2026-10-01T00:00:00.000Z" }],
    clinic_sms_logs: [
      {
        id: 1,
        delivery_status: "failed",
        error_detail: "Semaphore is not configured. Set SEMAPHORE_API_KEY in the server environment.",
      },
    ],
  };
  const backups = [];
  const operations = [];
  const settings = {
    backup: { schedule: "manual", retentionCount: 12, timezone: "Asia/Manila" },
  };
  const locks = new Set();

  function clone(value) {
    if (Buffer.isBuffer(value)) return Buffer.from(value);
    if (Array.isArray(value)) return value.map(clone);
    if (value && typeof value === "object") {
      const copy = {};
      for (const [key, nested] of Object.entries(value)) {
        copy[key] = clone(nested);
      }
      return copy;
    }
    return value;
  }

  async function query(sql, params = []) {
    const text = String(sql);

    if (text.includes("pg_try_advisory_lock")) {
      const key = String(params[0]);
      if (locks.has(key)) return { rows: [{ locked: false }] };
      locks.add(key);
      return { rows: [{ locked: true }] };
    }
    if (text.includes("pg_advisory_unlock")) {
      locks.delete(String(params[0]));
      return { rows: [{ unlocked: true }] };
    }
    if (text.includes("FROM pg_class")) {
      return { rows: Object.keys(tables).concat(["admin_portal_backups"]).map((name) => ({ name })) };
    }
    if (text.includes("json_agg(row_to_json")) {
      const match = text.match(/FROM "([a-zA-Z0-9_]+)"/);
      const name = match?.[1];
      return { rows: [{ rows: clone(tables[name] || []) }] };
    }
    if (text.includes("FROM admin_portal_settings") && text.includes("backup")) {
      return { rows: [{ setting_value: settings.backup }] };
    }
    if (text.includes("INSERT INTO admin_portal_settings")) {
      settings.backup = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (text.includes("INSERT INTO admin_portal_backup_operations")) {
      operations.push({
        backup_id: params[0],
        operation: params[1],
        status: params[2],
        actor_id: params[3],
        actor_name: params[4],
        detail: params[5],
        created_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
      });
      return { rows: [] };
    }
    if (text.includes("INSERT INTO admin_portal_backups")) {
      const row = {
        id: crypto.randomUUID(),
        backup_type: params[0],
        status: text.includes("'upload'") ? "success" : "in_progress",
        file_name: params[1],
        byte_size: 0,
        checksum_sha256: null,
        format_version: 1,
        table_count: 0,
        row_count: 0,
        table_names: [],
        payload: null,
        error_detail: null,
        created_by_id: params[2] || null,
        created_by_name: params[3] || null,
        created_at: new Date().toISOString(),
        finished_at: null,
        notes: params[4] || null,
      };
      if (text.includes("'upload'")) {
        row.byte_size = params[1];
        row.file_name = params[0];
        row.checksum_sha256 = params[2];
        row.format_version = params[3];
        row.table_count = params[4];
        row.row_count = params[5];
        row.table_names = params[6];
        row.payload = params[7];
        row.created_by_id = params[8];
        row.created_by_name = params[9];
        row.notes = params[10];
        row.finished_at = new Date().toISOString();
      }
      backups.unshift(row);
      return { rows: [clone({ ...row, payload: row.payload })] };
    }
    if (text.includes("UPDATE admin_portal_backups") && text.includes("status = 'success'")) {
      const row = backups.find((item) => item.id === params[0]);
      Object.assign(row, {
        status: "success",
        file_name: params[1],
        byte_size: params[2],
        checksum_sha256: params[3],
        format_version: params[4],
        table_count: params[5],
        row_count: params[6],
        table_names: params[6] && Array.isArray(params[7]) ? params[7] : params[7],
        payload: params[8],
        error_detail: null,
        finished_at: new Date().toISOString(),
      });
      return { rows: [clone(row)] };
    }
    if (text.includes("UPDATE admin_portal_backups") && text.includes("status = 'failed'")) {
      const row = backups.find((item) => item.id === params[0]);
      if (row) {
        row.status = "failed";
        row.error_detail = params[1];
        row.finished_at = new Date().toISOString();
      }
      return { rows: [row] };
    }
    if (text.includes("FROM admin_portal_backups") && text.includes("ORDER BY created_at DESC") && text.includes("LIMIT 50")) {
      return {
        rows: backups.map((row) => {
          const copy = clone(row);
          delete copy.payload;
          return copy;
        }),
      };
    }
    if (text.includes("FROM admin_portal_backup_operations") && text.includes("restore")) {
      const row = operations.filter((item) => item.operation === "restore").at(-1);
      return { rows: row ? [row] : [] };
    }
    if (text.includes("FROM admin_portal_backups WHERE id")) {
      const row = backups.find((item) => String(item.id) === String(params[0]));
      return { rows: row ? [clone(row)] : [] };
    }
    if (text.includes("SELECT COUNT(*)::int AS count FROM admin_portal_backups WHERE status = 'success'")) {
      return { rows: [{ count: backups.filter((item) => item.status === "success").length }] };
    }
    if (text.includes("DELETE FROM admin_portal_backups WHERE id = $1")) {
      const index = backups.findIndex((item) => item.id === params[0]);
      if (index >= 0) backups.splice(index, 1);
      return { rows: [] };
    }
    if (text.includes("DELETE FROM admin_portal_backups") && text.includes("ANY")) {
      const ids = params[0] || [];
      for (const id of ids) {
        const index = backups.findIndex((item) => item.id === id);
        if (index >= 0) backups.splice(index, 1);
      }
      return { rows: [] };
    }
    if (text.includes("SELECT id") && text.includes("backup_type <> 'safety'")) {
      return {
        rows: backups
          .filter((item) => item.status === "success" && item.backup_type !== "safety")
          .map((item) => ({ id: item.id })),
      };
    }
    if (text.trim() === "BEGIN" || text.includes("SET LOCAL") || text.trim() === "COMMIT" || text.trim() === "ROLLBACK") {
      return { rows: [] };
    }
    if (text.includes("TRUNCATE")) {
      const names = [...text.matchAll(/"([a-zA-Z0-9_]+)"/g)].map((match) => match[1]);
      for (const name of names) {
        if (tables[name]) tables[name] = [];
      }
      return { rows: [] };
    }
    if (text.includes("json_populate_recordset")) {
      const match = text.match(/INSERT INTO "([a-zA-Z0-9_]+)"/);
      const name = match?.[1];
      tables[name] = JSON.parse(params[0]);
      return { rows: [] };
    }
    if (text.includes("COUNT(*)::int AS count FROM")) {
      const match = text.match(/FROM "([a-zA-Z0-9_]+)"/);
      const name = match?.[1];
      return { rows: [{ count: (tables[name] || []).length }] };
    }

    throw new Error(`Unexpected test query: ${text}`);
  }

  return {
    tables,
    backups,
    operations,
    query,
    connect: async () => ({ query, release() {} }),
  };
}

test("backup payload helper round-trips without environment secrets", () => {
  const packed = gzipJson({
    magic: BACKUP_MAGIC,
    formatVersion: FORMAT_VERSION,
    tables: { users: { rows: [{ id: "p1" }] } },
  });
  const parsed = gunzipJson(packed);
  assert.equal(parsed.magic, BACKUP_MAGIC);
  assert.equal(payloadContainsSecrets(parsed, {}), false);
  assert.equal(
    payloadContainsSecrets(
      {
        tables: {
          clinic_sms_logs: {
            rows: [
              {
                error_detail:
                  "Semaphore is not configured. Set SEMAPHORE_API_KEY in the server environment.",
              },
            ],
          },
        },
      },
      { SEMAPHORE_API_KEY: "live-semaphore-key-value" }
    ),
    false
  );
  assert.equal(
    payloadContainsSecrets(
      { notes: "copied live-semaphore-key-value into a table" },
      { SEMAPHORE_API_KEY: "live-semaphore-key-value" }
    ),
    true
  );
  assert.equal(
    payloadContainsSecrets({ JWT_SECRET: "abc" }, { JWT_SECRET: "abc" }),
    false
  );
  assert.equal(normalizeSettings({ schedule: "daily", retentionCount: 3 }).schedule, "daily");
});

test("create backup stores metadata and excludes env secrets", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db });
  const backup = await service.createBackup({
    type: "manual",
    actor: { id: "admin-1", first_name: "Ada", last_name: "Admin" },
  });
  assert.equal(backup.status, "success");
  assert.equal(backup.backupType, "manual");
  assert.ok(backup.restorable);
  assert.ok(backup.byteSize > 0);
  const overview = await service.getOverview();
  assert.equal(overview.status, "success");
  assert.equal(overview.availableCount, 1);
  assert.equal(overview.storage.method, "postgresql");
  const packed = db.backups[0].payload;
  const parsed = gunzipJson(packed);
  assert.equal(parsed.magic, BACKUP_MAGIC);
  assert.deepEqual(parsed.tables.users.rows[0].id, "p1");
  assert.match(parsed.tables.clinic_sms_logs.rows[0].error_detail, /SEMAPHORE_API_KEY/);
  assert.equal(payloadContainsSecrets(parsed, { SEMAPHORE_API_KEY: "not-in-this-dump" }), false);
});

test("restore requires RESTORE confirmation and preserves records", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1", first_name: "Ada" } });
  db.tables.users = [{ id: "changed", email: "changed@example.test" }];
  await assert.rejects(
    () => service.restoreBackup({ backupId: backup.id, confirmation: "yes", actor: { id: "admin-1" } }),
    /Type RESTORE/
  );
  const restored = await service.restoreBackup({
    backupId: backup.id,
    confirmation: "RESTORE",
    actor: { id: "admin-1", first_name: "Ada" },
  });
  assert.equal(restored.restored, true);
  assert.equal(db.tables.users[0].id, "p1");
  assert.equal(db.tables.appointments[0].id, "a1");
  assert.ok(restored.safetyBackup?.id);
});

test("last known-good backup cannot be deleted and failed backups are not restorable", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
  await assert.rejects(() => service.deleteBackup({ backupId: backup.id, actor: { id: "admin-1" } }), /last known-good/);
  db.backups[0].status = "failed";
  db.backups[0].payload = Buffer.from("nope");
  await assert.rejects(
    () => service.restoreBackup({ backupId: backup.id, confirmation: "RESTORE", actor: { id: "admin-1" } }),
    /completed backup/
  );
});

test("corrupted archives are rejected", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db });
  assert.throws(() => service.parseAndValidatePayload(Buffer.from("not-a-backup")), /valid DentaSync archive/);
  assert.throws(
    () => service.parseAndValidatePayload(gzipJson({ magic: "NOPE", formatVersion: 1, tables: {} })),
    /incompatible/
  );
});

async function startPortal(databaseRole) {
  const app = express();
  app.use(express.json());
  const memory = createMemoryDb();
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db: {
        ...memory,
        async query(sql, params) {
          if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
            if (databaseRole !== "admin") return { rows: [] };
            return {
              rows: [
                {
                  id: "admin-1",
                  first_name: "Ada",
                  last_name: "Admin",
                  email: "ada@example.test",
                  phone: "639171234567",
                  role: "admin",
                  status: "Active",
                  is_verified: true,
                  password_hash: "hash",
                  created_at: "2026-01-01T00:00:00.000Z",
                },
              ],
            };
          }
          if (sql.includes("INTO admin_portal_audit_logs")) {
            return { rows: [{ id: 1, created_at: new Date().toISOString() }] };
          }
          return memory.query(sql, params);
        },
      },
      emailDeliveryIsConfigured: () => false,
      authenticateToken(req, _res, next) {
        req.user = { id: "admin-1", role: databaseRole };
        next();
      },
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api/admin`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("backup routes reject non-admin accounts and allow administrators", async () => {
  const staff = await startPortal("staff");
  try {
    const denied = await fetch(`${staff.url}/backups`);
    assert.equal(denied.status, 403);
  } finally {
    await staff.close();
  }

  const admin = await startPortal("admin");
  try {
    const created = await fetch(`${admin.url}/backups`, { method: "POST" });
    assert.equal(created.status, 201);
    const body = await created.json();
    assert.equal(body.backup.status, "success");
    assert.match(JSON.stringify(body), /^(?!.*JWT_SECRET).*$/);

    const listed = await fetch(`${admin.url}/backups`);
    assert.equal(listed.status, 200);
    const overview = await listed.json();
    assert.equal(overview.availableCount, 1);

    const blocked = await fetch(`${admin.url}/backups/${body.backup.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "please" }),
    });
    assert.equal(blocked.status, 400);

    const restored = await fetch(`${admin.url}/backups/${body.backup.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "RESTORE" }),
    });
    assert.equal(restored.status, 200);
    const restoreBody = await restored.json();
    assert.equal(restoreBody.restored, true);

    const download = await fetch(`${admin.url}/backups/${body.backup.id}/download`);
    assert.equal(download.status, 200);
    assert.ok((await download.arrayBuffer()).byteLength > 0);
  } finally {
    await admin.close();
  }
});
