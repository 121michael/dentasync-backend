import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { registrationDemographicsError } from "../patientDemographics.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "AuthPage.jsx"), "utf8");
const css = fs.readFileSync(path.join(here, "../index.css"), "utf8");
const profile = fs.readFileSync(path.join(here, "ProfilePage.jsx"), "utf8");

test("Create Your Account places Sex and Date of birth after mobile number", () => {
  const mobile = page.indexOf("Mobile number");
  const sex = page.indexOf("<span>Sex</span>");
  const dob = page.indexOf("<span>Date of birth</span>");
  const category = page.indexOf("<span>Patient category</span>");
  assert.ok(mobile >= 0 && sex > mobile && dob > sex && category > dob);
  assert.match(page, /Select sex/);
  assert.match(page, /type="date"/);
  assert.match(page, /auth-demographics-row/);
  assert.match(page, /name="sex"/);
  assert.match(page, /name="dateOfBirth"/);
  assert.match(page, /sex: form\.sex/);
  assert.match(page, /dateOfBirth: form\.dateOfBirth/);
  assert.match(profile, /PATIENT_SEX_OPTIONS/);
});

test("registration demographics validation rejects missing and future dates", () => {
  const now = new Date(2026, 10, 20);
  assert.equal(registrationDemographicsError({ sex: "", dateOfBirth: "2001-06-15" }, now), "Please select sex.");
  assert.equal(registrationDemographicsError({ sex: "Female", dateOfBirth: "" }, now), "Date of birth is required.");
  assert.equal(
    registrationDemographicsError({ sex: "Female", dateOfBirth: "2026-02-31" }, now),
    "Enter a valid date of birth."
  );
  assert.equal(
    registrationDemographicsError({ sex: "Female", dateOfBirth: "2099-01-01" }, now),
    "Date of birth cannot be in the future."
  );
  assert.equal(registrationDemographicsError({ sex: "Female", dateOfBirth: "2001-06-15" }, now), "");
});

test("auth demographics row stacks on phones and keeps date inputs from overflowing", () => {
  assert.match(css, /\.landing \.auth-card \.auth-demographics-row/);
  assert.match(css, /@media \(max-width: 520px\) \{[\s\S]*auth-demographics-row/);
  assert.match(css, /@media \(max-width: 390px\) \{[\s\S]*auth-demographics-row/);
  assert.match(css, /@media \(max-width: 320px\) \{[\s\S]*input\[type="date"\]/);
  assert.match(css, /\.landing \.auth-card \.field input\[type="date"\]/);
});
