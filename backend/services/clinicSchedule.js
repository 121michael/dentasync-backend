"use strict";

const DEFAULTS = {
  weekdayOpen: "09:00",
  weekdayClose: "16:00",
  weekendOpen: "11:00",
  weekendClose: "16:00",
  holidayOpen: "11:00",
  holidayClose: "16:00",
  slotMinutes: 30,
};

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeTime(value) {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function weekdayIndex(isoDate) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function toMinutes(time) {
  const normalized = normalizeTime(time);
  if (!normalized) return null;
  const [hours, minutes] = normalized.split(":").map(Number);
  return hours * 60 + minutes;
}

function fromMinutes(total) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function compactHours(open, close) {
  if (!open || !close) return "Closed";
  const openHour = Number(open.slice(0, 2));
  const closeHour = Number(close.slice(0, 2));
  const openLabel = open.endsWith(":00") ? String(openHour) : `${openHour}:${open.slice(3)}`;
  const closeLabel = close.endsWith(":00") ? String(closeHour > 12 ? closeHour - 12 : closeHour) : close;
  return `${openLabel}-${closeLabel}`;
}

function mergeDefaults(stored) {
  const next = { ...DEFAULTS };
  if (!stored || typeof stored !== "object") return next;
  for (const key of Object.keys(DEFAULTS)) {
    if (key === "slotMinutes") {
      const minutes = Number.parseInt(stored.slotMinutes, 10);
      if (Number.isFinite(minutes) && minutes >= 5 && minutes <= 240) {
        next.slotMinutes = minutes;
      }
      continue;
    }
    const time = normalizeTime(stored[key]);
    if (time) next[key] = time;
  }
  return next;
}

function resolveOperatingHours(isoDate, dayRow, defaults = DEFAULTS) {
  const settings = mergeDefaults(defaults);
  const isHoliday = Boolean(dayRow?.is_holiday);
  if (String(dayRow?.mode || "").toLowerCase() === "closed") {
    return {
      date: isoDate,
      closed: true,
      source: "closed",
      isHoliday,
      open: null,
      close: null,
      label: "Closed",
      compact: "Closed",
      mode: "closed",
    };
  }
  if (String(dayRow?.mode || "").toLowerCase() === "custom") {
    const open = normalizeTime(dayRow.open_time);
    const close = normalizeTime(dayRow.close_time);
    if (open && close && toMinutes(close) > toMinutes(open)) {
      return {
        date: isoDate,
        closed: false,
        source: "custom",
        isHoliday,
        open,
        close,
        label: `${open}–${close}`,
        compact: compactHours(open, close),
        mode: "custom",
      };
    }
  }
  if (isHoliday) {
    return {
      date: isoDate,
      closed: false,
      source: "holiday",
      isHoliday: true,
      open: settings.holidayOpen,
      close: settings.holidayClose,
      label: `${settings.holidayOpen}–${settings.holidayClose}`,
      compact: compactHours(settings.holidayOpen, settings.holidayClose),
      mode: "holiday",
    };
  }
  const dow = weekdayIndex(isoDate);
  if (dow === 0 || dow === 6) {
    return {
      date: isoDate,
      closed: false,
      source: "weekend",
      isHoliday: false,
      open: settings.weekendOpen,
      close: settings.weekendClose,
      label: `${settings.weekendOpen}–${settings.weekendClose}`,
      compact: compactHours(settings.weekendOpen, settings.weekendClose),
      mode: "weekend",
    };
  }
  return {
    date: isoDate,
    closed: false,
    source: "weekday",
    isHoliday: false,
    open: settings.weekdayOpen,
    close: settings.weekdayClose,
    label: `${settings.weekdayOpen}–${settings.weekdayClose}`,
    compact: compactHours(settings.weekdayOpen, settings.weekdayClose),
    mode: "weekday",
  };
}

function generateSlotTimes(open, close, slotMinutes = DEFAULTS.slotMinutes) {
  const start = toMinutes(open);
  const end = toMinutes(close);
  const step = Number.parseInt(slotMinutes, 10);
  if (start == null || end == null || !Number.isFinite(step) || step < 5 || end <= start) {
    return [];
  }
  const times = [];
  for (let cursor = start; cursor + step <= end; cursor += step) {
    times.push(fromMinutes(cursor));
  }
  return times;
}

function slotPeriod(time) {
  const minutes = toMinutes(time);
  if (minutes == null) return "Afternoon";
  if (minutes < 12 * 60) return "Morning";
  if (minutes < 16 * 60) return "Afternoon";
  return "Evening";
}

function monthDateRange(year, month) {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, lastDay };
}

