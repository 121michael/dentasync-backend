"use strict";

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");
const { postgresSslConfig } = require("../lib/postgresSsl");

const ARCHIVE_FORMAT = "pg_dump_custom";
const STAGE_CREATED = "backup_created";
const STAGE_VALIDATED = "archive_validated";
const STAGE_RESTORED = "test_restore_passed";

function liveDatabaseName(env = process.env) {
  const fromEnv = String(env.DB_NAME || env.PGDATABASE || "").trim();
  if (fromEnv) return fromEnv;
  const url = String(env.DATABASE_URL || "").trim();
  if (!url) return "postgres";
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, "")) || "postgres";
  } catch {
    return "postgres";
  }
}

function maintenanceDatabase(env = process.env) {
  return liveDatabaseName(env).toLowerCase() === "postgres" ? "template1" : "postgres";
}

function assertSeparateDatabase(env, destination) {
  const live = liveDatabaseName(env);
  const target = String(destination || "").trim();
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(target)) {
    const error = new Error("Test restore refused because the destination database name is not allowed.");
    error.status = 400;
    throw error;
  }
  if (target.toLowerCase() === live.toLowerCase()) {
    const error = new Error("Test restore refused because the destination is the live application database.");
    error.status = 400;
    throw error;
  }
}

function safeToolError(text) {
  const cleaned = String(text || "PostgreSQL backup tool failed.")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[connection]")
    .replace(/(password|PGPASSWORD)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "PostgreSQL backup tool failed.").slice(0, 300);
}

function connectionParts(env = process.env, database) {
  const url = String(env.DATABASE_URL || "").trim();
  let host = env.DB_HOST || "127.0.0.1";
  let port = String(env.DB_PORT || 5432);
  let user = env.DB_USER || "postgres";
  let password = env.DB_PASSWORD || "";
  let dbName = database || liveDatabaseName(env);
  if (url) {
    try {
      const parsed = new URL(url);
      host = parsed.hostname || host;
      port = parsed.port || port;
      user = decodeURIComponent(parsed.username || user);
      password = decodeURIComponent(parsed.password || password);
      if (!database) {
        dbName = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || dbName;
      }
    } catch {
      /* discrete DB_* values stay in use */
    }
  }
  return { host, port, user, password, database: dbName };
}

function toolEnv(env = process.env, database) {
  const parts = connectionParts(env, database);
  return {
    ...process.env,
    ...env,
    PGPASSWORD: parts.password,
    PGSSLMODE: String(env.DATABASE_SSL || "").toLowerCase() === "disable" ? "disable" : process.env.PGSSLMODE,
  };
}

function connectionArgs(env = process.env, database) {
  const parts = connectionParts(env, database);
  return ["-h", parts.host, "-p", parts.port, "-U", parts.user, "-d", parts.database];
}

function runTool(command, args, env, database) {
  return new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env: toolEnv(env, database) },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: stdout || "",
          stderr: stderr || "",
          message: safeToolError(stderr || error?.message || ""),
        });
      }
    );
  });
}

async function toolAvailable(command, env = process.env) {
  const result = await runTool(command, ["--version"], env);
  return result.ok;
}

function quoteIdent(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error("Unsupported database name in backup catalog.");
  }
  return `"${name}"`;
}

