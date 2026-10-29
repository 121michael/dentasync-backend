"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const express = require("express");
const { createPatientPortalRouter } = require("../routes/patientPortal");

function appointmentRow(overrides = {}) {
  return {
    id: 12,
    user_id: "patient-1",
    service_id: "cleaning",
    service_name: "Dental Cleaning / Oral Prophylaxis",
    dentist_id: "dr-sarah-cruz",
    dentist_name: "Dr. Sarah Cruz",
    appointment_date: "2099-12-15",
    appointment_time: "09:00",
    clinic_location: "Amethyst Dental — Makati",
    coverage_type: "self_pay",
    status: "confirmed",
    estimated_cost: 1500,
    notes: null,
    ...overrides,
  };
}

async function startPortal({ rows, queueRows = [] }) {
  const store = { rows, queueRows, updates: [] };
  const app = express();
  app.use(express.json());
  app.use(
    "/api/patient",
    createPatientPortalRouter({
      db: {
        async query(sql, params = []) {
          store.updates.push(sql);
          if (sql.includes("FROM admin_portal_settings") || sql.includes("FROM clinic_schedule")) {
            const missing = new Error("missing");
            missing.code = "42P01";
            throw missing;
          }
          if (sql.includes("FROM patient_portal_appointments") && sql.includes("LIMIT 1") && sql.includes("SELECT")) {
            return { rows: store.rows.filter((row) => String(row.id) === String(params[0])) };
          }
          if (sql.includes("FROM patient_portal_queue_entries")) {
            return { rows: store.queueRows };
          }
          if (sql.includes("UPDATE patient_portal_appointments") && sql.includes("cancelled")) {
            const row = store.rows[0];
            if (!row || !["pending", "confirmed", "checked_in"].includes(row.status)) return { rows: [] };
            row.status = "cancelled";
            return { rows: [row] };
          }
          if (sql.includes("INSERT INTO patient_portal_appointments")) {
            const created = appointmentRow({
              id: 99,
              appointment_date: params[5],
              appointment_time: params[6],
              status: params[16] || "confirmed",
              rescheduled_from_id: params[18],
            });
            store.rows.push(created);
            return { rows: [created] };
          }
          if (sql.includes("status = 'rescheduled'")) {
            store.rows[0].status = "rescheduled";
            store.rows[0].rescheduled_to_id = 99;
            return { rows: [store.rows[0]] };
          }
          return { rows: [] };
        },
        async connect() {
          return {
            async query(sql, params) {
              return this.query ? storeQuery(sql, params) : { rows: [] };
            },
            release() {},
          };
        },
      },
      authenticateToken(req, _res, next) {
        req.user = { id: "patient-1", role: "patient" };
        next();
      },
      uploadDirectory: fs.mkdtempSync(path.join(os.tmpdir(), "appt-actions-")),
    })
  );

  async function storeQuery(sql, params) {
    return app;
  }

  const db = {
    async query() {
      return { rows: [] };
    },
  };
  void db;

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/api/patient`,
    store,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

test("cancel rejects a completed appointment without changing it", async () => {
  const portal = await startPortal({ rows: [appointmentRow({ status: "completed" })] });
  try {
    const response = await fetch(`${portal.url}/appointments/12/cancel`, { method: "PATCH" });
    assert.equal(response.status, 409);
    assert.equal(portal.store.rows[0].status, "completed");
  } finally {
    await portal.close();
  }
});

test("cancel rejects a visit already with the dentist", async () => {
  const portal = await startPortal({
    rows: [appointmentRow({ status: "checked_in" })],
    queueRows: [{ id: 1, status: "dentist", checked_in_at: new Date().toISOString(), appointment_id: 12 }],
  });
  try {
    const response = await fetch(`${portal.url}/appointments/12/cancel`, { method: "PATCH" });
    assert.equal(response.status, 409);
    assert.equal(portal.store.rows[0].status, "checked_in");
  } finally {
    await portal.close();
  }
});

test("cancel confirms a pending appointment", async () => {
  const portal = await startPortal({ rows: [appointmentRow({ status: "pending" })] });
  try {
    const response = await fetch(`${portal.url}/appointments/12/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "patient_cancelled" }),
    });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).appointment.status, "cancelled");
  } finally {
    await portal.close();
  }
});
