"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");

function patientRow() {
  return {
    id: "patient-1",
    first_name: "Juan",
    last_name: "Dela Cruz",
    email: "juan@example.com",
    phone: "639171111111",
    role: "patient",
    status: "active",
    is_verified: true,
    is_archived: false,
    password_hash: "$2b$10$hashed-secret-value",
    patient_id: "A202610_01",
    patient_category: "regular",
    created_at: "2026-10-01T00:00:00.000Z",
  };
}

async function startPortal({
  target = patientRow(),
  issued = { requestId: "reset-1", expiresAt: "2026-10-13T01:00:00.000Z" },
  issuePasswordReset = async () => issued,
} = {}) {
  const issuedCalls = [];
  let passwordHashUpdated = false;
  const notifications = [];
  const audits = [];

  async function query(sql, params = []) {
    if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
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
            password_hash: "admin-hash",
            created_at: "2026-01-01T00:00:00.000Z",
            is_archived: false,
          },
        ],
      };
    }

    if (sql.includes("INTO admin_portal_audit_logs")) {
      audits.push({ sql, params });
      return { rows: [{ id: 1, created_at: "2026-10-13T00:00:00.000Z" }] };
    }

    if (sql.includes("INTO patient_portal_notifications")) {
      notifications.push(params);
      return { rows: [] };
    }

    if (sql.includes("COUNT(*) AS count") && sql.includes("FROM users AS account")) {
      return { rows: [{ count: "1" }] };
    }

    if (sql.includes("FROM users AS account") && sql.includes("LOWER(account.role) = 'patient'")) {
      return {
        rows: [
          {
            ...target,
            full_name: `${target.first_name} ${target.last_name}`,
            last_visit: null,
            date_of_birth: null,
            gender: "",
            last_treatment: null,
            age: null,
          },
        ],
      };
    }

    if (sql.includes("password_hash") && sql.includes("id::text = ANY") && sql.includes("FROM users")) {
      return {
        rows: [
          {
            id: String(target.id),
            has_password: Boolean(target.password_hash),
          },
        ],
      };
    }

    if (sql.includes("FROM password_reset_requests")) {
      return { rows: [] };
    }

    if (
      sql.includes("FROM users") &&
      sql.includes("id::text = $1") &&
      sql.includes("first_name") &&
      sql.includes("is_archived")
    ) {
      return { rows: [target] };
    }

    if (sql.includes("SET password_hash")) {
      passwordHashUpdated = true;
      return { rows: [] };
    }

    if (sql.includes("COUNT(*) AS count")) {
      return { rows: [{ count: "0" }] };
    }

    throw new Error(`Unexpected test query: ${sql} :: ${JSON.stringify(params)}`);
  }

  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db: { query },
      emailDeliveryIsConfigured: () => true,
      passwordResetService: {
        async issuePasswordReset(user) {
          issuedCalls.push(user);
          return issuePasswordReset(user);
        },
      },
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
    issuedCalls,
    notifications,
    audits,
    get passwordHashUpdated() {
      return passwordHashUpdated;
    },
    url: `http://127.0.0.1:${server.address().port}/api/admin`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("admin patient list shows email and password status without exposing the hash", async () => {
  const portal = await startPortal();
  try {
    const response = await fetch(`${portal.url}/patients?limit=50`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.patients.length, 1);
    assert.equal(body.patients[0].email, "juan@example.com");
    assert.equal(body.patients[0].patientId, "A202610_01");
    assert.equal(body.patients[0].passwordStatus, "Password set");
    assert.equal(body.patients[0].password_hash, undefined);
    assert.equal(body.patients[0].passwordHash, undefined);
    assert.equal(body.patients[0].password, undefined);
    const serialized = JSON.stringify(body);
    assert.equal(serialized.includes("$2b$10$hashed-secret-value"), false);
    assert.equal(serialized.includes("password_hash"), false);
  } finally {
    await portal.close();
  }
});

test("admin can initiate a patient password reset without changing the current password", async () => {
  const portal = await startPortal();
  try {
    const response = await fetch(`${portal.url}/accounts/patient-1/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.match(body.message, /reset link was sent/i);
    assert.equal(body.temporaryPassword, undefined);
    assert.equal(body.token, undefined);
    assert.equal(body.password, undefined);
    assert.equal(body.delivery, "email");
    assert.equal(portal.issuedCalls.length, 1);
    assert.equal(portal.issuedCalls[0].email, "juan@example.com");
    assert.equal(portal.passwordHashUpdated, false);
    assert.equal(portal.notifications.length, 1);
    const serialized = JSON.stringify({ body, issued: portal.issuedCalls, audits: portal.audits });
    assert.equal(serialized.includes("Amethyst-"), false);
  } finally {
    await portal.close();
  }
});

async function postReset(portal, id = "patient-1") {
  const response = await fetch(`${portal.url}/accounts/${id}/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  return { status: response.status, body: await response.json() };
}

test("admin reset explains when the patient has not verified their email", async () => {
  const portal = await startPortal({ target: { ...patientRow(), is_verified: false } });
  try {
    const { status, body } = await postReset(portal);
    assert.equal(status, 409);
    assert.match(body.message, /not verified their email/i);
    assert.equal(portal.issuedCalls.length, 0);
    assert.equal(portal.passwordHashUpdated, false);
  } finally {
    await portal.close();
  }
});

test("admin reset explains when the patient account is inactive", async () => {
  const portal = await startPortal({ target: { ...patientRow(), status: "Suspended" } });
  try {
    const { status, body } = await postReset(portal);
    assert.equal(status, 409);
    assert.match(body.message, /inactive, disabled, or suspended/i);
    assert.equal(portal.issuedCalls.length, 0);
  } finally {
    await portal.close();
  }
});

test("admin reset maps a store refusal to a clear message instead of a generic error", async () => {
  const portal = await startPortal({
    issuePasswordReset: async () => {
      const error = new Error("The account is unavailable for a password reset.");
      error.code = "PASSWORD_RESET_ACCOUNT_UNAVAILABLE";
      throw error;
    },
  });
  try {
    const { status, body } = await postReset(portal);
    assert.equal(status, 409);
    assert.match(body.message, /not verified or not active/i);
    assert.doesNotMatch(body.message, /^Unable to reset password\.$/);
  } finally {
    await portal.close();
  }
});

test("admin cannot reset staff or dentist passwords from user management", async () => {
  const staffPortal = await startPortal({
    target: { ...patientRow(), id: "staff-1", role: "staff", email: "staff@example.com" },
  });
  try {
    const response = await fetch(`${staffPortal.url}/accounts/staff-1/reset-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 403);
    assert.equal(staffPortal.issuedCalls.length, 0);
    assert.equal(staffPortal.passwordHashUpdated, false);
  } finally {
    await staffPortal.close();
  }
});
