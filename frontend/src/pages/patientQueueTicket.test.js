import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const css = fs.readFileSync(path.join(root, "index.css"), "utf8");
const dashboard = fs.readFileSync(path.join(root, "pages", "DashboardPage.jsx"), "utf8");
const queue = fs.readFileSync(path.join(root, "pages", "QueuePage.jsx"), "utf8");
const ticket = fs.readFileSync(path.join(root, "components", "PatientQueueTicket.jsx"), "utf8");
const estimate = fs.readFileSync(path.join(root, "utils", "queueWaitEstimate.js"), "utf8");

test("dashboard queue ticket reuses the queue wait helper", () => {
  assert.match(dashboard, /PatientQueueTicket/);
  assert.match(ticket, /ticketWaitPanel/);
  assert.match(ticket, /Your Queue Ticket/);
  assert.match(ticket, /TICKET_WAIT_NOTE/);
  assert.match(ticket, /Last updated/);
  assert.doesNotMatch(ticket, /Last updated —/);
  assert.doesNotMatch(ticket, /ticketWaitLine/);
  assert.match(queue, /ticketWaitLine\(current\)/);
  assert.match(queue, /queueStatusWaitLabel\(current\)/);
  assert.match(estimate, /export function ticketWaitPanel/);
  assert.doesNotMatch(queue, /Now — you are being seen/);
});

test("queue ticket matches Live Queue padding and stacks on small screens", () => {
  assert.match(css, /\.patient-queue-ticket \{[\s\S]*padding: 1\.5rem;/);
  assert.match(css, /@media \(max-width: 760px\) \{[\s\S]*\.patient-queue-ticket,[\s\S]*padding: 1rem;/);
  assert.match(css, /@media \(max-width: 390px\) \{[\s\S]*\.patient-queue-ticket__header,[\s\S]*flex-direction: column;/);
  assert.match(css, /@media \(max-width: 320px\) \{[\s\S]*\.patient-queue-ticket__number \{[\s\S]*font-size: 1\.4rem;/);
  assert.match(css, /\.queue-hero__wait \{[\s\S]*overflow-wrap: anywhere;/);
});
