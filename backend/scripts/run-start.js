"use strict";

/**
 * Cross-platform `npm start` entry.
 * Avoids Windows issues with:
 * - nested quotes in package.json scripts
 * - `&&` under Windows PowerShell 5.1 as npm script-shell
 * - hidden child processes (windowsHide must stay false)
 */
require("./print-start-info.js");

if (process.env.DENTASYNC_PRODUCTION !== "true") {
  process.env.NODE_ENV = "development";
  console.log("[DentaSync] NODE_ENV forced to development for local start");
}

const path = require("node:path");
const { spawnSync } = require("node:child_process");

const serverPath = path.join(__dirname, "..", "server.js");
console.log("[DentaSync] launching", serverPath);

const result = spawnSync(process.execPath, [serverPath], {
  stdio: "inherit",
  env: process.env,
  windowsHide: false,
});

if (result.error) {
  console.error("[DentaSync] FATAL: could not launch server.js");
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status == null ? 1 : result.status);
