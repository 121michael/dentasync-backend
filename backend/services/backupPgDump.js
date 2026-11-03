"use strict";

const { execFile } = require("child_process");
const zlib = require("zlib");

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: options.timeout || 60_000, maxBuffer: 40 * 1024 * 1024, env: options.env }, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

async function tryPgDump(env = process.env) {
  if (String(env.BACKUP_SKIP_PG_DUMP || "").toLowerCase() === "true") {
    return { status: "skipped", reason: "BACKUP_SKIP_PG_DUMP=true" };
  }
  const version = await run("pg_dump", ["--version"]);
  if (version.error) {
    return { status: "unavailable", reason: "pg_dump is not installed on this host." };
  }
  const databaseUrl = String(env.DATABASE_URL || "").trim();
  const args = ["--no-owner", "--no-acl", "--format=plain"];
  const childEnv = { ...process.env, ...env, PGPASSWORD: env.DB_PASSWORD || process.env.PGPASSWORD || "" };
  if (databaseUrl) {
    args.push(databaseUrl);
  } else {
    args.push(
      "-h", env.DB_HOST || "127.0.0.1",
      "-p", String(env.DB_PORT || 5432),
      "-U", env.DB_USER || "postgres",
      "-d", env.DB_NAME || "postgres"
    );
  }
  const dump = await run("pg_dump", args, { env: childEnv });
  if (dump.error) {
    return {
      status: "failed",
      reason: String(dump.stderr || dump.error.message || "pg_dump failed").slice(0, 500),
      postgresVersion: String(version.stdout || "").trim(),
    };
  }
  const sql = Buffer.from(dump.stdout || "", "utf8");
  const gzipped = zlib.gzipSync(sql);
  return {
    status: "captured",
    postgresVersion: String(version.stdout || "").trim(),
    sqlBytes: sql.length,
    gzipBytes: gzipped.length,
    sqlGzipBase64: gzipped.toString("base64"),
  };
}

module.exports = {
  tryPgDump,
};
