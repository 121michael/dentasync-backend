"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const {
  applyTrustedProxy,
  isOtpMailTestAllowed,
  shouldTrustProxy,
  trustedProxyHops,
} = require("../lib/httpSecurity");

test("Render and production trust exactly one proxy hop by default", () => {
  assert.equal(shouldTrustProxy({ NODE_ENV: "production" }), true);
  assert.equal(shouldTrustProxy({ RENDER: "true" }), true);
  assert.equal(trustedProxyHops({}), 1);
  assert.equal(trustedProxyHops({ TRUST_PROXY_HOPS: "1" }), 1);
});

test("local development does not trust forwarded IPs unless asked", () => {
  assert.equal(shouldTrustProxy({ NODE_ENV: "test" }), false);
  assert.equal(shouldTrustProxy({ TRUST_PROXY: "true", NODE_ENV: "test" }), true);
  assert.equal(shouldTrustProxy({ TRUST_PROXY: "false", RENDER: "true" }), false);
});

test("applyTrustedProxy sets Express to one hop on Render", () => {
  const app = express();
  applyTrustedProxy(app, { RENDER: "true" });
  assert.equal(app.get("trust proxy"), 1);
});

test("production sendTest is disabled without a matching header secret", () => {
  const req = {
    query: { sendTest: "1" },
    headers: {},
    get() {
      return "";
    },
  };
  assert.equal(isOtpMailTestAllowed(req, { NODE_ENV: "production" }), false);
  assert.equal(
    isOtpMailTestAllowed(
      { ...req, get: () => "wrong" },
      { NODE_ENV: "production", OTP_MAIL_STATUS_SECRET: "status-secret" }
    ),
    false
  );
  assert.equal(
    isOtpMailTestAllowed(
      { ...req, get: () => "status-secret" },
      { NODE_ENV: "production", OTP_MAIL_STATUS_SECRET: "status-secret" }
    ),
    true
  );
});

test("local sendTest stays available without a secret", () => {
  assert.equal(
    isOtpMailTestAllowed({ query: { sendTest: "1" }, headers: {} }, { NODE_ENV: "test" }),
    true
  );
});
