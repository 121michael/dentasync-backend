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

test("RFID authentication fails closed when the device secret is missing or blank", () => {
  for (const env of [{}, { RFID_DEVICE_SECRET: "" }, { RFID_DEVICE_SECRET: "   " }]) {
    assert.equal(rfidDeskCheckIn.deviceSecretConfigured(env), false);
    assert.equal(rfidDeskCheckIn.resolvedDeviceSecret(env), "");
    assert.equal(rfidDeskCheckIn.deviceKeyMatches("clinic-reader-secret", env), false);
    const denied = rfidDeskCheckIn.authorizePublicRfidRequest(
      {
        get() {
          return "clinic-reader-secret";
        },
        body: {},
      },
      env
    );
    assert.equal(denied.ok, false);
    assert.equal(denied.status, 503);
  }
});

test("a configured test device is authorized and invalid keys are denied", () => {
  const env = { RFID_DEVICE_SECRET: "isolated-test-reader" };
  const req = {
    get(name) {
      return name.toLowerCase() === "x-rfid-device-key" ? "isolated-test-reader" : "";
    },
    body: {},
  };
  const allowed = rfidDeskCheckIn.authorizePublicRfidRequest(req, env);
  assert.equal(allowed.ok, true);
  const invalid = rfidDeskCheckIn.authorizePublicRfidRequest(
    {
      get() {
        return "wrong-key";
      },
      body: {},
    },
    env
  );
  assert.equal(invalid.ok, false);
  assert.equal(invalid.status, 403);
});
