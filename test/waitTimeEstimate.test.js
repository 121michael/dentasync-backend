"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { estimateWaitMinutesForPosition } = require("../services/waitTime");

test("estimateWaitMinutesForPosition uses in-service procedure duration for current patient", async () => {
  const db = {
    async query() {
      throw new Error("Should not look up catalog duration for in-chair patients with a known length");
    },
  };

  const wait = await estimateWaitMinutesForPosition(db, {
    position: 2,
    aheadEntries: [
      {
        status: "dentist",
        estimated_wait_minutes: 40,
        service_name: "Cleaning",
      },
    ],
  });

  assert.equal(wait, 40);
});

test("estimateWaitMinutesForPosition falls back to service catalog for waiting patients ahead", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("clinic_service_durations") && sql.includes("service_name")) {
        return { rows: [{ default_duration_minutes: 25 }] };
      }
      return { rows: [] };
    },
  };

  const wait = await estimateWaitMinutesForPosition(db, {
    position: 3,
    aheadEntries: [
      { status: "waiting", service_name: "Filling" },
      { status: "dentist", estimated_wait_minutes: 30 },
    ],
  });

  assert.equal(wait, 55);
});
