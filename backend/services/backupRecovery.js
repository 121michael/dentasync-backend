"use strict";

const crypto = require("crypto");
const zlib = require("zlib");
const { notifyActiveAdmins } = require("./adminNotifications");
const { collectUploadFiles, restoreUploadFiles, stripFileBytes } = require("./backupFiles");
const { createOffsiteStore, objectPrefix } = require("./backupOffsite");
const { tryPgDump } = require("./backupPgDump");
const {
  ARCHIVE_FORMAT,
  STAGE_CREATED,
  STAGE_VALIDATED,
  STAGE_RESTORED,
  assertSeparateDatabase,
  captureManifest,
  createCustomDump,
  assertArchiveReadable,
  restoreCustomDump,
  inspectDatabase,
  compareManifest,
  dropDatabase,
  restoreOntoLive,
  describeBackupTools,
} = require("./backupPgCustom");

const BACKUP_MAGIC = "DENTASYNC_BACKUP";
const FORMAT_VERSION = 2;
const SUPPORTED_FORMATS = new Set([1, 2]);
const BACKUP_LOCK = 87412001;
const RESTORE_LOCK = 87412002;
const MAX_BACKUP_BYTES = 80 * 1024 * 1024;
const EXCLUDED_TABLES = new Set(["admin_portal_backups"]);
const ENVELOPE = Buffer.from("DSBENC1");
const DEFAULT_SETTINGS = {
  schedule: "manual",
  automatic: false,
  dailyEnabled: true,
  weeklyEnabled: true,
  monthlyEnabled: true,
  dailyHour: 2,
  retentionCount: 12,
  retentionDaily: 30,
  retentionWeekly: 8,
  retentionMonthly: 12,
  retentionManual: 12,
  timezone: "Asia/Manila",
  alertsEnabled: true,
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

function manilaParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: get("weekday"),
    hour: Number(get("hour")),
    dateKey: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function dateKeyFromIso(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return manilaParts(date).dateKey;
}

function schedulerCapabilities(env = process.env) {
  const external = String(env.BACKUP_EXTERNAL_SCHEDULER || "").toLowerCase() === "true";
  const cronSecret = Boolean(String(env.BACKUP_CRON_SECRET || "").trim());
  return {
    externalScheduler: external,
    cronEndpointConfigured: cronSecret,
    inProcessTimer: true,
    reliableAutomation: external,
  };
}

function normalizeSettings(value, env = process.env) {
  const source = value && typeof value === "object" ? value : {};
  const schedule = ["manual", "daily", "weekly", "automatic"].includes(source.schedule)
    ? source.schedule
    : "manual";
  const automatic = source.automatic === true || schedule === "automatic" || schedule === "daily" || schedule === "weekly";
  const caps = schedulerCapabilities(env);
  const schedulerNote = !automatic
    ? "Manual backups only. Automatic runs are not enabled."
    : caps.reliableAutomation
      ? "External scheduler is configured (Render Cron or BACKUP_EXTERNAL_SCHEDULER=true). Daily default is 2:00 AM Asia/Manila."
      : "Automatic times are stored, but this host only runs them while the API process is awake. Render Free sleep skips jobs. Add a Render Cron Job to POST /api/internal/backups/run with BACKUP_CRON_SECRET to make automation independent of the web server.";
  return {
    schedule,
    automatic,
    dailyEnabled: source.dailyEnabled !== false,
    weeklyEnabled: source.weeklyEnabled !== false,
    monthlyEnabled: source.monthlyEnabled !== false,
    dailyHour: Math.min(23, Math.max(0, Number(source.dailyHour ?? 2))),
    retentionCount: Math.min(50, Math.max(1, Number(source.retentionCount) || DEFAULT_SETTINGS.retentionCount)),
    retentionDaily: Math.min(90, Math.max(1, Number(source.retentionDaily) || 30)),
    retentionWeekly: Math.min(52, Math.max(1, Number(source.retentionWeekly) || 8)),
    retentionMonthly: Math.min(36, Math.max(1, Number(source.retentionMonthly) || 12)),
    retentionManual: Math.min(50, Math.max(1, Number(source.retentionManual) || 12)),
    timezone: "Asia/Manila",
    alertsEnabled: source.alertsEnabled !== false,
    lastScheduledAt: source.lastScheduledAt || null,
    lastScheduledError: source.lastScheduledError || null,
    lastDailyAt: source.lastDailyAt || null,
    lastWeeklyAt: source.lastWeeklyAt || null,
    lastMonthlyAt: source.lastMonthlyAt || null,
    lastCronAt: source.lastCronAt || null,
    scheduler: schedulerNote,
    schedulerActive: automatic && caps.reliableAutomation,
    schedulerCapabilities: caps,
  };
}

function pitrStatus(env = process.env) {
  if (String(env.BACKUP_PITR_AVAILABLE || "").toLowerCase() === "true") {
    return {
      available: true,
      window: env.BACKUP_PITR_WINDOW || "Provider recovery window",
      note: "Point-in-time recovery is provided by the PostgreSQL host, not by DentaSync .dsb archives.",
    };
  }
  return {
    available: false,
    window: null,
    note: "Point-in-time recovery is unavailable on this plan. Daily archives are logical snapshots, not arbitrary PITR.",
  };
}

function publicBackup(row) {
  if (!row) return null;
  const pipeline = row.pipeline_status || (row.status === "success" ? "completed" : row.status === "failed" ? "failed" : row.status);
  const storageClass = row.storage_class || "legacy_database";
  const offsiteVerified = row.offsite_verified === true || row.offsite_verified === "t";
  return {
    id: row.id,
    backupType: row.backup_type,
    status: row.status,
    pipelineStatus: pipeline,
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
    startedAt: row.started_at || row.created_at,
    durationMs: row.duration_ms == null ? null : Number(row.duration_ms),
    notes: row.notes || null,
    storageClass,
    storageLocation: storageClass,
    offsiteObjectKey: row.offsite_object_key || null,
    offsiteVerified,
    offsiteProtected: offsiteVerified && storageClass !== "legacy_database",
    verifiedAt: row.verified_at || null,
    verificationDetail: row.verification_detail || null,
    verificationStatus: row.verified_at ? "verified" : row.status === "success" ? "checksum_only" : "unverified",
    excludedFields: row.excluded_fields || [],
    fileManifest: row.file_manifest || [],
    pgDumpStatus: row.pg_dump_status || null,
    encryption: row.encryption || "none",
    scheduleSlot: row.schedule_slot || null,
    archiveFormat: row.archive_format || (String(row.file_name || "").toLowerCase().endsWith(".dump") ? ARCHIVE_FORMAT : "dsb"),
    recoveryStage: row.recovery_stage || null,
    formatLabel: row.archive_format === ARCHIVE_FORMAT || String(row.file_name || "").toLowerCase().endsWith(".dump") ? ".dump" : ".dsb",
    legacyDatabaseStored: Boolean(row.payload) || storageClass === "legacy_database" || storageClass === "both",
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
  "BACKUP_S3_SECRET_ACCESS_KEY",
  "BACKUP_ENCRYPTION_KEY",
  "BACKUP_CRON_SECRET",
  "RFID_DEVICE_SECRET",
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

function redactSecrets(value, secrets, path, hits) {
  if (typeof value === "string") {
    if (secrets.some((secret) => secret && value.includes(secret))) {
      const table = path.split(".")[0] || "unknown";
      const column = path.split(".").slice(1).join(".") || "(value)";
      hits.push({ table, column, path, reason: "environment_secret_value" });
      return null;
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => redactSecrets(item, secrets, `${path}[${index}]`, hits));
  }
  if (value && typeof value === "object") {
    const copy = {};
    for (const [key, nested] of Object.entries(value)) {
      copy[key] = redactSecrets(nested, secrets, path ? `${path}.${key}` : key, hits);
    }
    return copy;
  }
  return value;
}

function applySecretPolicy(tables, env = process.env) {
  const secrets = collectEnvSecretValues(env);
  const hits = [];
  const redacted = redactSecrets(tables, secrets, "", hits);
  if (payloadContainsSecrets({ tables: redacted }, env)) {
    const error = new Error(
      "Backup aborted because a configured environment secret value remained in table data after the reviewed redaction policy."
    );
    error.status = 500;
    error.excludedFields = hits;
    throw error;
  }
  return { tables: redacted, excludedFields: hits };
}

function wrapArchive(buffer, env = process.env) {
  const keyMaterial = String(env.BACKUP_ENCRYPTION_KEY || "").trim();
  if (!keyMaterial || isPlaceholderSecret(keyMaterial)) {
    return { buffer, encryption: "none" };
  }
  const key = crypto.scryptSync(keyMaterial, "dentasync-backup-v2", 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { buffer: Buffer.concat([ENVELOPE, iv, tag, enc]), encryption: "aes-256-gcm" };
}

function unwrapArchive(buffer, env = process.env) {
  if (!Buffer.isBuffer(buffer)) buffer = Buffer.from(buffer);
  if (buffer.length > 35 && buffer.subarray(0, 7).equals(ENVELOPE)) {
    const keyMaterial = String(env.BACKUP_ENCRYPTION_KEY || "").trim();
    if (!keyMaterial) {
      const error = new Error("This archive is encrypted. Set BACKUP_ENCRYPTION_KEY to download or restore it.");
      error.status = 400;
      throw error;
    }
    const key = crypto.scryptSync(keyMaterial, "dentasync-backup-v2", 32);
    const iv = buffer.subarray(7, 19);
    const tag = buffer.subarray(19, 35);
    const enc = buffer.subarray(35);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  }
  return buffer;
}

function productionRestoreAllowed(env = process.env) {
  return String(env.BACKUP_ALLOW_PRODUCTION_RESTORE || "").toLowerCase() === "true";
}

function createBackupRecoveryService({ db, env = process.env, notifyAdmin = notifyActiveAdmins } = {}) {
  if (!db || typeof db.query !== "function") {
    throw new Error("Backup recovery requires a database connection.");
  }
  const offsite = createOffsiteStore(env);

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

  async function jobIsRunning() {
    for (const key of [BACKUP_LOCK, RESTORE_LOCK]) {
      try {
        const locked = await db.query("SELECT pg_try_advisory_lock($1) AS locked", [key]);
        if (!locked.rows[0]?.locked) return true;
        await db.query("SELECT pg_advisory_unlock($1)", [key]);
      } catch {
        return false;
      }
    }
    return false;
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

  async function alertAdmins(title, body, backupId = null) {
    try {
      await notifyAdmin(db, {
        type: "backup_alert",
        title,
        body,
        entityType: "backup",
        entityId: backupId,
      });
    } catch (error) {
      console.warn("Backup admin notice failed:", error.message);
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
      return normalizeSettings(result.rows[0]?.setting_value, env);
    } catch (error) {
      if (error?.code === "42P01") {
        return normalizeSettings(DEFAULT_SETTINGS, env);
      }
      throw error;
    }
  }

  async function saveSettings(next, actor) {
    const settings = normalizeSettings(next, env);
    const persisted = { ...settings };
    delete persisted.scheduler;
    delete persisted.schedulerActive;
    delete persisted.schedulerCapabilities;
    await db.query(
      `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
       VALUES ('backup', $1::jsonb, CURRENT_TIMESTAMP, $2)
       ON CONFLICT (setting_key) DO UPDATE
       SET setting_value = EXCLUDED.setting_value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
      [JSON.stringify(persisted), actor?.id ? String(actor.id) : null]
    );
    return normalizeSettings(persisted, env);
  }

  async function applyRetention() {
    const settings = await loadSettings();
    const groups = [
      { slot: "daily", keep: settings.retentionDaily },
      { slot: "weekly", keep: settings.retentionWeekly },
      { slot: "monthly", keep: settings.retentionMonthly },
      { slot: null, keep: settings.retentionManual },
    ];
    let removed = 0;
    const verified = await db.query(
      `SELECT COUNT(*)::int AS count
       FROM admin_portal_backups
       WHERE status = 'success'`
    );
    const verifiedCount = Number(verified.rows[0]?.count || 0);
    for (const group of groups) {
      const successful = await db.query(
        group.slot
          ? `SELECT id, offsite_verified FROM admin_portal_backups
             WHERE status = 'success' AND backup_type <> 'safety' AND schedule_slot = $1
             ORDER BY created_at DESC`
          : `SELECT id, offsite_verified FROM admin_portal_backups
             WHERE status = 'success' AND backup_type <> 'safety' AND (schedule_slot IS NULL OR schedule_slot = '')
             ORDER BY created_at DESC`,
        group.slot ? [group.slot] : []
      );
      const extras = successful.rows.slice(group.keep);
      for (const extra of extras) {
        if (verifiedCount - removed <= 1) break;
        await db.query(
          `DELETE FROM admin_portal_backups
           WHERE id = $1 AND status = 'success'`,
          [extra.id]
        );
        removed += 1;
      }
    }
    return removed;
  }

  async function setPipeline(id, pipelineStatus) {
    try {
      await db.query(
        `UPDATE admin_portal_backups SET pipeline_status = $2 WHERE id = $1`,
        [id, pipelineStatus]
      );
    } catch (error) {
      if (error?.code !== "42703") throw error;
    }
  }

  async function putOffsite(backupId, packed, publicMeta) {
    if (!offsite.store) return { storageClass: "legacy_database", offsiteVerified: false, key: null };
    const prefix = objectPrefix(env);
    const key = `${prefix}/${backupId}/archive.dsb`;
    const manifestKey = `${prefix}/${backupId}/manifest.json`;
    await offsite.store.putObject(key, packed, "application/octet-stream");
    const manifest = Buffer.from(
      JSON.stringify({
        ...publicMeta,
        independentOfDatabase: true,
        createdAt: new Date().toISOString(),
      }),
      "utf8"
    );
    await offsite.store.putObject(manifestKey, manifest, "application/json");
    const downloaded = await offsite.store.getObject(key);
    const verified = Boolean(downloaded) && sha256(downloaded) === sha256(packed);
    if (!verified) {
      throw new Error("Off-site upload could not be verified by re-reading the archive.");
    }
    return {
      storageClass: offsite.configured ? "offsite" : "independent_disk",
      offsiteVerified: offsite.configured && verified,
      independentVerified: verified,
      key,
    };
  }

  function rowIsDump(row) {
    return row?.archive_format === ARCHIVE_FORMAT || String(row?.file_name || "").toLowerCase().endsWith(".dump");
  }

  function payloadBuffer(value) {
    if (!value) return Buffer.alloc(0);
    if (Buffer.isBuffer(value)) return value;
    return Buffer.from(value);
  }

  async function createPostgresDump({ actor = null, notes = null, backupType = "postgres_dump" } = {}) {
    return withLock(BACKUP_LOCK, async () => {
      const started = Date.now();
      const inserted = await db.query(
        `INSERT INTO admin_portal_backups (
           backup_type, status, file_name, created_by_id, created_by_name, notes,
           pipeline_status, started_at, archive_format, recovery_stage
         ) VALUES ($1, 'in_progress', $2, $3, $4, $5, 'running', CURRENT_TIMESTAMP, $6, NULL)
         RETURNING *`,
        [
          backupType,
          "dentasync-postgres-pending.dump",
          actor?.id ? String(actor.id) : null,
          actor ? actorName(actor) : "System",
          notes
            ? String(notes).slice(0, 500)
            : "PostgreSQL custom-format dump of schema and rows. Uploaded files such as X-rays and PDFs are not included.",
          ARCHIVE_FORMAT,
        ]
      );
      const record = inserted.rows[0];
      try {
        const manifest = await captureManifest(db);
        const dumped = await createCustomDump(env);
        if (dumped.buffer.length > MAX_BACKUP_BYTES) {
          const error = new Error("PostgreSQL backup exceeds the 80 MB catalog limit and was not stored.");
          error.status = 500;
          throw error;
        }
        const checksum = sha256(dumped.buffer);
        const fileName = `dentasync-postgres-${record.id}.dump`;
        const tableCount = manifest.tables.filter(
          (name) => name !== "admin_portal_backups" && name !== "admin_portal_backup_operations"
        ).length;
        const rowCount = Object.values(manifest.rowCounts).reduce((sum, value) => sum + Number(value || 0), 0);
        const saved = await db.query(
          `UPDATE admin_portal_backups
           SET status = 'success',
               pipeline_status = $2,
               recovery_stage = $2,
               file_name = $3,
               byte_size = $4,
               checksum_sha256 = $5,
               format_version = 0,
               table_count = $6,
               row_count = $7,
               table_names = $8,
               payload = $9,
               dump_manifest = $10::jsonb,
               pg_dump_status = 'captured',
               archive_format = $11,
               storage_class = 'legacy_database',
               encryption = 'none',
               error_detail = NULL,
               verified_at = NULL,
               verification_detail = $12,
               finished_at = CURRENT_TIMESTAMP,
               duration_ms = $13
           WHERE id = $1
           RETURNING *`,
          [
            record.id,
            STAGE_CREATED,
            fileName,
            dumped.buffer.length,
            checksum,
            tableCount,
            rowCount,
            manifest.tables,
            dumped.buffer,
            JSON.stringify(manifest),
            ARCHIVE_FORMAT,
            "Backup created. pg_dump finished and pg_restore could read the archive. This is not a restore.",
            Date.now() - started,
          ]
        );
        await recordOperation({
          backupId: record.id,
          operation: "create",
          status: "success",
          actor,
          detail: `PostgreSQL custom dump created. tables=${tableCount} rows=${rowCount} bytes=${dumped.buffer.length}.`,
        });
        return publicBackup(saved.rows[0]);
      } catch (error) {
        const message = String(error.message || "PostgreSQL backup failed.").slice(0, 500);
        await db.query(
          `UPDATE admin_portal_backups
           SET status = 'failed',
               pipeline_status = 'failed',
               recovery_stage = NULL,
               error_detail = $2,
               finished_at = CURRENT_TIMESTAMP,
               duration_ms = $3
           WHERE id = $1`,
          [record.id, message, Date.now() - started]
        ).catch(() => {});
        await recordOperation({
          backupId: record.id,
          operation: "create",
          status: "failed",
          actor,
          detail: message,
        });
        await alertAdmins("PostgreSQL backup failed", "A PostgreSQL .dump job failed. The dashboard lists the error without archive contents.", record.id);
        error.status = error.status || 500;
        throw error;
      }
    });
  }

  async function createBackup({ type = "manual", actor = null, notes = null, scheduleSlot = null } = {}) {
    return withLock(BACKUP_LOCK, async () => {
      const started = Date.now();
      let inserted;
      try {
        inserted = await db.query(
          `INSERT INTO admin_portal_backups (
             backup_type, status, file_name, created_by_id, created_by_name, notes, pipeline_status, started_at, schedule_slot
           ) VALUES ($1, 'in_progress', $2, $3, $4, $5, 'running', CURRENT_TIMESTAMP, $6)
           RETURNING *`,
          [
            type,
            `dentasync-backup-pending.dsb`,
            actor?.id ? String(actor.id) : null,
            actor ? actorName(actor) : "System",
            notes ? String(notes).slice(0, 500) : null,
            scheduleSlot,
          ]
        );
      } catch (error) {
        if (error?.code !== "42703") throw error;
        inserted = await db.query(
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
      }
      const record = inserted.rows[0];
      try {
        const dump = await dumpTables();
        const policy = applySecretPolicy(dump.tables, env);
        const files = collectUploadFiles({ cwd: process.cwd() });
        let pgDump = { status: "skipped", reason: "not attempted" };
        try {
          pgDump = await tryPgDump(env);
        } catch (error) {
          pgDump = { status: "failed", reason: error.message };
        }
        const payloadObject = {
          magic: BACKUP_MAGIC,
          formatVersion: FORMAT_VERSION,
          createdAt: new Date().toISOString(),
          backupType: type,
          app: { name: "DentaSync" },
          tableOrder: dump.names,
          rowCounts: dump.rowCounts,
          tables: policy.tables,
          excludedFields: policy.excludedFields,
          files: {
            included: files.included,
            omitted: files.omitted,
          },
          pgDump: {
            status: pgDump.status,
            reason: pgDump.reason || null,
            postgresVersion: pgDump.postgresVersion || null,
            sqlGzipBase64: pgDump.sqlGzipBase64 || null,
          },
        };
        if (payloadContainsSecrets({ tables: payloadObject.tables, excludedFields: payloadObject.excludedFields }, env)) {
          throw new Error(
            "Backup aborted because a configured environment secret value was found in table data."
          );
        }
        let packedInner = gzipJson(payloadObject);
        let postgresInner = packedInner;
        if (packedInner.length > MAX_BACKUP_BYTES) {
          const slimmer = {
            ...payloadObject,
            files: { included: stripFileBytes(files.included), omitted: files.omitted },
            pgDump: { ...payloadObject.pgDump, sqlGzipBase64: null },
          };
          postgresInner = gzipJson(slimmer);
          if (postgresInner.length > MAX_BACKUP_BYTES) {
            throw new Error("Backup exceeds the 80 MB storage limit.");
          }
        }
        const wrappedOffsite = wrapArchive(packedInner, env);
        const wrappedPostgres = wrapArchive(postgresInner, env);
        const fileName = `dentasync-backup-${record.id}.dsb`;
        await setPipeline(record.id, "uploading");
        let offsiteResult = { storageClass: "legacy_database", offsiteVerified: false, key: null };
        try {
          offsiteResult = await putOffsite(record.id, wrappedOffsite.buffer, {
            id: record.id,
            fileName,
            checksumSha256: sha256(wrappedOffsite.buffer),
            byteSize: wrappedOffsite.buffer.length,
            tableCount: dump.names.length,
            rowCount: dump.totalRows,
            formatVersion: FORMAT_VERSION,
            encryption: wrappedOffsite.encryption,
          });
        } catch (error) {
          if (offsite.store) {
            await alertAdmins(
              "Backup off-site upload failed",
              "A clinic backup archive could not be stored independently of PostgreSQL.",
              record.id
            );
            throw error;
          }
        }
        await setPipeline(record.id, "verifying");
        const storageClass = offsiteResult.key
          ? offsite.configured
            ? "both"
            : "both"
          : "legacy_database";
        const successParams = [
          record.id,
          fileName,
          wrappedPostgres.buffer.length,
          sha256(wrappedPostgres.buffer),
          FORMAT_VERSION,
          dump.names.length,
          dump.totalRows,
          dump.names,
          wrappedPostgres.buffer,
          offsiteResult.key ? "both" : "legacy_database",
          offsiteResult.key,
          offsiteResult.offsiteVerified === true,
          offsiteResult.offsiteVerified
            ? "Off-site object re-read matched checksum."
            : offsiteResult.independentVerified
              ? "Independent disk copy verified. Cloud off-site is not configured."
              : "Logical archive checksum stored in PostgreSQL only.",
          Date.now() - started,
          JSON.stringify(policy.excludedFields),
          JSON.stringify(stripFileBytes([...files.included, ...files.omitted])),
          pgDump.status,
          wrappedPostgres.encryption,
          scheduleSlot,
        ];
        let saved;
        try {
          saved = await db.query(
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
                 finished_at = CURRENT_TIMESTAMP,
                 pipeline_status = 'completed',
                 storage_class = $10,
                 offsite_object_key = $11,
                 offsite_verified = $12,
                 verified_at = CURRENT_TIMESTAMP,
                 verification_detail = $13,
                 duration_ms = $14,
                 excluded_fields = $15::jsonb,
                 file_manifest = $16::jsonb,
                 pg_dump_status = $17,
                 encryption = $18,
                 schedule_slot = $19
             WHERE id = $1
             RETURNING *`,
            successParams
          );
        } catch (error) {
          if (error?.code !== "42703") throw error;
          saved = await db.query(
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
            successParams.slice(0, 9)
          );
        }
        void storageClass;
        await applyRetention();
        await recordOperation({
          backupId: record.id,
          operation: "create",
          status: "success",
          actor,
          detail: `Stored ${dump.names.length} tables, ${dump.totalRows} rows, ${files.fileCount} files. Excluded secret fields: ${policy.excludedFields.length}.`,
        });
        return publicBackup(saved.rows[0]);
      } catch (error) {
        await db.query(
          `UPDATE admin_portal_backups
           SET status = 'failed',
               pipeline_status = 'failed',
               error_detail = $2,
               finished_at = CURRENT_TIMESTAMP,
               duration_ms = $3
           WHERE id = $1`,
          [record.id, String(error.message || error).slice(0, 2000), Date.now() - started]
        );
        await recordOperation({
          backupId: record.id,
          operation: "create",
          status: "failed",
          actor,
          detail: error.message,
        });
        await alertAdmins("Backup failed", "A clinic backup job failed. Check Backup History for the error class.", record.id);
        error.status = error.status || 500;
        throw error;
      }
    });
  }

  function nextScheduledDescription(settings) {
    if (!settings.automatic) return null;
    if (!settings.schedulerActive) {
      return "Not independently scheduled. Next in-process attempt runs while the API is awake.";
    }
    return `Daily ${String(settings.dailyHour).padStart(2, "0")}:00 Asia/Manila; weekly Sunday; monthly on the 1st.`;
  }

  async function getOverview() {
    const settings = await loadSettings();
    let backups = [];
    try {
      const listed = await db.query(
        `SELECT id, backup_type, status, file_name, byte_size, checksum_sha256, format_version,
                table_count, row_count, table_names, error_detail, created_by_id, created_by_name,
                created_at, finished_at, notes, pipeline_status, storage_class, offsite_object_key,
                offsite_verified, verified_at, verification_detail, started_at, duration_ms,
                excluded_fields, file_manifest, pg_dump_status, encryption, schedule_slot,
                archive_format, recovery_stage, dump_manifest
         FROM admin_portal_backups
         ORDER BY created_at DESC
         LIMIT 50`
      );
      backups = listed.rows.map(publicBackup);
    } catch (error) {
      if (error?.code === "42703") {
        const listed = await db.query(
          `SELECT id, backup_type, status, file_name, byte_size, checksum_sha256, format_version,
                  table_count, row_count, table_names, error_detail, created_by_id, created_by_name,
                  created_at, finished_at, notes
           FROM admin_portal_backups
           ORDER BY created_at DESC
           LIMIT 50`
        );
        backups = listed.rows.map(publicBackup);
      } else if (error?.code === "42P01") {
        return {
          status: "unavailable",
          activeJob: false,
          message: "Backup storage is not installed. Run npm run migrate:admin-backups.",
          availableCount: 0,
          backups: [],
          capabilities: {
            postgresDump: {
              available: false,
              reason: "Backup storage is not installed.",
              nextStep: "Run npm run migrate:admin-backups, then restart the API.",
            },
            applicationSnapshot: {
              available: false,
              reason: "Backup storage is not installed.",
              nextStep: "Run npm run migrate:admin-backups, then restart the API.",
            },
            testRestore: {
              available: false,
              reason: "Backup storage is not installed, so a restore test cannot run.",
              nextStep: "Install the backup catalog first. Backup creation stays off until that catalog exists.",
            },
          },
          settings,
          storage: {
            method: "postgresql",
            location: "admin_portal_backups.payload",
            persistentAcrossDeploys: true,
            survivesDestroyedDatabase: false,
          },
          offsite: offsite,
          pitr: pitrStatus(env),
        };
      } else {
        throw error;
      }
    }

    const successful = backups.filter((item) => item.status === "success");
    const latestAttempted = backups[0] || null;
    const latestCompleted = successful[0] || null;
    const latestFailed = backups.find((item) => item.status === "failed") || null;
    const latestVerified = backups.find((item) => (
      item.archiveFormat === ARCHIVE_FORMAT
        ? item.recoveryStage === STAGE_RESTORED
        : Boolean(item.verifiedAt)
    )) || successful.find((item) => item.archiveFormat !== ARCHIVE_FORMAT) || null;
    const activeJob = await jobIsRunning();
    for (const item of backups) {
      const running = item.status === "in_progress" || ["queued", "running", "uploading", "verifying"].includes(item.pipelineStatus);
      if (running && !activeJob) item.interrupted = true;
    }
    const verifiedOffsite = backups.find((item) => item.offsiteProtected);
    let lastRestore = null;
    let lastIsolated = null;
    try {
      const restore = await db.query(
        `SELECT backup_id, operation, status, actor_name, detail, created_at, finished_at
         FROM admin_portal_backup_operations
         WHERE operation IN ('restore', 'isolated_restore', 'dump_test_restore')
         ORDER BY created_at DESC
         LIMIT 5`
      );
      lastRestore = restore.rows.find((row) => row.operation === "restore") || null;
      lastIsolated = restore.rows.find((row) => row.operation === "isolated_restore" || row.operation === "dump_test_restore") || null;
    } catch (error) {
      if (error?.code !== "42P01") throw error;
    }

    let status = "never_backed_up";
    if (activeJob) status = "in_progress";
    else if (latestAttempted?.status === "failed") status = "failed";
    else if (latestCompleted) status = "success";
    else if (latestFailed) status = "failed";
    const historicalFailure = latestFailed
      && latestAttempted
      && latestAttempted.status === "success"
      && latestAttempted.id !== latestFailed.id
      ? {
          id: latestFailed.id,
          createdAt: latestFailed.createdAt,
          errorDetail: latestFailed.errorDetail,
          message: "This is an older failed backup, not the result of the latest attempt.",
        }
      : null;
    const capabilities = await describeBackupTools(env).catch(() => ({
      postgresDump: {
        available: false,
        reason: "PostgreSQL backup tools could not be checked.",
        nextStep: "Confirm pg_dump and pg_restore are installed on the API host, then refresh this page.",
      },
      applicationSnapshot: { available: true, reason: "", nextStep: "" },
      testRestore: {
        available: false,
        reason: "A test restore could not be checked.",
        nextStep: "Creating a backup is still allowed. Open Restore after the tools are available.",
      },
    }));

    const storageBytes = successful.reduce((sum, item) => sum + Number(item.byteSize || 0), 0);

    return {
      status,
      activeJob,
      capabilities,
      historicalFailure,
      availableCount: successful.length,
      latestBackup: latestAttempted,
      latestAttemptedBackup: latestAttempted,
      latestSuccessfulBackup: latestCompleted,
      latestCompletedBackup: latestCompleted,
      latestFailedBackup: latestFailed,
      latestVerifiedBackup: latestVerified,
      lastError: latestFailed?.errorDetail || null,
      nextScheduledBackup: nextScheduledDescription(settings),
      lastRestore: lastRestore
        ? {
            backupId: lastRestore.backup_id,
            status: lastRestore.status,
            actorName: lastRestore.actor_name,
            detail: lastRestore.detail,
            createdAt: lastRestore.created_at,
            finishedAt: lastRestore.finished_at,
            kind: "production",
          }
        : null,
      lastIsolatedRestore: lastIsolated
        ? {
            backupId: lastIsolated.backup_id,
            status: lastIsolated.status,
            actorName: lastIsolated.actor_name,
            detail: lastIsolated.detail,
            createdAt: lastIsolated.created_at,
            finishedAt: lastIsolated.finished_at,
          }
        : null,
      backups,
      settings,
      productionRestoreEnabled: productionRestoreAllowed(env),
      pitr: pitrStatus(env),
      offsite: {
        configured: offsite.configured,
        provider: offsite.provider,
        label: offsite.label,
        status: verifiedOffsite
          ? "verified"
          : offsite.configured
            ? "configured_unverified"
            : "Off-site Backup Not Configured",
        independentDisk: Boolean(offsite.independentDisk),
      },
      storage: {
        method: offsite.configured ? "postgresql+s3" : "postgresql",
        location: offsite.configured
          ? "admin_portal_backups.payload + private object storage"
          : "admin_portal_backups.payload",
        persistentAcrossDeploys: true,
        survivesDestroyedDatabase: Boolean(verifiedOffsite),
        usageBytes: storageBytes,
        note: verifiedOffsite
          ? "A verified independent object copy exists for at least one backup."
          : "Download completed backups or configure BACKUP_S3_* credentials. Render disks are ephemeral; this catalog is stored in Postgres and does not survive destroying that database unless an off-site copy was verified.",
      },
    };
  }

  async function getBackupRow(id, { includePayload = false } = {}) {
    const columns = includePayload
      ? "*"
      : `id, backup_type, status, file_name, byte_size, checksum_sha256, format_version,
         table_count, row_count, table_names, error_detail, created_by_id, created_by_name,
         created_at, finished_at, notes, pipeline_status, storage_class, offsite_object_key,
         offsite_verified, verified_at, verification_detail, started_at, duration_ms,
         excluded_fields, file_manifest, pg_dump_status, encryption, schedule_slot,
         archive_format, recovery_stage, dump_manifest`;
    try {
      const result = await db.query(
        `SELECT ${columns} FROM admin_portal_backups WHERE id::text = $1 LIMIT 1`,
        [String(id)]
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error?.code !== "42703") throw error;
      const result = await db.query(
        `SELECT id, backup_type, status, file_name, byte_size, checksum_sha256, format_version,
                table_count, row_count, table_names, error_detail, created_by_id, created_by_name,
                created_at, finished_at, notes, payload
         FROM admin_portal_backups WHERE id::text = $1 LIMIT 1`,
        [String(id)]
      );
      return result.rows[0] || null;
    }
  }

  function parseAndValidatePayload(buffer, expectedChecksum, options = {}) {
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
    let inner = buffer;
    try {
      inner = unwrapArchive(buffer, options.env || env);
    } catch (error) {
      if (error.status) throw error;
    }
    let parsed;
    try {
      parsed = gunzipJson(inner);
    } catch {
      const error = new Error("Backup file is not a valid DentaSync archive.");
      error.status = 400;
      throw error;
    }
    if (parsed?.magic !== BACKUP_MAGIC || !SUPPORTED_FORMATS.has(Number(parsed.formatVersion))) {
      const error = new Error("Backup format is incompatible with this DentaSync version.");
      error.status = 400;
      throw error;
    }
    if (!parsed.tables || typeof parsed.tables !== "object") {
      const error = new Error("Backup is missing table data.");
      error.status = 400;
      throw error;
    }
    if (payloadContainsSecrets({ tables: parsed.tables, excludedFields: parsed.excludedFields }, options.env || env)) {
      const error = new Error("Backup archive still contains environment secret values and cannot be restored.");
      error.status = 400;
      throw error;
    }
    return parsed;
  }

  async function loadArchiveBuffer(row) {
    if (row?.payload && row.payload.length) {
      return Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload);
    }
    if (row?.offsite_object_key && offsite.store) {
      const remote = await offsite.store.getObject(row.offsite_object_key);
      if (remote) return remote;
    }
    if (row?.id && offsite.store) {
      const remote = await loadIndependentArchive(row.id);
      if (remote) return remote;
    }
    const error = new Error("Backup file is empty or missing.");
    error.status = 400;
    throw error;
  }

  async function listIndependentBackups() {
    if (!offsite.store) {
      const error = new Error("Independent backup storage is not configured.");
      error.status = 400;
      throw error;
    }
    const prefix = objectPrefix(env);
    const listed = await offsite.store.listObjects(`${prefix}/`);
    const manifests = [];
    for (const obj of listed) {
      if (!String(obj.key).endsWith("manifest.json")) continue;
      const raw = await offsite.store.getObject(obj.key);
      if (!raw) continue;
      manifests.push(JSON.parse(raw.toString("utf8")));
    }
    return manifests;
  }

  async function loadIndependentArchive(backupId) {
    if (!offsite.store) {
      const error = new Error("Independent backup storage is not configured.");
      error.status = 400;
      throw error;
    }
    const key = `${objectPrefix(env)}/${backupId}/archive.dsb`;
    return offsite.store.getObject(key);
  }

  async function validateBackup({ backupId, actor }) {
    const row = await getBackupRow(backupId, { includePayload: true });
    if (!row) {
      const error = new Error("Backup not found.");
      error.status = 404;
      throw error;
    }
    const buffer = await loadArchiveBuffer(row);
    if (rowIsDump(row)) {
      return validatePostgresDump({ row, buffer, actor });
    }
    const expectedChecksum = row.payload && row.payload.length ? row.checksum_sha256 : null;
    const parsed = parseAndValidatePayload(buffer, expectedChecksum);
    const fileCount = (parsed.files?.included || []).length;
    await recordOperation({
      backupId: row.id,
      operation: "validate",
      status: "success",
      actor,
      detail: `Checksum matched. ${Object.keys(parsed.tables).length} tables, ${fileCount} packed files.`,
    });
    return {
      valid: true,
      backup: publicBackup(row),
      tableCount: Object.keys(parsed.tables).length,
      fileCount,
      pgDumpStatus: parsed.pgDump?.status || row.pg_dump_status || null,
      excludedFields: parsed.excludedFields || row.excluded_fields || [],
      formatVersion: parsed.formatVersion,
      legacy: Number(parsed.formatVersion) === 1 || (row.storage_class || "legacy_database") === "legacy_database",
    };
  }

  async function applyParsedTables(client, parsed) {
    const currentTables = new Set(await listPublicTables());
    const restoreNames = (parsed.tableOrder || Object.keys(parsed.tables)).filter((name) => currentTables.has(name));
    if (restoreNames.length) {
      await client.query(`TRUNCATE ${restoreNames.map(quoteIdent).join(", ")} RESTART IDENTITY CASCADE`);
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
    const verified = {};
    for (const name of restoreNames) {
      const count = await client.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(name)}`);
      verified[name] = count.rows[0].count;
    }
    return { restoreNames, verified };
  }

  async function validatePostgresDump({ row, buffer, actor }) {
    const bytes = payloadBuffer(buffer);
    const digest = sha256(bytes);
    if (!row.checksum_sha256 || digest !== row.checksum_sha256) {
      const error = new Error("Backup checksum does not match the stored PostgreSQL dump.");
      error.status = 400;
      throw error;
    }
    await assertArchiveReadable(bytes, env);
    const saved = await db.query(
      `UPDATE admin_portal_backups
       SET recovery_stage = $2,
           pipeline_status = $2,
           verified_at = NULL,
           verification_detail = $3
       WHERE id = $1
       RETURNING *`,
      [
        row.id,
        STAGE_VALIDATED,
        "Archive validated. pg_restore could read the custom-format archive. This is not a restore.",
      ]
    );
    await recordOperation({
      backupId: row.id,
      operation: "validate",
      status: "success",
      actor,
      detail: "Archive validated. Readable custom-format dump. Not a restore.",
    });
    return {
      valid: true,
      recoveryStage: STAGE_VALIDATED,
      stageLabel: "Archive validated",
      formatLabel: ".dump",
      backup: publicBackup(saved.rows[0] || row),
      restored: false,
    };
  }

  async function testRestorePostgresDump({ backupId, actor }) {
    return withLock(RESTORE_LOCK, async () => {
      const row = await getBackupRow(backupId, { includePayload: true });
      if (!row || !rowIsDump(row) || row.status !== "success") {
        const error = new Error("Only a completed PostgreSQL .dump can be restore-tested.");
        error.status = 400;
        throw error;
      }
      if (row.recovery_stage !== STAGE_VALIDATED && row.recovery_stage !== STAGE_RESTORED) {
        const error = new Error("Validate the .dump before a restore test. A readable archive is not a successful restore.");
        error.status = 400;
        throw error;
      }
      const bytes = payloadBuffer(await loadArchiveBuffer(row));
      if (sha256(bytes) !== row.checksum_sha256) {
        const error = new Error("Backup checksum does not match the stored PostgreSQL dump.");
        error.status = 400;
        throw error;
      }
      const destination = `dentasync_restore_${crypto.randomBytes(4).toString("hex")}`;
      assertSeparateDatabase(env, destination);
      const expected = typeof row.dump_manifest === "string"
        ? JSON.parse(row.dump_manifest)
        : (row.dump_manifest || {});
      try {
        await restoreCustomDump(bytes, env, destination);
        const actual = await inspectDatabase(env, destination);
        compareManifest(expected, actual);
        const saved = await db.query(
          `UPDATE admin_portal_backups
           SET recovery_stage = $2,
               pipeline_status = $2,
               verified_at = CURRENT_TIMESTAMP,
               verification_detail = $3
           WHERE id = $1
           RETURNING *`,
          [
            row.id,
            STAGE_RESTORED,
            "Test restore passed. Schema, record counts, and foreign keys were checked in a separate empty database.",
          ]
        );
        await recordOperation({
          backupId: row.id,
          operation: "dump_test_restore",
          status: "success",
          actor,
          detail: `Test restore passed. tables=${Object.keys(expected.rowCounts || {}).length} foreignKeys=${(expected.foreignKeys || []).length}. Live database was not replaced.`,
        });
        return {
          isolated: true,
          productionTouched: false,
          recoveryStage: STAGE_RESTORED,
          stageLabel: "Test restore passed",
          backup: publicBackup(saved.rows[0] || row),
          tableCount: Object.keys(expected.rowCounts || {}).length,
          foreignKeyCount: (expected.foreignKeys || []).length,
          destinationDropped: true,
        };
      } catch (error) {
        await recordOperation({
          backupId: row.id,
          operation: "dump_test_restore",
          status: "failed",
          actor,
          detail: String(error.message || "Test restore failed.").slice(0, 500),
        });
        error.status = error.status || 500;
        throw error;
      } finally {
        await dropDatabase(env, destination);
      }
    });
  }

  async function productionRestorePostgresDump({ backupId, confirmation, actor }) {
    if (String(confirmation || "").trim() !== "RESTORE") {
      const error = new Error("Type RESTORE to confirm this destructive recovery.");
      error.status = 400;
      throw error;
    }
    if (!productionRestoreAllowed(env)) {
      const error = new Error(
        "Production restore is disabled. Validate the .dump, run a test restore, then set BACKUP_ALLOW_PRODUCTION_RESTORE=true only for a supervised recovery window."
      );
      error.status = 403;
      throw error;
    }
    return withLock(RESTORE_LOCK, async () => {
      const row = await getBackupRow(backupId, { includePayload: true });
      if (!row || !rowIsDump(row)) {
        const error = new Error("Backup not found.");
        error.status = 404;
        throw error;
      }
      if (row.status !== "success") {
        const error = new Error("Only a completed PostgreSQL .dump can be restored.");
        error.status = 400;
        throw error;
      }
      if (row.recovery_stage !== STAGE_VALIDATED && row.recovery_stage !== STAGE_RESTORED) {
        const error = new Error("Production restore stays disabled until this .dump is validated.");
        error.status = 400;
        throw error;
      }
      const bytes = payloadBuffer(await loadArchiveBuffer(row));
      if (sha256(bytes) !== row.checksum_sha256) {
        const error = new Error("Backup checksum does not match the stored PostgreSQL dump.");
        error.status = 400;
        throw error;
      }
      let safety = null;
      let safetyBytes = null;
      try {
        safety = await createPostgresDump({
          actor,
          backupType: "safety",
          notes: `Safety PostgreSQL dump before restore of ${row.id}`,
        });
        const safetyRow = await getBackupRow(safety.id, { includePayload: true });
        safetyBytes = payloadBuffer(safetyRow?.payload);
        if (!safetyBytes.length || sha256(safetyBytes) !== safety.checksumSha256) {
          throw new Error("Safety backup could not be read back.");
        }
      } catch (error) {
        await recordOperation({
          backupId: row.id,
          operation: "restore",
          status: "blocked",
          actor,
          detail: `Safety backup failed: ${String(error.message || "").slice(0, 300)}`,
        });
        const blocked = new Error("Restore stopped because the safety PostgreSQL backup failed.");
        blocked.status = 500;
        throw blocked;
      }
      if (!safety?.id || safety.status !== "success") {
        const blocked = new Error("Restore stopped because the safety PostgreSQL backup did not complete.");
        blocked.status = 500;
        throw blocked;
      }
      try {
        await restoreOntoLive(bytes, env);
        await db.query(
          `INSERT INTO admin_portal_backups (
             backup_type, status, file_name, byte_size, checksum_sha256, format_version,
             table_count, row_count, payload, created_by_name, finished_at, notes,
             pipeline_status, archive_format, recovery_stage, storage_class, encryption, pg_dump_status
           ) VALUES (
             'safety', 'success', $1, $2, $3, 0,
             $4, $5, $6, $7, CURRENT_TIMESTAMP, $8,
             $9, $10, $9, 'legacy_database', 'none', 'captured'
           )`,
          [
            safety.fileName,
            safetyBytes.length,
            safety.checksumSha256,
            safety.tableCount,
            safety.rowCount,
            safetyBytes,
            actor ? actorName(actor) : "System",
            "Safety PostgreSQL dump kept after the live restore replaced the catalog.",
            STAGE_CREATED,
            ARCHIVE_FORMAT,
          ]
        );
      } catch (error) {
        await recordOperation({
          backupId: row.id,
          operation: "restore",
          status: "failed",
          actor,
          detail: String(error.message || "Production restore failed.").slice(0, 300),
        });
        throw error;
      }
      await recordOperation({
        backupId: row.id,
        operation: "restore",
        status: "success",
        actor,
        detail: `PostgreSQL dump restored after safety backup ${safety.id}.`,
      });
      return {
        restored: true,
        backup: publicBackup(row),
        safetyBackup: safety,
      };
    });
  }

  async function isolatedRestore({ backupId, actor }) {
    const peek = await getBackupRow(backupId, { includePayload: false });
    if (peek && rowIsDump(peek)) {
      return testRestorePostgresDump({ backupId, actor });
    }
    return withLock(RESTORE_LOCK, async () => {
      const row = await getBackupRow(backupId, { includePayload: true });
      if (!row || row.status !== "success") {
        const error = new Error("Only a completed backup can be restore-tested.");
        error.status = 400;
        throw error;
      }
      const parsed = parseAndValidatePayload(await loadArchiveBuffer(row), row.checksum_sha256);
      const client = typeof db.connect === "function" ? await db.connect() : db;
      const shouldRelease = client !== db;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        const applied = await applyParsedTables(client, parsed);
        const sample = {
          users: applied.verified.users ?? null,
          clinic_patient_records: applied.verified.clinic_patient_records ?? null,
          prescriptions: applied.verified.prescriptions ?? null,
          patient_portal_appointments: applied.verified.patient_portal_appointments ?? null,
        };
        const files = restoreUploadFiles(parsed.files?.included || [], { cwd: process.cwd(), dryRun: true });
        await client.query("ROLLBACK");
        await recordOperation({
          backupId: row.id,
          operation: "isolated_restore",
          status: "success",
          actor,
          detail: `Isolated restore rolled back after verifying ${applied.restoreNames.length} tables and ${files.length} files.`,
        });
        return {
          isolated: true,
          productionTouched: false,
          backup: publicBackup(row),
          restoredTables: applied.restoreNames,
          verifiedRowCounts: applied.verified,
          sampleCounts: sample,
          filesChecked: files.length,
        };
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        await recordOperation({
          backupId: row.id,
          operation: "isolated_restore",
          status: "failed",
          actor,
          detail: error.message,
        });
        await alertAdmins("Isolated recovery test failed", "A non-destructive restore test did not complete.", row.id);
        error.status = error.status || 500;
        throw error;
      } finally {
        if (shouldRelease) client.release();
      }
    });
  }

  async function restoreBackup({ backupId, confirmation, actor, createSafety = true, mode = "isolated" }) {
    const peek = await getBackupRow(backupId, { includePayload: false });
    if (peek && rowIsDump(peek)) {
      if (mode !== "production") {
        return testRestorePostgresDump({ backupId, actor });
      }
      if (!createSafety) {
        const error = new Error("Production restore of a PostgreSQL dump stays disabled unless a safety backup is required first.");
        error.status = 403;
        throw error;
      }
      return productionRestorePostgresDump({ backupId, confirmation, actor });
    }
    if (mode !== "production") {
      return isolatedRestore({ backupId, actor });
    }
    if (String(confirmation || "").trim() !== "RESTORE") {
      const error = new Error("Type RESTORE to confirm this destructive recovery.");
      error.status = 400;
      throw error;
    }
    if (!productionRestoreAllowed(env)) {
      const error = new Error(
        "Production restore is disabled. Run an isolated restore test, then set BACKUP_ALLOW_PRODUCTION_RESTORE=true only for a supervised recovery window."
      );
      error.status = 403;
      throw error;
    }
    return withLock(RESTORE_LOCK, async () => {
      const row = await getBackupRow(backupId, { includePayload: true });
      if (!row) {
        const error = new Error("Backup not found.");
        error.status = 404;
        throw error;
      }
      if (row.status !== "success") {
        const error = new Error("Only a completed backup can be restored.");
        error.status = 400;
        throw error;
      }
      const parsed = parseAndValidatePayload(await loadArchiveBuffer(row), row.checksum_sha256);
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
          const blocked = new Error(`Restore stopped because the safety backup failed: ${error.message}`);
          blocked.status = 500;
          throw blocked;
        }
      }

      const client = typeof db.connect === "function" ? await db.connect() : db;
      const shouldRelease = client !== db;
      try {
        await client.query("BEGIN");
        await client.query("SET LOCAL session_replication_role = replica");
        const applied = await applyParsedTables(client, parsed);
        restoreUploadFiles(parsed.files?.included || [], { cwd: process.cwd(), dryRun: false });
        await client.query("COMMIT");
        await recordOperation({
          backupId: row.id,
          operation: "restore",
          status: "success",
          actor,
          detail: `Restored ${applied.restoreNames.length} tables. Safety backup: ${safety?.id || "skipped"}.`,
        });
        return {
          restored: true,
          backup: publicBackup(row),
          safetyBackup: safety,
          verifiedRowCounts: applied.verified,
          restoredTables: applied.restoreNames,
        };
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
    const wrapped = wrapArchive(packed, env);
    const uploadValues = [
      `dentasync-upload-${Date.now()}.dsb`,
      wrapped.buffer.length,
      sha256(wrapped.buffer),
      Number(parsed.formatVersion || FORMAT_VERSION),
      Object.keys(parsed.tables || {}).length,
      Object.values(parsed.rowCounts || {}).reduce((sum, value) => sum + Number(value || 0), 0),
      parsed.tableOrder || Object.keys(parsed.tables || {}),
      wrapped.buffer,
      actor?.id ? String(actor.id) : null,
      actor ? actorName(actor) : "Administrator",
      `Uploaded ${String(originalName || "backup.dsb").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80)}`,
      wrapped.encryption,
    ];
    let inserted;
    try {
      inserted = await db.query(
        `INSERT INTO admin_portal_backups (
           backup_type, status, file_name, byte_size, checksum_sha256, format_version,
           table_count, row_count, table_names, payload, created_by_id, created_by_name,
           finished_at, notes, pipeline_status, storage_class, encryption
         ) VALUES (
           'upload', 'success', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11, 'completed', 'legacy_database', $12
         ) RETURNING *`,
        uploadValues
      );
    } catch (error) {
      if (error?.code !== "42703") throw error;
      inserted = await db.query(
        `INSERT INTO admin_portal_backups (
           backup_type, status, file_name, byte_size, checksum_sha256, format_version,
           table_count, row_count, table_names, payload, created_by_id, created_by_name,
           finished_at, notes
         ) VALUES (
           'upload', 'success', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP, $11
         ) RETURNING *`,
        uploadValues.slice(0, 11)
      );
    }
    await recordOperation({
      backupId: inserted.rows[0].id,
      operation: "upload",
      status: "success",
      actor,
      detail: "Uploaded backup stored. Restore was not started.",
    });
    return publicBackup(inserted.rows[0]);
  }

  async function deleteBackup({ backupId, actor, confirmation }) {
    if (String(confirmation || "").trim() !== "DELETE") {
      const error = new Error("Type DELETE to confirm removing this backup record.");
      error.status = 400;
      throw error;
    }
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

  async function transferLegacyBackup({ backupId, actor }) {
    if (!offsite.store) {
      const error = new Error("Off-site storage is not configured.");
      error.status = 400;
      throw error;
    }
    const row = await getBackupRow(backupId, { includePayload: true });
    if (!row?.payload) {
      const error = new Error("This backup has no stored payload to transfer.");
      error.status = 400;
      throw error;
    }
    const packed = Buffer.isBuffer(row.payload) ? row.payload : Buffer.from(row.payload);
    const uploaded = await putOffsite(row.id, packed, {
      id: row.id,
      fileName: row.file_name,
      checksumSha256: sha256(packed),
      byteSize: packed.length,
      transferredFromLegacy: true,
    });
    const saved = await db.query(
      `UPDATE admin_portal_backups
       SET storage_class = 'both',
           offsite_object_key = $2,
           offsite_verified = $3,
           verified_at = CURRENT_TIMESTAMP,
           verification_detail = $4
       WHERE id = $1
       RETURNING *`,
      [
        row.id,
        uploaded.key,
        uploaded.offsiteVerified === true,
        uploaded.offsiteVerified
          ? "Legacy payload copied off-site and re-read."
          : "Legacy payload copied to independent disk.",
      ]
    );
    await recordOperation({
      backupId: row.id,
      operation: "transfer",
      status: "success",
      actor,
      detail: "Legacy database payload copied without deleting the original.",
    });
    return publicBackup(saved.rows[0]);
  }

  function dueSlots(settings, now = new Date()) {
    if (!settings.automatic && settings.schedule === "manual") return [];
    const manila = manilaParts(now);
    const due = [];
    if (settings.dailyEnabled || settings.schedule === "daily" || settings.schedule === "automatic") {
      if (manila.hour >= Number(settings.dailyHour || 2) && dateKeyFromIso(settings.lastDailyAt) !== manila.dateKey) {
        due.push("daily");
      }
    }
    if (settings.weeklyEnabled && manila.weekday === "Sun" && dateKeyFromIso(settings.lastWeeklyAt) !== manila.dateKey) {
      due.push("weekly");
    }
    if (settings.monthlyEnabled && manila.day === "01" && dateKeyFromIso(settings.lastMonthlyAt) !== manila.dateKey) {
      due.push("monthly");
    }
    if (!due.length && (settings.schedule === "daily" || settings.schedule === "weekly")) {
      const last = settings.lastScheduledAt ? new Date(settings.lastScheduledAt) : null;
      if (!last || Number.isNaN(last.getTime())) due.push(settings.schedule === "weekly" ? "weekly" : "daily");
      else {
        const elapsed = now.getTime() - last.getTime();
        if (settings.schedule === "daily" && elapsed >= 20 * 60 * 60 * 1000) due.push("daily");
        if (settings.schedule === "weekly" && elapsed >= 6 * 24 * 60 * 60 * 1000) due.push("weekly");
      }
    }
    return due;
  }

  function scheduleIsDue(settings, now = new Date()) {
    return dueSlots(settings, now).length > 0;
  }

  async function runDueScheduledBackup(now = new Date()) {
    const settings = await loadSettings();
    const due = dueSlots(settings, now);
    if (!due.length) {
      return { ran: false, settings, due };
    }
    const slot = due[0];
    try {
      const backup = await createBackup({
        type: slot,
        actor: null,
        notes: `Scheduled ${slot} backup`,
        scheduleSlot: slot,
      });
      const stamp = new Date().toISOString();
      await saveSettings({
        ...settings,
        lastScheduledAt: stamp,
        lastScheduledError: null,
        lastDailyAt: slot === "daily" ? stamp : settings.lastDailyAt,
        lastWeeklyAt: slot === "weekly" ? stamp : settings.lastWeeklyAt,
        lastMonthlyAt: slot === "monthly" ? stamp : settings.lastMonthlyAt,
      });
      return { ran: true, backup, slot };
    } catch (error) {
      await saveSettings({
        ...settings,
        lastScheduledAt: new Date().toISOString(),
        lastScheduledError: error.message,
      });
      return { ran: false, error: error.message, slot };
    }
  }

  return {
    BACKUP_MAGIC,
    FORMAT_VERSION,
    getOverview,
    loadSettings,
    saveSettings,
    createBackup,
    createPostgresDump,
    testRestorePostgresDump,
    getBackupRow,
    publicBackup,
    parseAndValidatePayload,
    validateBackup,
    isolatedRestore,
    restoreBackup,
    storeUploadedBackup,
    deleteBackup,
    transferLegacyBackup,
    loadArchiveBuffer,
    listIndependentBackups,
    loadIndependentArchive,
    scheduleIsDue,
    runDueScheduledBackup,
    applyRetention,
    applySecretPolicy,
  };
}

function createInternalBackupCronHandler({ runOnce, env = process.env }) {
  return async function internalBackupCron(req, res) {
    const expected = String(env.BACKUP_CRON_SECRET || "").trim();
    const provided = String(req.get?.("x-backup-cron-secret") || req.headers?.["x-backup-cron-secret"] || req.body?.secret || "").trim();
    if (!expected || provided !== expected) {
      return res.status(401).json({ message: "Unauthorized backup scheduler." });
    }
    try {
      const result = await runOnce();
      return res.json({
        message: result.ran ? "Scheduled backup ran." : "No backup was due.",
        ran: result.ran,
        slot: result.slot || null,
        error: result.error || null,
        backup: result.backup || null,
      });
    } catch (error) {
      return res.status(500).json({ message: "Scheduled backup failed." });
    }
  };
}

function createBackupScheduleJob({ db, intervalMs = 30 * 60 * 1000, env = process.env } = {}) {
  const service = createBackupRecoveryService({ db, env });
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
  SUPPORTED_FORMATS,
  MAX_BACKUP_BYTES,
  gzipJson,
  gunzipJson,
  sha256,
  normalizeSettings,
  SECRET_ENV_KEYS,
  collectEnvSecretValues,
  payloadContainsSecrets,
  applySecretPolicy,
  wrapArchive,
  unwrapArchive,
  createBackupRecoveryService,
  createBackupScheduleJob,
  createInternalBackupCronHandler,
  productionRestoreAllowed,
};
