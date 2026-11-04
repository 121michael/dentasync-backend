"use strict";

function isMissingPasswordChangedAtColumn(error) {
  return error?.code === "42703" && /password_changed_at/i.test(String(error.message || ""));
}

function schemaPasswordChangedAtError() {
  const error = new Error("Session revocation schema is missing. Run npm run migrate:password-reset.");
  error.status = 503;
  error.code = "SCHEMA_PASSWORD_CHANGED_AT";
  return error;
}

function passwordChangedAtSeconds(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function passwordVersion(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return String(ms);
}

function accessTokenPayload({ id, role, passwordChangedAt = null, actAsUserId = null } = {}) {
  const payload = { id, role };
  const pwdv = passwordVersion(passwordChangedAt);
  if (pwdv) payload.pwdv = pwdv;
  if (actAsUserId) payload.actAsUserId = String(actAsUserId);
  return payload;
}

function isTokenRevokedByPasswordChange(decoded, passwordChangedAt) {
  const version = passwordVersion(passwordChangedAt);
  if (version == null) {
    return false;
  }
  if (decoded?.pwdv != null) {
    return String(decoded.pwdv) !== version;
  }
  if (decoded?.iat == null) {
    return true;
  }
  return Number(decoded.iat) * 1000 <= Number(version);
}

async function updatePasswordHash(db, { userId, passwordHash, whereSql = "", whereParams = [] }) {
  const id = String(userId);
  const params = [passwordHash, id, ...whereParams];
  try {
    return await db.query(
      `UPDATE users
       SET password_hash = $1,
           password_changed_at = CURRENT_TIMESTAMP
       WHERE id::text = $2
         ${whereSql}
       RETURNING id, password_changed_at`,
      params
    );
  } catch (error) {
    if (isMissingPasswordChangedAtColumn(error)) {
      throw schemaPasswordChangedAtError();
    }
    throw error;
  }
}

module.exports = {
  accessTokenPayload,
  isMissingPasswordChangedAtColumn,
  isTokenRevokedByPasswordChange,
  passwordChangedAtSeconds,
  passwordVersion,
  schemaPasswordChangedAtError,
  updatePasswordHash,
};
