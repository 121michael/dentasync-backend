"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const { hashesMatch } = require("../repositories/postgresPasswordResetStore");
const {
  PASSWORD_RESET_TTL_SECONDS,
  PasswordResetDeliveryError,
  createPasswordResetService,
} = require("../services/passwordResetService");

function createInMemoryPasswordResetStore({ user, now }) {
  const requests = new Map();

  return {
    requests,

    async withIssuanceLock(_userId, callback) {
      return callback({
        async createRequest({ requestId, tokenHash, ttlSeconds }) {
          const createdAt = now();
          for (const request of requests.values()) {
            if (!request.usedAt && !request.invalidatedAt) {
              request.invalidatedAt = createdAt;
            }
          }

          const request = {
            requestId,
            userId: user.id,
            tokenHash,
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
    },

    async consumeAndReset({ tokenHash, passwordHash }) {
      const request = Array.from(requests.values()).find((candidate) =>
        hashesMatch(candidate.tokenHash, tokenHash)
      );
      if (!request) {
        return { status: "not_found" };
      }

      const details = {
        requestId: request.requestId,
        user,
        createdAt: request.createdAt,
        expiresAt: request.expiresAt,
      };
      if (request.usedAt || request.invalidatedAt) {
        return { status: "inactive", ...details };
      }
      if (request.expiresAt.getTime() <= now().getTime()) {
        request.invalidatedAt = now();
        return { status: "expired", ...details };
      }

      request.usedAt = now();
      user.passwordHash = passwordHash;
      user.passwordChangedAt = now();
      for (const candidate of requests.values()) {
        if (candidate.requestId !== request.requestId && !candidate.usedAt && !candidate.invalidatedAt) {
          candidate.invalidatedAt = now();
        }
      }
      return { status: "reset", ...details };
    },
  };
}

function createFixture({ tokenGenerator, deliverResetLink } = {}) {
  let currentTime = new Date("2026-08-17T12:00:00.000Z");
  const now = () => new Date(currentTime);
  const user = {
    id: 42,
    email: "patient@example.test",
    role: "patient",
    is_verified: true,
    passwordHash: "old-password-hash",
  };
  const deliveries = [];
  const auditLogs = [];
  const store = createInMemoryPasswordResetStore({ user, now });
  const service = createPasswordResetService({
    store,
    passwordResetSecret: "test-only-password-reset-secret",
    tokenGenerator,
    logger: { info: (message) => auditLogs.push(message) },
    deliverResetLink:
      deliverResetLink ||
      (async (message) => {
        deliveries.push(message);
      }),
  });

  return {
    advance(milliseconds) {
      currentTime = new Date(currentTime.getTime() + milliseconds);
    },
    auditLogs,
    deliveries,
    service,
    store,
    user,
  };
}

test("the exact email reset token updates the password once", async () => {
  const token = "a".repeat(43);
  const fixture = createFixture({ tokenGenerator: () => token });
  const request = await fixture.service.issuePasswordReset(fixture.user);

  assert.equal(fixture.deliveries[0].to, fixture.user.email);
  assert.equal(fixture.deliveries[0].token, token);
  assert.equal(fixture.deliveries[0].expiresAt.getTime(), request.expiresAt.getTime());

  const result = await fixture.service.resetPassword({
    token: fixture.deliveries[0].token,
    passwordHash: "new-password-hash",
  });
  assert.equal(result.status, "reset");
  assert.equal(fixture.user.passwordHash, "new-password-hash");
  assert.ok(fixture.user.passwordChangedAt instanceof Date);
  assert.ok(fixture.auditLogs.every((entry) => !entry.includes(token)));

  const duplicate = await fixture.service.resetPassword({
    token,
    passwordHash: "another-password-hash",
  });
  assert.equal(duplicate.status, "inactive");
  assert.equal(fixture.user.passwordHash, "new-password-hash");
});

test("an expired reset link cannot update the password", async () => {
  const token = "b".repeat(43);
  const fixture = createFixture({ tokenGenerator: () => token });
  await fixture.service.issuePasswordReset(fixture.user);
  fixture.advance((PASSWORD_RESET_TTL_SECONDS + 1) * 1000);

  const result = await fixture.service.resetPassword({
    token,
    passwordHash: "new-password-hash",
  });
  assert.equal(result.status, "expired");
  assert.equal(fixture.user.passwordHash, "old-password-hash");
});

test("a new reset email invalidates the older reset link", async () => {
  const tokens = ["c".repeat(43), "d".repeat(43)];
  const fixture = createFixture({ tokenGenerator: () => tokens.shift() });

  await fixture.service.issuePasswordReset(fixture.user);
  await fixture.service.issuePasswordReset(fixture.user);

  const oldResult = await fixture.service.resetPassword({
    token: "c".repeat(43),
    passwordHash: "old-link-password-hash",
  });
  assert.equal(oldResult.status, "inactive");

  const latestResult = await fixture.service.resetPassword({
    token: "d".repeat(43),
    passwordHash: "latest-link-password-hash",
  });
  assert.equal(latestResult.status, "reset");
  assert.equal(fixture.user.passwordHash, "latest-link-password-hash");
});

test("an invalid token is rejected before it reaches storage", async () => {
  const fixture = createFixture({ tokenGenerator: () => "e".repeat(43) });

  const result = await fixture.service.resetPassword({
    token: "not-a-valid-reset-token",
    passwordHash: "new-password-hash",
  });
  assert.equal(result.status, "invalid");
  assert.equal(fixture.store.requests.size, 0);
});

test("a failed email delivery invalidates the new reset request", async () => {
  const fixture = createFixture({
    tokenGenerator: () => "f".repeat(43),
    deliverResetLink: async () => {
      throw new Error("SMTP unavailable");
    },
  });

  await assert.rejects(
    fixture.service.issuePasswordReset(fixture.user),
    PasswordResetDeliveryError
  );
  const request = Array.from(fixture.store.requests.values())[0];
  assert.ok(request.invalidatedAt instanceof Date);
});
