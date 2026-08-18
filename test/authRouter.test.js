"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const bcrypt = require("bcrypt");
const express = require("express");
const { createAuthRouter } = require("../routes/auth");

const REQUEST_ID = "123e4567-e89b-42d3-a456-426614174000";

async function startServer(app) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test("verification preserves a leading-zero OTP and returns a patient session redirect", async (t) => {
  let submittedVerification;
  const otpService = {
    async verifyOtp(payload) {
      submittedVerification = payload;
      return {
        status: "verified",
        user: {
          id: 42,
          first_name: "Test",
          last_name: "Patient",
          email: "patient@example.test",
          phone: "639333333333",
          role: "patient",
          status: "Active",
          is_verified: true,
        },
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {},
      otpService,
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
    })
  );

  const server = await startServer(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: REQUEST_ID, otp: "012345" }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(submittedVerification, { requestId: REQUEST_ID, otp: "012345" });
  assert.equal(body.redirectTo, "/patient/dashboard");
  assert.equal(body.user.isVerified, true);
  assert.equal(typeof body.token, "string");
});

test("legacy phone-and-OTP clients resolve the active request before verification", async (t) => {
  let resolvedPhone;
  let submittedVerification;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {},
      otpService: {
        async findActiveRequestIdByPhone(phone) {
          resolvedPhone = phone;
          return REQUEST_ID;
        },
        async verifyOtp(payload) {
          submittedVerification = payload;
          return {
            status: "verified",
            user: {
              id: 42,
              first_name: "Test",
              last_name: "Patient",
              email: "patient@example.test",
              phone: "639333333333",
              role: "patient",
              status: "Active",
              is_verified: true,
            },
          };
        },
      },
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
    })
  );

  const server = await startServer(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: "09333333333", otp: "012345" }),
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(resolvedPhone, "639333333333");
  assert.deepEqual(submittedVerification, { requestId: REQUEST_ID, otp: "012345" });
  assert.equal(body.redirectTo, "/patient/dashboard");
});

test("verification rejects an OTP sent as a number because leading zeros would be lost", async (t) => {
  let serviceCalled = false;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {},
      otpService: {
        async verifyOtp() {
          serviceCalled = true;
          return { status: "verified" };
        },
      },
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
    })
  );

  const server = await startServer(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: REQUEST_ID, otp: 12345 }),
  });
  const body = await response.json();

  assert.equal(response.status, 400);
  assert.match(body.message, /six-digit string/i);
  assert.equal(serviceCalled, false);
});

test("forgot-password accepts active verified accounts across all supported roles", async (t) => {
  const issuedFor = [];
  const accounts = {
    "admin@example.test": { id: 1, role: "admin" },
    "dentist@example.test": { id: 2, role: "dentist" },
    "staff@example.test": { id: 3, role: "staff" },
    "patient@example.test": { id: 4, role: "patient" },
  };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {
        async query(_query, [email]) {
          const account = accounts[email];
          return {
            rows: account
              ? [{
                    ...account,
                    email,
                    phone: "639333333333",
                    is_verified: true,
                  }]
              : [],
          };
        },
      },
      otpService: {},
      passwordResetService: {
        async issuePasswordReset(user) {
          issuedFor.push(user.email);
        },
      },
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
    })
  );
  const server = await startServer(app);
  t.after(server.close);

  async function requestReset(email) {
    return fetch(`${server.baseUrl}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    });
  }

  const responses = await Promise.all([
    requestReset("admin@example.test"),
    requestReset("dentist@example.test"),
    requestReset("staff@example.test"),
    requestReset("patient@example.test"),
    requestReset("unknown@example.test"),
  ]);

  assert.ok(responses.slice(0, 4).every((response) => response.status === 202));
  assert.equal(responses[4].status, 404);
  assert.match((await responses[4].json()).message, /email address not found/i);
  assert.deepEqual(issuedFor.sort(), [
    "admin@example.test",
    "dentist@example.test",
    "patient@example.test",
    "staff@example.test",
  ]);
});

test("forgot-password validates malformed emails and throttles repeated requests", async (t) => {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {
        async query() {
          return { rows: [] };
        },
      },
      otpService: {},
      passwordResetService: {
        async issuePasswordReset() {},
      },
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
    })
  );
  const server = await startServer(app);
  t.after(server.close);

  const malformed = await fetch(`${server.baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).message, /valid email/i);

  const responses = [];
  for (let attempt = 0; attempt < 4; attempt += 1) {
    responses.push(
      await fetch(`${server.baseUrl}/api/auth/forgot-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `unknown${attempt}@example.test` }),
      })
    );
  }
  assert.ok(responses.every((response) => response.status === 404));

  const throttled = await fetch(`${server.baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "too-many@example.test" }),
  });
  assert.equal(throttled.status, 429);
});

test("reset-password hashes the submitted password before consuming a reset token", async (t) => {
  let submittedReset;
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {
        async query() {
          return { rows: [] };
        },
      },
      otpService: {},
      passwordResetService: {
        async resetPassword(payload) {
          submittedReset = payload;
          return {
            status: "reset",
            user: { id: 42, email: "patient@example.test" },
          };
        },
      },
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
    })
  );
  const server = await startServer(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/auth/reset-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: "a".repeat(43),
      newPassword: "a-new-secure-password",
    }),
  });

  assert.equal(response.status, 200);
  assert.equal(submittedReset.token, "a".repeat(43));
  assert.notEqual(submittedReset.passwordHash, "a-new-secure-password");
  assert.equal(
    await bcrypt.compare("a-new-secure-password", submittedReset.passwordHash),
    true
  );
});
