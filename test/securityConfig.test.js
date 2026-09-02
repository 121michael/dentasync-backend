"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");

const {
  isWeakSecret,
  resolveAppSecrets,
  parseAllowedOrigins,
  createCorsOptions,
} = require("../lib/securityConfig");

test("rejects known weak and short secrets", () => {
  assert.equal(isWeakSecret("your_super_secret_key_here"), true);
  assert.equal(isWeakSecret("short"), true);
  assert.equal(isWeakSecret("a-sufficiently-long-production-secret"), false);
});

test("production requires strong JWT, OTP, and password-reset secrets", () => {
  assert.throws(
    () =>
      resolveAppSecrets({
        NODE_ENV: "production",
        JWT_SECRET: "your_super_secret_key_here",
      }),
    /JWT_SECRET/
  );

  const secrets = resolveAppSecrets({
    NODE_ENV: "production",
    JWT_SECRET: "production-jwt-secret-value",
    OTP_SECRET: "production-otp-secret-value",
    PASSWORD_RESET_SECRET: "production-reset-secret-value",
  });

  assert.equal(secrets.jwtSecret, "production-jwt-secret-value");
  assert.equal(secrets.otpSecret, "production-otp-secret-value");
  assert.equal(secrets.passwordResetSecret, "production-reset-secret-value");
});

test("development falls back to labeled local secrets instead of legacy defaults", () => {
  const secrets = resolveAppSecrets({ NODE_ENV: "development" });
  assert.match(secrets.jwtSecret, /development-only-jwt-secret/);
  assert.notEqual(secrets.jwtSecret, "your_super_secret_key_here");
});

test("CORS allowlist uses FRONTEND_URL and CORS_ORIGINS", () => {
  assert.deepEqual(
    parseAllowedOrigins({
      NODE_ENV: "production",
      FRONTEND_URL: "https://clinic.example",
    }),
    ["https://clinic.example"]
  );

  assert.deepEqual(
    parseAllowedOrigins({
      NODE_ENV: "production",
      CORS_ORIGINS: "https://a.example, https://b.example",
    }),
    ["https://a.example", "https://b.example"]
  );

  assert.deepEqual(
    parseAllowedOrigins({
      NODE_ENV: "production",
      FRONTEND_URL: "https://clinic.example/reset-password",
    }),
    ["https://clinic.example"]
  );

  assert.deepEqual(
    parseAllowedOrigins({
      NODE_ENV: "production",
      FRONTEND_URL: "https://clinic.example/",
    }),
    ["https://clinic.example"]
  );

  const options = createCorsOptions({
    NODE_ENV: "production",
    FRONTEND_URL: "https://clinic.example",
  });

  let allowed;
  options.origin("https://clinic.example", (_err, value) => {
    allowed = value;
  });
  assert.equal(allowed, true);

  options.origin("https://evil.example", (_err, value) => {
    allowed = value;
  });
  assert.equal(allowed, false);

  assert.throws(
    () =>
      createCorsOptions({
        NODE_ENV: "production",
      }),
    /FRONTEND_URL|CORS_ORIGINS/
  );
});
