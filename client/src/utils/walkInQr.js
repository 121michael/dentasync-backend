/**
 * Extract a walk-in QR session token from a scanned payload.
 * Accepts full check-in URLs or a raw token string.
 */
export function extractWalkInQrToken(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return null;

  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get("token");
    if (fromQuery) return fromQuery.trim();
    const parts = url.pathname.split("/").filter(Boolean);
    const walkInIndex = parts.findIndex((part) => part === "walk-in-check-in");
    if (walkInIndex >= 0 && parts[walkInIndex + 1]) {
      return decodeURIComponent(parts[walkInIndex + 1]).trim();
    }
  } catch {
    // Not a URL — treat as raw token below.
  }

  if (/^[a-f0-9]{24,}$/i.test(text)) {
    return text;
  }

  const tokenMatch = text.match(/[?&]token=([a-f0-9]+)/i);
  if (tokenMatch?.[1]) return tokenMatch[1];

  return null;
}

export function displayQueueStatus(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "waiting" || normalized === "checked_in") return "Waiting";
  if (normalized === "preparing" || normalized === "called") return "Called";
  if (normalized === "dentist" || normalized === "in_chair" || normalized === "in_treatment") {
    return "In Treatment";
  }
  if (normalized === "completed") return "Finished";
  if (normalized === "no_show" || normalized === "cancelled" || normalized === "skipped") {
    return "Cancelled";
  }
  return normalized.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) || "Waiting";
}
