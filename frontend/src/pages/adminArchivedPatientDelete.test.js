import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "AdminArchivedPage.jsx"), "utf8");

test("Archived patient delete confirms the selected account and waits for the server", () => {
  assert.match(page, /Permanently delete account/);
  assert.match(page, /Clinical treatment history stays in clinic records/);
  assert.match(page, /permanentlyDeleteAdminArchived\(user\.id\)/);
  assert.match(page, /if \(actionBusyId\) return/);
  assert.match(page, /disabled=\{Boolean\(actionBusyId\)\}/);
  assert.match(page, /Patient ID/);
  assert.match(page, /archiveRole === "patient"/);
});
