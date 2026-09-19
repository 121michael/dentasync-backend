"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const staffCheckIn = require("../services/staffCheckIn");

test("default check-in log filter is today in the clinic timezone", () => {
  const now = new Date("2026-09-19T16:00:00.000Z");
  const filter = staffCheckIn.resolveCheckInLogFilter({}, now);
  assert.equal(filter.range, "today");
  assert.equal(filter.date, "2026-09-20"); // Asia/Manila UTC+8
  assert.equal(filter.sort, "asc");
  assert.match(filter.label, /Today/i);
  assert.equal(filter.params[0], "Asia/Manila");
  assert.equal(filter.params[1], "2026-09-20");
});

test("specific date filter queries only that clinic date", () => {
  const filter = staffCheckIn.resolveCheckInLogFilter({ range: "date", date: "2026-09-18" });
  assert.equal(filter.range, "date");
  assert.equal(filter.date, "2026-09-18");
  assert.equal(filter.sort, "asc");
  assert.match(filter.subtitle, /September 18, 2026/);
  assert.equal(filter.params[1], "2026-09-18");
});

test("month filter covers the selected month without creating records", () => {
  const filter = staffCheckIn.resolveCheckInLogFilter({ range: "month", month: "9", year: "2026" });
  assert.equal(filter.range, "month");
  assert.equal(filter.month, 9);
  assert.equal(filter.year, 2026);
  assert.equal(filter.sort, "desc");
  assert.equal(filter.subtitle, "September 2026");
  assert.equal(filter.params[1], "2026-09-01");
  assert.match(filter.sql, /INTERVAL '1 month'/);
});

test("year filter covers the selected year", () => {
  const filter = staffCheckIn.resolveCheckInLogFilter({ range: "year", year: "2026" });
  assert.equal(filter.range, "year");
  assert.equal(filter.year, 2026);
  assert.equal(filter.subtitle, "2026");
  assert.equal(filter.sort, "desc");
  assert.equal(filter.params[1], 2026);
});

test("padCheckInId formats a stable visit identifier", () => {
  assert.equal(staffCheckIn.padCheckInId(1), "CI-000001");
  assert.equal(staffCheckIn.padCheckInId(14), "CI-000014");
});

test("listCheckInLog queries the existing queue table with the date window", async () => {
  const captured = [];
  const db = {
    async query(sql, params) {
      captured.push({ sql, params });
      return {
        rows: [
          {
            id: 14,
            token: "A-260918-014-ABC",
            position: 14,
            status: "completed",
            estimated_wait_minutes: 0,
            checked_in_at: "2026-09-18T02:05:00.000Z",
            updated_at: "2026-09-18T04:00:00.000Z",
            appointment_id: 9,
            service_name: "Cleaning",
            dentist_name: "Dr. Reyes",
            appointment_date: "2026-09-18",
            appointment_time: "10:00:00",
            patient_id: 3,
            clinic_patient_id: "A2026_03",
            patient_name: "Pedro Cruz",
          },
        ],
      };
    },
  };

  const result = await staffCheckIn.listCheckInLog(db, { range: "date", date: "2026-09-18" });
  assert.equal(result.rows.length, 1);
  assert.match(captured[0].sql, /patient_portal_queue_entries/);
  assert.match(captured[0].sql, /checked_in_at AT TIME ZONE/);
  assert.equal(captured[0].params[1], "2026-09-18");
  assert.doesNotMatch(captured[0].sql, /CURRENT_DATE/);
});

test("staff check-ins API filters on the backend and keeps completed visits in the log", async () => {
  const express = require("express");
  const { createStaffPortalRouter } = require("../routes/staffPortal");
  const captured = [];

  const db = {
    async query(sql, params) {
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'staff'")) {
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
      captured.push({ sql, params });
      return {
        rows: [
          {
            id: 1,
            token: "A-260919-001-AAA",
            position: 1,
            status: "completed",
            estimated_wait_minutes: 0,
            checked_in_at: "2026-09-19T01:05:00.000Z",
            updated_at: "2026-09-19T03:00:00.000Z",
            appointment_id: 8,
            service_name: "Cleaning",
            dentist_name: "Dr. Reyes",
            appointment_date: "2026-09-19",
            appointment_time: "09:00:00",
            patient_id: 11,
            clinic_patient_id: "A2026_01",
            patient_name: "Juan Dela Cruz",
          },
        ],
      };
    },
  };

  const app = express();
  app.use(express.json());
  app.use(
    "/api/staff",
    createStaffPortalRouter({
      db,
      authenticateToken(req, _res, next) {
        req.user = { id: "staff-1", role: "staff" };
        next();
      },
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  const url = `http://127.0.0.1:${server.address().port}/api/staff`;
  try {
    const response = await fetch(`${url}/check-ins?range=date&date=2026-09-18`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.range, "date");
    assert.equal(body.checkIns[0].clinicPatientId, "A2026_01");
    assert.equal(body.checkIns[0].checkInId, "CI-000001");
    assert.equal(body.checkIns[0].status, "completed");
    assert.equal(captured[0].params[1], "2026-09-18");
    assert.match(captured[0].sql, /checked_in_at AT TIME ZONE/);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("restoreCheckInFromHistory looks up the existing patient and does not update the historical row", async () => {
  const source = {
    id: 14,
    user_id: "3",
    token: "A-260918-014-ABC",
    position: 14,
    status: "completed",
    checked_in_at: "2026-09-18T02:05:00.000Z",
  };
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      if (sql.includes("FROM patient_portal_queue_entries AS queue") && sql.includes("WHERE queue.id")) {
        return { rows: [source] };
      }
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'patient'")) {
        return {
          rows: [
            {
              id: 3,
              first_name: "Pedro",
              last_name: "Cruz",
              email: "pedro@example.test",
              phone: "639171111111",
              role: "patient",
              status: "active",
              is_verified: true,
              rfid_tag: "AABBCC",
            },
          ],
        };
      }
      throw new Error("stop-after-patient-lookup");
    },
  };

  await assert.rejects(
    () => staffCheckIn.restoreCheckInFromHistory(client, { sourceQueueId: 14, staff: { id: "staff-1" } }),
    /stop-after-patient-lookup/
  );
  assert.equal(queries[0].params[0], 14);
  assert.equal(String(queries[1].params[0]), "3");
  assert.equal(
    queries.some((item) => /UPDATE patient_portal_queue_entries/.test(item.sql)),
    false
  );
});
