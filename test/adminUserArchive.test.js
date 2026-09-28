"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");

function cloneUser(user) {
  return { ...user };
}

async function startPortal(seedUsers, { missingPatientColumns = false } = {}) {
  const users = new Map(seedUsers.map((user) => [String(user.id), cloneUser(user)]));

  async function query(sql, params = []) {
    if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'") && sql.includes("is_verified = TRUE")) {
      return {
        rows: [
          {
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
            is_archived: false,
          },
        ],
      };
    }

    if (/^\s*BEGIN\s*$/i.test(sql.trim()) || /^\s*COMMIT\s*$/i.test(sql.trim()) || /^\s*ROLLBACK\s*$/i.test(sql.trim())) {
      return { rows: [] };
    }

    if (sql.includes("INTO admin_portal_audit_logs")) {
      return { rows: [{ id: 1, created_at: "2026-09-28T00:00:00.000Z" }] };
    }

    if (sql.includes("FOR UPDATE")) {
      const target = users.get(String(params[0]));
      return { rows: target ? [cloneUser(target)] : [] };
    }

    if (
      sql.includes("FROM users") &&
      sql.includes("id::text = $1") &&
      sql.includes("is_archived") &&
      !sql.includes("AS account")
    ) {
      const target = users.get(String(params[0]));
      return { rows: target ? [cloneUser(target)] : [] };
    }

    if (sql.includes("SET is_archived = TRUE")) {
      const target = users.get(String(params[0]));
      if (!target) return { rows: [] };
      Object.assign(target, {
        is_archived: true,
        archived_at: "2026-09-28T00:00:00.000Z",
        archived_by: String(params[1]),
      });
      return { rows: [cloneUser(target)] };
    }

    if (sql.includes("SET is_archived = FALSE")) {
      const target = users.get(String(params[0]));
      if (!target) return { rows: [] };
      Object.assign(target, {
        is_archived: false,
        archived_at: null,
        archived_by: null,
      });
      return { rows: [cloneUser(target)] };
    }

    if (sql.includes("FROM users AS account") && sql.includes("COALESCE(account.is_archived, FALSE) = TRUE")) {
      if (missingPatientColumns && sql.includes("account.patient_id")) {
        const error = new Error('column "patient_id" does not exist');
        error.code = "42703";
        throw error;
      }
      const roleMatch = sql.match(/LOWER\(account\.role\) = '([^']+)'/);
      const archived = [...users.values()].filter((user) => {
        if (!user.is_archived) return false;
        if (roleMatch && String(user.role).toLowerCase() !== roleMatch[1]) return false;
        return true;
      });
      if (sql.includes("COUNT(*) AS count")) {
        return { rows: [{ count: String(archived.length) }] };
      }
      return {
        rows: archived.map((user) => ({
          ...user,
          full_name: `${user.first_name} ${user.last_name}`.trim(),
          archived_by_name: "Ada Admin",
        })),
      };
    }

    if (sql.includes("FROM users AS account") && sql.includes("LOWER(account.role) = 'patient'")) {
      if (missingPatientColumns && sql.includes("account.patient_id")) {
        const error = new Error('column "patient_id" does not exist');
        error.code = "42703";
        throw error;
      }
      const patients = [...users.values()].filter((user) => user.role === "patient" && !user.is_archived);
      if (sql.includes("COUNT(*) AS count")) {
        return { rows: [{ count: String(patients.length) }] };
      }
      return {
        rows: patients.map((user) => ({
          ...user,
          full_name: `${user.first_name} ${user.last_name}`.trim(),
        })),
      };
    }

    if (sql.includes("COUNT(*) AS count")) {
      return { rows: [{ count: "0" }] };
    }

    throw new Error(`Unexpected test query: ${sql} :: ${JSON.stringify(params)}`);
  }

  const db = {
    query,
    async connect() {
      return {
        query,
        release() {},
      };
    },
  };

  const app = express();
  app.use(express.json());
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
    users,
    url: `http://127.0.0.1:${server.address().port}/api/admin`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

const seed = [
  {
    id: "staff-1",
    first_name: "Juan",
    last_name: "Dela Cruz",
    email: "juan@email.com",
    phone: "09123456789",
    role: "staff",
    status: "Active",
    is_verified: true,
    is_archived: false,
    created_at: "2026-01-02T00:00:00.000Z",
    patient_id: null,
    patient_category: null,
  },
  {
    id: "dentist-1",
    first_name: "Maria",
    last_name: "Santos",
    email: "dentist@email.com",
    phone: "09181234567",
    role: "dentist",
    status: "Active",
    is_verified: true,
    is_archived: false,
    created_at: "2026-01-03T00:00:00.000Z",
    patient_id: null,
    patient_category: null,
  },
  {
    id: "patient-1",
    first_name: "Juan",
    last_name: "Dela Cruz",
    email: "patient@email.com",
    phone: "09123456789",
    role: "patient",
    status: "Active",
    is_verified: true,
    is_archived: false,
    created_at: "2026-01-04T00:00:00.000Z",
    patient_id: "A2026_01",
    patient_category: "regular",
  },
];

