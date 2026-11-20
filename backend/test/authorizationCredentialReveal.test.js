"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const { Pool } = require("pg");

const envPath = path.join(__dirname, "..", ".env");
dotenv.config({ path: envPath });

function assertLocalPostgresOnly() {
  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (databaseUrl) {
    throw new Error("DATABASE_URL must be unset for local disposable PostgreSQL tests.");
  }
  const host = String(process.env.DB_HOST || "localhost").trim();
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Refusing non-local DB_HOST ${host}`);
  }
  if (!String(process.env.DB_USER || "").trim()) {
    throw new Error("DB_USER is required for local disposable PostgreSQL.");
  }
}

assertLocalPostgresOnly();

const dbName = `ds_cred_rev_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-disposable-jwt-secret";
process.env.DENTIST_CREDENTIAL_ENCRYPTION_KEY = "synthetic-dentist-credential-key";
process.env.DENTIST_CREDENTIAL_ENCRYPTION_KEY_ID = "v1";

const migrations = path.join(__dirname, "..", "migrations");
function sqlFile(name) {
  return fs.readFileSync(path.join(migrations, name), "utf8");
}

function containsSecret(value, secret) {
  return JSON.stringify(value).includes(secret);
}

test("Admin credential reveal stays masked until verified and never leaks hashes", { timeout: 90000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const recordAccess = require("../services/recordAccess");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(sqlFile("000_create_users.sql"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ
  `);
  await db.query(sqlFile("005_create_admin_portal.sql"));
  await db.query(sqlFile("008_create_admin_command_center.sql"));
  await db.query(`
    ALTER TABLE admin_portal_dentist_profiles
      ADD COLUMN IF NOT EXISTS can_approve_cross_branch_access BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS license_number TEXT,
      ADD COLUMN IF NOT EXISTS license_verified BOOLEAN NOT NULL DEFAULT FALSE
  `);
  await db.query(sqlFile("060_record_access_authorization_credential.sql"));
  await db.query(sqlFile("061_authorization_credential_secret.sql"));
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  await applyClinicBranchSchema(db);

  const adminPassword = "AdminLogin1234";
  const dentistAuth = "CrossBranch99";
  const otherAuth = "OtherBranch88";
  const adminHash = await bcrypt.hash(adminPassword, 4);
  const dentistLoginHash = await bcrypt.hash("DentistLogin1234", 4);

  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.admin@example.test', '09170000001', $1, 'admin', TRUE, 'Active')
     RETURNING id`,
    [adminHash]
  );
  const dentist = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Dina', 'Dentist', 'dina.dentist@example.test', '09170000002', $1, 'dentist', TRUE, 'Active')
     RETURNING id`,
    [dentistLoginHash]
  );
  const other = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Omar', 'Other', 'omar.other@example.test', '09170000003', $1, 'dentist', TRUE, 'Active')
     RETURNING id`,
    [dentistLoginHash]
  );
  const staff = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Sana', 'Staff', 'sana.staff@example.test', '09170000004', $1, 'staff', TRUE, 'Active')
     RETURNING id`,
    [await bcrypt.hash("StaffLogin1234", 4)]
  );
  const adminId = String(admin.rows[0].id);
  const dentistId = String(dentist.rows[0].id);
  const otherId = String(other.rows[0].id);
  const staffId = String(staff.rows[0].id);

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, notifyAdmin: async () => {} }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  function tokenFor(id, role, expiresIn = "1h") {
    return jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn });
  }

  async function api(method, urlPath, { role, id, body, expiresIn } = {}) {
    const headers = { "content-type": "application/json" };
    if (id) headers.authorization = `Bearer ${tokenFor(id, role, expiresIn || "1h")}`;
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    let json = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { raw: text };
    }
    return { status: response.status, json, headers: response.headers, text };
  }

  const saved = await api("PUT", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    role: "admin",
    id: adminId,
    body: { password: dentistAuth, confirmPassword: dentistAuth },
  });
  assert.equal(saved.status, 200, saved.json.message);
  assert.equal(saved.json.dentist.credentialConfigured, true);
  assert.equal(saved.json.dentist.credentialViewable, true);
  assert.equal(containsSecret(saved.json, dentistAuth), false);
  assert.equal(containsSecret(saved.json, "authorization_password"), false);

  const stored = await db.query(
    `SELECT authorization_password_hash, authorization_password_ciphertext, authorization_secret_key_id
     FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [dentistId]
  );
  assert.ok(stored.rows[0].authorization_password_hash);
  assert.notEqual(stored.rows[0].authorization_password_hash, dentistAuth);
  assert.ok(stored.rows[0].authorization_password_ciphertext);
  assert.equal(stored.rows[0].authorization_password_ciphertext.includes(dentistAuth), false);
  assert.equal(stored.rows[0].authorization_secret_key_id, "v1");

  const listed = await api("GET", "/api/admin/dentists?limit=50", { role: "admin", id: adminId });
  assert.equal(listed.status, 200);
  const listedDentist = (listed.json.dentists || []).find((row) => String(row.id) === dentistId);
  assert.equal(listedDentist.credentialConfigured, true);
  assert.equal(listedDentist.credentialViewable, true);
  assert.equal(containsSecret(listed.json, dentistAuth), false);
  assert.equal(containsSecret(listed.json, stored.rows[0].authorization_password_hash), false);
  assert.equal(containsSecret(listed.json, stored.rows[0].authorization_password_ciphertext), false);

  const renamed = await api("PATCH", `/api/admin/dentists/${dentistId}`, {
    role: "admin",
    id: adminId,
    body: { firstName: "Dina", lastName: "Updated", specialization: "Orthodontics" },
  });
  assert.equal(renamed.status, 200, renamed.json.message || JSON.stringify(renamed.json));
  assert.equal(renamed.json.dentist.credentialConfigured, true);
  const afterRename = await db.query(
    `SELECT authorization_password_hash, authorization_password_ciphertext FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [dentistId]
  );
  assert.equal(afterRename.rows[0].authorization_password_hash, stored.rows[0].authorization_password_hash);
  assert.equal(afterRename.rows[0].authorization_password_ciphertext, stored.rows[0].authorization_password_ciphertext);

  const otherSaved = await api("PUT", `/api/admin/dentists/${otherId}/authorization-credential`, {
    role: "admin",
    id: adminId,
    body: { password: otherAuth, confirmPassword: otherAuth },
  });
  assert.equal(otherSaved.status, 200, otherSaved.json.message);

  const wrong = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/verify-view`, {
    role: "admin",
    id: adminId,
    body: { adminPassword: "WrongAdmin9999" },
  });
  assert.equal(wrong.status, 401);
  assert.equal(containsSecret(wrong.json, dentistAuth), false);
  assert.equal(Boolean(wrong.json.password || wrong.json.verificationToken), false);

  const staffBlocked = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/verify-view`, {
    role: "staff",
    id: staffId,
    body: { adminPassword: adminPassword },
  });
  assert.equal(staffBlocked.status, 403);

  const dentistBlocked = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/reveal`, {
    role: "dentist",
    id: dentistId,
    body: { verificationToken: "not-a-ticket" },
  });
  assert.equal(dentistBlocked.status, 403);

  const expiredToken = tokenFor(adminId, "admin", "1ms");
  await new Promise((resolve) => setTimeout(resolve, 25));
  const expiredResponse = await fetch(`${base}/api/admin/dentists/${dentistId}/authorization-credential/verify-view`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${expiredToken}` },
    body: JSON.stringify({ adminPassword }),
  });
  assert.equal(expiredResponse.status, 403);

  recordAccess.resetAuthFailures();
  const verified = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/verify-view`, {
    role: "admin",
    id: adminId,
    body: { adminPassword },
  });
  assert.equal(verified.status, 200, verified.json.message);
  assert.equal(verified.json.credentialViewable, true);
  assert.ok(verified.json.verificationToken);
  assert.equal(containsSecret(verified.json, dentistAuth), false);
  assert.match(String(verified.headers.get("cache-control") || ""), /no-store/);

  const stolen = await api("POST", `/api/admin/dentists/${otherId}/authorization-credential/reveal`, {
    role: "admin",
    id: adminId,
    body: { verificationToken: verified.json.verificationToken },
  });
  assert.equal(stolen.status, 403);
  assert.equal(containsSecret(stolen.json, dentistAuth), false);
  assert.equal(containsSecret(stolen.json, otherAuth), false);

  const verifiedAgain = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/verify-view`, {
    role: "admin",
    id: adminId,
    body: { adminPassword },
  });
  const revealed = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/reveal`, {
    role: "admin",
    id: adminId,
    body: { verificationToken: verifiedAgain.json.verificationToken },
  });
  assert.equal(revealed.status, 200, revealed.json.message);
  assert.equal(revealed.json.password, dentistAuth);
  assert.match(String(revealed.headers.get("cache-control") || ""), /no-store/);
  const reuse = await api("POST", `/api/admin/dentists/${dentistId}/authorization-credential/reveal`, {
    role: "admin",
    id: adminId,
    body: { verificationToken: verifiedAgain.json.verificationToken },
  });
  assert.equal(reuse.status, 403);

  await db.query(
    `UPDATE admin_portal_dentist_profiles
        SET authorization_password_ciphertext = NULL, authorization_secret_key_id = NULL
      WHERE user_id = $1`,
    [otherId]
  );
  const legacyVerify = await api("POST", `/api/admin/dentists/${otherId}/authorization-credential/verify-view`, {
    role: "admin",
    id: adminId,
    body: { adminPassword },
  });
  assert.equal(legacyVerify.status, 200, legacyVerify.json.message);
  assert.equal(legacyVerify.json.credentialViewable, false);
  assert.match(legacyVerify.json.message, /Reset this credential to enable viewing/);
  assert.equal(containsSecret(legacyVerify.json, otherAuth), false);
  const legacyReveal = await api("POST", `/api/admin/dentists/${otherId}/authorization-credential/reveal`, {
    role: "admin",
    id: adminId,
    body: { verificationToken: legacyVerify.json.verificationToken },
  });
  assert.equal(legacyReveal.json.credentialViewable, false);
  assert.equal(legacyReveal.json.password, undefined);

  const reset = await api("PUT", `/api/admin/dentists/${otherId}/authorization-credential`, {
    role: "admin",
    id: adminId,
    body: { password: "ResetBranch77", confirmPassword: "ResetBranch77" },
  });
  assert.equal(reset.status, 200);
  assert.equal(reset.json.dentist.credentialViewable, true);
  const resetVerify = await api("POST", `/api/admin/dentists/${otherId}/authorization-credential/verify-view`, {
    role: "admin",
    id: adminId,
    body: { adminPassword },
  });
  const resetReveal = await api("POST", `/api/admin/dentists/${otherId}/authorization-credential/reveal`, {
    role: "admin",
    id: adminId,
    body: { verificationToken: resetVerify.json.verificationToken },
  });
  assert.equal(resetReveal.json.password, "ResetBranch77");

  const revoked = await api("DELETE", `/api/admin/dentists/${otherId}/authorization-credential`, {
    role: "admin",
    id: adminId,
  });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.json.dentist.credentialConfigured, false);
  assert.equal(revoked.json.dentist.authorizationCredentialStatus, "revoked");
  const afterRevoke = await db.query(
    `SELECT authorization_password_hash, authorization_password_ciphertext FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [otherId]
  );
  assert.equal(afterRevoke.rows[0].authorization_password_hash, null);
  assert.equal(afterRevoke.rows[0].authorization_password_ciphertext, null);

  const audits = await db.query(
    `SELECT action, detail FROM admin_portal_audit_logs WHERE target_id = ANY($1::text[])`,
    [[dentistId, otherId]]
  );
  const joined = JSON.stringify(audits.rows);
  assert.equal(joined.includes(dentistAuth), false);
  assert.equal(joined.includes(adminPassword), false);
  assert.equal(joined.includes(stored.rows[0].authorization_password_hash), false);
  assert.ok(audits.rows.some((row) => row.action === "record_access_credential_revealed"));
  assert.ok(audits.rows.some((row) => row.action === "record_access_credential_reveal_failed"));
  assert.ok(audits.rows.some((row) => row.action === "record_access_credential_revoked"));
});
