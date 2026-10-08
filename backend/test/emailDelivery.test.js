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
