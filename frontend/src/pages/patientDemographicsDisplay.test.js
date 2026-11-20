import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { displayDateOfBirth, displaySex, NOT_RECORDED } from "../patientDemographics.js";

const here = path.dirname(fileURLToPath(import.meta.url));

test("display helpers keep calendar dates and use Not recorded", () => {
  assert.equal(displaySex("Female"), "Female");
  assert.equal(displaySex(""), NOT_RECORDED);
  assert.equal(displayDateOfBirth("2001-06-15"), "June 15, 2001");
  assert.equal(displayDateOfBirth("1999-12-31"), "December 31, 1999");
  assert.equal(displayDateOfBirth("2000-01-01"), "January 1, 2000");
  assert.equal(displayDateOfBirth("2001-06-15T00:00:00.000Z"), "June 15, 2001");
  assert.equal(displayDateOfBirth(""), NOT_RECORDED);
});

test("Patient, Staff, Dentist, and Admin personal details label Sex and Date of birth", () => {
  const profile = fs.readFileSync(path.join(here, "ProfilePage.jsx"), "utf8");
  const staff = fs.readFileSync(path.join(here, "StaffPatientsPage.jsx"), "utf8");
  const dentist = fs.readFileSync(path.join(here, "DentistRecordsPage.jsx"), "utf8");
  const admin = fs.readFileSync(path.join(here, "AdminPatientRecordsPage.jsx"), "utf8");
  assert.match(profile, /<span>Sex<\/span>/);
  assert.match(profile, /<span>Date of birth<\/span>/);
  assert.match(profile, /NOT_RECORDED/);
  assert.match(staff, /<strong>Sex:<\/strong>/);
  assert.match(staff, /<strong>Date of birth:<\/strong>/);
  assert.match(staff, /displayDateOfBirth/);
  assert.match(dentist, /label="Sex"/);
  assert.match(dentist, /label="Date of birth"/);
  assert.match(dentist, /displayDateOfBirth\(detail\.patient\.dateOfBirth\)/);
  assert.match(admin, /<small>Date of birth<\/small>/);
  assert.match(admin, /<small>Sex<\/small>/);
  assert.match(admin, /displayDateOfBirth\(record\.dateOfBirth\)/);
});
