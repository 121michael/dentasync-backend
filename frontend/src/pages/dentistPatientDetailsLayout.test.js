import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "DentistRecordsPage.jsx"), "utf8");
const css = fs.readFileSync(path.join(here, "../index.css"), "utf8");
const profile = fs.readFileSync(path.join(here, "ProfilePage.jsx"), "utf8");

test("Dentist Patient Details uses four My Profile style cards in order", () => {
  assert.match(profile, /className="profile-menu"/);
  assert.match(profile, /profile-menu__item/);
  assert.match(page, /const RECORD_MENU = \[/);
  assert.match(page, /className="profile-menu"/);
  assert.match(page, /Back to Patient Records/);
  assert.match(page, /Back to patient cards/);
  assert.match(page, /Patient ID ·/);
  assert.match(page, /View and update your personal details/);
  assert.match(page, /Manage your emergency contact details/);
  assert.match(page, /Review your dental and clinical information/);
  assert.match(page, /View your coverage and wellness information/);
  const personal = page.indexOf('title: "Personal Information"');
  const emergency = page.indexOf('title: "Emergency Contact"');
  const clinical = page.indexOf('title: "Clinical Information"');
  const coverage = page.indexOf('title: "Coverage and Wellness"');
  assert.ok(personal >= 0 && emergency > personal && clinical > emergency && coverage > clinical);
  assert.doesNotMatch(page, /title: "Account Security"/);
});

test("Patient Details keeps authorized actions and status badges", () => {
  assert.match(page, /unlockDentistRecordAccess/);
  assert.match(page, /StatusBadge/);
  assert.match(page, /Request Record Access/);
  assert.match(page, /Add Treatment/);
  assert.match(page, /<h2>Dental Treatment History<\/h2>/);
  assert.match(css, /\.dentist-record-toolbar/);
  assert.match(css, /body:has\(\.dentist-patient-record-page\) \.role-bottom-dock--wide/);
});
