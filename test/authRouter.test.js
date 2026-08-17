"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

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
