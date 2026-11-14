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

const dbName = `ds_dentist_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});
process.env.DB_NAME = dbName;

test("dentist and staff account creation reports the invalid field", async (t) => {
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  const db = require("../db");
  db.on("error", () => {});
  const { resolveAppSecrets } = require("../lib/securityConfig");
  const { applyClinicBranchSchema } = require("../services/clinicBranches");
  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { createAuthRouter } = require("../routes/auth");
  const { authenticateToken } = require("../middleware/authMiddleware");

  let server;
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });

  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "005_create_admin_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "006_create_dentist_portal.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "008_create_admin_command_center.sql"), "utf8"));
  await db.query(fs.readFileSync(path.join(__dirname, "..", "migrations", "046_dentist_pad_credentials.sql"), "utf8"));
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
  `);
  await applyClinicBranchSchema(db);

  const admin = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ('Ada', 'Admin', 'ada.admin@example.test', '09170000001', 'synthetic-hash', 'admin', TRUE, 'Active')
     RETURNING id`
  );
  const branch = await db.query(`SELECT id FROM clinic_branches WHERE is_main LIMIT 1`);

  const app = express();
  app.use(express.json());
  const { jwtSecret } = resolveAppSecrets(process.env);
  app.use("/api/auth", createAuthRouter({
    db,
    otpService: {},
    passwordResetService: null,
    authenticateToken,
    jwtSecret,
  }));
  app.use("/api/admin", createAdminPortalRouter({
    db,
    authenticateToken,
    passwordResetService: null,
    notifyAdmin: async () => {},
  }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = jwt.sign({ id: String(admin.rows[0].id), role: "admin" }, jwtSecret, { expiresIn: "1h" });

  async function request(method, urlPath, body) {
    const response = await fetch(`${base}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(urlPath.startsWith("/api/admin") ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const incomplete = {
    firstName: "Synthetic",
    lastName: "Dentist",
    email: "synthetic.dentist@examplecollege",
    phone: "09170000021",
    password: "TempPass1234",
    branchIds: [branch.rows[0].id],
    specialization: "dentist",
    licenseNumber: "52541",
    licenseVerified: false,
  };
  const rejected = await request("POST", "/api/admin/dentists", incomplete);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.fields.email, "Enter a complete email address, including the full domain.");
  assert.equal(rejected.body.message, rejected.body.fields.email);
  const unsaved = await db.query(`SELECT id FROM users WHERE LOWER(email) = $1`, [incomplete.email.toLowerCase()]);
  assert.equal(unsaved.rows.length, 0);

  const valid = { ...incomplete, email: "synthetic.dentist@examplecollege.test" };
  const [first, second] = await Promise.all([
    request("POST", "/api/admin/dentists", valid),
    request("POST", "/api/admin/dentists", valid),
  ]);
  const created = [first, second].filter((item) => item.status === 201);
  const conflicts = [first, second].filter((item) => item.status === 409);
  assert.equal(created.length, 1, JSON.stringify([first, second]));
  assert.equal(conflicts.length, 1);
  const stored = await db.query(
    `SELECT users.id, users.email, users.role, profile.license_number, profile.license_verified, assignment.branch_id
     FROM users
     LEFT JOIN admin_portal_dentist_profiles AS profile ON profile.user_id = users.id::text
     LEFT JOIN clinic_branch_assignments AS assignment ON assignment.user_id = users.id
     WHERE LOWER(users.email) = $1`,
    [valid.email]
  );
  assert.equal(stored.rows.length, 1);
  assert.equal(stored.rows[0].role, "dentist");
  assert.equal(stored.rows[0].license_number, "52541");
  assert.equal(stored.rows[0].license_verified, false);
  assert.equal(Number(stored.rows[0].branch_id), Number(branch.rows[0].id));

  const listed = await request("GET", "/api/admin/dentists");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.dentists.some((row) => row.email === valid.email), true);

  const login = await request("POST", "/api/auth/login", {
    email: valid.email,
    password: valid.password,
  });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  assert.equal(String(login.body.user.role).toLowerCase(), "dentist");

  const staffRejected = await request("POST", "/api/admin/staff", {
    firstName: "Synthetic",
    lastName: "Staff",
    email: "synthetic.staff@examplecollege",
    phone: "09170000022",
    password: "TempPass1234",
    branchId: branch.rows[0].id,
  });
  assert.equal(staffRejected.status, 400);
  assert.equal(staffRejected.body.fields.email, "Enter a complete email address, including the full domain.");
  const staff = await request("POST", "/api/admin/staff", {
    firstName: "Synthetic",
    lastName: "Staff",
    email: "synthetic.staff@examplecollege.test",
    phone: "09170000022",
    password: "TempPass1234",
    branchId: branch.rows[0].id,
  });
  assert.equal(staff.status, 201, JSON.stringify(staff.body));
  const staffRows = await db.query(`SELECT id FROM users WHERE LOWER(email) = 'synthetic.staff@examplecollege.test'`);
  assert.equal(staffRows.rows.length, 1);
});
