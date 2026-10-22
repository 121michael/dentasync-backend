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
  tokenUser = { id: "admin-1", role: "admin" },
  callerIsAdmin = true,
  failPasswordUpdate = false,
} = {}) {
  const issuedCalls = [];
  let passwordHashUpdated = false;
  let storedHash = null;
  const notifications = [];
  const audits = [];
  const invalidatedLinks = [];

  async function query(sql, params = []) {
    if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
      if (!callerIsAdmin) return { rows: [] };
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

    if (sql.includes("UPDATE password_reset_requests")) {
      invalidatedLinks.push(params);
      return { rows: [] };
    }

    if (sql.includes("SELECT managed_by_user_id FROM users")) {
      return { rows: [{ managed_by_user_id: target.managed_by_user_id || null }] };
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
      if (failPasswordUpdate) {
        const error = new Error("connection terminated unexpectedly");
        error.code = "57P01";
        throw error;
      }
      passwordHashUpdated = true;
      storedHash = params[0];
      return { rows: sql.includes("RETURNING id") ? [{ id: target.id }] : [] };
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
        req.user = tokenUser;
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
    invalidatedLinks,
    get passwordHashUpdated() {
      return passwordHashUpdated;
    },
    get storedHash() {
      return storedHash;
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

const NEW_PASSWORD = "Clinic-Set-Pass-2026";

async function postDirectReset(portal, body, id = "patient-1") {
  const response = await fetch(`${portal.url}/accounts/${id}/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: JSON.parse(text), text };
}

async function captureConsole(run) {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const level of Object.keys(original)) {
    console[level] = (...args) => lines.push(args.map(String).join(" "));
  }
  try {
    await run();
  } finally {
    Object.assign(console, original);
  }
  return lines.join("\n");
}

test("admin can set a new patient password directly without sending an email", async () => {
  const bcrypt = require("bcrypt");
  const portal = await startPortal({ target: { ...patientRow(), is_verified: false } });
  try {
    let result;
    const logs = await captureConsole(async () => {
      result = await postDirectReset(portal, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.delivery, "direct");
    assert.match(result.body.message, /can now sign in with the new password/i);
    assert.equal(portal.issuedCalls.length, 0, "no reset email is issued");
    assert.equal(portal.passwordHashUpdated, true);
    assert.match(portal.storedHash, /^\$2[aby]\$12\$/);
    assert.notEqual(portal.storedHash, NEW_PASSWORD);
    assert.equal(await bcrypt.compare(NEW_PASSWORD, portal.storedHash), true);
    assert.deepEqual(portal.invalidatedLinks, [["patient-1"]]);
    assert.equal(portal.notifications.length, 1);

    const audit = portal.audits.at(-1);
    assert.ok(audit.params.includes("admin-1"), "audit records the administrator");
    assert.ok(audit.params.includes("patient-1"), "audit records the target account");
    assert.ok(audit.params.includes("success"), "audit records the outcome");

    const exposed = [result.text, logs, JSON.stringify(portal.audits), JSON.stringify(portal.notifications)].join("\n");
    assert.equal(exposed.includes(NEW_PASSWORD), false, "plaintext password must not leak");
    assert.equal(exposed.includes(portal.storedHash), false, "password hash must not leak");
    assert.equal(exposed.includes("$2b$10$hashed-secret-value"), false, "old hash must not leak");
  } finally {
    await portal.close();
  }
});

test("admin direct reset rejects short, oversized, missing, and mismatched passwords", async () => {
  const portal = await startPortal();
  try {
    const cases = [
      [{ newPassword: "short", confirmPassword: "short" }, /at least 10 characters/i],
      [{ newPassword: "x".repeat(73), confirmPassword: "x".repeat(73) }, /72 characters or fewer/i],
      [{ newPassword: "", confirmPassword: "" }, /enter the new password/i],
      [{ newPassword: NEW_PASSWORD }, /enter the new password/i],
      [{ newPassword: 12345678901, confirmPassword: 12345678901 }, /enter the new password/i],
      [{ newPassword: NEW_PASSWORD, confirmPassword: `${NEW_PASSWORD}x` }, /do not match/i],
    ];
    for (const [body, pattern] of cases) {
      const result = await postDirectReset(portal, body);
      assert.equal(result.status, 400, JSON.stringify(body));
      assert.match(result.body.message, pattern);
      assert.equal(result.text.includes(NEW_PASSWORD), false);
    }
    assert.equal(portal.passwordHashUpdated, false);
    assert.equal(portal.issuedCalls.length, 0);
  } finally {
    await portal.close();
  }
});

test("non-admin callers cannot set a patient password", async () => {
  for (const role of ["staff", "dentist", "patient"]) {
    const portal = await startPortal({ tokenUser: { id: `${role}-9`, role }, callerIsAdmin: false });
    try {
      const result = await postDirectReset(portal, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
      assert.equal(result.status, 403, role);
      assert.equal(portal.passwordHashUpdated, false, role);
    } finally {
      await portal.close();
    }
  }
});

test("admin direct reset is refused for staff, dentists, and family-managed dependents", async () => {
  const staffPortal = await startPortal({ target: { ...patientRow(), id: "staff-1", role: "staff" } });
  try {
    const result = await postDirectReset(
      staffPortal,
      { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD },
      "staff-1"
    );
    assert.equal(result.status, 403);
    assert.equal(staffPortal.passwordHashUpdated, false);
  } finally {
    await staffPortal.close();
  }

  const dependentPortal = await startPortal({ target: { ...patientRow(), managed_by_user_id: "patient-0" } });
  try {
    const result = await postDirectReset(dependentPortal, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    assert.equal(result.status, 409);
    assert.match(result.body.message, /managed by a family account holder/i);
    assert.equal(dependentPortal.passwordHashUpdated, false);
  } finally {
    await dependentPortal.close();
  }
});

test("admin direct reset reports failure, not success, when the database update fails", async () => {
  const portal = await startPortal({ failPasswordUpdate: true });
  try {
    let result;
    const logs = await captureConsole(async () => {
      result = await postDirectReset(portal, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    });
    assert.equal(result.status, 500);
    assert.match(result.body.message, /current password was not changed/i);
    assert.equal(result.body.delivery, undefined);
    assert.equal(portal.notifications.length, 0, "no success notification is sent");
    assert.equal(portal.invalidatedLinks.length, 0);
    assert.ok(portal.audits.at(-1).params.includes("failed"));
    assert.equal([result.text, logs, JSON.stringify(portal.audits)].join("\n").includes(NEW_PASSWORD), false);
    assert.equal(/\$2[aby]\$/.test([result.text, logs].join("\n")), false);
  } finally {
    await portal.close();
  }
});

test("admin direct reset returns not found for unknown or archived patients", async () => {
  const portal = await startPortal({ target: { ...patientRow(), is_archived: true } });
  try {
    const result = await postDirectReset(portal, { newPassword: NEW_PASSWORD, confirmPassword: NEW_PASSWORD });
    assert.equal(result.status, 404);
    assert.equal(result.body.message, "Account not found.");
    assert.equal(portal.passwordHashUpdated, false);
  } finally {
    await portal.close();
  }
});
