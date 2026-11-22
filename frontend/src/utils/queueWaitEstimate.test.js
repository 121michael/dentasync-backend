import assert from "node:assert/strict";
import test from "node:test";
import { compactQueueWaitCaption, waitRangeFromEntry } from "./queueWaitEstimate.js";

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
});
