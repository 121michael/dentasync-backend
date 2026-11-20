import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "AdminManageUsersPage.jsx"), "utf8");

test("Set Credential shows a fixed mask and verifies the Admin login password", () => {
  assert.match(page, /CREDENTIAL_MASK = "••••••••"/);
  assert.match(page, /Credential set\./);
  assert.match(page, /Verify administrator/);
  assert.match(page, /verifyAdminDentistAuthorizationCredential/);
  assert.match(page, /revealAdminDentistAuthorizationCredential/);
  assert.match(page, /Reset this credential to enable viewing/);
  assert.doesNotMatch(page, /localStorage\.setItem\(["'][^"']*unlock/);
  assert.match(page, /data-credential-mask="true"/);
});
