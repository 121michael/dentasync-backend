"use strict";

process.env.BACKUP_SKIP_PG_DUMP = "true";

const assert = require("node:assert/strict");
const test = require("node:test");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");
const {
  gzipJson,
  gunzipJson,
  payloadContainsSecrets,
  applySecretPolicy,
  normalizeSettings,
  createBackupRecoveryService,
  createInternalBackupCronHandler,
  BACKUP_MAGIC,
  FORMAT_VERSION,
} = require("../services/backupRecovery");
const { createS3CompatMock } = require("../services/s3CompatMock");

function createMemoryDb(options = {}) {
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
  let snapshot = null;

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

  function extraBackupFields(row) {
    return {
      pipeline_status: row.pipeline_status || (row.status === "success" ? "completed" : row.status === "failed" ? "failed" : "running"),
      storage_class: row.storage_class || "legacy_database",
      offsite_object_key: row.offsite_object_key || null,
      offsite_verified: row.offsite_verified || false,
      verified_at: row.verified_at || null,
      verification_detail: row.verification_detail || null,
      started_at: row.started_at || row.created_at,
      duration_ms: row.duration_ms || null,
      excluded_fields: row.excluded_fields || [],
      file_manifest: row.file_manifest || [],
      pg_dump_status: row.pg_dump_status || null,
      encryption: row.encryption || "none",
      schedule_slot: row.schedule_slot || null,
    };
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
    if (text.trim() === "BEGIN") {
      snapshot = clone(tables);
      return { rows: [] };
    }
    if (text.trim() === "ROLLBACK") {
      if (snapshot) {
        for (const key of Object.keys(tables)) delete tables[key];
        Object.assign(tables, snapshot);
        snapshot = null;
      }
      return { rows: [] };
    }
    if (text.trim() === "COMMIT") {
      snapshot = null;
      return { rows: [] };
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
    if (text.includes("INSERT INTO admin_portal_notifications")) {
      return { rows: [], rowCount: 0 };
    }
    if (text.includes("FROM users") && text.includes("LOWER(role) = 'admin'")) {
      return { rows: [] };
    }
    if (text.includes("INSERT INTO admin_portal_backups")) {
      if (options.rejectPipelineStatus && text.includes("pipeline_status")) {
        const error = new Error('column "pipeline_status" of relation "admin_portal_backups" does not exist');
        error.code = "42703";
        throw error;
      }
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
        ...extraBackupFields({ pipeline_status: "running", schedule_slot: params[5] || null }),
      };
      if (text.includes("'upload'")) {
        row.backup_type = "upload";
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
        row.encryption = params[11] || "none";
        row.finished_at = new Date().toISOString();
        row.pipeline_status = "completed";
      }
      backups.unshift(row);
      return { rows: [clone(row)] };
    }
    if (text.includes("UPDATE admin_portal_backups") && text.includes("pipeline_status = $2") && !text.includes("status = 'success'")) {
      const row = backups.find((item) => item.id === params[0]);
      if (row) row.pipeline_status = params[1];
      return { rows: row ? [row] : [] };
    }
    if (text.includes("UPDATE admin_portal_backups") && text.includes("status = 'success'")) {
      const row = backups.find((item) => item.id === params[0]);
      Object.assign(row, extraBackupFields(row), {
        status: "success",
        file_name: params[1],
        byte_size: params[2],
        checksum_sha256: params[3],
        format_version: params[4],
        table_count: params[5],
        row_count: params[6],
        table_names: params[7],
        payload: params[8],
        error_detail: null,
        finished_at: new Date().toISOString(),
        pipeline_status: "completed",
        storage_class: params[9] || "legacy_database",
        offsite_object_key: params[10] || null,
        offsite_verified: params[11] === true,
        verification_detail: params[12] || null,
        duration_ms: params[13] || null,
        excluded_fields: params[14] ? JSON.parse(params[14]) : [],
        file_manifest: params[15] ? JSON.parse(params[15]) : [],
        pg_dump_status: params[16] || null,
        encryption: params[17] || "none",
        schedule_slot: params[18] || row.schedule_slot,
        verified_at: new Date().toISOString(),
      });
      return { rows: [clone(row)] };
    }
    if (text.includes("UPDATE admin_portal_backups") && text.includes("storage_class = 'both'")) {
      const row = backups.find((item) => item.id === params[0]);
      Object.assign(row, {
        storage_class: "both",
        offsite_object_key: params[1],
        offsite_verified: params[2] === true,
        verified_at: new Date().toISOString(),
        verification_detail: params[3],
      });
      return { rows: [clone(row)] };
    }
    if (text.includes("UPDATE admin_portal_backups") && text.includes("status = 'failed'")) {
      const row = backups.find((item) => item.id === params[0]);
      if (row) {
        row.status = "failed";
        row.pipeline_status = "failed";
        row.error_detail = params[1];
        row.duration_ms = params[2] || null;
        row.finished_at = new Date().toISOString();
      }
      return { rows: [row] };
    }
    if (text.includes("FROM admin_portal_backups") && text.includes("ORDER BY created_at DESC") && text.includes("LIMIT 50")) {
      return {
        rows: backups.map((row) => {
          const copy = clone({ ...row, ...extraBackupFields(row) });
          delete copy.payload;
          return copy;
        }),
      };
    }
    if (text.includes("FROM admin_portal_backup_operations") && text.includes("isolated_restore")) {
      return { rows: operations.slice().reverse() };
    }
    if (text.includes("FROM admin_portal_backup_operations") && text.includes("restore")) {
      const row = operations.filter((item) => item.operation === "restore").at(-1);
      return { rows: row ? [row] : [] };
    }
    if (text.includes("FROM admin_portal_backups WHERE id")) {
      const row = backups.find((item) => String(item.id) === String(params[0]));
      return { rows: row ? [clone(row)] : [] };
    }
    if (text.includes("COUNT(*)::int AS count") && text.includes("FROM admin_portal_backups") && text.includes("status = 'success'")) {
      return { rows: [{ count: backups.filter((item) => item.status === "success").length }] };
    }
    if (text.includes("DELETE FROM admin_portal_backups WHERE id = $1")) {
      const index = backups.findIndex((item) => item.id === params[0]);
      if (index >= 0) backups.splice(index, 1);
      return { rows: [] };
    }
    if (text.includes("DELETE FROM admin_portal_backups") && text.includes("status = 'success'")) {
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
          .map((item) => ({ id: item.id, offsite_verified: item.offsite_verified })),
      };
    }
    if (text.includes("SET LOCAL")) {
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
  assert.equal(normalizeSettings({ schedule: "daily" }).schedulerActive, false);
});

