"use strict";

const crypto = require("crypto");

function isHostedProduction(env = process.env) {
  return (
    env.NODE_ENV === "production" || String(env.RENDER || "").toLowerCase() === "true"
  );
}

function shouldTrustProxy(env = process.env) {
  const explicit = String(env.TRUST_PROXY || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(explicit)) {
    return false;
  }
  if (["1", "true", "yes", "on"].includes(explicit)) {
    return true;
  }
  return isHostedProduction(env);
}

function trustedProxyHops(env = process.env) {
  const hops = Number(env.TRUST_PROXY_HOPS);
  return Number.isInteger(hops) && hops >= 1 ? hops : 1;
}

function applyTrustedProxy(app, env = process.env) {
  if (shouldTrustProxy(env)) {
    // Trust only the immediate Render proxy hop so req.ip is the client IP
    // from X-Forwarded-For, not an attacker-supplied left-most address.
    app.set("trust proxy", trustedProxyHops(env));
  }
}

function secretsMatch(provided, expected) {
  if (!provided || !expected) {
    return false;
  }
  const left = Buffer.from(String(provided));
  const right = Buffer.from(String(expected));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function isOtpMailTestAllowed(req, env = process.env) {
  if (String(req.query?.sendTest || "") !== "1") {
    return false;
  }
  if (!isHostedProduction(env)) {
    return true;
  }

  const expected = String(env.OTP_MAIL_STATUS_SECRET || "").trim();
  if (!expected) {
    return false;
  }

  const provided = String(
    req.get?.("x-otp-mail-status-secret") || req.headers?.["x-otp-mail-status-secret"] || ""
  ).trim();
  return secretsMatch(provided, expected);
}

module.exports = {
  applyTrustedProxy,
  isHostedProduction,
  isOtpMailTestAllowed,
  shouldTrustProxy,
  trustedProxyHops,
};
