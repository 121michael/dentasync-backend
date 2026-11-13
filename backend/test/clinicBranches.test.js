"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const dotenv = require("dotenv");
const { Pool } = require("pg");
const express = require("express");
const jwt = require("jsonwebtoken");

dotenv.config({ path: path.join(__dirname, "..", ".env") });

const dbName = `ds_branch_${process.pid}_${Date.now().toString(36)}`;
const adminPool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST || "localhost",
  database: "postgres",
  password: process.env.DB_PASSWORD,
  port: Number(process.env.DB_PORT || 5432),
});

process.env.DB_NAME = dbName;

const { resolveAppSecrets } = require("../lib/securityConfig");
const { applyClinicBranchSchema, rollbackClinicBranchSchema } = require("../services/clinicBranches");

let db;
let server;
let baseUrl;

function tokenFor(id, role) {
  const { jwtSecret } = resolveAppSecrets(process.env);
  return jwt.sign({ id, role }, jwtSecret, { expiresIn: "1h" });
}

async function request(method, urlPath, { token, body } = {}) {
  const response = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let payload = {};
  if (text) {
    payload = JSON.parse(text);
  }
  return { status: response.status, body: payload };
}

async function insertUser({ firstName, lastName, email, phone, role }) {
  const result = await db.query(
    `INSERT INTO users (first_name, last_name, email, phone, password_hash, role, is_verified, status)
     VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'Active')
     RETURNING id, role, password_hash`,
    [firstName, lastName, email, phone, "synthetic-hash", role]
  );
  return result.rows[0];
}

