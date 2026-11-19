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
  assert.match(page, /HMO submissions waiting for Staff review\./);
  assert.match(page, /Dentist Availability/);
  assert.match(page, /View Full Schedule/);
  assert.match(page, /floorMetricHref\("booked"/);
  assert.match(page, /\/admin\/users\?tab=patient/);
  assert.match(page, /\/admin\/archived-records/);
  assert.match(page, /\/admin\/sync-data/);
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
  assert.match(page, /admin-stat-grid--floor/);
  assert.match(
    css,
    /\.admin-dashboard-page \.admin-stat-grid--floor \{[\s\S]*grid-template-columns: repeat\(6, minmax\(0, 1fr\)\)/
  );
  assert.match(
    css,
    /\.admin-dashboard-page \.admin-stat-grid--floor \.admin-stat-card \{[\s\S]*padding: 0\.68rem 0\.72rem 0\.7rem/
  );
});
