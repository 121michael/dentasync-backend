"use strict";

const crypto = require("crypto");

const OTP_LENGTH = 6;
const OTP_TTL_SECONDS = 5 * 60;
const MAX_OTP_GENERATION_ATTEMPTS = 5;
const OTP_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class OtpDeliveryError extends Error {
  constructor() {
    super("The verification code could not be delivered.");
    this.name = "OtpDeliveryError";
  }
}

function generateOtp(randomInt = crypto.randomInt) {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

function normalizeOtp(value) {
  if (typeof value !== "string") {
    return null;
  }

  const otp = value.trim();
  return new RegExp(`^\\d{${OTP_LENGTH}}$`).test(otp) ? otp : null;
}

function isOtpRequestId(value) {
  return typeof value === "string" && OTP_REQUEST_ID_PATTERN.test(value);
}

function hashOtp(otp, secret) {
  return crypto.createHmac("sha256", secret).update(otp, "utf8").digest("hex");
}

function hashesMatch(left, right) {
  const leftBuffer = Buffer.from(left || "", "utf8");
  const rightBuffer = Buffer.from(right || "", "utf8");

  return (
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function accountFingerprint(user) {
  const identifier = `${user.id}:${user.email || ""}`;
  return crypto.createHash("sha256").update(identifier).digest("hex").slice(0, 12);
}

function asIsoTimestamp(value) {
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? null : timestamp.toISOString();
}

function writeAuditLog(logger, event, details) {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...details,
  };

  // Never include the OTP itself in audit logs.
  logger.info?.(`[otp] ${JSON.stringify(payload)}`);
}

function createOtpService({
  store,
  deliverOtp,
  otpSecret,
  logger = console,
  codeGenerator = generateOtp,
  ttlSeconds = OTP_TTL_SECONDS,
}) {
  if (
    !store ||
    typeof store.withIssuanceLock !== "function" ||
    typeof store.consume !== "function" ||
    typeof store.findActiveRequestIdByPhone !== "function"
  ) {
    throw new Error("An OTP store with issuance and consumption support is required.");
  }

  if (typeof deliverOtp !== "function") {
    throw new Error("An OTP delivery function is required.");
  }

  if (!otpSecret) {
    throw new Error("OTP_SECRET must be configured.");
  }

  async function issueOtp(user) {
    const requestId = crypto.randomUUID();

    return store.withIssuanceLock(
      user.id,
      async ({ getActiveOtpHash, createRequest, invalidateRequest }) => {
        const activeOtpHash = await getActiveOtpHash();
        let otp;
        let otpHash;

        for (let attempt = 0; attempt < MAX_OTP_GENERATION_ATTEMPTS; attempt += 1) {
          const candidate = normalizeOtp(codeGenerator());
          if (!candidate) {
            throw new Error("OTP generator returned an invalid code.");
          }

          const candidateHash = hashOtp(candidate, otpSecret);
          if (!activeOtpHash || !hashesMatch(candidateHash, activeOtpHash)) {
            otp = candidate;
            otpHash = candidateHash;
            break;
          }
        }

        if (!otp || !otpHash) {
          throw new Error("Unable to generate a new OTP distinct from the active request.");
        }

        const request = await createRequest({
          requestId,
          user,
          otpHash,
          ttlSeconds,
        });

        const auditContext = {
          requestId,
          account: accountFingerprint(user),
          createdAt: asIsoTimestamp(request.createdAt),
          expiresAt: asIsoTimestamp(request.expiresAt),
        };

        writeAuditLog(logger, "otp.request_created", auditContext);

        try {
          // The same string is both hashed above and sent here; it is never regenerated.
          await deliverOtp({
            to: user.email,
            otp,
            requestId,
            expiresAt: request.expiresAt,
          });
        } catch {
          await invalidateRequest(requestId);
          writeAuditLog(logger, "otp.delivery_failed", auditContext);
          throw new OtpDeliveryError();
        }

        writeAuditLog(logger, "otp.delivery_succeeded", auditContext);

        return {
          requestId,
          expiresAt: request.expiresAt,
        };
      }
    );
  }

  async function verifyOtp({ requestId, otp }) {
    const normalizedOtp = normalizeOtp(otp);
    if (!normalizedOtp) {
      return { status: "invalid_format" };
    }

    const result = await store.consume({
      requestId,
      otpHash: hashOtp(normalizedOtp, otpSecret),
    });

    writeAuditLog(logger, "otp.verification_attempt", {
      requestId,
      account: result.user ? accountFingerprint(result.user) : null,
      createdAt: asIsoTimestamp(result.createdAt),
      expiresAt: asIsoTimestamp(result.expiresAt),
      verificationAt: new Date().toISOString(),
      recordFound: result.status !== "not_found",
      expired: result.status === "expired" || result.status === "invalid_expiration",
      submittedOtpMatched: result.status === "verified",
      outcome: result.status,
    });

    return result;
  }

  async function findActiveRequestIdByPhone(phone) {
    return store.findActiveRequestIdByPhone(phone);
  }

  return {
    findActiveRequestIdByPhone,
    issueOtp,
    verifyOtp,
  };
}

module.exports = {
  OTP_LENGTH,
  OTP_TTL_SECONDS,
  OtpDeliveryError,
  createOtpService,
  generateOtp,
  hashOtp,
  isOtpRequestId,
  normalizeOtp,
};
