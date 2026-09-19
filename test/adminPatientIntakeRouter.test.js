"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");

function adminRow() {
  return {
    id: "admin-1",
    first_name: "Ada",
    last_name: "Admin",
    email: "ada@example.test",
    phone: "639171234567",
    role: "admin",
    status: "Active",
    is_verified: true,
    password_hash: "hash",
    created_at: "2026-01-01T00:00:00.000Z",
  };
}

async function startPortal({ databaseRole }) {
  const app = express();
  app.use(express.json());
  const audits = [];
  const sessions = new Map();
  let nextId = 1;
  const db = {
    audits,
    sessions,
    async query(sql, params = []) {
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
        return { rows: databaseRole === "admin" ? [adminRow()] : [] };
      }
      if (sql.includes("INSERT INTO admin_portal_audit_logs")) {
        audits.push({ action: params[3], result: params[7], detail: params[8] });
        return { rows: [{ id: audits.length }] };
      }
      if (sql.includes("INSERT INTO admin_patient_intake_sessions")) {
        const row = {
          id: nextId++,
          created_by: params[0],
          status: "draft",
          fields: JSON.parse(params[1]),
          manual_fields: {},
          conflicts: [],
          category_confirmed: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        sessions.set(row.id, row);
        return { rows: [row] };
      }
      if (sql.includes("FROM admin_patient_intake_sessions WHERE id = $1")) {
        const row = sessions.get(Number(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (sql.includes("UPDATE admin_patient_intake_sessions") && sql.includes("manual_fields = $1")) {
        const row = sessions.get(Number(params[2]));
        row.manual_fields = JSON.parse(params[0]);
        row.category_confirmed = params[1];
        return { rows: [row] };
      }
      if (sql.includes("UPDATE admin_patient_intake_sessions") && sql.includes("fields = $1")) {
        const row = sessions.get(Number(params[2]));
        row.fields = JSON.parse(params[0]);
        row.conflicts = JSON.parse(params[1]);
        return { rows: [row] };
      }
      if (sql.includes("FROM patient_documents WHERE session_id = $1")) {
        return { rows: [] };
      }
      if (sql.includes("COUNT(*) AS count")) {
        return { rows: [{ count: "0" }] };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };

  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db,
      emailDeliveryIsConfigured: () => false,
      authenticateToken(req, _res, next) {
        req.user = { id: "admin-1", role: "admin" };
        next();
      },
    })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    db,
    url: `http://127.0.0.1:${server.address().port}/api/admin`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("patient document intake is blocked for non-admin database accounts", async () => {
  const portal = await startPortal({ databaseRole: "staff" });
  try {
    for (const [method, path] of [
      ["POST", "/patient-intake/sessions"],
      ["GET", "/patient-intake/sessions"],
      ["POST", "/patient-intake/sessions/1/confirm"],
      ["GET", "/patient-intake/sessions/1/documents/1/file"],
    ]) {
      const response = await fetch(`${portal.url}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      });
      assert.equal(response.status, 403, `${method} ${path}`);
    }
  } finally {
    await portal.close();
  }
});

test("admin can start an intake, enter information manually, and see validation state", async () => {
  const portal = await startPortal({ databaseRole: "admin" });
  try {
    const created = await fetch(`${portal.url}/patient-intake/sessions`, { method: "POST" });
    assert.equal(created.status, 201);
    const { session } = await created.json();
    assert.equal(session.status, "draft");
    assert.equal(session.validation.valid, false);
    assert.ok(session.validation.missing.includes("firstName"));

    const edited = await fetch(`${portal.url}/patient-intake/sessions/${session.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          firstName: "juan",
          lastName: "DELA CRUZ",
          dateOfBirth: "January 10, 2005",
          sex: "MALE",
          phone: "0912 345 6789",
          patientCategory: "regular",
        },
      }),
    });
    assert.equal(edited.status, 200);
    const updated = (await edited.json()).session;
    assert.equal(updated.values.firstName, "Juan");
    assert.equal(updated.values.lastName, "Dela Cruz");
    assert.equal(updated.values.dateOfBirth, "2005-01-10");
    assert.equal(updated.values.sex, "Male");
    assert.equal(updated.values.phone, "639123456789");
    assert.equal(updated.fields.firstName.status, "manual");
    assert.equal(updated.categoryConfirmed, true);
    assert.equal(updated.validation.valid, true, JSON.stringify(updated.validation));
    assert.ok(portal.db.audits.some((entry) => entry.action === "Patient Intake Corrected"));

    const unreadable = await fetch(`${portal.url}/patient-intake/sessions/${session.id}/documents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(unreadable.status, 400);
    assert.equal((await unreadable.json()).code, "INVALID_DOCUMENT");
  } finally {
    await portal.close();
  }
});
