"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const express = require("express");
const { createAuthRouter } = require("../routes/auth");
const { createAdminPortalRouter } = require("../routes/adminPortal");
const { buildAdminOtpMailStatus } = require("../services/otpMailStatus");
const { createOtpService } = require("../services/otpService");

async function listen(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("anonymous callers no longer receive OTP mail diagnostics", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: { query: async () => ({ rows: [] }) },
      otpService: { issueOtp: async () => ({}), verifyOtp: async () => ({ status: "invalid" }) },
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret-value",
    })
  );
  const server = await listen(app);
  t.after(server.close);
  const response = await fetch(`${server.url}/api/auth/otp-mail-status`);
  assert.equal(response.status, 404);
});

test("admin mail status omits credentials, provider bodies, and raw errors", async () => {
  const status = await buildAdminOtpMailStatus({
    env: {
      EMAIL_USER: "clinic-mail@example.test",
      EMAIL_PASS: "not-a-real-password",
      EMAIL_FROM: "clinic-mail@example.test",
    },
  });
  const serialized = JSON.stringify(status);
  assert.equal(status.emailDeliveryConfigured, true);
  assert.equal(status.smtpConfigured, true);
  assert.equal(status.httpsRelayConfigured, false);
  assert.equal(serialized.includes("clinic-mail@example.test"), false);
  assert.equal(serialized.includes("not-a-real-password"), false);
  assert.equal(status.probe, undefined);
  assert.equal(status.error, undefined);
  assert.equal(status.relay.reached, false);
});

test("administrators can load operational mail status; patients cannot", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db: {
        async query(sql, params = []) {
          if (sql.includes("LOWER(role) = 'admin'")) {
            if (String(params[0]) !== "admin-1") {
              return { rows: [] };
            }
            return {
              rows: [
                {
                  id: "admin-1",
                  first_name: "Ada",
                  last_name: "Admin",
                  email: "admin@example.test",
                  role: "admin",
                  status: "Active",
                  is_verified: true,
                },
              ],
            };
          }
          return { rows: [] };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: req.headers["x-user-id"], role: req.headers["x-user-role"] };
        next();
      },
      emailDeliveryIsConfigured: () => true,
    })
  );
  const server = await listen(app);
  t.after(server.close);

  const denied = await fetch(`${server.url}/api/admin/otp-mail-status`, {
    headers: { "x-user-id": "patient-1", "x-user-role": "patient" },
  });
  assert.equal(denied.status, 403);

  const allowed = await fetch(`${server.url}/api/admin/otp-mail-status`, {
    headers: { "x-user-id": "admin-1", "x-user-role": "admin" },
  });
  assert.equal(allowed.status, 200);
  const body = await allowed.json();
  assert.equal(typeof body.emailDeliveryConfigured, "boolean");
  assert.equal(body.error, undefined);
  assert.equal(body.testSend, undefined);
});

test("OTP issue still delivers through the configured mailer", async () => {
  const delivered = [];
  const otpService = createOtpService({
    otpSecret: "otp-secret-for-tests-32chars-long",
    deliverOtp: async (payload) => {
      delivered.push(payload);
    },
    store: {
      async withIssuanceLock(_userId, work) {
        return work({
          async getActiveOtpHash() {
            return null;
          },
          async createRequest(record) {
            return {
              requestId: record.requestId,
              createdAt: new Date(),
              expiresAt: new Date(Date.now() + 300000),
            };
          },
          async invalidateRequest() {},
        });
      },
      async consume() {
        return { status: "invalid" };
      },
      async findActiveRequestIdByPhone() {
        return null;
      },
    },
  });
  const issued = await otpService.issueOtp({
    id: "user-1",
    email: "patient@example.test",
  });
  assert.ok(issued.requestId);
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].to, "patient@example.test");
  assert.match(String(delivered[0].otp), /^\d{6}$/);
});
