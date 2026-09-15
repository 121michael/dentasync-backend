"use strict";

/**
 * Local Windows-friendly entry for `npm start`.
 * Spawns server.js so require.main === module and the HTTP listener starts.
 * Forces NODE_ENV=development unless strong production secrets are already set
 * with an explicit DENTASYNC_PRODUCTION=true (or real host NODE_ENV=production
 * + strong secrets — handled inside server normalizeLocalNpmStartEnv).
 */
const { spawn } = require("node:child_process");
const path = require("node:path");

// Prefer development for the default npm start script used on local machines.
// Production hosts should set strong JWT_SECRET / OTP_SECRET / PASSWORD_RESET_SECRET;
// server.js will keep NODE_ENV=production when those are strong.
if (!process.env.DENTASYNC_PRODUCTION && process.env.NODE_ENV === "production") {
  // Leave NODE_ENV as-is; server.js normalizes weak-secret production boots.
  // Also clear the common Windows npm override when secrets are absent by
  // setting development early so even pre-listen requires succeed.
  const jwt = String(process.env.JWT_SECRET || "").trim();
  const weakPlaceholders = new Set([
    "",
    "your_super_secret_key_here",
    "your_fallback_jwt_secret",
    "secret",
    "jwt_secret",
    "changeme",
    "password",
  ]);
  if (!jwt || jwt.length < 16 || weakPlaceholders.has(jwt.toLowerCase())) {
    process.env.NODE_ENV = "development";
  }
}

const serverPath = path.join(__dirname, "..", "server.js");
const child = spawn(process.execPath, [serverPath], {
  stdio: "inherit",
  env: process.env,
  windowsHide: true,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code == null ? 1 : code);
});
