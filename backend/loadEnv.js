"use strict";

const path = require("node:path");
const dotenv = require("dotenv");

let loaded = false;

function envPath(relativeToBackend) {
  return path.join(__dirname, relativeToBackend);
}

/**
 * Load backend/.env first. If that file is empty or missing DB_USER,
 * also try the repo-root .env (the location used before the folder split).
 */
function loadEnv() {
  if (loaded) return;
  loaded = true;

  const backendEnv = envPath(".env");
  const rootEnv = envPath(path.join("..", ".env"));

  dotenv.config({ path: backendEnv });

  if (!String(process.env.DB_USER || "").trim()) {
    dotenv.config({ path: rootEnv, override: false });
  }
}

module.exports = { loadEnv, envPath };
