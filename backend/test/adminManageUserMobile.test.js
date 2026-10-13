"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter, parseManageUserMobile } = require("../routes/adminPortal");

const MESSAGE = "Enter a valid 11-digit mobile number starting with 09.";

test("parseManageUserMobile accepts exactly 11 digits starting with 09", () => {
  assert.equal(parseManageUserMobile("09171234567"), "09171234567");
  assert.equal(parseManageUserMobile("0917-123-4567"), "09171234567");
});

test("parseManageUserMobile rejects invalid Philippine mobile numbers", () => {
  assert.equal(parseManageUserMobile("639171234567"), null);
  assert.equal(parseManageUserMobile("0917123456"), null);
  assert.equal(parseManageUserMobile("091712345678"), null);
  assert.equal(parseManageUserMobile("08171234567"), null);
  assert.equal(parseManageUserMobile("09ABC123456"), null);
  assert.equal(parseManageUserMobile(""), null);
});

async function startPortal() {
  const app = express();
  app.use(express.json());
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
        return {
          rows: [
            {
              id: "admin-1",
              first_name: "Ada",
              last_name: "Admin",
              email: "ada@example.test",
              phone: "09171234567",
              role: "admin",
              status: "Active",
              is_verified: true,
              password_hash: "hash",
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("UPDATE users") && sql.includes("RETURNING")) {
        return {
          rows: [
            {
              id: params[params.length - 1],
              first_name: "Ana",
              last_name: "Staff",
              email: "ana@example.test",
              phone: params[0],
              role: "staff",
              status: "Active",
              is_verified: true,
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("admin_portal_staff_profiles")) {
        return { rows: [] };
      }
      throw new Error(`Unexpected test query: ${sql} :: ${JSON.stringify(params)}`);
    },
    async connect() {
      throw new Error("Staff create should not open a transaction for invalid phones.");
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
    url: `http://127.0.0.1:${server.address().port}/api/admin`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("admin staff create rejects invalid mobile numbers before saving", async () => {
  const portal = await startPortal();
  const payload = {
    firstName: "Ana",
    lastName: "Staff",
    email: "ana@example.test",
  };
  try {
    for (const phone of ["639171234567", "0917123456", "091712345678", "08171234567", "09ABC123456"]) {
      const response = await fetch(`${portal.url}/staff`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, phone }),
      });
      assert.equal(response.status, 400, phone);
      assert.equal((await response.json()).message, MESSAGE);
    }
  } finally {
    await portal.close();
  }
});

test("admin staff update accepts a valid 09 mobile number and rejects 63 prefix", async () => {
  const portal = await startPortal();
  try {
    const valid = await fetch(`${portal.url}/staff/staff-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "09171234567" }),
    });
    assert.equal(valid.status, 200);
    assert.equal((await valid.json()).staff.phone, "09171234567");

    const invalid = await fetch(`${portal.url}/staff/staff-1`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ phone: "639171234567" }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).message, MESSAGE);
  } finally {
    await portal.close();
  }
});
