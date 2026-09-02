"use strict";

const WEAK_SECRET_VALUES = new Set([
  "your_super_secret_key_here",
  "your_fallback_jwt_secret",
  "secret",
  "jwt_secret",
  "changeme",
  "password",
  "development-only-otp-secret",
  "development-only-password-reset-secret",
]);

function isProductionLike(env = process.env) {
  const nodeEnv = String(env.NODE_ENV || "").toLowerCase();
  return nodeEnv === "production" || env.FORCE_SECURE_SECRETS === "true";
}

function isWeakSecret(value) {
  if (value == null) return true;
  const trimmed = String(value).trim();
  if (!trimmed) return true;
  if (trimmed.length < 16) return true;
  return WEAK_SECRET_VALUES.has(trimmed.toLowerCase());
}

/**
 * Resolve JWT / OTP / password-reset secrets with production-safe rules.
 * Development may use labeled local fallbacks; production must set real env vars.
 */
function resolveAppSecrets(env = process.env) {
  const production = isProductionLike(env);
  const jwtSecret = env.JWT_SECRET;
  const otpSecret = env.OTP_SECRET || env.JWT_SECRET;
  const passwordResetSecret = env.PASSWORD_RESET_SECRET || env.OTP_SECRET || env.JWT_SECRET;

  if (production) {
    if (isWeakSecret(jwtSecret)) {
      throw new Error(
        "JWT_SECRET must be set to a strong secret (16+ characters) in production."
      );
    }
    if (isWeakSecret(otpSecret)) {
      throw new Error(
        "OTP_SECRET must be set to a strong secret (16+ characters) in production."
      );
    }
    if (isWeakSecret(passwordResetSecret)) {
      throw new Error(
        "PASSWORD_RESET_SECRET must be set to a strong secret (16+ characters) in production."
      );
    }
    return {
      jwtSecret: String(jwtSecret).trim(),
      otpSecret: String(otpSecret).trim(),
      passwordResetSecret: String(passwordResetSecret).trim(),
    };
  }

  const resolvedJwt = !isWeakSecret(jwtSecret)
    ? String(jwtSecret).trim()
    : "development-only-jwt-secret-change-me";
  const resolvedOtp = !isWeakSecret(otpSecret)
    ? String(otpSecret).trim()
    : "development-only-otp-secret-change-me";
  const resolvedReset = !isWeakSecret(passwordResetSecret)
    ? String(passwordResetSecret).trim()
    : "development-only-password-reset-secret-change-me";

  if (isWeakSecret(jwtSecret) || isWeakSecret(otpSecret) || isWeakSecret(passwordResetSecret)) {
    console.warn(
      "⚠️ Using development-only auth secrets. Set JWT_SECRET, OTP_SECRET, and PASSWORD_RESET_SECRET before deploying."
    );
  }

  return {
    jwtSecret: resolvedJwt,
    otpSecret: resolvedOtp,
    passwordResetSecret: resolvedReset,
  };
}

function parseAllowedOrigins(env = process.env) {
  const raw = env.CORS_ORIGINS || env.FRONTEND_URL || "";
  const fromEnv = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  if (fromEnv.length) {
    return [...new Set(fromEnv)];
  }

  if (!isProductionLike(env)) {
    return [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ];
  }

  return [];
}

function createCorsOptions(env = process.env) {
  const allowedOrigins = parseAllowedOrigins(env);
  const production = isProductionLike(env);

  return {
    origin(origin, callback) {
      // Non-browser clients (curl, server-to-server, same-origin) often omit Origin.
      if (!origin) {
        return callback(null, true);
      }
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      if (!production && allowedOrigins.length === 0) {
        return callback(null, true);
      }
      return callback(null, false);
    },
    credentials: true,
    allowedOrigins,
  };
}

function applySecurityHeaders(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-XSS-Protection", "0");
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  }
  next();
}

module.exports = {
  WEAK_SECRET_VALUES,
  isProductionLike,
  isWeakSecret,
  resolveAppSecrets,
  parseAllowedOrigins,
  createCorsOptions,
  applySecurityHeaders,
};
