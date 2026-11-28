import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dashboard = fs.readFileSync(path.join(root, "pages", "DashboardPage.jsx"), "utf8");
const queuePage = fs.readFileSync(path.join(root, "pages", "QueuePage.jsx"), "utf8");
const liveQueue = fs.readFileSync(path.join(root, "components", "DashboardLiveQueue.jsx"), "utf8");
const board = fs.readFileSync(path.join(root, "components", "PatientQueueBoard.jsx"), "utf8");

test("Dashboard Live Queue uses the preceding-ticket card only", () => {
  assert.match(dashboard, /DashboardLiveQueue/);
  assert.doesNotMatch(dashboard, /<PatientQueueBoard/);
  assert.match(liveQueue, /You are next in line/);
  assert.match(liveQueue, /Your treatment is in progress/);
  assert.match(liveQueue, /The ticket immediately ahead of you/);
  assert.doesNotMatch(liveQueue, /queueStatusWaitLabel/);
  assert.doesNotMatch(liveQueue, /patientName/);
});

test("Queue Status page still renders the full live board", () => {
  assert.match(queuePage, /<PatientQueueBoard/);
  assert.match(board, /Your ticket/);
});
