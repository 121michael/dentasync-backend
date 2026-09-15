"use strict";

/**
 * Local entry used by `npm start`.
 * Must NOT spawn a hidden child process on Windows — that can exit instantly
 * with no visible output. Set a safe local env, then hand off to server.js
 * via process.argv / runMain pattern by re-requiring after env fix is wrong
 * for require.main. Instead: set env and execFileSync is blocking — use
 * child_process.spawnSync with stdio inherit and windowsHide:false, OR
 * simply tell package.json to run node server.js.
 *
 * Kept as a thin diagnostic wrapper that always prints, then runs server
 * in-process by loading it after patching require.main behavior.
 */

console.log("[DentaSync] npm start wrapper OK");
console.log("[DentaSync] node", process.version);
console.log("[DentaSync] cwd", process.cwd());

// Always local-dev for npm start unless operator opts into production.
if (process.env.DENTASYNC_PRODUCTION !== "true") {
  process.env.NODE_ENV = "development";
  console.log("[DentaSync] NODE_ENV=development");
}

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const serverPath = path.join(__dirname, "..", "server.js");
const result = spawnSync(process.execPath, [serverPath], {
  stdio: "inherit",
  env: process.env,
  windowsHide: false,
});

if (result.error) {
  console.error("[DentaSync] failed to start server.js:", result.error);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
