"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { hashesMatch } = require("../repositories/postgresOtpStore");
const {
  OTP_TTL_SECONDS,
  createOtpService,
  generateOtp,
} = require("../services/otpService");

function createInMemoryOtpStore({ users, now }) {
  const requests = new Map();
  const locks = new Map();

  function accountFor(request) {
    const user = users.find((candidate) => String(candidate.id) === String(request.userId));
    return user
      ? { id: user.id, email: user.email }
      : { id: request.userId, email: request.email };
  }

  return {
    requests,

    async withIssuanceLock(userId, callback) {
      const previous = locks.get(String(userId)) || Promise.resolve();
      let release;
      const current = new Promise((resolve) => {
        release = resolve;
      });
      locks.set(String(userId), current);

      await previous;
      try {
        return await callback({
          async getActiveOtpHash() {
            for (const request of requests.values()) {
              if (
                String(request.userId) === String(userId) &&
                !request.usedAt &&
                !request.invalidatedAt
              ) {
                return request.otpHash;
              }
            }
            return null;
          },

          async createRequest({ requestId, user, otpHash, ttlSeconds }) {
            const createdAt = now();
            for (const request of requests.values()) {
              if (
                String(request.userId) === String(user.id) &&
                !request.usedAt &&
                !request.invalidatedAt
              ) {
                request.invalidatedAt = createdAt;
              }
            }

            const request = {
              requestId,
              userId: user.id,
              email: user.email,
              otpHash,
              createdAt,
              expiresAt: new Date(createdAt.getTime() + ttlSeconds * 1000),
              usedAt: null,
              invalidatedAt: null,
            };
            requests.set(requestId, request);
            return request;
          },

          async invalidateRequest(requestId) {
            const request = requests.get(requestId);
            if (request && !request.usedAt && !request.invalidatedAt) {
              request.invalidatedAt = now();
            }
          },
        });
      } finally {
        release();
        if (locks.get(String(userId)) === current) {
          locks.delete(String(userId));
        }
      }
    },

    async consume({ requestId, otpHash }) {
      const request = requests.get(requestId);
      if (!request) {
        return { status: "not_found" };
      }

      const user = accountFor(request);
      const timestamps = {
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
      };

      if (request.usedAt || request.invalidatedAt) {
        return { status: "inactive", user, ...timestamps };
      }

      if (!(request.expiresAt instanceof Date) || Number.isNaN(request.expiresAt.getTime())) {
        request.invalidatedAt = now();
        return { status: "invalid_expiration", user, ...timestamps };
      }

      if (request.expiresAt.getTime() <= now().getTime()) {
        request.invalidatedAt = now();
        return { status: "expired", user, ...timestamps };
      }

      if (!hashesMatch(request.otpHash, otpHash)) {
        return { status: "mismatch", user, ...timestamps };
      }

      request.usedAt = now();
      const storedUser = users.find(
        (candidate) => String(candidate.id) === String(request.userId)
      );
      storedUser.is_verified = true;

      return {
        status: "verified",
        user: storedUser,
        ...timestamps,
      };
    },
  };
}

function createFixture({ codeGenerator, start = "2026-08-17T12:00:00.000Z" } = {}) {
  let currentTime = new Date(start);
  const now = () => new Date(currentTime);
  const users = [
    {
      id: 42,
      email: "patient@example.test",
      phone: "639333333333",
      role: "patient",
      status: "Active",
      is_verified: false,
    },
  ];
  const deliveries = [];
  const auditLogs = [];
  const store = createInMemoryOtpStore({ users, now });
  const service = createOtpService({
    store,
    otpSecret: "test-only-otp-secret",
    codeGenerator,
    logger: { info: (message) => auditLogs.push(message) },
    deliverOtp: async (message) => {
      deliveries.push(message);
    },
  });

  return {
    advance(milliseconds) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    auditLogs,
    deliveries,
    service,
    store,
    user: users[0],
  };
}

test("OTP generation preserves leading zeros", () => {
  assert.equal(generateOtp(() => 12345), "012345");
});

