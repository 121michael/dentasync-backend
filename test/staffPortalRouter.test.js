"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createStaffPortalRouter } = require("../routes/staffPortal");

async function startStaffPortal({ tokenRole, databaseRole }) {
  const app = express();
  const db = {
    async query(sql) {
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'staff'")) {
        if (databaseRole !== "staff") {
          return { rows: [] };
        }
        return {
          rows: [
            {
              id: "staff-1",
              first_name: "Jane",
              last_name: "Doe",
              email: "jane@example.test",
              phone: "639171234567",
              role: "staff",
              status: "active",
              is_verified: true,
            },
          ],
        };
      }

      if (sql.includes("COUNT(*) AS count")) {
        return { rows: [{ count: "0" }] };
      }

      if (sql.includes("todaysActivity") || sql.includes("LEFT JOIN patient_portal_queue_entries AS queue")) {
        return { rows: [] };
      }

      if (sql.includes("FROM patient_portal_appointments AS appointment")) {
        return { rows: [] };
      }

      throw new Error(`Unexpected test query: ${sql}`);
    },
  };

  app.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken(req, _res, next) {
        req.user = { id: "staff-1", role: tokenRole };
        next();
      },
    })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });

  return {
    url: `http://127.0.0.1:${server.address().port}/api/staff`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("staff dashboard rejects a token whose database account is not staff", async () => {
  const portal = await startStaffPortal({ tokenRole: "staff", databaseRole: "patient" });
  try {
    const response = await fetch(`${portal.url}/dashboard`);
    assert.equal(response.status, 403);
    assert.match((await response.json()).message, /active staff accounts only/i);
  } finally {
    await portal.close();
  }
});

test("staff dashboard authorizes the live database role instead of a token role claim", async () => {
  const portal = await startStaffPortal({ tokenRole: "patient", databaseRole: "staff" });
  try {
    const response = await fetch(`${portal.url}/dashboard`);
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).metrics, {
      todaysAppointments: 0,
      todayCheckIns: 0,
      checkedIn: 0,
      waitingQueue: 0,
      activeQueue: 0,
      completedToday: 0,
      pendingRequests: 0,
      unreadNotifications: 0,
    });
  } finally {
    await portal.close();
  }
});
