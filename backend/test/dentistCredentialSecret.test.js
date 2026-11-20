"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  encryptAuthorizationPassword,
  decryptAuthorizationPassword,
  resolveCredentialEncryption,
  KEY_UNAVAILABLE_MESSAGE,
} = require("../services/dentistCredentialSecret");

test("AES-GCM round-trip keeps the calendar password and refuses production without a key", () => {
  const env = {
    DENTIST_CREDENTIAL_ENCRYPTION_KEY: "synthetic-dentist-credential-key",
    DENTIST_CREDENTIAL_ENCRYPTION_KEY_ID: "v1",
  };
  const envelope = encryptAuthorizationPassword("DelegateAuth1234", env);
  assert.equal(envelope.keyId, "v1");
  assert.match(envelope.ciphertext, /^dscred1\.v1\./);
  assert.equal(decryptAuthorizationPassword(envelope.ciphertext, env), "DelegateAuth1234");
  assert.notEqual(envelope.ciphertext, "DelegateAuth1234");

  const rotated = {
    ...env,
    DENTIST_CREDENTIAL_ENCRYPTION_KEY: "synthetic-dentist-credential-key-v2",
    DENTIST_CREDENTIAL_ENCRYPTION_KEY_ID: "v2",
    DENTIST_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS: "synthetic-dentist-credential-key",
    DENTIST_CREDENTIAL_ENCRYPTION_KEY_PREVIOUS_ID: "v1",
  };
  assert.equal(decryptAuthorizationPassword(envelope.ciphertext, rotated), "DelegateAuth1234");
  const next = encryptAuthorizationPassword("DelegateAuth1234", rotated);
  assert.equal(next.keyId, "v2");

  const production = resolveCredentialEncryption({ NODE_ENV: "production" });
  assert.equal(production.available, false);
  assert.throws(
    () => encryptAuthorizationPassword("DelegateAuth1234", { NODE_ENV: "production" }),
    (error) => error.status === 503 && error.message === KEY_UNAVAILABLE_MESSAGE
  );
});
