"use strict";

const bcrypt = require("bcrypt");
const { writeAdminAudit } = require("./adminAudit");

const SECRET_MIN = 8;
const SECRET_MAX = 72;
const BCRYPT_COST = 12;
const STATUSES = new Set(["not_set", "active", "revoked"]);

function httpError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeStatus(value) {
  const status = String(value || "not_set").toLowerCase();
  return STATUSES.has(status) ? status : "not_set";
}

function normalizeLicense(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .toUpperCase();
}

function publicCredential(row = {}) {
  const permission = row.can_approve_cross_branch_access === true;
  const hasHash = Boolean(row.cross_branch_approval_secret_hash || row.has_secret);
  let status = normalizeStatus(row.cross_branch_approval_credential_status);
  if (status === "active" && !hasHash) status = "not_set";
  if (!permission && status === "active") status = "revoked";
  const verifiedLicense = row.license_verified === true ? String(row.license_number || "").trim() : "";
  return {
    canApproveCrossBranchAccess: permission,
    approvalCredentialStatus: status,
    approvalCredentialIdentifier: verifiedLicense || null,
    licenseVerified: row.license_verified === true,
  };
}

function assertSecretShape(secret, licenseNumber) {
  const value = String(secret || "");
  if (value.length < SECRET_MIN || value.length > SECRET_MAX) {
    throw httpError(`Choose an approval PIN or passphrase between ${SECRET_MIN} and ${SECRET_MAX} characters.`, 400);
  }
  const license = normalizeLicense(licenseNumber);
  if (license && normalizeLicense(value) === license) {
    throw httpError("Do not use the PRC license number as the approval credential.", 400);
  }
  return value;
}

function containsSecret(value, secret) {
  if (!secret) return false;
  const haystack = typeof value === "string" ? value : JSON.stringify(value || "");
  return haystack.includes(secret);
}

async function loadProfile(db, userId) {
  try {
    const result = await db.query(
      `SELECT user_id, can_approve_cross_branch_access, license_number, license_verified,
              cross_branch_approval_secret_hash, cross_branch_approval_credential_status
       FROM admin_portal_dentist_profiles
       WHERE user_id = $1
       LIMIT 1`,
      [String(userId)]
    );
    return result.rows[0] || null;
  } catch (error) {
    if (error.code === "42703" || error.code === "42P01") return null;
    throw error;
  }
}

async function publicForUser(db, userId) {
  const row = await loadProfile(db, userId);
  return publicCredential(row || {});
}

async function attachPublic(db, accounts) {
  if (!accounts?.length) return accounts;
  try {
    const result = await db.query(
      `SELECT user_id, can_approve_cross_branch_access, license_number, license_verified,
              cross_branch_approval_credential_status,
              (cross_branch_approval_secret_hash IS NOT NULL AND BTRIM(cross_branch_approval_secret_hash) <> '') AS has_secret
       FROM admin_portal_dentist_profiles
       WHERE user_id = ANY($1::text[])`,
      [accounts.map((account) => String(account.id))]
    );
    const byUser = new Map(result.rows.map((row) => [String(row.user_id), row]));
    for (const account of accounts) {
      Object.assign(account, publicCredential(byUser.get(String(account.id)) || {}));
    }
  } catch (error) {
    if (error.code !== "42703" && error.code !== "42P01") throw error;
    for (const account of accounts) {
      account.canApproveCrossBranchAccess = account.canApproveCrossBranchAccess === true;
      account.approvalCredentialStatus = account.approvalCredentialStatus || "not_set";
      account.approvalCredentialIdentifier = account.approvalCredentialIdentifier || null;
    }
  }
  return accounts;
}

async function auditCredential(db, { actorId, actorName, actorRole, dentistId, action, result = "success" }) {
  await writeAdminAudit(db, {
    actorId,
    actorName: actorName || null,
    actorRole: actorRole || "admin",
    action,
    targetType: "dentist",
    targetId: String(dentistId),
    result,
    detail: `Cross-branch approval credential ${action.replace("record_access_credential_", "")}.`,
  });
}

