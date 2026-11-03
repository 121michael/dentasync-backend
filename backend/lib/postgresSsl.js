"use strict";

function postgresSslConfig(env = process.env) {
  const mode = String(env.DATABASE_SSL || env.PGSSLMODE || "").toLowerCase();
  if (mode === "disable" || mode === "false") {
    return undefined;
  }
  if (mode === "no-verify") {
    return { rejectUnauthorized: false };
  }
  const production = String(env.NODE_ENV || "").toLowerCase() === "production";
  if (mode === "require" || mode === "true" || mode === "verify-full" || production) {
    return {
      rejectUnauthorized: String(env.DATABASE_SSL_REJECT_UNAUTHORIZED || "") !== "false",
    };
  }
  return undefined;
}

module.exports = { postgresSslConfig };
