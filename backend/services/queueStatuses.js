"use strict";

const ACTIVE_QUEUE_STATUSES = ["checked_in", "waiting", "preparing", "dentist"];
const CLOSED_DAY_STATUSES = ["not_served", "needs_review"];
const TERMINAL_QUEUE_STATUSES = ["completed", "no_show", "not_served", "needs_review"];

function sqlInList(values) {
  return `(${values.map((value) => `'${value}'`).join(", ")})`;
}

const ACTIVE_QUEUE_STATUS_SQL = sqlInList(ACTIVE_QUEUE_STATUSES);
const CLOSED_DAY_STATUS_SQL = sqlInList(CLOSED_DAY_STATUSES);
const TERMINAL_QUEUE_STATUS_SQL = sqlInList(TERMINAL_QUEUE_STATUSES);

function normalizeQueueStatus(status) {
  return String(status || "").toLowerCase();
}

function isClosedDayQueueStatus(status) {
  return CLOSED_DAY_STATUSES.includes(normalizeQueueStatus(status));
}

function isTerminalQueueStatus(status) {
  return TERMINAL_QUEUE_STATUSES.includes(normalizeQueueStatus(status));
}

function isReviewableQueueStatus(status) {
  const key = normalizeQueueStatus(status);
  return key === "needs_review" || ACTIVE_QUEUE_STATUSES.includes(key);
}

function closedDayTargetStatus(status) {
  const key = normalizeQueueStatus(status);
  if (key === "dentist") return "needs_review";
  if (key === "completed") return "completed";
  if (key === "checked_in" || key === "waiting" || key === "preparing") return "not_served";
  return null;
}

module.exports = {
  ACTIVE_QUEUE_STATUSES,
  CLOSED_DAY_STATUSES,
  TERMINAL_QUEUE_STATUSES,
  ACTIVE_QUEUE_STATUS_SQL,
  CLOSED_DAY_STATUS_SQL,
  TERMINAL_QUEUE_STATUS_SQL,
  normalizeQueueStatus,
  isClosedDayQueueStatus,
  isTerminalQueueStatus,
  isReviewableQueueStatus,
  closedDayTargetStatus,
};
