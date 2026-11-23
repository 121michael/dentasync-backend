"use strict";

const crypto = require("crypto");
const { isProductionLike, isWeakSecret } = require("../lib/securityConfig");

const ENVELOPE_PREFIX = "dscred1";
const SCRYPT_SALT = "dentasync-dentist-credential-v1";
const CURRENT_KEY_ID_DEFAULT = "v1";
const PREVIOUS_KEY_ID_DEFAULT = "v0";
const DEV_FALLBACK_KEY = "development-only-dentist-credential-key";
let warnedDevelopmentKey = false;
const KEY_UNAVAILABLE_MESSAGE =
  "Authorization credential encryption is not configured. Set DENTIST_CREDENTIAL_ENCRYPTION_KEY.";

function httpError(message, status, extra = {}) {
  const error = new Error(message);
  error.status = status;
  Object.assign(error, extra);
  return error;
}

function readKey(env, name) {
  const value = String(env[name] || "").trim();
  return value || "";
}

function deriveKey(material) {
  return crypto.scryptSync(material, SCRYPT_SALT, 32);
}

function resolveCredentialEncryption(env = process.env) {
  const production = isProductionLike(env);
  const currentMaterial = readKey(env, "DENTIST_CREDENTIAL_ENCRYPTION_KEY");
  const previousMaterial = readKey(env, "DENTIST_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS");
  const currentId = readKey(env, "DENTIST_CREDENTIAL_ENCRYPTION_KEY_ID") || CURRENT_KEY_ID_DEFAULT;
  const previousId = readKey(env, "DENTIST_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID") || PREVIOUS_KEY_ID_DEFAULT;

  let material = currentMaterial;
  let warned = false;
  if (!material || isWeakSecret(material)) {
    if (production) {
      return { available: false, currentId, keys: new Map(), warned: false, code: "ENCRYPTION_UNAVAILABLE" };
    }
    material = DEV_FALLBACK_KEY;
    warned = true;
  }

  const keys = new Map();
  keys.set(currentId, deriveKey(material));
  if (previousMaterial && !isWeakSecret(previousMaterial)) {
    keys.set(previousId, deriveKey(previousMaterial));
  }

  return {
    available: true,
    currentId,
    keys,
    warned,
  };
}

function requireCredentialEncryption(env = process.env) {
  const resolved = resolveCredentialEncryption(env);
  if (!resolved.available) {
    throw httpError(KEY_UNAVAILABLE_MESSAGE, 503, { code: "ENCRYPTION_UNAVAILABLE" });
  }
  if (resolved.warned && !warnedDevelopmentKey) {
    warnedDevelopmentKey = true;
    console.warn(
      "⚠️ Using a development-only dentist credential encryption key. Set DENTIST_CREDENTIAL_ENCRYPTION_KEY before deploying."
    );
  }
  return resolved;
}

function encryptAuthorizationPassword(plain, env = process.env) {
  const text = String(plain || "");
  if (!text) {
    throw httpError("Authorization password is required.", 400);
  }
  const { currentId, keys } = requireCredentialEncryption(env);
  const key = keys.get(currentId);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    keyId: currentId,
    ciphertext: [ENVELOPE_PREFIX, currentId, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join("."),
  };
}

function decryptAuthorizationPassword(envelope, env = process.env) {
  const text = String(envelope || "").trim();
  if (!text) return null;
  const { keys } = requireCredentialEncryption(env);
  const parts = text.split(".");
  if (parts.length !== 5 || parts[0] !== ENVELOPE_PREFIX) {
    throw httpError("The stored credential copy is not readable. Reset this credential to enable viewing.", 409);
  }
  const keyId = parts[1];
  const key = keys.get(keyId);
  if (!key) {
    throw httpError("The stored credential copy was encrypted with an unavailable key. Rotate back the previous key or reset this credential.", 503);
  }
  try {
    const iv = Buffer.from(parts[2], "base64url");
    const tag = Buffer.from(parts[3], "base64url");
    const encrypted = Buffer.from(parts[4], "base64url");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch {
    throw httpError("The stored credential copy is not readable. Reset this credential to enable viewing.", 409);
  }
}

module.exports = {
  KEY_UNAVAILABLE_MESSAGE,
  resolveCredentialEncryption,
  requireCredentialEncryption,
  encryptAuthorizationPassword,
  decryptAuthorizationPassword,
};
