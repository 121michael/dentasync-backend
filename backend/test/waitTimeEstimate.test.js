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
        duration_minutes: 40,
        service_name: "Cleaning",
      },
    ],
  });

  assert.equal(wait, 40);
});

test("estimateWaitMinutesForPosition uses remaining chair time plus 10 minutes per waiter ahead", async () => {
  const db = {
    async query() {
      throw new Error("Waiting patients use a fixed 10-minute allowance, not catalog duration");
    },
  };

  const wait = await estimateWaitMinutesForPosition(db, {
    position: 3,
    aheadEntries: [
      { status: "waiting", service_name: "Filling" },
      { status: "dentist", duration_minutes: 30 },
    ],
  });

  assert.equal(wait, 40);
});
