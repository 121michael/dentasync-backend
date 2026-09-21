"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_CLINIC,
  answerFromCatalog,
  loadClinicProfile,
} = require("../services/clinicAssistant");
const { SERVICES, DENTISTS } = require("../routes/patientPortal");

const options = { services: SERVICES, dentists: DENTISTS, clinic: DEFAULT_CLINIC };

test("clinic assistant answers hours from clinic facts, not a vague weekday line", () => {
  const result = answerFromCatalog("What time does the clinic open?", options);
  assert.match(result.answer, /Monday/i);
  assert.match(result.answer, /9:00/i);
  assert.equal(result.source, "faq");
});

test("clinic assistant answers location and contact using clinic profile", () => {
  const location = answerFromCatalog("Where is the clinic located?", options);
  assert.match(location.answer, /Makati/i);
  const contact = answerFromCatalog("What is your phone number?", options);
  assert.match(contact.answer, /8555 1234/);
  assert.match(contact.answer, /care@amethystdental/);
});

test("brushing questions are oral-care education, not clinic hours", () => {
  const result = answerFromCatalog("What time should I brush my teeth?", options);
  assert.match(result.answer, /twice a day/i);
  assert.doesNotMatch(result.answer, /Monday/);
  assert.equal(result.source, "oral-health");
});

test("cavity questions explain prevention and refuse diagnosis", () => {
  const result = answerFromCatalog("Do I have a cavity in my molar?", options);
  assert.match(result.answer, /cannot diagnose/i);
  assert.match(result.answer, /decay|enamel|fluoride/i);
});

test("service questions match the clinic catalog including aliases", () => {
  const cleaning = answerFromCatalog("How much is a dental cleaning?", options);
  assert.match(cleaning.answer, /Oral Prophylaxis/i);
  assert.match(cleaning.answer, /₱/);
  assert.equal(cleaning.source, "catalog");

  const root = answerFromCatalog("Tell me about a root canal", options);
  assert.match(root.answer, /Root Canal Treatment/i);
});

test("dentist roster questions list clinic dentists", () => {
  const result = answerFromCatalog("Who are the dentists at the clinic?", options);
  assert.match(result.answer, /Sarah Cruz/);
  assert.match(result.answer, /Orthodontics/);
});

test("loadClinicProfile uses admin settings when present", async () => {
  const db = {
    async query() {
      return {
        rows: [
          {
            setting_value: {
              name: "Amethyst Dental Clinic",
              address: "123 Ayala Avenue, Makati",
              phone: "+63 2 8888 0000",
              email: "hello@amethyst.test",
              operatingHours: "Tuesday–Friday · 10:00 AM – 4:00 PM",
            },
          },
        ],
      };
    },
  };
  const clinic = await loadClinicProfile(db);
  assert.equal(clinic.address, "123 Ayala Avenue, Makati");
  const answered = answerFromCatalog("What are your clinic hours?", {
    services: SERVICES,
    dentists: DENTISTS,
    clinic,
  });
  assert.match(answered.answer, /Tuesday/);
  assert.match(answered.answer, /10:00/);
});

test("loadClinicProfile falls back when the settings table is missing", async () => {
  const db = {
    async query() {
      const error = new Error("missing");
      error.code = "42P01";
      throw error;
    },
  };
  const clinic = await loadClinicProfile(db);
  assert.equal(clinic.phone, DEFAULT_CLINIC.phone);
});
