"use strict";

/** In-process ring buffer so ESP32 taps can update the Staff Check-In UI without typing. */
const MAX_EVENTS = 40;
const events = [];
let sequence = 0;

function recordRfidEvent( partial ) {
  sequence += 1;
  const event = {
    id: sequence,
    rfidTag: String(partial.rfidTag || "").trim().toUpperCase() || null,
    status: partial.status || "received",
    message: partial.message || null,
    patient: partial.patient || null,
    appointment: partial.appointment || null,
    queue: partial.queue || null,
    createdAt: new Date().toISOString(),
  };
  events.unshift(event);
  if (events.length > MAX_EVENTS) {
    events.length = MAX_EVENTS;
  }
  return event;
}

function listRfidEvents({ sinceId = 0, limit = 10 } = {}) {
  const minId = Number(sinceId) || 0;
  return events.filter((event) => event.id > minId).slice(0, Math.max(1, Math.min(limit, 40)));
}

function latestRfidEvent() {
  return events[0] || null;
}

module.exports = {
  recordRfidEvent,
  listRfidEvents,
  latestRfidEvent,
};
