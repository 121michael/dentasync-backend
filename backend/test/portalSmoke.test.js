"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const enabled = process.env.RUN_PORTAL_SMOKE === "1";
const base = process.env.PORTAL_SMOKE_URL || "http://127.0.0.1:5000";

async function login(identifier, password) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  const body = await response.json();
  return { status: response.status, body };
}

test("staff, dentist, admin, and patient logins still work", { skip: !enabled }, async () => {
  let reachable = false;
  try {
    await fetch(base, { signal: AbortSignal.timeout(2000) });
    reachable = true;
  } catch (error) {
    assert.fail(`Portal smoke is enabled but ${base} is not reachable: ${error.message}`);
  }
  assert.equal(reachable, true);

  const staff = await login("staff@amethyst.com", "StaffPass123!");
  assert.equal(staff.status, 200, staff.body.message);
  assert.equal(staff.body.user.role, "staff");

  const dentist = await login("dentist@amethyst.com", "DentistPass123!");
  assert.equal(dentist.status, 200, dentist.body.message);
  assert.equal(dentist.body.user.role, "dentist");

  const admin = await login("admin@amethyst.com", "admin123");
  assert.equal(admin.status, 200, admin.body.message);
  assert.equal(admin.body.user.role, "admin");

  const patient = await login("patient@amethyst.com", "PatientPass123!");
  assert.equal(patient.status, 200, patient.body.message);
  assert.equal(patient.body.user.role, "patient");

  const staffDash = await fetch(`${base}/api/staff/dashboard`, {
    headers: { Authorization: `Bearer ${staff.body.token}` },
  });
  assert.equal(staffDash.status, 200);
  const dentistDash = await fetch(`${base}/api/dentist/dashboard`, {
    headers: { Authorization: `Bearer ${dentist.body.token}` },
  });
  assert.equal(dentistDash.status, 200);
  const adminBackups = await fetch(`${base}/api/admin/backups`, {
    headers: { Authorization: `Bearer ${admin.body.token}` },
  });
  assert.equal(adminBackups.status, 200);
});
