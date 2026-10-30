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

test("Gmail Apps Script URL spaces are stripped", () => {
  const config = getMailConfig({
    GMAIL_APPS_SCRIPT_URL: "https://script.google.com/macros/s/abc/exec ",
    GMAIL_APPS_SCRIPT_SECRET: "relay-secret",
  });
  assert.equal(config.appsScriptUrl, "https://script.google.com/macros/s/abc/exec");
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
  assert.match(String(calls[0].options.headers["Content-Type"]), /application\/x-www-form-urlencoded/);
  const payload = Object.fromEntries(new URLSearchParams(calls[0].options.body));
  assert.equal(payload.to, "patient@example.test");
  assert.equal(payload.secret, "relay-secret");
  assert.match(payload.html, /123456/);
  assert.equal(payload.attachmentsJson, undefined);
});

test("HTTPS relay POSTs prescription PDFs as base64 without SMTP", async () => {
  const { sendMailMessage } = require("../services/emailDelivery");
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ status: "ok", attachments: 1 });
      },
    };
  };

  await sendMailMessage(
    {
      to: "patient@example.test",
      subject: "Your Prescription from Amethyst Dental Clinic",
      html: "<p>attached</p>",
      attachments: [
        {
          filename: "RX-202610-0002.pdf",
          content: Buffer.from("%PDF-1.4 test"),
          contentType: "application/pdf",
        },
      ],
    },
    {
      GMAIL_APPS_SCRIPT_URL: "https://script.google.com/macros/s/abc/exec",
      GMAIL_APPS_SCRIPT_SECRET: "relay-secret",
    },
    fetchImpl
  );

  assert.equal(calls.length, 1);
  const payload = Object.fromEntries(new URLSearchParams(calls[0].options.body));
  assert.equal(payload.to, "patient@example.test");
  assert.equal(payload.expectAttachments, "1");
  const files = JSON.parse(payload.attachmentsJson);
  assert.equal(files.length, 1);
  assert.equal(files[0].filename, "RX-202610-0002.pdf");
  assert.equal(files[0].mimeType, "application/pdf");
  assert.equal(Buffer.from(files[0].contentBase64, "base64").toString(), "%PDF-1.4 test");
});

test("HTTPS relay rejects PDF send when the Apps Script does not confirm the attachment", async () => {
  const { sendMailMessage } = require("../services/emailDelivery");
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return "ok";
    },
  });

  await assert.rejects(
    () =>
      sendMailMessage(
        {
          to: "patient@example.test",
          subject: "Your Prescription from Amethyst Dental Clinic",
          html: "<p>attached</p>",
          attachments: [{ filename: "rx.pdf", content: Buffer.from("pdf"), contentType: "application/pdf" }],
        },
        {
          GMAIL_APPS_SCRIPT_URL: "https://script.google.com/macros/s/abc/exec",
          GMAIL_APPS_SCRIPT_SECRET: "relay-secret",
        },
        fetchImpl
      ),
    /gmail-https-relay\.gs/
  );
});
