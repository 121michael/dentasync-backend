"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createDentistPortalRouter } = require("../routes/dentistPortal");

async function startDentistPortal({ tokenRole, databaseRole, catalogDentistId = "dr-sarah-cruz" }) {
  const app = express();
  const db = {
    async query(sql, params = []) {
      if (sql.includes("FROM users AS account") && sql.includes("LOWER(account.role) = 'dentist'")) {
        if (databaseRole !== "dentist") {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: "dentist-1",
              first_name: "Sarah",
              last_name: "Cruz",
              email: "dentist@example.test",
              phone: "639173333333",
              role: "dentist",
              status: "Active",
              is_verified: true,
              created_at: "2026-01-01T00:00:00.000Z",
              specialization: "Orthodontics",
              schedule_notes: "Mon–Fri",
              catalog_dentist_id: catalogDentistId,
            },
          ],
        };
      }

      if (sql.includes("COUNT(*) AS count")) {
        return { rows: [{ count: "0" }] };
      }

      if (sql.includes("LIMIT 1") && sql.includes("patient_portal_queue_entries")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected test query: ${sql} :: ${JSON.stringify(params)}`);
    },
  };

  app.use(
    "/api/dentist",
    createDentistPortalRouter({
      db,
      authenticateToken(req, _res, next) {
        req.user = { id: "dentist-1", role: tokenRole };
        next();
      },
    })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/api/dentist`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("dentist dashboard rejects a token whose database account is not dentist", async () => {
  const portal = await startDentistPortal({ tokenRole: "dentist", databaseRole: "staff" });
  try {
    const response = await fetch(`${portal.url}/dashboard`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /active dentist accounts only/i);
  } finally {
    await portal.close();
  }
});

test("dentist dashboard authorizes the live database role instead of a token role claim", async () => {
  const portal = await startDentistPortal({ tokenRole: "patient", databaseRole: "dentist" });
  try {
    const response = await fetch(`${portal.url}/dashboard`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.dentist.fullName, "Dr. Sarah Cruz");
    assert.equal(body.metrics.todaysTarget, 0);
    assert.equal(body.metrics.remainingQueue, 0);
    assert.equal(body.metrics.completedToday, 0);
  } finally {
    await portal.close();
  }
});
