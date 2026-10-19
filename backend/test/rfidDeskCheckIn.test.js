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

test("Render can authorize the ESP32 desk key without RFID_DEVICE_SECRET", () => {
  const env = { RFID_DEVICE_SECRET: "" };
  assert.equal(rfidDeskCheckIn.deviceSecretConfigured(env), true);
  assert.equal(rfidDeskCheckIn.resolvedDeviceSecret(env), rfidDeskCheckIn.DEFAULT_RFID_DEVICE_SECRET);
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("dentasync-esp32-desk", env), true);
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("wrong", env), false);
});

test("RFID_DEVICE_SECRET on Render overrides the firmware default", () => {
  const env = { RFID_DEVICE_SECRET: "render-override" };
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("render-override", env), true);
  assert.equal(rfidDeskCheckIn.deviceKeyMatches("dentasync-esp32-desk", env), false);
});