test("branch management phase 1", async (t) => {
  t.after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
    if (db) await db.end();
    await adminPool.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => {});
    await adminPool.end();
  });
  await adminPool.query(`CREATE DATABASE ${dbName}`);
  db = require("../db");
  const usersSql = fs.readFileSync(path.join(__dirname, "..", "migrations", "000_create_users.sql"), "utf8");
  await db.query(usersSql);
  await db.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ;
    CREATE TABLE IF NOT EXISTS admin_portal_staff_profiles (
      user_id TEXT PRIMARY KEY,
      operational_role TEXT,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS admin_portal_dentist_profiles (
      user_id TEXT PRIMARY KEY,
      specialization TEXT,
      schedule_notes TEXT,
      catalog_dentist_id TEXT,
      license_number TEXT,
      license_verified BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const admin = await insertUser({
    firstName: "Ada",
    lastName: "Admin",
    email: "ada.admin@example.test",
    phone: "09170001001",
    role: "admin",
  });
  const staff = await insertUser({
    firstName: "Sam",
    lastName: "Staff",
    email: "sam.staff@example.test",
    phone: "09170001002",
    role: "staff",
  });
  const dentist = await insertUser({
    firstName: "Dee",
    lastName: "Dentist",
    email: "dee.dentist@example.test",
    phone: "09170001003",
    role: "dentist",
  });
  const patient = await insertUser({
    firstName: "Pat",
    lastName: "Patient",
    email: "pat.patient@example.test",
    phone: "09170001004",
    role: "patient",
  });
  const before = {
    admin: { ...admin },
    staff: { ...staff },
    dentist: { ...dentist },
    patient: { ...patient },
  };

  await applyClinicBranchSchema(db);
  await applyClinicBranchSchema(db);

  const branches = await db.query("SELECT * FROM clinic_branches ORDER BY id");
  assert.equal(branches.rows.length, 1);
  const main = branches.rows[0];
  assert.equal(main.branch_code, "BR-0001");
  assert.equal(main.name, "Mandaluyong");
  assert.equal(main.is_main, true);
  assert.equal(main.status, "active");
  assert.match(main.address, /Mandaluyong/);
  assert.equal(main.contact_number, "09109207877");
  assert.equal(main.email, "amethystdental@gmail.com");

  const assignments = await db.query(
    `SELECT user_id, branch_id FROM clinic_branch_assignments ORDER BY user_id`
  );
  assert.deepEqual(
    assignments.rows.map((row) => Number(row.user_id)).sort((a, b) => a - b),
    [Number(staff.id), Number(dentist.id)].sort((a, b) => a - b)
  );
  assert.ok(assignments.rows.every((row) => Number(row.branch_id) === Number(main.id)));

  const accounts = await db.query("SELECT id, role, password_hash FROM users ORDER BY id");
  const byId = new Map(accounts.rows.map((row) => [String(row.id), row]));
  for (const account of Object.values(before)) {
    const current = byId.get(String(account.id));
    assert.equal(current.role, account.role);
    assert.equal(current.password_hash, account.password_hash);
  }

  const { createAdminPortalRouter } = require("../routes/adminPortal");
  const { authenticateToken } = require("../middleware/authMiddleware");
  const app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminPortalRouter({ db, authenticateToken }));
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const adminToken = tokenFor(admin.id, "admin");
  const staffToken = tokenFor(staff.id, "staff");

  const listed = await request("GET", "/api/admin/branches", { token: adminToken });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.branches.length, 1);
  assert.equal(listed.body.branches[0].branchId, "BR-0001");
  assert.deepEqual(listed.body.branches[0].missingDetails, []);

  const anonymous = await request("GET", "/api/admin/branches");
  assert.equal(anonymous.status, 401);
  const staffView = await request("GET", "/api/admin/branches", { token: staffToken });
  assert.equal(staffView.status, 403);

  const created = await request("POST", "/api/admin/branches", {
    token: adminToken,
    body: {
      name: "Pasig",
      address: "Synthetic Pasig address",
      contactNumber: "09180001001",
      email: "pasig@example.test",
    },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.branch.branchId, "BR-0002");
  assert.equal(created.body.branch.isMain, false);
  const pasigId = created.body.branch.id;

  const edited = await request("PATCH", `/api/admin/branches/${pasigId}`, {
    token: adminToken,
    body: { name: "Pasig Clinic", contactNumber: "09180001002" },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.branch.name, "Pasig Clinic");

  const deactivated = await request("POST", `/api/admin/branches/${pasigId}/status`, {
    token: adminToken,
    body: { status: "inactive" },
  });
  assert.equal(deactivated.status, 200);
  assert.equal(deactivated.body.branch.status, "inactive");

  const reactivated = await request("POST", `/api/admin/branches/${pasigId}/status`, {
    token: adminToken,
    body: { status: "active" },
  });
  assert.equal(reactivated.status, 200);
  assert.equal(reactivated.body.branch.status, "active");

  const mainOff = await request("POST", `/api/admin/branches/${main.id}/status`, {
    token: adminToken,
    body: { status: "inactive" },
  });
  assert.equal(mainOff.status, 409);
  const mainDelete = await request("DELETE", `/api/admin/branches/${main.id}`, { token: adminToken });
  assert.equal(mainDelete.status, 403);
  const clearMain = await request("PATCH", `/api/admin/branches/${main.id}`, {
    token: adminToken,
    body: { isMain: false, name: "Mandaluyong" },
  });
  assert.equal(clearMain.status, 409);
  const mainStill = await db.query("SELECT is_main, status, name FROM clinic_branches WHERE id = $1", [main.id]);
  assert.equal(mainStill.rows[0].is_main, true);
  assert.equal(mainStill.rows[0].status, "active");

  await assert.rejects(
    () => db.query("UPDATE clinic_branches SET status = 'inactive' WHERE id = $1", [main.id]),
    (error) => /cannot be deactivated/i.test(error.message)
  );
  await assert.rejects(
    () => db.query("UPDATE clinic_branches SET is_main = FALSE WHERE id = $1", [main.id]),
    (error) => /main designation/i.test(error.message)
  );
  await assert.rejects(
    () => db.query("DELETE FROM clinic_branches WHERE id = $1", [main.id]),
    (error) => /cannot be deleted/i.test(error.message)
  );

  const newStaff = await request("POST", "/api/admin/staff", {
    token: adminToken,
    body: {
      firstName: "Nora",
      lastName: "Nurse",
      email: "nora.nurse@example.test",
      phone: "09170001005",
      password: "synthetic-pass-10",
      position: "Clinic Staff",
      branchId: main.id,
    },
  });
  assert.equal(newStaff.status, 201);
  const noraId = newStaff.body.staff.id;

  const twoBranches = await request("PATCH", `/api/admin/staff/${noraId}`, {
    token: adminToken,
    body: { branchIds: [main.id, pasigId] },
  });
  assert.equal(twoBranches.status, 400);

  const noBranch = await request("PATCH", `/api/admin/staff/${noraId}`, {
    token: adminToken,
    body: { branchId: "" },
  });
  assert.equal(noBranch.status, 400);

  const badId = await request("PATCH", `/api/admin/staff/${noraId}`, {
    token: adminToken,
    body: { firstName: "Changed", branchId: 999999 },
  });
  assert.equal(badId.status, 400);
  const nora = await db.query("SELECT first_name FROM users WHERE id = $1", [noraId]);
  assert.equal(nora.rows[0].first_name, "Nora");
  const noraAssignment = await db.query(
    "SELECT branch_id FROM clinic_branch_assignments WHERE user_id = $1",
    [noraId]
  );
  assert.equal(noraAssignment.rows.length, 1);
  assert.equal(Number(noraAssignment.rows[0].branch_id), Number(main.id));

  const moved = await request("PATCH", `/api/admin/staff/${noraId}`, {
    token: adminToken,
    body: { branchId: pasigId },
  });
  assert.equal(moved.status, 200);
  await request("POST", `/api/admin/branches/${pasigId}/status`, {
    token: adminToken,
    body: { status: "inactive" },
  });
  const kept = await db.query(
    "SELECT branch_id FROM clinic_branch_assignments WHERE user_id = $1",
    [noraId]
  );
  assert.equal(Number(kept.rows[0].branch_id), Number(pasigId));
  const staffList = await request("GET", "/api/admin/staff", { token: adminToken });
  const noraRow = staffList.body.staff.find((row) => String(row.id) === String(noraId));
  assert.equal(noraRow.branches[0].inactive, true);
  assert.equal(noraRow.branches[0].status, "inactive");

  const blocked = await request("POST", "/api/admin/staff", {
    token: adminToken,
    body: {
      firstName: "Ivy",
      lastName: "Inactive",
      email: "ivy.inactive@example.test",
      phone: "09170001006",
      password: "synthetic-pass-10",
      branchId: pasigId,
    },
  });
  assert.equal(blocked.status, 400);
  const ivy = await db.query("SELECT id FROM users WHERE email = 'ivy.inactive@example.test'");
  assert.equal(ivy.rows.length, 0);

  const reassigned = await request("PATCH", `/api/admin/staff/${noraId}`, {
    token: adminToken,
    body: { branchId: main.id },
  });
  assert.equal(reassigned.status, 200);
  assert.equal(Number(reassigned.body.staff.branches[0].id), Number(main.id));

  const second = await request("POST", "/api/admin/branches", {
    token: adminToken,
    body: {
      name: "Quezon City",
      address: "Synthetic Quezon City address",
      contactNumber: "09180001003",
    },
  });
  assert.equal(second.status, 201);
  const dentistCreated = await request("POST", "/api/admin/dentists", {
    token: adminToken,
    body: {
      firstName: "Dan",
      lastName: "Dual",
      email: "dan.dual@example.test",
      phone: "09170001007",
      password: "synthetic-pass-10",
      branchIds: [main.id, second.body.branch.id],
    },
  });
  assert.equal(dentistCreated.status, 201);
  const dual = await db.query(
    "SELECT branch_id FROM clinic_branch_assignments WHERE user_id = $1 ORDER BY branch_id",
    [dentistCreated.body.dentist.id]
  );
  assert.equal(dual.rows.length, 2);

  const dentistNone = await request("PATCH", `/api/admin/dentists/${dentist.id}`, {
    token: adminToken,
    body: { branchIds: [] },
  });
  assert.equal(dentistNone.status, 400);

  await assert.rejects(
    () => db.query(
      "INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)",
      [admin.id, main.id]
    ),
    (error) => /staff and dentists/i.test(error.message)
  );
  await assert.rejects(
    () => db.query(
      "INSERT INTO clinic_branch_assignments (user_id, branch_id) VALUES ($1, $2)",
      [patient.id, main.id]
    ),
    (error) => /staff and dentists/i.test(error.message)
  );

  const people = await request("GET", `/api/admin/branches/${main.id}`, { token: adminToken });
  assert.equal(people.status, 200);
  const roles = people.body.branch.personnel.map((person) => person.role).sort();
  assert.ok(roles.includes("staff"));
  assert.ok(roles.includes("dentist"));

  const pasigPeople = await request("GET", `/api/admin/branches/${pasigId}`, { token: adminToken });
  assert.equal(pasigPeople.body.branch.personnel.length, 0);

  await rollbackClinicBranchSchema(db);
  const leftoverBranches = await db.query(
    "SELECT to_regclass('public.clinic_branches') AS branches, to_regclass('public.clinic_branch_assignments') AS assignments"
  );
  assert.equal(leftoverBranches.rows[0].branches, null);
  assert.equal(leftoverBranches.rows[0].assignments, null);
  const afterRollback = await db.query("SELECT id, role, password_hash FROM users WHERE id = $1", [staff.id]);
  assert.equal(afterRollback.rows[0].role, "staff");
  assert.equal(afterRollback.rows[0].password_hash, "synthetic-hash");
});
