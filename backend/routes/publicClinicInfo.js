"use strict";

const clinicSchedule = require("../services/clinicSchedule");

const CLINIC_BRAND_NAME = "Amethyst Dental Clinic";
const EXCEPTION_LOOKAHEAD_DAYS = 30;

function savedText(value, maxLength = 300) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function addDays(isoDate, days) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

async function loadSavedClinicProfile(db) {
  try {
    const result = await db.query(
      `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'clinic' LIMIT 1`
    );
    return result.rows[0]?.setting_value || {};
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return {};
    throw error;
  }
}

function publicHours(isoDate, hours) {
  return {
    date: isoDate,
    weekday: clinicSchedule.weekdayIndex(isoDate),
    closed: Boolean(hours.closed),
    isHoliday: Boolean(hours.isHoliday),
    source: hours.source,
    open: hours.closed ? null : hours.open,
    close: hours.closed ? null : hours.close,
  };
}

async function buildPublicClinicInfo({ db, services = [], hmoProviders = [], now = new Date() }) {
  // Only Admin-saved clinic details are published; the assistant's placeholder defaults are not.
  const saved = await loadSavedClinicProfile(db);
  const name = savedText(saved.name, 120) || CLINIC_BRAND_NAME;
  const address = savedText(saved.address);
  const phone = savedText(saved.phone, 40);
  const email = savedText(saved.email, 160);

  const defaults = await clinicSchedule.loadDefaults(db);
  const today = clinicSchedule.clinicTodayYmd(now);
  const lastDay = addDays(today, EXCEPTION_LOOKAHEAD_DAYS);
  const dayMap = await clinicSchedule.loadDayMap(db, today, lastDay);
  const exceptions = [...dayMap.entries()]
    .filter(([, row]) => {
      const mode = String(row.mode || "").toLowerCase();
      return mode === "closed" || mode === "custom" || Boolean(row.is_holiday);
    })
    .map(([date, row]) => publicHours(date, clinicSchedule.resolveOperatingHours(date, row, defaults)))
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    clinic: { name, address, phone, email },
    locations: address
      ? [
          {
            id: "main",
            name,
            address,
            directionsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name}, ${address}`)}`,
          },
        ]
      : [],
    hours: {
      timezone: process.env.CLINIC_TIMEZONE || "Asia/Manila",
      weekly: [
        { id: "weekday", days: [1, 2, 3, 4, 5], open: defaults.weekdayOpen, close: defaults.weekdayClose },
        { id: "weekend", days: [6, 0], open: defaults.weekendOpen, close: defaults.weekendClose },
        { id: "holiday", days: [], open: defaults.holidayOpen, close: defaults.holidayClose },
      ],
      today: publicHours(today, clinicSchedule.resolveOperatingHours(today, dayMap.get(today), defaults)),
      exceptions,
    },
    services: services.map((service) => ({
      id: service.id,
      name: service.name,
      description: service.description || "",
    })),
    hmoProviders: hmoProviders.map((provider) => provider.name),
  };
}

function createPublicClinicInfoHandler({ db, services, hmoProviders, now = () => new Date() }) {
  return async (_req, res) => {
    try {
      const info = await buildPublicClinicInfo({ db, services, hmoProviders, now: now() });
      res.set("Cache-Control", "public, max-age=60");
      return res.json(info);
    } catch (error) {
      console.error("Public clinic info error:", error.message);
      return res.status(500).json({ message: "Clinic information is temporarily unavailable." });
    }
  };
}

module.exports = {
  buildPublicClinicInfo,
  createPublicClinicInfoHandler,
};
