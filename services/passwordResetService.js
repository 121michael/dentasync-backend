"use strict";

const crypto = require("crypto");

const PASSWORD_RESET_TTL_SECONDS = 30 * 60;
const PASSWORD_RESET_TOKEN_BYTES = 32;
const PASSWORD_RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;

class PasswordResetDeliveryError extends Error {
  constructor() {
    super("The password reset email could not be delivered.");
    this.name = "PasswordResetDeliveryError";
  }
}

function generatePasswordResetToken(randomBytes = crypto.randomBytes) {
  return randomBytes(PASSWORD_RESET_TOKEN_BYTES).toString("base64url");
}

function normalizePasswordResetToken(value) {
  if (typeof value !== "string") {
    return null;
  }

  const token = value.trim();
  return PASSWORD_RESET_TOKEN_PATTERN.test(token) ? token : null;
}

function hashPasswordResetToken(token, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update("password-reset:", "utf8")
    .update(token, "utf8")
    .digest("hex");
}

function accountFingerprint(user) {
  return crypto
    .createHash("sha256")
    .update(`${user.id}:${user.email || ""}`)
    .digest("hex")
    .slice(0, 12);
}

function asIsoTimestamp(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function writeAuditLog(logger, event, details) {
  logger.info?.(
    `[password-reset] ${JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      ...details,
    })}`
  );
}

function createPasswordResetService({
  store,
  deliverResetLink,
  passwordResetSecret,
  logger = console,
  tokenGenerator = generatePasswordResetToken,
  ttlSeconds = PASSWORD_RESET_TTL_SECONDS,
}) {
  if (
    !store ||
    typeof store.withIssuanceLock !== "function" ||
    typeof store.consumeAndReset !== "function"
  ) {
    throw new Error("A password reset store with issuance and reset support is required.");
  }
  if (typeof deliverResetLink !== "function") {
    throw new Error("A password reset delivery function is required.");
  }
  if (!passwordResetSecret) {
    throw new Error("PASSWORD_RESET_SECRET must be configured.");
  }

  async function issuePasswordReset(user) {
    const token = normalizePasswordResetToken(tokenGenerator());
    if (!token) {
      throw new Error("Password reset token generator returned an invalid token.");
    }

    const requestId = crypto.randomUUID();
    const tokenHash = hashPasswordResetToken(token, passwordResetSecret);

    return store.withIssuanceLock(user.id, async ({ createRequest, invalidateRequest }) => {
      const request = await createRequest({
        requestId,
        user,
        tokenHash,
        ttlSeconds,
      });
      const auditContext = {
        requestId,
        account: accountFingerprint(user),
        createdAt: asIsoTimestamp(request.createdAt),
        expiresAt: asIsoTimestamp(request.expiresAt),
      };

      writeAuditLog(logger, "password_reset.request_created", auditContext);

      try {
        await deliverResetLink({
          to: user.email,
          token,
          expiresAt: request.expiresAt,
        });
      } catch {
        await invalidateRequest(requestId);
        writeAuditLog(logger, "password_reset.delivery_failed", auditContext);
        throw new PasswordResetDeliveryError();
      }

      writeAuditLog(logger, "password_reset.delivery_succeeded", auditContext);
      return {
        requestId,
        expiresAt: request.expiresAt,
      };
    });
  }

  async function resetPassword({ token, passwordHash }) {
    const normalizedToken = normalizePasswordResetToken(token);
    if (!normalizedToken || typeof passwordHash !== "string" || !passwordHash) {
      return { status: "invalid" };
    }

    const result = await store.consumeAndReset({
      tokenHash: hashPasswordResetToken(normalizedToken, passwordResetSecret),
      passwordHash,
    });

    writeAuditLog(logger, "password_reset.attempt", {
      requestId: result.requestId || null,
      account: result.user ? accountFingerprint(result.user) : null,
      createdAt: asIsoTimestamp(result.createdAt),
      expiresAt: asIsoTimestamp(result.expiresAt),
      resetAt: new Date().toISOString(),
      recordFound: result.status !== "not_found",
      expired: result.status === "expired" || result.status === "invalid_expiration",
      outcome: result.status,
    });

    return result;
  }

  return {
    issuePasswordReset,
    resetPassword,
  };
}

module.exports = {
  PASSWORD_RESET_TOKEN_BYTES,
  PASSWORD_RESET_TTL_SECONDS,
  PasswordResetDeliveryError,
  createPasswordResetService,
  generatePasswordResetToken,
  hashPasswordResetToken,
  normalizePasswordResetToken,
};
