"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicSchedule = require("../services/clinicSchedule");
const booking = require("../services/appointmentBookingServices");

const catalog = [
  { id: "cleaning", name: "Dental Cleaning / Oral Prophylaxis", durationMinutes: 45, estimatedCost: 1500 },
  { id: "filling", name: "Permanent Filling / Restoration", durationMinutes: 45, estimatedCost: 2500 },
  { id: "whitening", name: "Teeth Whitening", durationMinutes: 60, estimatedCost: 8000 },
  { id: "extraction", name: "Tooth Extraction", durationMinutes: 60, estimatedCost: 3500 },
  { id: "oral-surgery", name: "Oral Surgery", durationMinutes: 90, bookable: false, estimatedCost: 15000 },
];

test("resolveSelectedServices keeps unique ids, max three, and sums duration", () => {
  const services = booking.resolveSelectedServices(["cleaning", "filling", "cleaning"], catalog);
  assert.equal(services.length, 2);
  assert.equal(booking.totalDurationMinutes(services), 90);
  assert.equal(booking.compoundServiceName(services), "Dental Cleaning / Oral Prophylaxis · Permanent Filling / Restoration");
  assert.equal(booking.slotsNeeded(90, 30), 3);
  assert.throws(() => booking.resolveSelectedServices(["cleaning", "filling", "whitening", "extraction"], catalog), /up to 3/i);
  assert.throws(() => booking.resolveSelectedServices(["oral-surgery"], catalog), /treatment/i);
  assert.deepEqual(booking.requestedServiceIds({ serviceIds: ["filling"], serviceId: "cleaning" }), ["filling"]);
  assert.deepEqual(booking.requestedServiceIds({ serviceId: "cleaning" }), ["cleaning"]);
});

test("consecutive slots keep a multi-service duration as one block", () => {
  const hours = { closed: false, open: "09:00", close: "12:00" };
  const defaults = { slotMinutes: 30 };
  const saved = new Map();
  const booked = new Map();
  clinicSchedule.addOccupiedTimes(booked, "09:00", 90, 30);
  assert.equal(booked.get("09:00"), 1);
  assert.equal(booked.get("09:30"), 1);
  assert.equal(booked.get("10:00"), 1);

  const open = clinicSchedule.buildSlots(hours, defaults, saved, new Map(), 0, 90);
  assert.equal(open.find((slot) => slot.time === "09:00").bookable, true);
  assert.equal(open.find((slot) => slot.time === "09:00").slotsNeeded, 3);
  assert.equal(open.find((slot) => slot.time === "11:00").bookable, true);

  const blocked = clinicSchedule.buildSlots(hours, defaults, saved, new Map([["09:30", 1]]), 0, 90);
  assert.equal(blocked.find((slot) => slot.time === "09:00").bookable, false);
  assert.equal(blocked.find((slot) => slot.time === "10:00").bookable, true);
  assert.deepEqual(clinicSchedule.consecutiveSlotTimes("09:00", 3, "09:00", "12:00", 30), [
    "09:00",
    "09:30",
    "10:00",
  ]);
});