test("secret policy redacts env values and names the table without exposing the secret", () => {
  const tables = {
    clinic_sms_logs: {
      rows: [{ error_detail: "provider rejected live-semaphore-key-value" }],
    },
  };
  const result = applySecretPolicy(tables, { SEMAPHORE_API_KEY: "live-semaphore-key-value" });
  assert.equal(result.tables.clinic_sms_logs.rows[0].error_detail, null);
  assert.equal(result.excludedFields[0].table, "clinic_sms_logs");
  assert.equal(JSON.stringify(result.tables).includes("live-semaphore-key-value"), false);
});

test("create backup stores metadata and excludes env secrets", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db, env: { BACKUP_SKIP_PG_DUMP: "true" }, notifyAdmin: async () => 0 });
  const backup = await service.createBackup({
    type: "manual",
    actor: { id: "admin-1", first_name: "Ada", last_name: "Admin" },
  });
  assert.equal(backup.status, "success");
  assert.equal(backup.pipelineStatus, "completed");
  assert.equal(backup.backupType, "manual");
  assert.ok(backup.restorable);
  assert.ok(backup.byteSize > 0);
  const overview = await service.getOverview();
  assert.equal(overview.status, "success");
  assert.equal(overview.availableCount, 1);
  assert.equal(overview.offsite.status, "Off-site Backup Not Configured");
  assert.equal(overview.storage.survivesDestroyedDatabase, false);
  const packed = db.backups[0].payload;
  const parsed = gunzipJson(packed);
  assert.equal(parsed.magic, BACKUP_MAGIC);
  assert.deepEqual(parsed.tables.users.rows[0].id, "p1");
  assert.match(parsed.tables.clinic_sms_logs.rows[0].error_detail, /SEMAPHORE_API_KEY/);
  assert.equal(payloadContainsSecrets(parsed, { SEMAPHORE_API_KEY: "not-in-this-dump" }), false);
});

