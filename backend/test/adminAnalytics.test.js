"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const express = require("express");
const { createAdminPortalRouter } = require("../routes/adminPortal");
const { loadAdminAnalytics } = require("../services/adminAnalytics");

function rowsFor(sql) {
  if (sql.includes("FROM ai_usage_events") && sql.includes("MIN(created_at)")) {
    return { rows: [{ started_at: null }] };
  }
  if (sql.includes("FROM ai_usage_events") && sql.includes("COUNT(DISTINCT user_id)")) {
    return {
      rows: [
        {
          total: "0",
          successful: "0",
          failed: "0",
          active_users: "0",
          input_rows: "0",
          output_rows: "0",
          input_tokens: null,
          output_tokens: null,
          total_tokens: null,
        },
      ],
    };
  }
  if (sql.includes("FROM ai_usage_events")) {
    return { rows: [] };
  }
  if (sql.includes("AS value") && sql.includes("estimated_cost")) {
    return { rows: [{ label: "2026-10", value: "1500" }] };
  }
  if (sql.includes("AS no_show") && sql.includes("AS revenue")) {
    return {
      rows: [
        {
          completed: "3",
          pending: "1",
          cancelled: "0",
          no_show: "0",
          confirmed: "2",
          checked_in: "1",
          total: "7",
          revenue: "1500",
        },
      ],
    };
  }
  if (sql.includes("FROM users")) {
    return { rows: [{ label: "2026-10", count: "4" }] };
  }
  if (sql.includes("dentist_name")) {
    return { rows: [{ dentist: "Dr Cruz", completed: "3", total: "5" }] };
  }
  if (sql.includes("appointment_date >= CURRENT_DATE - INTERVAL '13 days'")) {
    return { rows: [{ label: "2026-10-19", count: "2" }] };
  }
  if (sql.includes("patient_portal_queue_entries")) {
    return { rows: [{ active: "1", completed: "2", total: "3", avg_wait_minutes: "6.2" }] };
  }
  throw new Error(sql);
}

test("loadAdminAnalytics keeps clinic metrics and attaches AI usage for the same range", async () => {
  const db = {
    async query(sql) {
      return rowsFor(sql);
    },
  };
  const payload = await loadAdminAnalytics(db, { range: "year" });
  assert.equal(payload.periodLabel, "This Year");
  assert.equal(payload.summary.totalRevenue, 1500);
  assert.equal(payload.summary.totalAppointments, 7);
  assert.equal(payload.aiUsage.periodLabel, "This Year");
  assert.equal(payload.aiUsage.summary.totalRequests, 0);
  assert.equal(payload.aiUsage.summary.tokensAvailable, false);
});

test("analytics export endpoint is limited to administrators", async () => {
  const app = express();
  const db = {
    async query(sql) {
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
        return { rows: [] };
      }
      return { rows: [{ count: "0" }] };
    },
  };
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db,
      emailDeliveryIsConfigured: () => false,
      authenticateToken(req, _res, next) {
        req.user = { id: "staff-1", role: "staff" };
        next();
      },
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/admin`;
  try {
    const response = await fetch(`${url}/analytics/export?format=pdf&range=year`);
    assert.equal(response.status, 403);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
