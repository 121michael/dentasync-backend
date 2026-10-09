"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const staffWalkInQr = require("../services/staffWalkInQr");

test("walk-in QR URL uses the site root so static hosts serve index.html", () => {
  const url = staffWalkInQr.buildCheckInUrl("abc123def456abc123de", "https://dentasync-web.onrender.com/staff/check-in", {
    FRONTEND_URL: "http://localhost:5173",
  });
  assert.equal(url, "https://dentasync-web.onrender.com/?walkin=abc123def456abc123de");
});

test("walk-in QR URL ignores the API host and uses the staff Origin instead", () => {
  const url = staffWalkInQr.buildCheckInUrl("tokentokentokentoken", "https://clinic.example", {
    FRONTEND_URL: "https://dentasync-hg2x.onrender.com",
    RENDER_EXTERNAL_URL: "https://dentasync-hg2x.onrender.com",
  });
  assert.equal(url, "https://clinic.example/?walkin=tokentokentokentoken");
});

test("extractWalkInQrToken reads walkin and legacy token query params", () => {
  assert.equal(
    staffWalkInQr.extractWalkInQrToken("https://clinic.example/?walkin=deadbeefdeadbeefdeadbeef"),
    "deadbeefdeadbeefdeadbeef"
  );
  assert.equal(
    staffWalkInQr.extractWalkInQrToken("https://clinic.example/walk-in-check-in?token=cafebabecafebabecafebabe"),
    "cafebabecafebabecafebabe"
  );
  assert.equal(
    staffWalkInQr.extractWalkInQrToken("https://clinic.example/#/walk-in-check-in?token=aaaaaaaaaaaaaaaaaaaaaaaa"),
    "aaaaaaaaaaaaaaaaaaaaaaaa"
  );
});
