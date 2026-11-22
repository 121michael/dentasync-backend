import assert from "node:assert/strict";
import test from "node:test";
import { compactQueueWaitCaption, ticketWaitLine, ticketWaitPanel, waitRangeFromEntry } from "./queueWaitEstimate.js";

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
  assert.equal(
    waitRangeFromEntry({ waitEstimate: { treatmentOverrun: true, estimatedWaitMinutes: { min: 0, max: 0 } } }),
    "Treatment running long"
  );
  assert.equal(waitRangeFromEntry({ waitMinutes: 0 }), "Estimate unavailable");
});

test("ticket wait line uses the same backend labels without inventing Now", () => {
  assert.equal(
    ticketWaitLine({
      status: "waiting",
      waitEstimate: { estimatedWaitMinutes: { min: 8, max: 8 } },
    }),
    "Estimated wait: About 8 min"
  );
  assert.equal(
    ticketWaitLine({
      status: "waiting",
      waitEstimate: { estimatedWaitMinutes: { min: 0, max: 0 } },
    }),
    "Estimated wait: Now"
  );
  assert.equal(
    ticketWaitLine({ status: "waiting", waitEstimate: { unavailable: true } }),
    "Estimated wait: Estimate unavailable"
  );
  assert.equal(
    ticketWaitLine({ status: "waiting", waitEstimate: { treatmentOverrun: true } }),
    "Estimated wait: Treatment running long"
  );
  assert.equal(ticketWaitLine({ status: "dentist" }), "In treatment");
  assert.equal(ticketWaitLine({ status: "completed" }), "Completed");
  assert.equal(ticketWaitLine({ status: "waiting" }), "Estimated wait: Estimate unavailable");
});

test("ticket wait panel shows wait once and does not invent Now", () => {
  assert.deepEqual(
    ticketWaitPanel({
      status: "waiting",
      waitEstimate: { estimatedWaitMinutes: { min: 8, max: 8 } },
    }),
    { kind: "waiting", title: "Estimated wait", value: "About 8 min" }
  );
  assert.deepEqual(
    ticketWaitPanel({ status: "dentist" }),
    { kind: "in_treatment", title: null, value: "Your treatment is underway" }
  );
  assert.deepEqual(
    ticketWaitPanel({ status: "completed" }),
    { kind: "completed", title: null, value: "Completed" }
  );
  assert.deepEqual(
    ticketWaitPanel({ status: "waiting", waitEstimate: { unavailable: true } }),
    { kind: "waiting", title: "Estimated wait", value: "Estimate unavailable" }
  );
  assert.deepEqual(
    ticketWaitPanel({ status: "waiting", waitEstimate: { treatmentOverrun: true } }),
    { kind: "waiting", title: "Estimated wait", value: "Treatment running long" }
  );
  assert.deepEqual(
    ticketWaitPanel({ status: "waiting" }),
    { kind: "waiting", title: "Estimated wait", value: "Estimate unavailable" }
  );
});
