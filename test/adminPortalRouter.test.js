"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");

async function startAdminPortal({ tokenRole, databaseRole }) {
  const app = express();
  const db = {
    async query(sql) {
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
        if (databaseRole !== "admin") {
          return { rows: [] };
        }
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
            },
          ],
        };
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
        req.user = { id: "admin-1", role: tokenRole };
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

test("admin dashboard rejects a token whose database account is not admin", async () => {
  const portal = await startAdminPortal({ tokenRole: "admin", databaseRole: "staff" });
  try {
    const response = await fetch(`${portal.url}/dashboard`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /active administrator accounts only/i);
  } finally {
    await portal.close();
  }
});

test("admin dashboard authorizes the live database role instead of a token role claim", async () => {
  const portal = await startAdminPortal({ tokenRole: "patient", databaseRole: "admin" });
  try {
    const response = await fetch(`${portal.url}/dashboard`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.welcomeName, "Ada Admin");
    assert.equal(body.metrics.totalPatients, 0);
    assert.equal(body.metrics.monthGrowth, 0);
  } finally {
    await portal.close();
  }
});
