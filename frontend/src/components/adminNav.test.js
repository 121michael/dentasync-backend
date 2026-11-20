import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, "..");

test("Admin sidebar and mobile menu omit Authorize Record Access while the route remains", () => {
  const layout = fs.readFileSync(path.join(here, "AdminLayout.jsx"), "utf8");
  assert.doesNotMatch(layout, /Authorize Record Access/);
  assert.doesNotMatch(layout, /\/record-access\/authorize/);

  const app = fs.readFileSync(path.join(src, "App.jsx"), "utf8");
  assert.match(app, /path="\/record-access\/authorize"/);
  assert.match(app, /RecordAccessAuthorizePage/);

  const page = fs.readFileSync(path.join(src, "pages", "RecordAccessAuthorizePage.jsx"), "utf8");
  assert.match(page, /export function RecordAccessAuthorizePage/);
  assert.match(page, /getRecordAccessApprover/);
  assert.match(page, /approveRecordAccessChallenge/);
  assert.match(page, /authorizationPassword/);
  assert.match(page, /Setup required/);

  const manage = fs.readFileSync(path.join(src, "pages", "AdminManageUsersPage.jsx"), "utf8");
  assert.match(manage, /Set Credential/);
  assert.match(manage, /Credential set/);
  assert.match(manage, /Reset credential/);
  assert.match(manage, /Revoke credential/);
  assert.match(manage, /Verify administrator/);
  assert.match(manage, /CREDENTIAL_MASK/);
  assert.doesNotMatch(manage, /Can Authorize Cross-Branch Record Access/);
  assert.doesNotMatch(manage, /localStorage\.setItem\(["']credential/);
});
