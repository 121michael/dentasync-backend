const ACTIVE_STATUSES = new Set([
  "checked_in",
  "waiting",
  "preparing",
  "called",
  "dentist",
  "in_chair",
  "in_treatment",
]);

const INACTIVE_STATUSES = new Set([
  "completed",
  "cancelled",
  "canceled",
  "no_show",
  "skipped",
  "needs_review",
]);

export function queueStatusKey(status) {
  const value = String(status || "").toLowerCase();
  if (value === "in_chair" || value === "in_treatment") return "dentist";
  if (value === "called") return "preparing";
  return value;
}

export function isActiveQueueEntry(entry) {
  const status = queueStatusKey(entry?.status);
  if (INACTIVE_STATUSES.has(status)) return false;
  return ACTIVE_STATUSES.has(status);
}

export function dentistLaneId(entry) {
  return String(entry?.dentistId || entry?.dentist_id || "").trim() || "__unassigned__";
}

function servingRank(status) {
  const key = queueStatusKey(status);
  if (key === "dentist" || key === "preparing") return 0;
  if (key === "waiting" || key === "checked_in") return 1;
  return 2;
}

export function compareActiveQueueOrder(a, b) {
  const leftRank = servingRank(a?.status);
  const rightRank = servingRank(b?.status);
  if (leftRank !== rightRank) return leftRank - rightRank;
  const leftPosition = Number(a?.position);
  const rightPosition = Number(b?.position);
  if (Number.isFinite(leftPosition) && Number.isFinite(rightPosition) && leftPosition !== rightPosition) {
    return leftPosition - rightPosition;
  }
  const leftId = Number(a?.id);
  const rightId = Number(b?.id);
  if (Number.isFinite(leftId) && Number.isFinite(rightId) && leftId !== rightId) {
    return leftId - rightId;
  }
  return String(a?.token || a?.queueNumber || "").localeCompare(String(b?.token || b?.queueNumber || ""));
}

function isSameTicket(entry, current) {
  if (!entry || !current) return false;
  if (entry.isCurrentPatient) return true;
  if (current.token && entry.token && String(entry.token) === String(current.token)) return true;
  if (current.queueNumber && entry.queueNumber && String(entry.queueNumber) === String(current.queueNumber)) {
    return true;
  }
  if (current.id != null && entry.id != null && String(entry.id) === String(current.id)) return true;
  return false;
}

export function dashboardPrecedingTicket(entries, current) {
  const you =
    current ||
    (Array.isArray(entries) ? entries.find((entry) => entry?.isCurrentPatient) : null) ||
    null;
  if (!you) {
    return { kind: "empty", peopleAhead: 0 };
  }
  if (queueStatusKey(you.status) === "dentist") {
    return { kind: "in_progress", peopleAhead: 0 };
  }

  const active = (Array.isArray(entries) ? entries : []).filter(isActiveQueueEntry);
  const hasLane = active.some((entry) => dentistLaneId(entry) !== "__unassigned__");
  const lane = dentistLaneId(you);
  const scoped = hasLane ? active.filter((entry) => dentistLaneId(entry) === lane) : active;
  const ordered = [...scoped].sort(compareActiveQueueOrder);
  const index = ordered.findIndex((entry) => isSameTicket(entry, you));
  const peopleAhead = index > 0 ? index : 0;
  if (index <= 0) {
    return { kind: "next", peopleAhead: 0 };
  }
  const ahead = ordered[index - 1];
  return {
    kind: "ahead",
    peopleAhead,
    ticket: {
      token: ahead.token || ahead.queueNumber || null,
      status: ahead.status,
    },
  };
}

export function peopleAheadLabel(count) {
  const people = Math.max(0, Number(count) || 0);
  if (people === 1) return "1 person ahead";
  return `${people} people ahead`;
}