function datesInMonth(year, month) {
  const { lastDay } = monthDateRange(year, month);
  const dates = [];
  for (let day = 1; day <= lastDay; day += 1) {
    dates.push(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  return dates;
}

async function loadDefaults(db) {
  try {
    const result = await db.query(
      `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'clinic_schedule' LIMIT 1`
    );
    return mergeDefaults(result.rows[0]?.setting_value);
  } catch (error) {
    if (error?.code === "42P01") return { ...DEFAULTS };
    throw error;
  }
}

async function loadDayMap(db, startDate, endDate) {
  try {
    const result = await db.query(
      `SELECT schedule_date::text AS schedule_date, mode, is_holiday, open_time, close_time, notes
       FROM clinic_schedule_days
       WHERE schedule_date >= $1::date AND schedule_date <= $2::date`,
      [startDate, endDate]
    );
    return new Map(
      result.rows.map((row) => [
        String(row.schedule_date).slice(0, 10),
        row,
      ])
    );
  } catch (error) {
    if (error?.code === "42P01") return new Map();
    throw error;
  }
}

async function loadSlotMap(db, scheduleDate) {
  try {
    const result = await db.query(
      `SELECT slot_time, status
       FROM clinic_schedule_slots
       WHERE schedule_date = $1::date`,
      [scheduleDate]
    );
    return new Map(
      result.rows.map((row) => [normalizeTime(row.slot_time), String(row.status || "available").toLowerCase()])
    );
  } catch (error) {
    if (error?.code === "42P01") return new Map();
    throw error;
  }
}

async function loadBookedTimes(db, scheduleDate) {
  try {
    const result = await db.query(
      `SELECT appointment_time::text AS appointment_time, COUNT(*) AS count
       FROM patient_portal_appointments
       WHERE appointment_date = $1::date
         AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
       GROUP BY appointment_time`,
      [scheduleDate]
    );
    return new Map(
      result.rows.map((row) => [
        normalizeTime(String(row.appointment_time || "").slice(0, 5)),
        Number.parseInt(row.count, 10) || 0,
      ])
    );
  } catch (error) {
    if (error?.code === "42P01") return new Map();
    throw error;
  }
}

async function loadBookedAppointments(db, scheduleDate) {
  try {
    const result = await db.query(
      `SELECT
         appointment.id,
         appointment.appointment_time::text AS appointment_time,
         appointment.service_name,
         appointment.status,
         CONCAT_WS(' ', patient.first_name, patient.last_name) AS patient_name
       FROM patient_portal_appointments AS appointment
       LEFT JOIN users AS patient ON patient.id::text = appointment.user_id
       WHERE appointment.appointment_date = $1::date
         AND LOWER(COALESCE(appointment.status, 'pending')) <> 'cancelled'
       ORDER BY appointment.appointment_time ASC`,
      [scheduleDate]
    );
    return result.rows.map((row) => ({
      id: row.id,
      time: normalizeTime(String(row.appointment_time || "").slice(0, 5)),
      service: row.service_name || "Appointment",
      status: row.status,
      patientName: row.patient_name || "Patient",
    }));
  } catch (error) {
    if (error?.code === "42P01") return [];
    throw error;
  }
}

function buildSlots(hours, defaults, savedSlots, bookedTimes) {
  if (hours.closed) return [];
  const times = generateSlotTimes(hours.open, hours.close, defaults.slotMinutes);
  return times.map((time) => {
    const booked = Number(bookedTimes.get(time) || 0) > 0;
    const saved = savedSlots.get(time);
    let status = "available";
    if (booked) status = "booked";
    else if (saved === "unavailable") status = "unavailable";
    return {
      time,
      period: slotPeriod(time),
      status,
      booked,
      bookable: status === "available",
    };
  });
}

function isSlotBookable(hours, defaults, savedSlots, bookedTimes, appointmentTime) {
  const time = normalizeTime(appointmentTime);
  if (!time || hours.closed) return false;
  const slot = buildSlots(hours, defaults, savedSlots, bookedTimes).find((item) => item.time === time);
  return Boolean(slot?.bookable);
}

module.exports = {
  DEFAULTS,
  isIsoDate,
  normalizeTime,
  weekdayIndex,
  mergeDefaults,
  resolveOperatingHours,
  generateSlotTimes,
  slotPeriod,
  monthDateRange,
  datesInMonth,
  loadDefaults,
  loadDayMap,
  loadSlotMap,
  loadBookedTimes,
  loadBookedAppointments,
  buildSlots,
  isSlotBookable,
  toMinutes,
};
