const CLINIC_TIMEZONE = "Asia/Manila";

function formatSpan(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  const hourLabel = hours === 1 ? "1 hr" : `${hours} hr`;
  return rest ? `${hourLabel} ${rest} min` : hourLabel;
}

export function formatWaitRange(min, max, { unavailableLabel = "Currently unavailable" } = {}) {
  if (min == null && max == null) return unavailableLabel;
  const low = Math.max(0, Math.round(Number(min) || 0));
  const high = Math.max(low, Math.round(Number(max) || 0));
  if (low === 0 && high === 0) return "Now";
  if (low === high) return formatSpan(low);
  return `${formatSpan(low)}–${formatSpan(high)}`;
}

function formatClock(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).format(date);
}

export function formatCallTimeRange(start, end, { unavailableLabel = "Currently unavailable" } = {}) {
  const from = formatClock(start);
  const to = formatClock(end);
  if (!from && !to) return unavailableLabel;
  if (from && to && from !== to) return `${from}–${to}`;
  return from || to;
}

export function waitRangeFromEntry(entry) {
  if (entry?.waitEstimate?.unavailable) return "Estimate unavailable";
  if (entry?.waitEstimate?.treatmentOverrun) return "Treatment running long";
  const estimate = entry?.waitEstimate?.estimatedWaitMinutes;
  if (estimate && (estimate.min != null || estimate.max != null)) {
    return formatWaitRange(estimate.min, estimate.max, { unavailableLabel: "Estimate unavailable" });
  }
  if (entry?.estimatedWaitMinMinutes != null || entry?.estimatedWaitMaxMinutes != null) {
    return formatWaitRange(entry.estimatedWaitMinMinutes, entry.estimatedWaitMaxMinutes, {
      unavailableLabel: "Estimate unavailable",
    });
  }
  if (entry?.waitMinutes != null && Number(entry.waitMinutes) > 0) {
    return formatWaitRange(entry.waitMinutes, entry.waitMinutes, { unavailableLabel: "Estimate unavailable" });
  }
  return "Estimate unavailable";
}

function compactAbout(range) {
  if (!range || range === "Estimate unavailable" || range === "Currently unavailable") {
    return "Estimate unavailable";
  }
  if (range === "Treatment running long") return "Treatment running long";
  if (range === "Now") return "Now";
  return `About ${range}`;
}

export function queueStatusWaitLabel(entry) {
  const status = String(entry?.status || "").toLowerCase();
  if (status === "dentist" || status === "in_chair" || status === "in_treatment") return "In treatment";
  if (status === "completed") return "Completed";
  if (status === "no_show") return "No-show";
  if (status === "cancelled") return "Cancelled";
  return compactAbout(waitRangeFromEntry(entry));
}

export function ticketWaitLine(entry) {
  const status = String(entry?.status || "").toLowerCase();
  if (status === "dentist" || status === "in_chair" || status === "in_treatment") return "In treatment";
  if (status === "completed") return "Completed";
  if (status === "no_show") return "No-show";
  if (status === "cancelled") return "Cancelled";
  const label = queueStatusWaitLabel(entry);
  if (label === "Now") return "Estimated wait: Now";
  if (label === "Treatment running long") return "Estimated wait: Treatment running long";
  if (label === "Estimate unavailable") return "Estimated wait: Estimate unavailable";
  return `Estimated wait: ${label}`;
}

export function ticketWaitPanel(entry) {
  const status = String(entry?.status || "").toLowerCase();
  if (status === "dentist" || status === "in_chair" || status === "in_treatment") {
    return { kind: "in_treatment", title: null, value: "Your treatment is underway" };
  }
  if (status === "completed") {
    return { kind: "completed", title: null, value: "Completed" };
  }
  if (status === "no_show") {
    return { kind: "no_show", title: null, value: "No-show" };
  }
  if (status === "cancelled") {
    return { kind: "cancelled", title: null, value: "Cancelled" };
  }
  return {
    kind: "waiting",
    title: "Estimated wait",
    value: compactAbout(waitRangeFromEntry(entry)),
  };
}

export function compactQueueWaitCaption(entry) {
  const status = String(entry?.status || "").toLowerCase();
  const yours = Boolean(entry?.isCurrentPatient);
  const label = queueStatusWaitLabel(entry);
  if (status === "dentist" || status === "in_chair" || status === "in_treatment" || status === "completed") {
    return yours ? `You · ${label}` : label;
  }
  if (yours) {
    return label === "Estimate unavailable"
      ? "Your estimated wait: Estimate unavailable"
      : `Your estimated wait: ${label}`;
  }
  return label === "Estimate unavailable" ? "Estimated wait: Estimate unavailable" : `Estimated wait: ${label}`;
}

export function formatWaitUpdatedAt(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLINIC_TIMEZONE,
  }).format(date);
}

export function callRangeFromEntry(entry) {
  const estimate = entry?.waitEstimate?.estimatedCallTime;
  if (estimate?.start || estimate?.end) {
    return formatCallTimeRange(estimate.start, estimate.end);
  }
  if (entry?.estimatedCallStart || entry?.estimatedCallEnd) {
    return formatCallTimeRange(entry.estimatedCallStart, entry.estimatedCallEnd);
  }
  return "Currently unavailable";
}

export function durationFromEntry(entry) {
  const minutes = entry?.estimatedDurationMinutes ?? entry?.waitEstimate?.estimatedDurationMinutes;
  if (minutes == null) return "—";
  return formatSpan(minutes);
}

export function remainingRangeFromEntry(entry) {
  const remaining = entry?.waitEstimate?.remainingTreatmentMinutes;
  if (remaining && (remaining.min != null || remaining.max != null)) {
    return formatWaitRange(remaining.min, remaining.max, { unavailableLabel: "Estimate unavailable" });
  }
  return "Estimate unavailable";
}

export function publicQueueNumber(entry) {
  return String(entry?.token || entry?.queueNumber || "").trim() || null;
}

export const QUEUE_WAIT_DISCLAIMER =
  "Estimates are approximate and may change depending on actual treatment duration and queue conditions.";

export const TICKET_WAIT_NOTE = "Waiting times may change.";