test("the exact OTP delivered by email verifies the matching request", async () => {
  const fixture = createFixture({ codeGenerator: () => "483920" });
  const request = await fixture.service.issueOtp(fixture.user);
  const delivered = fixture.deliveries[0];

  assert.equal(delivered.to, fixture.user.email);
  assert.equal(delivered.otp, "483920");
  assert.equal(delivered.requestId, request.requestId);

  const result = await fixture.service.verifyOtp({
    requestId: request.requestId,
    otp: delivered.otp,
  });

  assert.equal(result.status, "verified");
  assert.equal(fixture.user.is_verified, true);
  assert.ok(fixture.auditLogs.every((entry) => !entry.includes(delivered.otp)));
});

test("an incorrect OTP is rejected without consuming the valid OTP", async () => {
  const fixture = createFixture({ codeGenerator: () => "483920" });
  const request = await fixture.service.issueOtp(fixture.user);

  const incorrect = await fixture.service.verifyOtp({
    requestId: request.requestId,
    otp: "000000",
  });
  assert.equal(incorrect.status, "mismatch");
  assert.equal(fixture.user.is_verified, false);

  const correct = await fixture.service.verifyOtp({
    requestId: request.requestId,
    otp: fixture.deliveries[0].otp,
  });
  assert.equal(correct.status, "verified");
});

test("an expired OTP is rejected using server-side expiration", async () => {
  const fixture = createFixture({ codeGenerator: () => "483920" });
  const request = await fixture.service.issueOtp(fixture.user);
  fixture.advance((OTP_TTL_SECONDS + 1) * 1000);

  const result = await fixture.service.verifyOtp({
    requestId: request.requestId,
    otp: fixture.deliveries[0].otp,
  });

  assert.equal(result.status, "expired");
  assert.equal(fixture.user.is_verified, false);
});

test("a resend invalidates the previous OTP and accepts only the newest OTP", async () => {
  const codes = ["111111", "222222"];
  const fixture = createFixture({ codeGenerator: () => codes.shift() });
  const firstRequest = await fixture.service.issueOtp(fixture.user);
  const firstOtp = fixture.deliveries[0].otp;

  const secondRequest = await fixture.service.issueOtp(fixture.user);
  const secondOtp = fixture.deliveries[1].otp;

  assert.notEqual(firstRequest.requestId, secondRequest.requestId);
  const oldResult = await fixture.service.verifyOtp({
    requestId: firstRequest.requestId,
    otp: firstOtp,
  });
  assert.equal(oldResult.status, "inactive");

  const latestResult = await fixture.service.verifyOtp({
    requestId: secondRequest.requestId,
    otp: secondOtp,
  });
  assert.equal(latestResult.status, "verified");
});

test("a resend does not reuse the currently active OTP if random generation collides", async () => {
  const codes = ["111111", "111111", "222222"];
  const fixture = createFixture({ codeGenerator: () => codes.shift() });

  await fixture.service.issueOtp(fixture.user);
  await fixture.service.issueOtp(fixture.user);

  assert.equal(fixture.deliveries[0].otp, "111111");
  assert.equal(fixture.deliveries[1].otp, "222222");
});

test("a leading-zero OTP remains a six-character string and verifies", async () => {
  const fixture = createFixture({ codeGenerator: () => "012345" });
  const request = await fixture.service.issueOtp(fixture.user);

  assert.equal(fixture.deliveries[0].otp, "012345");
  const result = await fixture.service.verifyOtp({
    requestId: request.requestId,
    otp: "012345",
  });

  assert.equal(result.status, "verified");
});

test("the request ID remains sufficient after a verification-page refresh", async () => {
  const fixture = createFixture({ codeGenerator: () => "483920" });
  const request = await fixture.service.issueOtp(fixture.user);

  // A page refresh only restores this opaque request ID; it does not recreate
  // an OTP or depend on client time.
  const restoredRequestId = request.requestId;
  const result = await fixture.service.verifyOtp({
    requestId: restoredRequestId,
    otp: fixture.deliveries[0].otp,
  });

  assert.equal(result.status, "verified");
});

test("duplicate verification submissions consume a correct OTP exactly once", async () => {
  const fixture = createFixture({ codeGenerator: () => "483920" });
  const request = await fixture.service.issueOtp(fixture.user);

  const results = await Promise.all([
    fixture.service.verifyOtp({ requestId: request.requestId, otp: "483920" }),
    fixture.service.verifyOtp({ requestId: request.requestId, otp: "483920" }),
  ]);

  assert.equal(results.filter((result) => result.status === "verified").length, 1);
  assert.equal(results.filter((result) => result.status === "inactive").length, 1);
});
