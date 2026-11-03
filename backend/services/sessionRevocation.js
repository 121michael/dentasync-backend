"use strict";

function passwordChangedAtSeconds(value) {
  if (!value) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 1000);
}

function isTokenRevokedByPasswordChange(decoded, passwordChangedAt) {
  const changedAt = passwordChangedAtSeconds(passwordChangedAt);
  if (changedAt == null || decoded?.iat == null) {
    return false;
  }
  return Number(decoded.iat) < changedAt;
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
         ${whereSql}`,
      params
    );
  } catch (error) {
    if (error?.code !== "42703") throw error;
    return db.query(
      `UPDATE users
       SET password_hash = $1
       WHERE id::text = $2
         ${whereSql}`,
      params
    );
  }
}

module.exports = {
  isTokenRevokedByPasswordChange,
  passwordChangedAtSeconds,
  updatePasswordHash,
};
