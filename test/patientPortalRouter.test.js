"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createPatientPortalRouter } = require("../routes/patientPortal");

async function startPortal(role) {
  const uploadDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "amethyst-portal-test-"));
  const app = express();
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        query: async () => {
          throw new Error("Catalog requests must not query the database.");
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "patient-1", role };
        next();
      },
      uploadDirectory,
    })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/api/patient`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
      fs.rmSync(uploadDirectory, { recursive: true, force: true });
    },
  };
}

test("patient portal exposes the booking catalog only to patient accounts", async () => {
  const portal = await startPortal("patient");
  try {
    const response = await fetch(`${portal.url}/catalog`);
    assert.equal(response.status, 200);
    const body = await response.json();

    assert.equal(body.services.length, 8);
    assert.equal(body.services[0].id, "cleaning");
    assert.equal(body.dentists.length, 3);
  } finally {
    await portal.close();
  }
});

test("patient portal rejects a non-patient account before data access", async () => {
  const portal = await startPortal("admin");
  try {
    const response = await fetch(`${portal.url}/catalog`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /patient accounts only/i);
  } finally {
    await portal.close();
  }
});
