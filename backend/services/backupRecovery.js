"use strict";

const crypto = require("crypto");
const zlib = require("zlib");

const BACKUP_MAGIC = "DENTASYNC_BACKUP";
const FORMAT_VERSION = 1;
const BACKUP_LOCK = 87412001;
const RESTORE_LOCK = 87412002;
const MAX_BACKUP_BYTES = 80 * 1024 * 1024;
const EXCLUDED_TABLES = new Set(["admin_portal_backups"]);
const DEFAULT_SETTINGS = {
  schedule: "manual",
  retentionCount: 12,
  timezone: "Asia/Manila",
};

function quoteIdent(name) {
  const value = String(name || "");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error("Unsupported table name in backup catalog.");
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function gzipJson(value) {
  return zlib.gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

function gunzipJson(buffer) {
  const raw = zlib.gunzipSync(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer));
  return JSON.parse(raw.toString("utf8"));
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function actorName(admin) {
  return `${admin?.first_name || ""} ${admin?.last_name || ""}`.trim() || admin?.email || "Administrator";
}

function normalizeSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const schedule = ["manual", "daily", "weekly"].includes(source.schedule) ? source.schedule : "manual";
  const retentionCount = Math.min(50, Math.max(1, Number(source.retentionCount) || DEFAULT_SETTINGS.retentionCount));
  return {
    schedule,
    retentionCount,
    timezone: "Asia/Manila",
    lastScheduledAt: source.lastScheduledAt || null,
    lastScheduledError: source.lastScheduledError || null,
    scheduler: schedule === "manual"
      ? "Manual backups only. Render does not provide a guaranteed OS cron; daily/weekly runs while the API process is awake."
      : "Server-side interval while the API service is running. Render Free may skip runs during sleep.",
  };
}

function publicBackup(row) {
  if (!row) return null;
  return {
    id: row.id,
    backupType: row.backup_type,
    status: row.status,
    fileName: row.file_name,
    byteSize: Number(row.byte_size || 0),
    checksumSha256: row.checksum_sha256 || null,
    formatVersion: Number(row.format_version || 1),
    tableCount: Number(row.table_count || 0),
    rowCount: Number(row.row_count || 0),
    tableNames: row.table_names || [],
    errorDetail: row.error_detail || null,
    createdById: row.created_by_id || null,
    createdByName: row.created_by_name || null,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    notes: row.notes || null,
    downloadable: row.status === "success" && Number(row.byte_size || 0) > 0,
    restorable: row.status === "success" && Number(row.byte_size || 0) > 0 && Boolean(row.checksum_sha256),
  };
}

const SECRET_ENV_KEYS = [
  "JWT_SECRET",
  "OTP_SECRET",
  "PASSWORD_RESET_SECRET",
  "DB_PASSWORD",
  "EMAIL_PASS",
  "EMAIL_PASSWORD",
  "SEMAPHORE_API_KEY",
  "GMAIL_APPS_SCRIPT_SECRET",
  "GEMINI_API_KEY",
  "GOOGLE_CLOUD_API_KEY",
  "GOOGLE_VISION_API_KEY",
];

function isPlaceholderSecret(value) {
  const normalized = String(value || "").trim();
  if (normalized.length < 8) return true;
  return /^(your[_-]|replace-with|changeme|example|placeholder|dummy)/i.test(normalized);
}

function collectEnvSecretValues(env = process.env) {
  const values = [];
  for (const key of SECRET_ENV_KEYS) {
    const value = String(env?.[key] || "").trim();
    if (!value || isPlaceholderSecret(value)) continue;
    values.push(value);
  }
  return values;
}

function payloadContainsSecrets(payload, env = process.env) {
  const text = JSON.stringify(payload);
  if (!text) return false;
  return collectEnvSecretValues(env).some((value) => text.includes(value));
}

function createBackupRecoveryService({ db } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Backup recovery requires a database connection.");
  }

  async function withLock(key, fn) {
    const client = typeof db.connect === "function" ? await db.connect() : db;
    const shouldRelease = client !== db;
    try {
      const locked = await client.query("SELECT pg_try_advisory_lock($1) AS locked", [key]);
      if (!locked.rows[0]?.locked) {
        const error = new Error("Another backup or restore operation is already running.");
        error.status = 409;
        throw error;
      }
      try {
        return await fn();
      } finally {
        await client.query("SELECT pg_advisory_unlock($1)", [key]).catch(() => {});
      }
    } finally {
      if (shouldRelease) client.release();
    }
  }

  async function recordOperation({ backupId, operation, status, actor, detail }) {
    try {
      await db.query(
        `INSERT INTO admin_portal_backup_operations (
           backup_id, operation, status, actor_id, actor_name, detail, finished_at
         ) VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [
          backupId || null,
          operation,
          status,
          actor?.id ? String(actor.id) : null,
          actor ? actorName(actor) : "System",
          detail ? String(detail).slice(0, 2000) : null,
        ]
      );
    } catch (error) {
      if (error?.code !== "42P01") {
        console.warn("Backup operation log failed:", error.message);
      }
    }
  }

  async function listPublicTables() {
    const result = await db.query(
      `SELECT c.relname AS name
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'r'
       ORDER BY c.relname`
    );
    return result.rows.map((row) => row.name).filter((name) => !EXCLUDED_TABLES.has(name));
  }

  async function dumpTables() {
    const names = await listPublicTables();
    const tables = {};
    const rowCounts = {};
    let totalRows = 0;
    for (const name of names) {
      const result = await db.query(
        `SELECT COALESCE(json_agg(row_to_json(t)), '[]'::json) AS rows
         FROM (SELECT * FROM ${quoteIdent(name)}) t`
      );
      const rows = result.rows[0]?.rows || [];
      const list = Array.isArray(rows) ? rows : [];
      tables[name] = { rows: list };
      rowCounts[name] = list.length;
      totalRows += list.length;
    }
    return { names, tables, rowCounts, totalRows };
  }

  async function loadSettings() {
    try {
      const result = await db.query(
        `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'backup' LIMIT 1`
      );
      return normalizeSettings(result.rows[0]?.setting_value);
    } catch (error) {
      if (error?.code === "42P01") {
        return normalizeSettings(DEFAULT_SETTINGS);
      }
      throw error;
    }
  }

  async function saveSettings(next, actor) {
    const settings = normalizeSettings(next);
    await db.query(
      `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('backup', $1::jsonb, CURRENT_TIMESTAMP, $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(settings), actor?.id ? String(actor.id) : null]
    );
    return settings;
  }

  async function applyRetention(keepCount) {
    const settings = await loadSettings();
    const limit = Math.max(1, Number(keepCount || settings.retentionCount || 12));
    const successful = await db.query(
      `SELECT id
       FROM admin_portal_backups
       WHERE status = 'success'
         AND backup_type <> 'safety'
       ORDER BY created_at DESC`
    );
    const extras = successful.rows.slice(limit);
    if (!extras.length) return 0;
    if (successful.rows.length - extras.length < 1) return 0;
    const ids = extras.map((row) => row.id);
    await db.query(
      `DELETE FROM admin_portal_backups
       WHERE id = ANY($1::uuid[])
         AND status = 'success'`,
      [ids]
    );
    return ids.length;
  }

  async function createBackup({ type = "manual", actor = null, notes = null } = {}) {
    return withLock(BACKUP_LOCK, async () => {
      const inserted = await db.query(
        `INSERT INTO admin_portal_backups (
           backup_type, status, file_name, created_by_id, created_by_name, notes
         ) VALUES ($1, 'in_progress', $2, $3, $4, $5)
         RETURNING *`,
        [
          type,
          `dentasync-backup-pending.dsb`,
          actor?.id ? String(actor.id) : null,
          actor ? actorName(actor) : "System",
          notes ? String(notes).slice(0, 500) : null,
        ]
      );
      const record = inserted.rows[0];
      try {
        const dump = await dumpTables();
        const payloadObject = {
          magic: BACKUP_MAGIC,
          formatVersion: FORMAT_VERSION,
          createdAt: new Date().toISOString(),
          backupType: type,
          app: { name: "DentaSync" },
          tableOrder: dump.names,
          rowCounts: dump.rowCounts,
          tables: dump.tables,
        };
        if (payloadContainsSecrets(payloadObject)) {
          throw new Error(
            "Backup aborted because a configured environment secret value was found in table data."
          );
        }
        const packed = gzipJson(payloadObject);
        if (packed.length > MAX_BACKUP_BYTES) {
          throw new Error("Backup exceeds the 80 MB storage limit.");
        }
        const fileName = `dentasync-backup-${record.id}.dsb`;
        const saved = await db.query(
          `UPDATE admin_portal_backups
           SET status = 'success',
               file_name = $2,
               byte_size = $3,
               checksum_sha256 = $4,
               format_version = $5,
               table_count = $6,
               row_count = $7,
               table_names = $8,
               payload = $9,
               error_detail = NULL,
               finished_at = CURRENT_TIMESTAMP
           WHERE id = $1
           RETURNING *`,
          [
            record.id,
            fileName,
            packed.length,
            sha256(packed),
            FORMAT_VERSION,
            dump.names.length,
            dump.totalRows,
            dump.names,
            packed,
          ]
        );
        await applyRetention();
        await recordOperation({
          backupId: record.id,
          operation: "create",
          status: "success",
          actor,
          detail: `Stored ${dump.names.length} tables, ${dump.totalRows} rows.`,
        });
        return publicBackup(saved.rows[0]);
      } catch (error) {
        await db.query(
          `UPDATE admin_portal_backups
           SET status = 'failed',
               error_detail = $2,
               finished_at = CURRENT_TIMESTAMP
           WHERE id = $1`,
          [record.id, String(error.message || error).slice(0, 2000)]
        );
        await recordOperation({
          backupId: record.id,
          operation: "create",
          status: "failed",
          actor,
          detail: error.message,
        });
        error.status = error.status || 500;
        throw error;
      }
    });
  }

  async function getOverview() {
    const settings = await loadSettings();
    let backups = [];
    try {
      const listed = await db.query(
        `SELECT id, backup_type, status, file_name, byte_size, checksum_sha256, format_version,
                table_count, row_count, table_names, error_detail, created_by_id, created_by_name,
                created_at, finished_at, notes
         FROM admin_portal_backups
         ORDER BY created_at DESC
         LIMIT 50`
      );
      backups = listed.rows.map(publicBackup);
    } catch (error) {
      if (error?.code === "42P01") {
        return {
          status: "unavailable",
          message: "Backup storage is not installed. Run npm run migrate:admin-backups.",
          availableCount: 0,
          backups: [],
          settings,
          storage: {
            method: "postgresql",
            location: "admin_portal_backups.payload",
            persistentAcrossDeploys: true,
            survivesDestroyedDatabase: false,
          },
        };
      }
      throw error;
    }

    const successful = backups.filter((item) => item.status === "success");
    const latest = backups[0] || null;
    const latestSuccess = successful[0] || null;
    const inProgress = backups.find((item) => item.status === "in_progress");
    const latestFailed = backups.find((item) => item.status === "failed");
    let lastRestore = null;
    try {
      const restore = await db.query(
        `SELECT backup_id, status, actor_name, detail, created_at, finished_at
         FROM admin_portal_backup_operations
         WHERE operation = 'restore'
         ORDER BY created_at DESC
         LIMIT 1`
      );
      lastRestore = restore.rows[0] || null;
    } catch (error) {
      if (error?.code !== "42P01") throw error;
    }

    let status = "never_backed_up";
    if (inProgress) status = "in_progress";
    else if (latestSuccess) status = "success";
    else if (latestFailed) status = "failed";

    return {
      status,
      availableCount: successful.length,
      latestBackup: latest,
      latestSuccessfulBackup: latestSuccess,
      lastError: latestFailed?.errorDetail || null,
      lastRestore: lastRestore
        ? {
            backupId: lastRestore.backup_id,
            status: lastRestore.status,
            actorName: lastRestore.actor_name,
            detail: lastRestore.detail,
            createdAt: lastRestore.created_at,
            finishedAt: lastRestore.finished_at,
          }
        : null,
      backups,
      settings,
      storage: {
        method: "postgresql",
        location: "admin_portal_backups.payload",
        persistentAcrossDeploys: true,
        survivesDestroyedDatabase: false,
        note: "Download completed backups for off-site copies. Render disks are ephemeral; this catalog is stored in Postgres.",
      },
    };
  }

  async function getBackupRow(id, { includePayload = false } = {}) {
    const columns = includePayload
      ? "*"
      : `id, backup_type, status, file_name, byte_size, checksum_sha256, format_version,
         table_count, row_count, table_names, error_detail, created_by_id, created_by_name,
         created_at, finished_at, notes`;
    const result = await db.query(
      `SELECT ${columns} FROM admin_portal_backups WHERE id::text = $1 LIMIT 1`,
      [String(id)]
    );
    return result.rows[0] || null;
  }

  function parseAndValidatePayload(buffer, expectedChecksum) {
    if (!buffer || !buffer.length) {
      const error = new Error("Backup file is empty or missing.");
      error.status = 400;
      throw error;
    }
    const digest = sha256(buffer);
    if (expectedChecksum && digest !== expectedChecksum) {
      const error = new Error("Backup checksum does not match the stored file.");
      error.status = 400;
      throw error;
    }
    let parsed;
    try {
      parsed = gunzipJson(buffer);
    } catch {
      const error = new Error("Backup file is not a valid DentaSync archive.");
      error.status = 400;
      throw error;
    }
    if (parsed?.magic !== BACKUP_MAGIC || Number(parsed.formatVersion) !== FORMAT_VERSION) {
      const error = new Error("Backup format is incompatible with this DentaSync version.");
      error.status = 400;
      throw error;
    }
    if (!parsed.tables || typeof parsed.tables !== "object") {
      const error = new Error("Backup is missing table data.");
      error.status = 400;
      throw error;
    }
    return parsed;
  }

  async function restoreBackup({ backupId, confirmation, actor, createSafety = true }) {
    if (String(confirmation || "").trim() !== "RESTORE") {
      const error = new Error('Type RESTORE to confirm this destructive recovery.');
      error.status = 400;
      throw error;
    }
    return withLock(RESTORE_LOCK, async () => {
      const row = await getBackupRow(backupId, { includePayload: true });
      if (!row) {
        const error = new Error("Backup not found.");
        error.status = 404;
        throw error;
      }
      if (row.status !== "success" || !row.payload) {
        const error = new Error("Only a completed backup can be restored.");
        error.status = 400;
        throw error;
      }
      const parsed = parseAndValidatePayload(row.payload, row.checksum_sha256);
      let safety = null;
      if (createSafety) {
        try {
          safety = await createBackup({
            type: "safety",
            actor,
            notes: `Automatic safety copy before restore of ${row.id}`,
          });
        } catch (error) {
          await recordOperation({
            backupId: row.id,
            operation: "restore",
            status: "blocked",
            actor,
            detail: `Safety backup failed: ${error.message}`,
          });
          const blocked = new Error(
            `Restore stopped because the safety backup failed: ${error.message}`
          );
          blocked.status = 500;
          throw blocked;
        }
      }

      const currentTables = new Set(await listPublicTables());
      const restoreNames = (parsed.tableOrder || Object.keys(parsed.tables)).filter((name) =>
        currentTables.has(name)
      );
      const client = typeof db.connect === "function" ? await db.connect() : db;
      const shouldRelease = client !== db;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        if (restoreNames.length) {
          await client.query(
            `TRUNCATE ${restoreNames.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`
          );
        }
        for (const name of restoreNames) {
          const rows = parsed.tables[name]?.rows || [];
          if (!rows.length) continue;
          await client.query(
            `INSERT INTO ${quoteIdent(name)}
             SELECT * FROM json_populate_recordset(NULL::${quoteIdent(name)}, $1::json)`,
            [JSON.stringify(rows)]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        await recordOperation({
          backupId: row.id,
          operation: "restore",
          status: "failed",
          actor,
          detail: error.message,
        });
        error.status = 500;
        throw error;
      } finally {
        if (shouldRelease) client.release();
      }

      const verified = {};
      for (const name of restoreNames) {
        const count = await db.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(name)}`);
        verified[name] = count.rows[0].count;
      }
      await recordOperation({
        backupId: row.id,
        operation: "restore",
        status: "success",
        actor,
        detail: `Restored ${restoreNames.length} tables. Safety backup: ${safety?.id || "skipped"}.`,
      });
      return {
        restored: true,
        backup: publicBackup(row),
        safetyBackup: safety,
        verifiedRowCounts: verified,
        restoredTables: restoreNames,
      };
    });
  }

  async function storeUploadedBackup({ buffer, originalName, actor }) {
    if (!buffer?.length) {
      const error = new Error("Upload a DentaSync .dsb backup file.");
      error.status = 400;
      throw error;
    }
    if (buffer.length > MAX_BACKUP_BYTES) {
      const error = new Error("Uploaded backup exceeds the 80 MB limit.");
      error.status = 400;
      throw error;
    }
    const parsed = parseAndValidatePayload(buffer);
    const packed = gzipJson(parsed);
    const inserted = await db.query(
      `INSERT INTO admin_portal_backups (
         backup_type, status, file_name, byte_size, checksum_sha256, format_version,
         table_count, row_count, table_names, payload, created_by_id, created_by_name,
         finished_at, notes
       ) VALUES (
         'upload', 'success', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11
       ) RETURNING *`,
      [
        `dentasync-upload-${Date.now()}.dsb`,
        packed.length,
        sha256(packed),
        FORMAT_VERSION,
        Object.keys(parsed.tables || {}).length,
        Object.values(parsed.rowCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
        parsed.tableOrder || Object.keys(parsed.tables || {}),
        packed,
        actor?.id ? String(actor.id) : null,
        actor ? actorName(actor) : "Administrator",
        `Uploaded ${String(originalName || "backup.dsb").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`,
      ]
    );
    await recordOperation({
      backupId: inserted.rows[0].id,
      operation: "upload",
      status: "success",
      actor,
      detail: "Uploaded backup stored. Restore was not started.",
    });
    return publicBackup(inserted.rows[0]);
  }

  async function deleteBackup({ backupId, actor }) {
    const row = await getBackupRow(backupId);
    if (!row) {
      const error = new Error("Backup not found.");
      error.status = 404;
      throw error;
    }
    const successful = await db.query(
      `SELECT COUNT(*)::int AS count FROM admin_portal_backups WHERE status = 'success'`
    );
    if (row.status === "success" && successful.rows[0].count <= 1) {
      const error = new Error("The last known-good backup cannot be deleted.");
      error.status = 400;
      throw error;
    }
    await db.query(`DELETE FROM admin_portal_backups WHERE id = $1`, [row.id]);
    await recordOperation({
      backupId: row.id,
      operation: "delete",
      status: "success",
      actor,
      detail: "Administrator deleted a backup record.",
    });
    return { deleted: true, id: row.id };
  }

  function scheduleIsDue(settings, now = new Date()) {
    if (settings.schedule === "manual") return false;
    const last = settings.lastScheduledAt ? new Date(settings.lastScheduledAt) : null;
    if (!last || Number.isNaN(last.getTime())) return true;
    const elapsed = now.getTime() - last.getTime();
    if (settings.schedule === "daily") return elapsed >= 20 * 60 * 60 * 1000;
    if (settings.schedule === "weekly") return elapsed >= 6 * 24 * 60 * 60 * 1000;
    return false;
  }

  async function runDueScheduledBackup() {
    const settings = await loadSettings();
    if (!scheduleIsDue(settings)) {
      return { ran: false, settings };
    }
    try {
      const backup = await createBackup({ type: "scheduled", actor: null, notes: "Scheduled backup" });
      await saveSettings({ ...settings, lastScheduledAt: new Date().toISOString(), lastScheduledError: null });
      return { ran: true, backup };
    } catch (error) {
      await saveSettings({
        ...settings,
        lastScheduledAt: new Date().toISOString(),
        lastScheduledError: error.message,
      });
      return { ran: false, error: error.message };
    }
  }

  return {
    BACKUP_MAGIC,
    FORMAT_VERSION,
    getOverview,
    loadSettings,
    saveSettings,
    createBackup,
    getBackupRow,
    publicBackup,
    parseAndValidatePayload,
    restoreBackup,
    storeUploadedBackup,
    deleteBackup,
    scheduleIsDue,
    runDueScheduledBackup,
    applyRetention,
  };
}

function createBackupScheduleJob({ db, intervalMs = 30 * 60 * 1000 } = {}) {
  const service = createBackupRecoveryService({ db });
  let timer = null;

  async function runOnce() {
    return service.runDueScheduledBackup();
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce().catch((error) => console.warn("Scheduled backup error:", error.message));
    }, 20_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.warn("Scheduled backup interval error:", error.message));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runOnce };
}

module.exports = {
  BACKUP_MAGIC,
  FORMAT_VERSION,
  MAX_BACKUP_BYTES,
  gzipJson,
  gunzipJson,
  sha256,
  normalizeSettings,
  SECRET_ENV_KEYS,
  collectEnvSecretValues,
  payloadContainsSecrets,
  createBackupRecoveryService,
  createBackupScheduleJob,
};
