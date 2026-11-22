import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const board = fs.readFileSync(path.join(root, "components", "PatientQueueBoard.jsx"), "utf8");

test("Live Queue card has a titled header, one subtitle, and a single footer", () => {
  assert.match(board, /Live Queue/);
  assert.match(board, /Your queue position and estimated waiting time/);
  assert.match(board, /UsersRound/);
  assert.match(board, /Your ticket/);
  assert.match(board, /No active queue ticket/);
  assert.match(board, /Check in at the clinic to see your queue number and estimated wait/);
  assert.match(board, /Estimates may change as treatments progress/);
  assert.doesNotMatch(board, /Last updated —/);
  assert.doesNotMatch(board, /Queue numbers only/);
  assert.doesNotMatch(board, /QUEUE_WAIT_DISCLAIMER/);
});

test("Live Queue padding is 24px on desktop and 16px on small screens", () => {
  assert.match(css, /\.patient-queue-board \{[\s\S]*padding: 1\.5rem;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.patient-queue-board \{[\s\S]*padding: 1rem;/);
  assert.match(css, /@media \(max-width: 390px\) \{[\s\S]*\.patient-queue-board__header \{[\s\S]*flex-direction: column;/);
  assert.match(css, /\.patient-queue-board__empty \{[\s\S]*text-align: center;/);
});
