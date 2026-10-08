"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  emailDeliveryIsConfigured,
  getMailConfig,
} = require("../services/emailDelivery");

test("Gmail OTP is configured from EMAIL_USER and EMAIL_PASS like local .env", () => {
  const env = {
    EMAIL_USER: " clinic@gmail.com ",
    EMAIL_PASS: "abcd efgh ijkl mnop",
  };
  const config = getMailConfig(env);
  assert.equal(config.user, "clinic@gmail.com");
  assert.equal(config.pass, "abcdefghijklmnop");
  assert.equal(config.from, "clinic@gmail.com");
  assert.equal(config.configured, true);
  assert.equal(emailDeliveryIsConfigured(env), true);
});

test("missing Gmail app password is treated as not configured", () => {
  assert.equal(
    emailDeliveryIsConfigured({ EMAIL_USER: "clinic@gmail.com" }),
    false
  );
});

test("Render Free Gmail OTP can use the HTTPS Apps Script relay", () => {
  const env = {
    GMAIL_APPS_SCRIPT_URL: "https://script.google.com/macros/s/abc/exec",
    GMAIL_APPS_SCRIPT_SECRET: "relay-secret",
  };
  assert.equal(getMailConfig(env).httpsRelayConfigured, true);
  assert.equal(emailDeliveryIsConfigured(env), true);
});

test("HTTPS relay POSTs the OTP email without using SMTP", async () => {
  const { sendEmailOtp } = require("../services/emailDelivery");
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return "ok";
      },
    };
  };

  await sendEmailOtp(
    { to: "patient@example.test", otp: "123456", expiresAt: new Date(Date.now() + 60000) },
    {
      GMAIL_APPS_SCRIPT_URL: "https://script.google.com/macros/s/abc/exec",
      GMAIL_APPS_SCRIPT_SECRET: "relay-secret",
    },
    fetchImpl
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://script.google.com/macros/s/abc/exec");
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.to, "patient@example.test");
  assert.equal(payload.secret, "relay-secret");
  assert.match(payload.html, /123456/);
});