test("an interrupted older job does not disable a new backup", async () => {
  const db = createMemoryDb();
  db.backups.unshift({
    id: "old-fail",
    status: "failed",
    pipeline_status: "failed",
    backup_type: "manual",
    file_name: "old-fail.dsb",
    byte_size: 0,
    created_at: "2026-10-29T02:46:00.000Z",
    error_detail: "Backup aborted because environment secrets were detected in table data.",
  });
  db.backups.unshift({
    id: "stuck-job",
    status: "in_progress",
    pipeline_status: "running",
    backup_type: "manual",
    file_name: "stuck.dsb",
    byte_size: 0,
    created_at: "2026-11-01T00:00:00.000Z",
    error_detail: null,
  });
  db.backups.unshift({
    id: "latest-ok",
    status: "success",
    pipeline_status: "completed",
    backup_type: "manual",
    file_name: "latest.dsb",
    byte_size: 12,
    checksum_sha256: "abc",
    created_at: "2026-11-12T02:02:00.000Z",
    error_detail: null,
  });
  const service = createBackupRecoveryService({
    db,
    env: { BACKUP_SKIP_PG_DUMP: "true" },
    notifyAdmin: async () => 0,
  });
  const overview = await service.getOverview();
  assert.equal(overview.activeJob, false);
  assert.equal(overview.status, "success");
  assert.equal(overview.capabilities.applicationSnapshot.available, true);
  assert.equal(overview.backups.find((item) => item.id === "stuck-job").interrupted, true);
  assert.match(overview.historicalFailure.message, /older failed backup/i);
  assert.match(overview.historicalFailure.errorDetail, /secrets/);
  const created = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
  assert.equal(created.status, "success");
});

test("create backup redacts a leaked env secret instead of storing it", async () => {
  const db = createMemoryDb();
  db.tables.clinic_sms_logs[0].error_detail = "failed with live-semaphore-key-value";
  const service = createBackupRecoveryService({
    db,
    env: { BACKUP_SKIP_PG_DUMP: "true", SEMAPHORE_API_KEY: "live-semaphore-key-value" },
    notifyAdmin: async () => 0,
  });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
  assert.equal(backup.status, "success");
  const parsed = gunzipJson(db.backups[0].payload);
  assert.equal(parsed.tables.clinic_sms_logs.rows[0].error_detail, null);
  assert.ok(parsed.excludedFields.length >= 1);
  assert.equal(JSON.stringify(parsed).includes("live-semaphore-key-value"), false);
});

test("isolated restore verifies records without keeping production writes", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db, env: { BACKUP_SKIP_PG_DUMP: "true" }, notifyAdmin: async () => 0 });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1", first_name: "Ada" } });
  db.tables.users = [{ id: "changed", email: "changed@example.test" }];
  const tested = await service.restoreBackup({
    backupId: backup.id,
    actor: { id: "admin-1" },
    mode: "isolated",
  });
  assert.equal(tested.isolated, true);
  assert.equal(tested.productionTouched, false);
  assert.equal(db.tables.users[0].id, "changed");
});

test("production restore is blocked unless explicitly enabled", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db, env: { BACKUP_SKIP_PG_DUMP: "true" }, notifyAdmin: async () => 0 });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
  await assert.rejects(
    () => service.restoreBackup({ backupId: backup.id, confirmation: "RESTORE", actor: { id: "admin-1" }, mode: "production" }),
    /Production restore is disabled/
  );
});

