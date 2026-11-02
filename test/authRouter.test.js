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

function mountAuth(otpService, env) {
  const app = express();
  app.use(express.json());
  app.use(
    "/api/auth",
    createAuthRouter({
      db: {},
      otpService,
      authenticateToken: (_req, _res, next) => next(),
      jwtSecret: "test-jwt-secret",
      env,
    })
  );
  return app;
}

test("verification preserves a leading-zero OTP and returns a patient session redirect", async (t) => {
  let submittedVerification;
  const app = mountAuth({
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
  });

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
  const app = mountAuth({
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
  });

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
  const app = mountAuth({
    async verifyOtp() {
      serviceCalled = true;
      return { status: "verified" };
    },
  });

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

test("wrong OTP codes report remaining attempts and then lock out", async (t) => {
  const outcomes = [
    { status: "mismatch", attemptsRemaining: 2 },
    { status: "locked", retryAfterSeconds: 300, attemptsRemaining: 0 },
  ];
  const app = mountAuth({
    async verifyOtp() {
      return outcomes.shift();
    },
  });

  const server = await startServer(app);
  t.after(server.close);

  const mismatch = await fetch(`${server.baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: REQUEST_ID, otp: "000001" }),
  });
  const mismatchBody = await mismatch.json();
  assert.equal(mismatch.status, 400);
  assert.equal(mismatchBody.attemptsRemaining, 2);

  const locked = await fetch(`${server.baseUrl}/api/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ requestId: REQUEST_ID, otp: "000002" }),
  });
  const lockedBody = await locked.json();
  assert.equal(locked.status, 429);
  assert.equal(lockedBody.attemptsRemaining, 0);
  assert.equal(lockedBody.retryAfterSeconds, 300);
});

test("patient registration shares the OTP send rate limit", async (t) => {
  const app = mountAuth({
    async issueOtp() {
      return { requestId: REQUEST_ID, expiresAt: new Date().toISOString() };
    },
  });
  const server = await startServer(app);
  t.after(server.close);

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const response = await fetch(`${server.baseUrl}/api/auth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 400);
  }

  const limited = await fetch(`${server.baseUrl}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  const body = await limited.json();
  assert.equal(limited.status, 429);
  assert.match(body.message, /verification code requests/i);
});

test("production otp-mail-status does not send a test email without the secret header", async (t) => {
  const app = mountAuth({}, { NODE_ENV: "production" });
  const server = await startServer(app);
  t.after(server.close);

  const response = await fetch(`${server.baseUrl}/api/auth/otp-mail-status?sendTest=1`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.testSend?.ok, false);
  assert.match(body.testSend?.error || "", /disabled in production/i);
});

