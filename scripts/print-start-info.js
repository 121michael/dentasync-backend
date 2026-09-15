"use strict";

/**
 * First step of `npm start`. Writes a log file so we can tell whether npm
 * actually invoked Node on Windows (where the console can look blank).
 */
const fs = require("node:fs");
const path = require("node:path");

const logPath = path.join(__dirname, "..", "dentasync-start.log");
const lines = [
  `time=${new Date().toISOString()}`,
  `node=${process.version}`,
  `cwd=${process.cwd()}`,
  `NODE_ENV=${process.env.NODE_ENV || ""}`,
  `npm_lifecycle_event=${process.env.npm_lifecycle_event || ""}`,
  `platform=${process.platform}`,
  "",
];

try {
  fs.writeFileSync(logPath, lines.join("\n"), "utf8");
} catch (err) {
  console.error("[DentaSync] could not write dentasync-start.log:", err.message);
}

console.log("[DentaSync] start script reached Node", process.version);
console.log("[DentaSync] wrote", logPath);
