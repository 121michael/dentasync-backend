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
  const estimate = entry?.waitEstimate?.estimatedWaitMinutes;
  if (estimate && (estimate.min != null || estimate.max != null)) {
    return formatWaitRange(estimate.min, estimate.max);
  }
  if (entry?.estimatedWaitMinMinutes != null || entry?.estimatedWaitMaxMinutes != null) {
    return formatWaitRange(entry.estimatedWaitMinMinutes, entry.estimatedWaitMaxMinutes);
  }
  if (entry?.waitMinutes != null) {
    return formatWaitRange(entry.waitMinutes, entry.waitMinutes);
  }
  return "Currently unavailable";
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

export const QUEUE_WAIT_DISCLAIMER =
  "Estimates are approximate and may change depending on actual treatment duration and queue conditions.";
