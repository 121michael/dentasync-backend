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

test("public RFID routes fail closed, then accept a matching handshake and a registered card", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const express = require("express");
  const { registerPublicRfidRoutes } = require("../routes/publicRfid");
  const sketch = fs.readFileSync(
    path.join(__dirname, "../../firmware/esp32-rfid-checkin/esp32-rfid-checkin.ino"),
    "utf8"
  );
  assert.match(sketch, /#define DEVICE_KEY/);
  assert.match(sketch, /X-RFID-Device-Key/);
  assert.match(sketch, /\/api\/public\/rfid-check-in/);
  assert.match(sketch, /http\.GET\(\)/);
  assert.match(sketch, /http\.POST\(body\)/);

  const previous = process.env.RFID_DEVICE_SECRET;
  const secret = "isolated-test-reader";
  const tag = "A1B2C3D4";

  function fakeDb() {
    const client = {
      async query(sql, params = []) {
        const text = String(sql);
        if (
          /^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)\b/i.test(text.trim())
        ) {
          return { rows: [] };
        }
        if (text.includes("pg_advisory_xact_lock")) return { rows: [] };
        if (text.includes("FROM users") && text.includes("rfid_tag")) {
          if (!String(params[0] || "").toUpperCase().includes(tag)) return { rows: [] };
          return {
            rows: [
              {
                id: 42,
                first_name: "Ada",
                last_name: "Lovelace",
                email: "ada@example.test",
                phone: "09170000000",
                role: "patient",
                status: "active",
                is_verified: true,
                rfid_tag: tag,
              },
            ],
          };
        }
        if (text.includes("patient_portal_appointments") && text.includes("appointment.user_id")) {
          return {
            rows: [
              {
                id: 7,
                user_id: 42,
                service_name: "Cleaning",
                dentist_id: "dr-sarah-cruz",
                dentist_name: "Dr. Sarah Cruz",
                appointment_date: "2026-11-05",
                appointment_time: "09:00:00",
                status: "confirmed",
                patient_name: "Ada Lovelace",
                patient_phone: "09170000000",
                patient_email: "ada@example.test",
              },
            ],
          };
        }
        if (text.includes("patient_portal_queue_entries") && text.includes("queue.user_id")) {
          return {
            rows: [
              {
                id: 9,
                token: "A-001",
                position: 1,
                status: "waiting",
                estimated_wait_minutes: 0,
                checked_in_at: "2026-11-05T01:00:00.000Z",
                appointment_id: 7,
                user_id: "42",
                check_in_method: "rfid",
              },
            ],
          };
        }
        throw new Error(`Unexpected RFID query: ${text.slice(0, 180)}`);
      },
      release() {},
    };
    return {
      async connect() {
        return client;
      },
    };
  }

  const app = express();
  app.use(express.json());
  registerPublicRfidRoutes(app, {
    db: fakeDb(),
    notifyActiveStaff() {},
    notifyDentists() {},
  });
  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });

  async function call({ method, headers, body }) {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/public/rfid-check-in`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = { raw: text };
    }
    return { status: response.status, json };
  }

  try {
    delete process.env.RFID_DEVICE_SECRET;
    const missingSecret = await call({
      method: "GET",
      headers: { "X-RFID-Device-Key": secret },
    });
    assert.equal(missingSecret.status, 503);
    assert.match(missingSecret.json.message, /Set RFID_DEVICE_SECRET/);

    process.env.RFID_DEVICE_SECRET = secret;
    const missingKey = await call({ method: "GET" });
    assert.equal(missingKey.status, 403);
    const wrongKey = await call({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RFID-Device-Key": "wrong-key" },
      body: { rfidTag: tag },
    });
    assert.equal(wrongKey.status, 403);

    const handshake = await call({
      method: "GET",
      headers: { "X-RFID-Device-Key": secret },
    });
    assert.equal(handshake.status, 200);
    assert.equal(handshake.json.ok, true);
    assert.equal(handshake.json.connected, true);

    const checkedIn = await call({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RFID-Device-Key": secret },
      body: { rfidTag: "a1:b2:c3:d4" },
    });
    assert.equal(checkedIn.status, 200);
    assert.equal(checkedIn.json.method, "rfid");
    assert.equal(checkedIn.json.patient.fullName, "Ada Lovelace");
    assert.equal(checkedIn.json.queue.token, "A-001");

    const unknown = await call({
      method: "POST",
      headers: { "Content-Type": "application/json", "X-RFID-Device-Key": secret },
      body: { rfidTag: "DEADBEEF" },
    });
    assert.equal(unknown.status, 404);
  } finally {
    server.close();
    if (previous === undefined) delete process.env.RFID_DEVICE_SECRET;
    else process.env.RFID_DEVICE_SECRET = previous;
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
