import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const page = fs.readFileSync(path.join(root, "pages", "StaffHmoVerificationPage.jsx"), "utf8");
const layout = fs.readFileSync(path.join(root, "components", "StaffLayout.jsx"), "utf8");
const appointments = fs.readFileSync(path.join(root, "pages", "StaffAppointmentsPage.jsx"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "pages", "StaffDashboardPage.jsx"), "utf8");

test("HMO Verification is a separate Staff destination from Appointments", () => {
  assert.match(layout, /to: "\/staff\/hmo-verification"/);
  assert.match(layout, /to: "\/staff\/appointments"/);
  assert.match(dashboard, /to="\/staff\/hmo-verification"/);
  assert.match(dashboard, /HMO submissions waiting for Staff review\./);
  assert.doesNotMatch(appointments, /id: "hmo"/);
  assert.match(appointments, /Appointment:/);
  assert.match(appointments, /· HMO:/);
});

test("HMO verification layout wraps at 390px and 320px while remaining a full-page review", () => {
  assert.match(page, /staff-hmo-page/);
  assert.match(page, /Profile submission|sourceLabel/);
  assert.match(css, /@media \(min-width: 981px\) \{[\s\S]*\.staff-hmo-page \.staff-table-wrap/);
  assert.match(css, /@media \(max-width: 390px\) \{[\s\S]*\.staff-hmo-detail \{[\s\S]*grid-template-columns: 1fr/);
  assert.match(css, /@media \(max-width: 320px\) \{[\s\S]*\.staff-hmo-page \.staff-panel/);
});
