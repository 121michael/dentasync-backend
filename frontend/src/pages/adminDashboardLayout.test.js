import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const page = fs.readFileSync(path.join(root, "pages", "AdminDashboardPage.jsx"), "utf8");
const layout = fs.readFileSync(path.join(root, "components", "AdminLayout.jsx"), "utf8");

test("welcome heading and actions stay inside the welcome card", () => {
  assert.match(page, /className="admin-page admin-dashboard-page ops-dashboard-clearance"/);
  assert.match(page, /Welcome Back, Administrator/);
  assert.match(page, /Audit Accounts/);
  assert.match(page, /View General Analytics/);
  assert.match(page, /> Refresh/);
  assert.match(page, /admin-welcome-card__actions/);
});

test("dashboard cards keep existing metrics and desktop sidebar navigation", () => {
  assert.match(page, /Total Registered Users/);
  assert.match(page, /Booked Today/);
  assert.match(page, /Checked In/);
  assert.match(page, /Waiting/);
  assert.match(page, /In Treatment/);
  assert.match(page, /No-show/);
  assert.match(page, /Pending HMO Verification/);
  assert.match(page, /Dentist Availability/);
  assert.match(page, /metrics\.archivedRecords/);
  assert.match(layout, /className=\{`admin-shell/);
  assert.match(layout, /admin-sidebar/);
  assert.match(layout, /FloatingCircleMenu/);
  assert.match(css, /@media \(min-width: 981px\) \{[\s\S]*\.role-bottom-dock/);
});

test("phone layout wraps welcome actions, uses two columns then one, and clears the Menu button", () => {
  assert.match(css, /\.admin-welcome-card__actions \{ display: flex; flex-wrap: wrap;/);
  assert.match(
    css,
    /@media \(max-width: 430px\) \{[\s\S]*\.admin-dashboard-page \.admin-stat-grid \{[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    css,
    /@media \(max-width: 360px\) \{[\s\S]*\.admin-dashboard-page \.admin-stat-grid \{[\s\S]*grid-template-columns: 1fr;/
  );
  assert.match(
    css,
    /@media \(max-width: 980px\) \{[\s\S]*\.admin-shell \.admin-main \{[\s\S]*padding-bottom: calc\(6\.75rem \+ env\(safe-area-inset-bottom, 0px\)\);/
  );
  assert.match(css, /@media \(max-width: 390px\) \{[\s\S]*\.admin-dashboard-page \.admin-stat-grid/);
  assert.match(css, /@media \(max-width: 320px\) \{[\s\S]*\.admin-dashboard-page \.admin-stat-grid \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /\.ops-dashboard-clearance/);
});
