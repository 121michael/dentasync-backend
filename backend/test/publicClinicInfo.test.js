"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { buildPublicClinicInfo } = require("../routes/publicClinicInfo");
const { SERVICES } = require("../routes/patientPortal");
const { APPROVED_HMO_PROVIDERS } = require("../services/clinicAssistant");

function fakeDb({ clinic = null, schedule = null, days = [], missingTables = false } = {}) {
  const queries = [];
  return {
    queries,
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (missingTables) {
        const error = new Error("relation does not exist");
        error.code = "42P01";
        throw error;
      }
      if (sql.includes("setting_key = 'clinic'")) {
        return { rows: clinic ? [{ setting_value: clinic }] : [] };
      }
      if (sql.includes("setting_key = 'clinic_schedule'")) {
        return { rows: schedule ? [{ setting_value: schedule }] : [] };
      }
      if (sql.includes("FROM clinic_schedule_days")) {
        return { rows: days };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

const NOW = new Date("2026-10-22T04:00:00.000Z");

test("public clinic info reflects the Admin clinic schedule, overrides, and saved contact details", async () => {
  const db = fakeDb({
    clinic: {
      name: "Amethyst Dental Clinic",
      address: "2F Sample Building, Makati City",
      phone: "0917 000 0000",
      email: "frontdesk@amethyst.test",
      operatingHours: "stale free-text hours",
    },
    schedule: { weekdayOpen: "08:30", weekdayClose: "17:00", weekendOpen: "10:00", weekendClose: "15:00" },
    days: [
      { schedule_date: "2026-10-22", mode: "custom", is_holiday: false, open_time: "13:00", close_time: "16:00", notes: "staff training" },
      { schedule_date: "2026-11-01", mode: "closed", is_holiday: true, open_time: null, close_time: null, notes: "internal note" },
      { schedule_date: "2026-10-25", mode: "default", is_holiday: false, open_time: null, close_time: null, notes: "" },
    ],
  });

  const info = await buildPublicClinicInfo({ db, services: SERVICES, hmoProviders: APPROVED_HMO_PROVIDERS, now: NOW });

  assert.deepEqual(info.hours.weekly.map((row) => [row.id, row.open, row.close]), [
    ["weekday", "08:30", "17:00"],
    ["weekend", "10:00", "15:00"],
    ["holiday", "11:00", "16:00"],
  ]);
  assert.deepEqual(
    { date: info.hours.today.date, open: info.hours.today.open, close: info.hours.today.close, closed: info.hours.today.closed },
    { date: "2026-10-22", open: "13:00", close: "16:00", closed: false }
  );
  assert.deepEqual(
    info.hours.exceptions.map((day) => [day.date, day.closed, day.isHoliday]),
    [
      ["2026-10-22", false, false],
      ["2026-11-01", true, true],
    ]
  );
  assert.equal(JSON.stringify(info).includes("internal note"), false, "admin notes stay private");
  assert.equal(JSON.stringify(info).includes("stale free-text hours"), false);

  assert.equal(info.clinic.phone, "0917 000 0000");
  assert.equal(info.locations.length, 1);
  assert.match(info.locations[0].directionsUrl, /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=/);
  assert.ok(info.locations[0].directionsUrl.includes(encodeURIComponent("2F Sample Building, Makati City")));

  assert.equal(info.services.length, SERVICES.length);
  assert.deepEqual(info.services[0], { id: SERVICES[0].id, name: SERVICES[0].name, description: SERVICES[0].description });
  assert.equal(info.services.some((service) => "estimatedCost" in service), false, "prices are not published");
  assert.deepEqual(info.hmoProviders, APPROVED_HMO_PROVIDERS.map((provider) => provider.name));
});

test("public clinic info never publishes placeholder contact details when the Admin has not saved any", async () => {
  const info = await buildPublicClinicInfo({ db: fakeDb(), services: SERVICES, now: NOW });
  assert.deepEqual(info.clinic, { name: "Amethyst Dental Clinic", address: null, phone: null, email: null });
  assert.deepEqual(info.locations, []);
  const serialized = JSON.stringify(info);
  assert.equal(serialized.includes("8555"), false);
  assert.equal(serialized.includes(".example"), false);
  assert.equal(info.hours.weekly[0].open, "09:00");
});

test("public clinic info falls back to default hours when schedule tables are missing", async () => {
  const info = await buildPublicClinicInfo({ db: fakeDb({ missingTables: true }), services: [], now: NOW });
  assert.equal(info.hours.weekly[0].open, "09:00");
  assert.equal(info.hours.today.closed, false);
  assert.deepEqual(info.hours.exceptions, []);
  assert.deepEqual(info.locations, []);
});
