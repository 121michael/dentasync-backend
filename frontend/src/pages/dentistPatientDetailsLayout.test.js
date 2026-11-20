import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "DentistRecordsPage.jsx"), "utf8");
const css = fs.readFileSync(path.join(here, "../index.css"), "utf8");
const profile = fs.readFileSync(path.join(here, "ProfilePage.jsx"), "utf8");

test("Dentist Patient Details reuses My Profile membership card and field cards", () => {
  assert.match(profile, /membership-card/);
  assert.match(profile, /glass-card profile-section/);
  assert.match(profile, /field-grid field-grid--two/);
  assert.match(page, /className="membership-card"/);
  assert.match(page, /Patient ID ·/);
  assert.match(page, /glass-card profile-section/);
  assert.match(page, /field-grid field-grid--two/);
  assert.match(page, /HMO verification/);
  assert.match(page, /<h2>Dental Treatment History<\/h2>/);
  assert.match(page, /Request Record Access/);
  assert.match(page, /Add Treatment/);
  assert.match(page, /dentist-record-toolbar/);
});

test("Patient Details keeps authorized actions and status badges", () => {
  assert.match(page, /unlockDentistRecordAccess/);
  assert.match(page, /StatusBadge/);
  assert.match(css, /\.dentist-record-toolbar/);
  assert.match(css, /padding-bottom: calc\(7\.75rem/);
  assert.match(css, /body:has\(\.dentist-patient-record-page\) \.role-bottom-dock--wide/);
});
