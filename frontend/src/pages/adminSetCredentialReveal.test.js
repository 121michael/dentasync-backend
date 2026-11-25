import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "AdminManageUsersPage.jsx"), "utf8");

test("Set Credential shows a fixed mask and verifies the Admin login password", () => {
  assert.match(page, /CREDENTIAL_MASK = "••••••••"/);
  assert.match(page, /Credential set/);
  assert.match(page, /Authorization Credential/);
  assert.match(page, /Not set/);
  assert.match(page, /getAdminDentistAuthorizationCredential/);
  assert.match(page, /Verify administrator/);
  assert.match(page, /verifyAdminDentistAuthorizationCredential/);
  assert.match(page, /revealAdminDentistAuthorizationCredential/);
  assert.match(page, /Reset this credential to enable viewing/);
  assert.doesNotMatch(page, /localStorage\.setItem\(["'][^"']*unlock/);
  assert.match(page, /data-credential-mask="true"/);
  assert.match(page, /revealedPassword \|\| CREDENTIAL_MASK/);
  assert.match(page, /Save dentist details/);
  assert.match(page, /Save credential/);
  assert.match(page, /Setup required/);
  assert.match(page, /Credential saving is temporarily unavailable/);
  assert.match(page, /migrate:record-access/);
  assert.match(page, /encryptionAvailable/);
  assert.match(page, /credentialSaveReady/);
  assert.match(page, /credentialSecretSchemaReady/);
  assert.match(page, /admin-form--manage-user__body/);
  assert.match(page, /type="button"[\s\S]*admin-set-credential__toggle/);
  assert.doesNotMatch(page, /setAdminDentistAuthorizationCredential\(editing\.id[\s\S]{0,80}updater\(/);
  assert.match(page, /authorizationPassword/);
  assert.match(page, /authorizationConfirmPassword/);
  assert.match(page, /typedPassword === CREDENTIAL_MASK/);
});