test("production restore requires RESTORE and can preserve records when enabled", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({
    db,
    env: { BACKUP_SKIP_PG_DUMP: "true", BACKUP_ALLOW_PRODUCTION_RESTORE: "true" },
    notifyAdmin: async () => 0,
  });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1", first_name: "Ada" } });
  db.tables.users = [{ id: "changed", email: "changed@example.test" }];
  await assert.rejects(
    () => service.restoreBackup({ backupId: backup.id, confirmation: "yes", actor: { id: "admin-1" }, mode: "production" }),
    /Type RESTORE/
  );
  const restored = await service.restoreBackup({
    backupId: backup.id,
    confirmation: "RESTORE",
    actor: { id: "admin-1", first_name: "Ada" },
    mode: "production",
  });
  assert.equal(restored.restored, true);
  assert.equal(db.tables.users[0].id, "p1");
  assert.equal(db.tables.appointments[0].id, "a1");
  assert.ok(restored.safetyBackup?.id);
});

test("last known-good backup cannot be deleted and failed backups are not restorable", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db, env: { BACKUP_SKIP_PG_DUMP: "true" }, notifyAdmin: async () => 0 });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
  await assert.rejects(() => service.deleteBackup({ backupId: backup.id, actor: { id: "admin-1" } }), /Type DELETE/);
  await assert.rejects(
    () => service.deleteBackup({ backupId: backup.id, actor: { id: "admin-1" }, confirmation: "DELETE" }),
    /last known-good/
  );
  db.backups[0].status = "failed";
  db.backups[0].payload = Buffer.from("nope");
  await assert.rejects(
    () => service.isolatedRestore({ backupId: backup.id, actor: { id: "admin-1" } }),
    /completed backup/
  );
});

test("corrupted archives are rejected", async () => {
  const db = createMemoryDb();
  const service = createBackupRecoveryService({ db, env: { BACKUP_SKIP_PG_DUMP: "true" }, notifyAdmin: async () => 0 });
  assert.throws(() => service.parseAndValidatePayload(Buffer.from("not-a-backup")), /valid DentaSync archive/);
  assert.throws(
    () => service.parseAndValidatePayload(gzipJson({ magic: "NOPE", formatVersion: 1, tables: {} })),
    /incompatible/
  );
});

test("independent disk store verifies a copy without claiming cloud off-site", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ds-offsite-"));
  const db = createMemoryDb();
  const service = createBackupRecoveryService({
    db,
    env: { BACKUP_SKIP_PG_DUMP: "true", BACKUP_OFFSITE_DIR: dir },
    notifyAdmin: async () => 0,
  });
  const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
  assert.equal(backup.storageClass, "both");
  assert.equal(backup.offsiteProtected, false);
  assert.ok(backup.offsiteObjectKey);
  const stored = fs.readdirSync(dir, { recursive: true });
  assert.ok(stored.join(" ").includes("archive.dsb"));
  const overview = await service.getOverview();
  assert.equal(overview.offsite.status, "Off-site Backup Not Configured");
});