async function applyAdminAction(db, { dentistId, action, admin }) {
  const allowed = new Set(["enable", "revoke", "start_setup", "reset"]);
  const next = String(action || "").toLowerCase();
  if (!allowed.has(next)) {
    throw httpError("Choose enable, revoke, start setup, or reset.", 400);
  }
  const profile = await loadProfile(db, dentistId);
  if (!profile) {
    throw httpError("Dentist record not found.", 404);
  }

  let permission = profile.can_approve_cross_branch_access === true;
  let status = normalizeStatus(profile.cross_branch_approval_credential_status);
  let clearHash = false;

  if (next === "enable") {
    permission = true;
    if (status === "revoked") status = "not_set";
  } else if (next === "revoke") {
    permission = false;
    status = "revoked";
    clearHash = true;
  } else if (next === "start_setup") {
    permission = true;
    status = "not_set";
    clearHash = true;
  } else if (next === "reset") {
    permission = true;
    status = "not_set";
    clearHash = true;
  }

  await db.query(
    `UPDATE admin_portal_dentist_profiles
     SET can_approve_cross_branch_access = $2,
         cross_branch_approval_credential_status = $3,
         cross_branch_approval_secret_hash = CASE WHEN $4 THEN NULL ELSE cross_branch_approval_secret_hash END,
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1`,
    [String(dentistId), permission, status, clearHash]
  );

  await auditCredential(db, {
    actorId: admin?.id,
    actorName: `${admin?.first_name || admin?.firstName || ""} ${admin?.last_name || admin?.lastName || ""}`.trim(),
    actorRole: "admin",
    dentistId,
    action: `record_access_credential_${next}`,
  });

  return publicForUser(db, dentistId);
}

async function setDentistSecret(db, { dentist, secret, confirmSecret, currentSecret }) {
  const profile = await loadProfile(db, dentist.id);
  if (!profile || profile.can_approve_cross_branch_access !== true) {
    throw httpError("An administrator must enable cross-branch approval before you can set a credential.", 403);
  }
  const status = normalizeStatus(profile.cross_branch_approval_credential_status);
  if (status === "revoked") {
    throw httpError("This approval credential was revoked. Ask an administrator to start setup again.", 403);
  }
  const nextSecret = assertSecretShape(secret, profile.license_number);
  if (nextSecret !== String(confirmSecret || "")) {
    throw httpError("The new approval credential and confirmation do not match.", 400);
  }
  if (status === "active" && profile.cross_branch_approval_secret_hash) {
    const matches = await bcrypt.compare(String(currentSecret || ""), profile.cross_branch_approval_secret_hash);
    if (!matches) {
      throw httpError("Enter your current approval credential to replace it.", 403);
    }
  }

  const hash = await bcrypt.hash(nextSecret, BCRYPT_COST);
  await db.query(
    `UPDATE admin_portal_dentist_profiles
     SET cross_branch_approval_secret_hash = $2,
         cross_branch_approval_credential_status = 'active',
         updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $1`,
    [String(dentist.id), hash]
  );
  await auditCredential(db, {
    actorId: dentist.id,
    actorName: `${dentist.first_name || ""} ${dentist.last_name || ""}`.trim(),
    actorRole: "dentist",
    dentistId: dentist.id,
    action: status === "active" ? "record_access_credential_rotated" : "record_access_credential_set",
  });
  return publicForUser(db, dentist.id);
}

async function verifyDentistSecret(profile, secret) {
  if (!profile || profile.can_approve_cross_branch_access !== true) return false;
  if (normalizeStatus(profile.cross_branch_approval_credential_status) !== "active") return false;
  if (!profile.cross_branch_approval_secret_hash) return false;
  try {
    return await bcrypt.compare(String(secret || ""), profile.cross_branch_approval_secret_hash);
  } catch {
    return false;
  }
}

module.exports = {
  SECRET_MIN,
  publicCredential,
  loadProfile,
  publicForUser,
  attachPublic,
  applyAdminAction,
  setDentistSecret,
  verifyDentistSecret,
  containsSecret,
  assertSecretShape,
};
