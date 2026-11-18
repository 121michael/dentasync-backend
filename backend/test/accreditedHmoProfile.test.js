"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const dotenv = require("dotenv");
const express = require("express");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dbName = `ds_hmo_profile_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "127.0.0.1",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

function sqlFile(name) {
  return fs.readFileSync(path.join(__dirname, "..", "migrations", name), "utf8");
}

test("patient profile HMO dropdown uses accredited providers and preserves saved values", async (t) => {
  const identity = await adminPool.query(`SELECT current_database() AS name, inet_server_port() AS port`);
  assert.ok(identity.rows[0].name);
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const hmoCatalog = require("../services/accreditedHmoProviders");
  const inactiveProvider = {
    id: "retiredcare",
    name: "RetiredCare",
    aliases: ["retiredcare"],
    filipinoDoctors: false,
    active: false,
  };
  hmoCatalog.APPROVED_HMO_PROVIDERS.push(inactiveProvider);

  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    const index = hmoCatalog.APPROVED_HMO_PROVIDERS.indexOf(inactiveProvider);
    if (index >= 0) hmoCatalog.APPROVED_HMO_PROVIDERS.splice(index, 1);
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  const connected = await db.query(`SELECT current_database() AS name, inet_server_port() AS port`);
  assert.equal(connected.rows[0].name, dbName);

  await db.query(sqlFile("000_create_users.sql"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_id TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS patient_category TEXT;
  `);
  await db.query(sqlFile("002_create_patient_portal.sql"));
  await db.query(`
    ALTER TABLE patient_portal_profiles
      ADD COLUMN IF NOT EXISTS hmo_verification_status TEXT NOT NULL DEFAULT 'not_applicable'
  `);

  const patient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ava', 'Catalog', 'ava.hmo.profile@example.test', '09170005001', 'synthetic-hash', 'patient', TRUE, 'Active')
     RETURNING id`
  );
  const patientId = String(patient.rows[0].id);
  await db.query(
    `INSERT INTO patient_portal_profiles (user_id, hmo_provider, hmo_member_number, hmo_status, hmo_verification_status)
     VALUES ($1, 'RetiredCare', 'MEM-KEEP', 'enrolled', 'verified')`,
    [patientId]
  );

  const app = express();
  app.use(express.json());
  app.use("/api/patient", createPatientPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const { jwtSecret } = resolveAppSecrets(process.env);
  const token = jwt.sign({ id: patientId, role: "patient" }, jwtSecret, { expiresIn: "1h" });

  async function request(method, urlPath, body) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const parsed = await response.json();
    return { status: response.status, body: parsed };
  }

  const catalog = await request("GET", "/api/patient/catalog");
  assert.equal(catalog.status, 200);
  const names = catalog.body.hmoProviders.map((provider) => provider.name);
  assert.ok(names.includes("Maxicare"));
  assert.ok(names.includes("ValuCare"));
  assert.equal(names.includes("RetiredCare"), false);
  assert.equal(names.includes("MediCard"), false);
  assert.equal(catalog.body.hmoProviders.every((provider) => provider.active !== false), true);

  const profileBase = {
    firstName: "Ava",
    lastName: "Catalog",
    email: "ava.hmo.profile@example.test",
    phone: "09170005001",
    hmoMemberNumber: "MEM-KEEP",
  };

  const preservedInactive = await request("PUT", "/api/patient/profile", {
    ...profileBase,
    hmoProvider: "RetiredCare",
    hmoMemberNumber: "MEM-NEW",
  });
  assert.equal(preservedInactive.status, 200);
  assert.equal(preservedInactive.body.profile.hmo_provider, "RetiredCare");
  assert.equal(preservedInactive.body.profile.hmo_member_number, "MEM-NEW");
  assert.equal(preservedInactive.body.profile.hmo_verification_status, "verified");

  const rejectedUnlisted = await request("PUT", "/api/patient/profile", {
    ...profileBase,
    hmoProvider: "MediCard",
  });
  assert.equal(rejectedUnlisted.status, 400);

  const saved = await request("PUT", "/api/patient/profile", {
    ...profileBase,
    hmoProvider: "Maxicare",
    hmoMemberNumber: "MEM-MAX-1",
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.profile.hmo_provider, "Maxicare");
  assert.equal(saved.body.profile.hmo_member_number, "MEM-MAX-1");
  assert.equal(saved.body.profile.hmo_status, "enrolled");
  assert.equal(saved.body.profile.hmo_verification_status, "pending_verification");

  const reloaded = await request("GET", "/api/patient/profile");
  assert.equal(reloaded.status, 200);
  assert.equal(reloaded.body.profile.hmo_provider, "Maxicare");
  assert.equal(reloaded.body.profile.hmo_member_number, "MEM-MAX-1");
  assert.equal(reloaded.body.profile.hmo_verification_status, "pending_verification");

  const keepVerified = await request("PUT", "/api/patient/profile", {
    ...profileBase,
    hmoProvider: "Maxicare",
    hmoMemberNumber: "MEM-MAX-1",
  });
  assert.equal(keepVerified.status, 200);
  assert.equal(keepVerified.body.profile.hmo_verification_status, "pending_verification");

  await db.query(
    `UPDATE patient_portal_profiles SET hmo_verification_status = 'verified' WHERE user_id = $1`,
    [patientId]
  );
  const staffVerified = await request("PUT", "/api/patient/profile", {
    ...profileBase,
    hmoProvider: "Maxicare",
    hmoMemberNumber: "MEM-MAX-1",
  });
  assert.equal(staffVerified.status, 200);
  assert.equal(staffVerified.body.profile.hmo_verification_status, "verified");

  const cannotSwitchToInactive = await request("PUT", "/api/patient/profile", {
    ...profileBase,
    hmoProvider: "RetiredCare",
  });
  assert.equal(cannotSwitchToInactive.status, 400);
});
