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

test("forgot-password uses one response for known and unknown patient emails", async (t) => {
  const issuedFor = [];
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {
        async query(_query, [email]) {
          return {
            rows:
              email === "patient@example.test"
                ? [{
                    id: 42,
                    email,
                    phone: "639333333333",
                    role: "patient",
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

  const known = await fetch(`${server.baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "patient@example.test" }),
  });
  const unknown = await fetch(`${server.baseUrl}/api/auth/forgot-password`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "unknown@example.test" }),
  });

  assert.equal(known.status, 202);
  assert.equal(unknown.status, 202);
  assert.deepEqual(await known.json(), await unknown.json());
  assert.deepEqual(issuedFor, ["patient@example.test"]);
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
