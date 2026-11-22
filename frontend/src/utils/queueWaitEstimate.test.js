import assert from "node:assert/strict";
import test from "node:test";
import {
  compactQueueWaitCaption,
  featuredWaitValue,
  hasEstimatedCallTime,
  queueRowStatusLabel,
  waitRangeFromEntry,
} from "./queueWaitEstimate.js";

test("compact captions highlight the signed-in patient without inventing waits", () => {
  assert.equal(
    compactQueueWaitCaption({
      status: "waiting",
      isCurrentPatient: true,
      waitEstimate: { estimatedWaitMinutes: { min: 20, max: 20 } },
    }),
    "Your estimated wait: About 20 min"
  );
  assert.equal(
    compactQueueWaitCaption({
      status: "waiting",
      isCurrentPatient: false,
      waitEstimate: { estimatedWaitMinutes: { min: 20, max: 20 } },
    }),
    "Estimated wait: About 20 min"
  );
  assert.equal(
    compactQueueWaitCaption({ status: "dentist", isCurrentPatient: true }),
    "You · In treatment"
  );
  assert.equal(compactQueueWaitCaption({ status: "completed" }), "Completed");
  assert.equal(
    waitRangeFromEntry({ waitEstimate: { unavailable: true } }),
    "Estimate unavailable"
  );
});

test("featured wait and row labels stay readable without repeating the featured line", () => {
  const waitingYou = {
    status: "waiting",
    isCurrentPatient: true,
    waitEstimate: { estimatedWaitMinutes: { min: 20, max: 20 } },
  };
  assert.equal(featuredWaitValue(waitingYou), "About 20 min");
  assert.equal(queueRowStatusLabel(waitingYou), "Waiting");
  assert.equal(
    featuredWaitValue({ status: "waiting", waitEstimate: { unavailable: true } }),
    "Estimate unavailable"
  );
  assert.equal(featuredWaitValue({ status: "dentist", isCurrentPatient: true }), "In treatment");
  assert.equal(queueRowStatusLabel({ status: "dentist" }), "In treatment");
  assert.equal(
    queueRowStatusLabel({
      status: "waiting",
      isCurrentPatient: false,
      waitEstimate: { estimatedWaitMinutes: { min: 40, max: 40 } },
    }),
    "About 40 min"
  );
  assert.equal(hasEstimatedCallTime({ waitEstimate: { unavailable: true } }), false);
  assert.equal(
    hasEstimatedCallTime({ waitEstimate: { estimatedCallTime: { start: "2026-11-22T04:30:00.000Z" } } }),
    true
  );
});