async function withMaintenance(env, fn) {
  const parts = connectionParts(env, maintenanceDatabase(env));
  const client = new Client({
    host: parts.host,
    port: Number(parts.port),
    user: parts.user,
    password: parts.password,
    database: maintenanceDatabase(env),
    ssl: postgresSslConfig(env),
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function captureManifest(db) {
  const tables = await db.query(
    `SELECT c.relname AS name
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`
  );
  const foreignKeys = await db.query(
    `SELECT con.conname AS name, rel.relname AS table_name
     FROM pg_constraint con
     JOIN pg_class rel ON rel.oid = con.conrelid
     JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE con.contype = 'f' AND nsp.nspname = 'public'
     ORDER BY con.conname`
  );
  const rowCounts = {};
  for (const table of tables.rows) {
    if (table.name === "admin_portal_backups" || table.name === "admin_portal_backup_operations") continue;
    const count = await db.query(`SELECT COUNT(*)::int AS count FROM ${quoteIdent(table.name)}`);
    rowCounts[table.name] = count.rows[0].count;
  }
  return {
    tables: tables.rows.map((row) => row.name),
    foreignKeys: foreignKeys.rows,
    rowCounts,
  };
}

async function createCustomDump(env = process.env) {
  if (!(await toolAvailable("pg_dump", env)) || !(await toolAvailable("pg_restore", env))) {
    const error = new Error("PostgreSQL backup tools are missing. Install pg_dump and pg_restore on the API host.");
    error.status = 500;
    throw error;
  }
  const filePath = path.join(os.tmpdir(), `ds-pgdump-${crypto.randomBytes(8).toString("hex")}.dump`);
  const dumped = await runTool(
    "pg_dump",
    ["--format=custom", "--no-owner", "--no-acl", "--file", filePath, ...connectionArgs(env)],
    env
  );
  if (!dumped.ok) {
    fs.rmSync(filePath, { force: true });
    const error = new Error(`PostgreSQL backup failed. ${dumped.message}`);
    error.status = 500;
    throw error;
  }
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* the temp file is removed after the catalog stores the bytes */
  }
  const listed = await runTool("pg_restore", ["--list", filePath], env);
  if (!listed.ok || !/^\d+;/m.test(String(listed.stdout))) {
    fs.rmSync(filePath, { force: true });
    const error = new Error(
      `PostgreSQL backup was not marked complete because pg_restore could not read the archive. ${listed.message}`
    );
    error.status = 500;
    throw error;
  }
  const buffer = fs.readFileSync(filePath);
  fs.rmSync(filePath, { force: true });
  return { buffer, listText: String(listed.stdout) };
}

async function assertArchiveReadable(buffer, env = process.env) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) {
    const error = new Error("PostgreSQL backup file is empty or missing.");
    error.status = 400;
    throw error;
  }
  const filePath = path.join(os.tmpdir(), `ds-pgcheck-${crypto.randomBytes(8).toString("hex")}.dump`);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
  try {
    const listed = await runTool("pg_restore", ["--list", filePath], env);
    if (!listed.ok || !/^\d+;/m.test(String(listed.stdout))) {
      const error = new Error(`Archive validation failed. pg_restore could not read this .dump. ${listed.message}`);
      error.status = 400;
      throw error;
    }
    return { listText: String(listed.stdout) };
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

async function restoreCustomDump(buffer, env, destination) {
  assertSeparateDatabase(env, destination);
  const filePath = path.join(os.tmpdir(), `ds-pgrestore-${crypto.randomBytes(8).toString("hex")}.dump`);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
  try {
    await withMaintenance(env, async (admin) => {
      const existing = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [destination]);
      if (existing.rowCount) {
        const error = new Error("Test restore refused because the destination database already exists.");
        error.status = 400;
        throw error;
      }
      await admin.query(`CREATE DATABASE ${quoteIdent(destination)}`);
    });
    const restored = await runTool(
      "pg_restore",
      ["--exit-on-error", "--no-owner", "--no-acl", ...connectionArgs(env, destination), filePath],
      env,
      destination
    );
    if (!restored.ok) {
      const error = new Error(`Test restore failed before the records could be checked. ${restored.message}`);
      error.status = 500;
      throw error;
    }
  } catch (error) {
    await dropDatabase(env, destination);
    throw error;
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

async function inspectDatabase(env, database) {
  const parts = connectionParts(env, database);
  const client = new Client({
    host: parts.host,
    port: Number(parts.port),
    user: parts.user,
    password: parts.password,
    database,
    ssl: postgresSslConfig(env),
  });
  await client.connect();
  try {
    return await captureManifest(client);
  } finally {
    await client.end();
  }
}

function compareManifest(expected, actual) {
  const actualTables = new Set(actual.tables || []);
  for (const name of expected.tables || []) {
    if (name === "admin_portal_backups" || name === "admin_portal_backup_operations") continue;
    if (!actualTables.has(name)) {
      const error = new Error(`Test restore did not recover table ${name}.`);
      error.status = 500;
      throw error;
    }
    if (Number(actual.rowCounts?.[name]) !== Number(expected.rowCounts?.[name])) {
      const error = new Error(`Test restore did not recover the expected records for table ${name}.`);
      error.status = 500;
      throw error;
    }
  }
  const actualKeys = new Set((actual.foreignKeys || []).map((item) => item.name));
  for (const key of expected.foreignKeys || []) {
    if (!actualKeys.has(key.name)) {
      const error = new Error(`Test restore did not recover foreign key ${key.name}.`);
      error.status = 500;
      throw error;
    }
  }
}

async function dropDatabase(env, destination) {
  if (!destination || destination.toLowerCase() === liveDatabaseName(env).toLowerCase()) return;
  try {
    await withMaintenance(env, async (admin) => {
      await admin.query(
        `SELECT pg_terminate_backend(pid)
         FROM pg_stat_activity
         WHERE datname = $1 AND pid <> pg_backend_pid()`,
        [destination]
      );
      await admin.query(`DROP DATABASE IF EXISTS ${quoteIdent(destination)}`);
    });
  } catch {
    /* the test database is dropped when the server accepts the command */
  }
}

async function restoreOntoLive(buffer, env = process.env) {
  const filePath = path.join(os.tmpdir(), `ds-pglive-${crypto.randomBytes(8).toString("hex")}.dump`);
  fs.writeFileSync(filePath, buffer, { mode: 0o600 });
  try {
    const restored = await runTool(
      "pg_restore",
      [
        "--exit-on-error",
        "--single-transaction",
        "--clean",
        "--if-exists",
        "--no-owner",
        "--no-acl",
        ...connectionArgs(env),
        filePath,
      ],
      env
    );
    if (!restored.ok) {
      const error = new Error(`Production restore failed and was not reported as successful. ${restored.message}`);
      error.status = 500;
      throw error;
    }
  } finally {
    fs.rmSync(filePath, { force: true });
  }
}

function databaseConfigured(env = process.env) {
  return Boolean(String(env.DB_USER || env.DATABASE_URL || env.PGUSER || "").trim());
}

async function probeMaintenanceDatabase(env = process.env) {
  const parts = connectionParts(env, maintenanceDatabase(env));
  const client = new Client({
    host: parts.host,
    port: Number(parts.port),
    user: parts.user,
    password: parts.password,
    database: parts.database,
    connectionTimeoutMillis: 4000,
    ssl: postgresSslConfig(env),
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
    return { ok: true, message: "" };
  } catch (error) {
    return { ok: false, message: safeToolError(error.message) };
  } finally {
    await client.end().catch(() => {});
  }
}

async function describeBackupTools(env = process.env) {
  const dumpReady = await toolAvailable("pg_dump", env);
  const restoreReady = await toolAvailable("pg_restore", env);
  const toolsReady = dumpReady && restoreReady;
  const missingTools = {
    available: false,
    reason: "PostgreSQL backup tools are missing on the API host.",
    nextStep: "Install pg_dump and pg_restore, using the same major version as the database, then refresh this page.",
  };
  const postgresDump = toolsReady
    ? { available: true, reason: "", nextStep: "" }
    : missingTools;
  let testRestore = toolsReady
    ? {
        available: true,
        reason: "",
        nextStep: "",
      }
    : {
        available: false,
        reason: "A test restore needs pg_restore on the API host.",
        nextStep: "Install pg_restore, then open Restore on a completed backup. Creating a backup does not use the test database.",
      };
  if (toolsReady && databaseConfigured(env)) {
    const probe = await probeMaintenanceDatabase(env);
    if (!probe.ok) {
      testRestore = {
        available: false,
        reason: "The separate database used for a test restore cannot be opened.",
        nextStep: probe.message
          ? `${probe.message} Creating a backup is still allowed. Give the database user permission to create a temporary database, then try Restore again.`
          : "Creating a backup is still allowed. Give the database user permission to create a temporary database, then try Restore again.",
      };
    }
  }
  return {
    postgresDump,
    applicationSnapshot: {
      available: true,
      reason: "",
      nextStep: "",
    },
    testRestore,
  };
}

module.exports = {
  ARCHIVE_FORMAT,
  STAGE_CREATED,
  STAGE_VALIDATED,
  STAGE_RESTORED,
  liveDatabaseName,
  assertSeparateDatabase,
  safeToolError,
  describeBackupTools,
  captureManifest,
  createCustomDump,
  assertArchiveReadable,
  restoreCustomDump,
  inspectDatabase,
  compareManifest,
  dropDatabase,
  restoreOntoLive,
};
