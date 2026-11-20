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

const dbName = `ds_svc_dd_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;
process.env.JWT_SECRET = process.env.JWT_SECRET || "local-disposable-jwt-secret";

const migrations = path.join(__dirname, "..", "migrations");
function sqlFile(name) {
  return fs.readFileSync(path.join(migrations, name), "utf8");
}

test("Admin clinic service dropdown saves one service without changing others", { timeout: 90000 }, async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { createPatientPortalRouter } = require("../routes/patientPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const { invalidateClinicCatalogCache } = require("../services/approvedClinicCatalog");
  const { answerFromCatalog } = require("../services/clinicAssistant");
  const { SERVICES, DENTISTS } = require("../routes/patientPortal");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    invalidateClinicCatalogCache();
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

  const adminPassword = "AdminLogin1234";
  const adminHash = await bcrypt.hash(adminPassword, 4);
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
    [adminHash]
  );
  const adminId = String(admin.rows[0].id);
  const dentistId = String(dentist.rows[0].id);
  const patient = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Lila', 'Patient', 'lila.patient@example.test', '09170000005', $1, 'patient', TRUE, 'Active')
     RETURNING id`,
    [adminHash]
  );
  const patientId = String(patient.rows[0].id);

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken, notifyAdmin: async () => {} }));
  app.use("/api/patient", createPatientPortalRouter({ db, authenticateToken, jwtSecret }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  function tokenFor(id, role) {
    return jwt.sign({ id: String(id), role }, jwtSecret, { expiresIn: "1h" });
  }

  async function api(method, urlPath, { role, id, body } = {}) {
    const headers = { "content-type": "application/json" };
    if (id) headers.authorization = `Bearer ${tokenFor(id, role)}`;
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = await response.json().catch(() => ({}));
    return { status: response.status, json };
  }

  const listed = await api("GET", "/api/admin/clinic-services", { role: "admin", id: adminId });
  assert.equal(listed.status, 200, listed.json.message);
  const catalogIds = listed.json.services.map((service) => service.id);
  assert.ok(catalogIds.includes("cleaning"));
  assert.ok(catalogIds.includes("filling"));
  const visibleTitles = listed.json.services
    .filter((service) => service.adminVisible !== false)
    .map((service) => service.title);
  assert.ok(visibleTitles.includes("Consultation / Oral Examination"));
  assert.equal(new Set(listed.json.services.map((service) => service.id)).size, listed.json.services.length);
  const originalCleaning = listed.json.services.find((service) => service.id === "cleaning");
  const originalFilling = listed.json.services.find((service) => service.id === "filling");

  const saveA = await api("PUT", "/api/admin/clinic-services", {
    role: "admin",
    id: adminId,
    body: {
      services: [
        {
          id: "cleaning",
          priceLabel: "₱1,111 synthetic mild",
          chatbotEn: "Synthetic cleaning is ₱1,111 for mild cases.",
        },
      ],
    },
  });
  assert.equal(saveA.status, 200, saveA.json.message);
  const cleaningAfterA = saveA.json.services.find((service) => service.id === "cleaning");
  const fillingAfterA = saveA.json.services.find((service) => service.id === "filling");
  assert.equal(cleaningAfterA.priceLabel, "₱1,111 synthetic mild");
  assert.equal(cleaningAfterA.chatbotEn, "Synthetic cleaning is ₱1,111 for mild cases.");
  assert.equal(cleaningAfterA.details, originalCleaning.details);
  assert.deepEqual(cleaningAfterA.lines, originalCleaning.lines);
  assert.equal(fillingAfterA.priceLabel, originalFilling.priceLabel);
  assert.equal(fillingAfterA.chatbotEn, originalFilling.chatbotEn);

  const saveB = await api("PUT", "/api/admin/clinic-services", {
    role: "admin",
    id: adminId,
    body: {
      services: [
        {
          id: "filling",
          priceLabel: "₱2,222 synthetic filling",
          chatbotEn: "Synthetic filling is ₱2,222 per surface.",
        },
      ],
    },
  });
  assert.equal(saveB.status, 200, saveB.json.message);
  const fillingAfterB = saveB.json.services.find((service) => service.id === "filling");
  const cleaningAfterB = saveB.json.services.find((service) => service.id === "cleaning");
  assert.equal(fillingAfterB.priceLabel, "₱2,222 synthetic filling");
  assert.equal(cleaningAfterB.priceLabel, "₱1,111 synthetic mild");
  assert.equal(cleaningAfterB.chatbotEn, "Synthetic cleaning is ₱1,111 for mild cases.");
  assert.equal(cleaningAfterB.details, originalCleaning.details);

  const reloaded = await api("GET", "/api/admin/clinic-services", { role: "admin", id: adminId });
  const reloadedCleaning = reloaded.json.services.find((service) => service.id === "cleaning");
  const reloadedFilling = reloaded.json.services.find((service) => service.id === "filling");
  assert.equal(reloadedCleaning.priceLabel, "₱1,111 synthetic mild");
  assert.equal(reloadedFilling.priceLabel, "₱2,222 synthetic filling");
  assert.equal(reloadedCleaning.details, originalCleaning.details);

  const patientCatalog = await api("GET", "/api/patient/catalog", { role: "patient", id: patientId });
  assert.equal(patientCatalog.status, 200);
  const publicCleaning = patientCatalog.json.clinicServices.find((service) => service.id === "cleaning");
  assert.equal(publicCleaning.priceLabel, "₱1,111 synthetic mild");
  assert.equal(publicCleaning.details, originalCleaning.details);

  invalidateClinicCatalogCache();
  const { loadApprovedClinicCatalog } = require("../services/approvedClinicCatalog");
  const approved = await loadApprovedClinicCatalog(db);
  const chat = answerFromCatalog("How much is a dental cleaning?", {
    services: SERVICES,
    dentists: DENTISTS,
    approvedServices: approved.chatbotServices,
    approvedFactsEn: approved.factsEn,
  });
  assert.match(chat.answer, /₱1,111/);

  const denied = await api("PUT", "/api/admin/clinic-services", {
    role: "dentist",
    id: dentistId,
    body: { services: [{ id: "cleaning", priceLabel: "hacked", chatbotEn: "hacked" }] },
  });
  assert.equal(denied.status, 403);
  const afterDenied = await api("GET", "/api/admin/clinic-services", { role: "admin", id: adminId });
  assert.equal(
    afterDenied.json.services.find((service) => service.id === "cleaning").priceLabel,
    "₱1,111 synthetic mild"
  );
});
