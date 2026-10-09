"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const staffCheckIn = require("../services/staffCheckIn");
const rfidDeskCheckIn = require("../services/rfidDeskCheckIn");

test("normalizeRfidTag strips colons and uppercases hex UIDs", () => {
  assert.equal(staffCheckIn.normalizeRfidTag("aa:bb:cc:dd"), "AABBCCDD");
  assert.equal(staffCheckIn.normalizeRfidTag("  DE AD BE EF  "), "DEADBEEF");
});

test("device key compare is secret-based", () => {
  const env = { RFID_DEVICE_SECRET: "clinic-reader-secret" };
  assert.equal(rfidDeskCheckIn.deviceSecretConfigured(env), true);
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("clinic-reader-secret", env), true);
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("wrong", env), false);
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("", env), false);
});
