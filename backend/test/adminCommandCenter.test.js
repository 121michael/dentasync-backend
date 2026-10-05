"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");

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

      if (sql.includes("admin_portal_settings") && sql.includes("setting_key = 'ai'")) {
        return {
          rows: [
            {
              setting_value: {
                amethystAiEnabled: true,
                predictiveDiagnostics: true,
                automatedReminders: false,
                waitingTimePrediction: true,
                aiChatbot: false,
                scheduledSystemUpdates: true,
                chatbotKnowledgeMode: "clinic",
                diagnosticsSensitivity: "balanced",
              },
              updated_at: "2026-06-03T00:00:00.000Z",
              updated_by: "admin-1",
            },
          ],
        };
      }

      if (sql.includes("INTO admin_portal_audit_logs")) {
        return { rows: [{ id: 1, created_at: "2026-06-03T00:00:00.000Z" }] };
      }

      if (sql.includes("SELECT 1")) {
        return { rows: [{ "?column?": 1 }] };
      }

      if (sql.includes("COUNT(*) AS count")) {
        return { rows: [{ count: "0" }] };
      }

      if (sql.includes("FROM admin_portal_audit_logs")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected test query: ${sql} :: ${JSON.stringify(params)}`);
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

test("admin AI settings endpoint returns persisted configuration", async () => {
  const portal = await startPortal();
  try {
    const response = await fetch(`${portal.url}/ai-settings`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.settings.amethystAiEnabled, true);
    assert.equal(body.settings.automatedReminders, false);
  } finally {
    await portal.close();
  }
});

test("admin status endpoint reports infrastructure health", async () => {
  const portal = await startPortal();
  try {
    const response = await fetch(`${portal.url}/status`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.coreInfrastructureOnline, true);
    assert.equal(typeof body.activeOperationsTerminals, "number");
  } finally {
    await portal.close();
  }
});
