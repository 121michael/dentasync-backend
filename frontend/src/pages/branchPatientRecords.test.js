import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

test("patient record screens clear cached rows when the assigned branch changes", () => {
  const staff = fs.readFileSync(path.join(root, "pages", "StaffPatientsPage.jsx"), "utf8");
  const dentist = fs.readFileSync(path.join(root, "pages", "DentistRecordsPage.jsx"), "utf8");
  const layout = fs.readFileSync(path.join(root, "components", "DentistLayout.jsx"), "utf8");
  assert.match(layout, /dentasync-branch-change/);
  assert.match(staff, /dentasync-branch-change/);
  assert.match(dentist, /dentasync-branch-change/);
  assert.match(dentist, /navigate\("\/dentist\/patient-records"\)/);
});