test("archiving clinic staff preserves original status and blocks other lifecycle actions", async () => {
  const portal = await startPortal(seed);
  try {
    const blocked = await fetch(`${portal.url}/accounts/staff-1/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "suspend" }),
    });
    assert.equal(blocked.status, 403);

    const archived = await fetch(`${portal.url}/accounts/staff-1/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    assert.equal(archived.status, 200);
    const body = await archived.json();
    assert.equal(body.account.status, "active");
    assert.equal(portal.users.get("staff-1").is_archived, true);
    assert.equal(portal.users.get("staff-1").status, "Active");

    const staffList = await fetch(`${portal.url}/archived?role=staff`);
    assert.equal(staffList.status, 200);
    const staffBody = await staffList.json();
    assert.equal(staffBody.records.length, 1);
    assert.equal(staffBody.records[0].id, "staff-1");
    assert.equal(staffBody.records[0].originalStatus, "active");

    const dentistList = await fetch(`${portal.url}/archived?role=dentist`);
    const dentistBody = await dentistList.json();
    assert.equal(dentistBody.records.length, 0);
  } finally {
    await portal.close();
  }
});

test("archiving a patient keeps Patient ID and related identity fields", async () => {
  const portal = await startPortal(seed);
  try {
    const archived = await fetch(`${portal.url}/accounts/patient-1/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "archive" }),
    });
    assert.equal(archived.status, 200);
    const body = await archived.json();
    assert.equal(body.account.patientId, "A2026_01");
    assert.equal(body.account.patientCategory, "regular");
    assert.equal(body.account.status, "active");

    const list = await fetch(`${portal.url}/archived?role=patient`);
    const payload = await list.json();
    assert.equal(payload.records.length, 1);
    assert.equal(payload.records[0].patientId, "A2026_01");
    assert.equal(payload.records[0].email, "patient@email.com");
  } finally {
    await portal.close();
  }
});

test("archived accounts can be restored by an administrator without duplicating records", async () => {
  const portal = await startPortal(
    seed.map((user) =>
      user.id === "patient-1"
        ? { ...user, is_archived: true, archived_at: "2026-09-28T00:00:00.000Z", archived_by: "admin-1" }
        : user
    )
  );
  try {
    const restore = await fetch(`${portal.url}/accounts/patient-1/lifecycle`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "restore" }),
    });
    assert.equal(restore.status, 200);
    const body = await restore.json();
    assert.equal(body.account.patientId, "A2026_01");
    assert.equal(body.account.status, "active");
    assert.equal(portal.users.get("patient-1").is_archived, false);
    assert.equal(portal.users.get("patient-1").patient_id, "A2026_01");
    assert.equal(portal.users.get("patient-1").status, "Active");

    const archived = await fetch(`${portal.url}/archived?role=patient`);
    const archivedBody = await archived.json();
    assert.equal(archivedBody.records.length, 0);

    const active = await fetch(`${portal.url}/patients?limit=50`);
    const activeBody = await active.json();
    assert.equal(activeBody.patients.length, 1);
    assert.equal(activeBody.patients[0].id, "patient-1");
    assert.equal(activeBody.patients[0].patientId, "A2026_01");

    const removed = await fetch(`${portal.url}/archived/patient-1`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "delete" }),
    });
    assert.equal(removed.status, 403);
    assert.ok(portal.users.has("patient-1"));
  } finally {
    await portal.close();
  }
});

test("archived and patient lists still load when patient identity columns are missing", async () => {
  const portal = await startPortal(
    seed.map((user) => (user.id === "staff-1" ? { ...user, is_archived: true } : user)),
    { missingPatientColumns: true }
  );
  try {
    const archived = await fetch(`${portal.url}/archived?role=staff&limit=50`);
    assert.equal(archived.status, 200);
    const archivedBody = await archived.json();
    assert.equal(archivedBody.records.length, 1);
    assert.equal(archivedBody.records[0].id, "staff-1");

    const patients = await fetch(`${portal.url}/patients?limit=50`);
    assert.equal(patients.status, 200);
    const patientBody = await patients.json();
    assert.equal(patientBody.patients.length, 1);
    assert.equal(patientBody.patients[0].id, "patient-1");
  } finally {
    await portal.close();
  }
});
