"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { portalDate, portalTime } = require("../services/portalDates");

test("portalDate formats Date objects without throwing", () => {
  assert.equal(portalDate(new Date(2026, 8, 21)), "2026-09-21");
  assert.equal(portalDate("2026-09-21T16:00:00.000Z"), "2026-09-21");
  assert.equal(portalDate(null), null);
});

test("portalTime formats Date and string times", () => {
  assert.equal(portalTime("09:05:00"), "09:05:00");
  assert.equal(portalTime(new Date(2026, 0, 1, 9, 5, 0)), "09:05:00");
  assert.equal(portalTime(null), null);
});
