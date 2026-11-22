import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const page = fs.readFileSync(path.join(root, "pages", "AdminManageUsersPage.jsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "pages", "AdminDashboardPage.jsx"), "utf8");

test("Patient Accounts splits pending approval from approved with URL-backed counts", () => {
  assert.match(page, /Pending Approval/);
  assert.match(page, /label: "Approved"/);
  assert.match(page, /patientAccountFilter/);
  assert.match(page, /status: tab === "patient" \? patientFilter : undefined/);
  assert.match(page, /tabCounts\.pending/);
  assert.match(page, /tabCounts\.approved/);
  assert.match(page, /next\.set\("filter", "pending"\)/);
  assert.match(page, /No patients awaiting approval/);
  assert.match(page, /OTP or email verification is not Admin approval/);
  assert.doesNotMatch(page, /Pending Patient Registration Requests/);
});

test("pending accounts use Admin status, not OTP verification", () => {
  assert.match(page, /status === "pending" \|\| status === "unverified"/);
  assert.doesNotMatch(page, /!user\?\.verified \|\| status === "pending"/);
  assert.match(dashboard, /\/admin\/users\?tab=patient&filter=pending/);
  assert.match(dashboard, /Patients waiting for Admin approval/);
});

test("patient account tabs wrap at 320px and 390px and clear the floating Menu", () => {
  assert.match(page, /admin-page--patient-accounts ops-dashboard-clearance/);
  assert.match(page, /admin-account-cards/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.admin-table-wrap--desktop \{ display: none; \}/);
  assert.match(css, /@media \(max-width: 390px\) \{[\s\S]*\.admin-page--patient-accounts \.admin-search/);
  assert.match(css, /@media \(max-width: 320px\) \{[\s\S]*\.admin-page--patient-accounts \.admin-row-actions \.button \{[\s\S]*flex: 1 1 100%/);
  assert.match(css, /\.admin-page--users \.admin-tabs \{[\s\S]*align-items: center;/);
  assert.match(css, /@media \(max-width: 980px\) \{[\s\S]*\.ops-dashboard-clearance \{[\s\S]*padding-bottom: calc\(7\.5rem/);
});