async function startPortal(databaseRole, env = { BACKUP_SKIP_PG_DUMP: "true" }) {
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
        connect: memory.connect,
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
    assert.equal(overview.offsite.status, "Off-site Backup Not Configured");

    const blockedPhrase = await fetch(`${admin.url}/backups/${body.backup.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "please", mode: "production" }),
    });
    assert.equal(blockedPhrase.status, 400);

    const blocked = await fetch(`${admin.url}/backups/${body.backup.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmation: "RESTORE", mode: "production" }),
    });
    assert.equal(blocked.status, 403);

    const isolated = await fetch(`${admin.url}/backups/${body.backup.id}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "isolated" }),
    });
    assert.equal(isolated.status, 200);
    const isolatedBody = await isolated.json();
    assert.equal(isolatedBody.isolated, true);

    const download = await fetch(`${admin.url}/backups/${body.backup.id}/download`);
    assert.equal(download.status, 200);
    assert.ok((await download.arrayBuffer()).byteLength > 0);
  } finally {
    await admin.close();
  }
});

function s3TestEnv(endpoint) {
  return {
    BACKUP_SKIP_PG_DUMP: "true",
    BACKUP_S3_BUCKET: "dentasync-backups",
    BACKUP_S3_REGION: "us-east-1",
    BACKUP_S3_ENDPOINT: endpoint,
    BACKUP_S3_FORCE_PATH_STYLE: "true",
    BACKUP_S3_ACCESS_KEY_ID: "test-access-key-id12",
    BACKUP_S3_SECRET_ACCESS_KEY: "test-secret-access-key-value",
    BACKUP_S3_PREFIX: "dentasync-backups",
  };
}

test("S3-compatible off-site storage uploads, lists, and survives deleting the database payload", async () => {
  const mock = createS3CompatMock({ bucket: "dentasync-backups" });
  const listening = await mock.listen();
  try {
    const db = createMemoryDb();
    const service = createBackupRecoveryService({
      db,
      env: s3TestEnv(listening.url),
      notifyAdmin: async () => 0,
    });
    const backup = await service.createBackup({ type: "manual", actor: { id: "admin-1" } });
    assert.equal(backup.offsiteProtected, true);
    assert.equal(backup.storageClass, "both");
    const overview = await service.getOverview();
    assert.equal(overview.offsite.status, "verified");
    assert.equal(overview.storage.survivesDestroyedDatabase, true);

    const manifests = await service.listIndependentBackups();
    assert.equal(manifests.length, 1);
    assert.equal(manifests[0].id, backup.id);

    db.backups[0].payload = null;
    const row = await service.getBackupRow(backup.id, { includePayload: true });
    const remote = await service.loadArchiveBuffer(row);
    const parsed = service.parseAndValidatePayload(remote);
    assert.equal(parsed.tables.users.rows[0].id, "p1");

    db.backups.splice(0, db.backups.length);
    const independent = await service.loadIndependentArchive(backup.id);
    assert.ok(independent.length > 0);
    assert.equal(service.parseAndValidatePayload(independent).magic, BACKUP_MAGIC);
  } finally {
    await mock.close();
  }
});

test("scheduled backup worker runs without a browser session", async () => {
  const db = createMemoryDb();
  const env = { BACKUP_SKIP_PG_DUMP: "true", BACKUP_CRON_SECRET: "cron-secret-value-12" };
  const service = createBackupRecoveryService({ db, env, notifyAdmin: async () => 0 });
  await service.saveSettings({ schedule: "automatic" });
  const dueAt = new Date("2026-11-05T18:30:00.000Z");
  const result = await service.runDueScheduledBackup(dueAt);
  assert.equal(result.ran, true);
  assert.equal(result.slot, "daily");
  assert.equal(result.backup.status, "success");

  const app = express();
  app.use(express.json());
  app.post(
    "/api/internal/backups/run",
    createInternalBackupCronHandler({
      env,
      runOnce: () => service.runDueScheduledBackup(new Date("2026-11-06T18:30:00.000Z")),
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const denied = await fetch(`${url}/api/internal/backups/run`, { method: "POST" });
    assert.equal(denied.status, 401);
    const allowed = await fetch(`${url}/api/internal/backups/run`, {
      method: "POST",
      headers: { "x-backup-cron-secret": "cron-secret-value-12" },
    });
    assert.equal(allowed.status, 200);
    const body = await allowed.json();
    assert.equal(body.ran, true);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("upload of a v1 .dsb works when pipeline_status is missing and does not restore", async () => {
  const db = createMemoryDb({ rejectPipelineStatus: true });
  db.tables.users = [{ id: "live", email: "unchanged@example.test" }];
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
    tables: { users: { rows: [{ id: "p1", email: "patient@example.test" }] } },
  });
  const uploaded = await service.storeUploadedBackup({
    buffer: fixture,
    originalName: "clinic-v1.dsb",
    actor: { id: "admin-1", first_name: "Ada" },
  });
  assert.equal(uploaded.status, "success");
  assert.equal(uploaded.backupType, "upload");
  assert.equal(uploaded.restored, undefined);
  assert.equal(db.tables.users[0].id, "live");
  assert.equal(db.backups.filter((row) => row.backup_type === "upload").length, 1);
});
