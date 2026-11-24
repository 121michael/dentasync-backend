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

dotenv.config({ path: path.join(__dirname, "..", ".env") });

function assertLocalPostgresOnly() {
  if (String(process.env.DATABASE_URL || "").trim()) {
    throw new Error("DATABASE_URL must be unset for local disposable PostgreSQL tests.");
  }
  const host = String(process.env.DB_HOST || "localhost").trim();
  if (!["localhost", "127.0.0.1"].includes(host)) {
    throw new Error(`Refusing non-local DB_HOST ${host}`);
  }
}

assertLocalPostgresOnly();

const dbName = `ds_cred_schema_${process.pid}_${Date.now().toString(36)}`;
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

test("credential schema readiness is distinct from encryption and hash-only verify still works", { timeout: 90000 }, async (t) => {
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
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  await applyClinicBranchSchema(db);

  const adminPassword = "AdminLogin1234";
  const dentistLogin = "DentistLogin1234";
  const adminHash = await bcrypt.hash(adminPassword, 4);
  const dentistLoginHash = await bcrypt.hash(dentistLogin, 4);
  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.schema@example.test', '09170001001', $1, 'admin', TRUE, 'Active')
     RETURNING id`,
    [adminHash]
  );
  const dentist = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Dina', 'Schema', 'dina.schema@example.test', '09170001002', $1, 'dentist', TRUE, 'Active')
     RETURNING id`,
    [dentistLoginHash]
  );
  const staff = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Sana', 'Staff', 'sana.schema@example.test', '09170001003', $1, 'staff', TRUE, 'Active')
     RETURNING id`,
    [await bcrypt.hash("StaffLogin1234", 4)]
  );
  const adminId = String(admin.rows[0].id);
  const dentistId = String(dentist.rows[0].id);
  const staffId = String(staff.rows[0].id);
  await db.query(`INSERT INTO admin_portal_dentist_profiles (user_id, specialization) VALUES ($1, 'General')`, [
    dentistId,
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, passwordResetService: { requestReset: async () => ({}) } }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);

  async function api(method, urlPath, { id, role, body } = {}) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" })}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  const missingHash = await api("PUT", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
    body: { password: "ViewableAuth12", confirmPassword: "ViewableAuth12" },
  });
  assert.equal(missingHash.status, 503);
  assert.equal(missingHash.json.code, "CREDENTIAL_HASH_SCHEMA_MISSING");
  assert.match(String(missingHash.json.message), /migrate:record-access/);

  const statusMissingHash = await api("GET", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
  });
  assert.equal(statusMissingHash.status, 200);
  assert.equal(statusMissingHash.json.dentist.credentialSaveReady, false);
  assert.equal(statusMissingHash.json.dentist.credentialHashSchemaReady, false);
  assert.equal(statusMissingHash.json.dentist.encryptionAvailable, true);

  await db.query(sqlFile("060_record_access_authorization_credential.sql"));
  const missingSecret = await api("PUT", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
    body: { password: "ViewableAuth12", confirmPassword: "ViewableAuth12" },
  });
  assert.equal(missingSecret.status, 503, JSON.stringify(missingSecret.json));
  assert.equal(missingSecret.json.code, "CREDENTIAL_SECRET_SCHEMA_MISSING");
  assert.match(String(missingSecret.json.message), /061_authorization_credential_secret/);

  const hashOnly = await bcrypt.hash("LegacyHashOnly99", 4);
  await db.query(
    `UPDATE admin_portal_dentist_profiles
     SET can_approve_cross_branch_access = TRUE,
         authorization_password_hash = $2,
         authorization_credential_status = 'configured'
     WHERE user_id = $1`,
    [dentistId, hashOnly]
  );
  const hashOnlyRow = await db.query(
    `SELECT authorization_password_hash FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [dentistId]
  );
  assert.equal(await bcrypt.compare("LegacyHashOnly99", hashOnlyRow.rows[0].authorization_password_hash), true);
  await recordAccess.verifyApproverPassword(
    db,
    {
      id: dentistId,
      role: "dentist",
      can_approve_cross_branch_access: true,
      authorization_password_hash: hashOnly,
      authorization_credential_status: "configured",
    },
    "LegacyHashOnly99",
    { user: { id: dentistId }, ip: "127.0.0.1" }
  );
  await assert.rejects(
    () =>
      recordAccess.verifyApproverPassword(
        db,
        {
          id: dentistId,
          role: "dentist",
          can_approve_cross_branch_access: true,
          authorization_password_hash: hashOnly,
          authorization_credential_status: "configured",
        },
        "WrongPassword99",
        { user: { id: dentistId }, ip: "127.0.0.1" }
      ),
    /Unable to authorize this access/
  );

  await db.query(sqlFile("061_authorization_credential_secret.sql"));
  await db.query(sqlFile("061_authorization_credential_secret.sql"));
  const stillHash = await db.query(
    `SELECT authorization_password_hash, authorization_password_ciphertext FROM admin_portal_dentist_profiles WHERE user_id = $1`,
    [dentistId]
  );
  assert.equal(stillHash.rows[0].authorization_password_hash, hashOnly);
  assert.equal(stillHash.rows[0].authorization_password_ciphertext, null);

  const saved = await api("PUT", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
    body: { password: "ViewableAuth12", confirmPassword: "ViewableAuth12" },
  });
  assert.equal(saved.status, 200, JSON.stringify(saved.json));
  assert.equal(saved.json.dentist.credentialConfigured, true);
  assert.equal(saved.json.dentist.credentialViewable, true);
  assert.equal(saved.json.dentist.credentialSaveReady, true);

  const reopened = await api("GET", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
  });
  assert.equal(reopened.json.dentist.authorizationCredentialStatus, "configured");
  assert.equal(reopened.json.dentist.credentialViewable, true);

  const details = await api("PATCH", `/api/admin/dentists/${dentistId}`, {
    id: adminId,
    role: "admin",
    body: { specialization: "Orthodontics", licenseNumber: "PRC-SCHEMA-1", licenseVerified: true },
  });
  assert.equal(details.status, 200, JSON.stringify(details.json));
  assert.equal(details.json.dentist.specialization, "Orthodontics");
  assert.equal(details.json.dentist.credentialConfigured, true);

  const denied = await api("PUT", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: staffId,
    role: "staff",
    body: { password: "ViewableAuth12", confirmPassword: "ViewableAuth12" },
  });
  assert.ok(denied.status === 401 || denied.status === 403);

  const previousKey = process.env.DENTIST_CREDENTIAL_ENCRYPTION_KEY;
  const previousNode = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  delete process.env.DENTIST_CREDENTIAL_ENCRYPTION_KEY;
  const missingKey = await api("PUT", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
    body: { password: "AnotherAuth99", confirmPassword: "AnotherAuth99" },
  });
  assert.equal(missingKey.status, 503);
  assert.equal(missingKey.json.code, "ENCRYPTION_UNAVAILABLE");
  const keyStatus = await api("GET", `/api/admin/dentists/${dentistId}/authorization-credential`, {
    id: adminId,
    role: "admin",
  });
  assert.equal(keyStatus.json.dentist.encryptionAvailable, false);
  assert.equal(keyStatus.json.dentist.credentialSecretSchemaReady, true);
  assert.equal(keyStatus.json.dentist.credentialConfigured, true);
  process.env.DENTIST_CREDENTIAL_ENCRYPTION_KEY = previousKey;
  process.env.NODE_ENV = previousNode;
});
