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

function formatClock(time) {
  const normalized = normalizeTime(time);
  if (!normalized) return "";
  const hours = Number(normalized.slice(0, 2));
  const minutes = normalized.slice(3);
  const suffix = hours >= 12 ? "PM" : "AM";
  const hour12 = hours % 12 || 12;
  return minutes === "00" ? `${hour12}:00 ${suffix}` : `${hour12}:${minutes} ${suffix}`;
}

function formatHourRange(open, close) {
  const start = formatClock(open);
  const end = formatClock(close);
  if (!start || !end) return "Closed";
  return `${start}–${end}`;
}

function clinicTodayYmd(now = new Date()) {
  return now.toLocaleDateString("en-CA", { timeZone: process.env.CLINIC_TIMEZONE || "Asia/Manila" });
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

async function mainBranchId(db) {
  try {
    const result = await db.query(
      `SELECT id FROM clinic_branches WHERE is_main ORDER BY id LIMIT 1`
    );
    return result.rows[0]?.id || null;
  } catch (error) {
    if (error?.code === "42P01") return null;
    throw error;
  }
}

// Omitted branchId keeps the historical Mandaluyong schedule. Pass null to read every branch.
async function scopeBranchId(db, branchId) {
  if (branchId === null) return null;
  if (branchId !== undefined && branchId !== "") return branchId;
  return mainBranchId(db);
}

function mapDayRows(rows) {
  return new Map(
    rows.map((row) => [String(row.schedule_date).slice(0, 10), row])
  );
}

async function loadDayMap(db, startDate, endDate, branchId) {
  const scoped = await scopeBranchId(db, branchId);
  try {
    const result = await db.query(
      `SELECT schedule_date::text AS schedule_date, mode, is_holiday, open_time, close_time, notes
       FROM clinic_schedule_days
       WHERE schedule_date >= $1::date AND schedule_date <= $2::date
         AND ($3::bigint IS NULL OR branch_id = $3)`,
      [startDate, endDate, scoped]
    );
    return mapDayRows(result.rows);
  } catch (error) {
    if (error?.code === "42703") {
      const result = await db.query(
        `SELECT schedule_date::text AS schedule_date, mode, is_holiday, open_time, close_time, notes
         FROM clinic_schedule_days
         WHERE schedule_date >= $1::date AND schedule_date <= $2::date`,
        [startDate, endDate]
      );
      return mapDayRows(result.rows);
    }
    if (error?.code === "42P01") return new Map();
    throw error;
  }
}

async function loadSlotMap(db, scheduleDate, branchId) {
  const scoped = await scopeBranchId(db, branchId);
  try {
    const result = await db.query(
      `SELECT slot_time, status
       FROM clinic_schedule_slots
       WHERE schedule_date = $1::date
         AND ($2::bigint IS NULL OR branch_id = $2)`,
      [scheduleDate, scoped]
    );
    return new Map(
      result.rows.map((row) => [normalizeTime(row.slot_time), String(row.status || "available").toLowerCase()])
    );
  } catch (error) {
    if (error?.code === "42703") {
      const result = await db.query(
        `SELECT slot_time, status
         FROM clinic_schedule_slots
         WHERE schedule_date = $1::date`,
        [scheduleDate]
      );
      return new Map(
        result.rows.map((row) => [normalizeTime(row.slot_time), String(row.status || "available").toLowerCase()])
      );
    }
    if (error?.code === "42P01") return new Map();
    throw error;
  }
}

async function loadBookedTimes(db, scheduleDate, branchId) {
  const scoped = await scopeBranchId(db, branchId);
  try {
    const result = await db.query(
      `SELECT appointment_time::text AS appointment_time, COUNT(*) AS count
       FROM patient_portal_appointments
       WHERE appointment_date = $1::date
         AND appointment_time IS NOT NULL
         AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
         AND ($2::bigint IS NULL OR branch_id = $2)
       GROUP BY appointment_time`,
      [scheduleDate, scoped]
    );
    return new Map(
      result.rows
        .map((row) => [
          normalizeTime(String(row.appointment_time || "").slice(0, 5)),
          Number.parseInt(row.count, 10) || 0,
        ])
        .filter(([time]) => time)
    );
  } catch (error) {
    if (error?.code === "42703") {
      const result = await db.query(
        `SELECT appointment_time::text AS appointment_time, COUNT(*) AS count
         FROM patient_portal_appointments
         WHERE appointment_date = $1::date
           AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
         GROUP BY appointment_time`,
        [scheduleDate]
      );
      return new Map(
        result.rows
          .map((row) => [
            normalizeTime(String(row.appointment_time || "").slice(0, 5)),
            Number.parseInt(row.count, 10) || 0,
          ])
          .filter(([time]) => time)
      );
    }
    if (error?.code === "42P01") return new Map();
    throw error;
  }
}

async function loadDateOnlyCount(db, scheduleDate, branchId) {
  const scoped = await scopeBranchId(db, branchId);
  try {
    const result = await db.query(
      `SELECT COUNT(*) AS count
       FROM patient_portal_appointments
       WHERE appointment_date = $1::date
         AND appointment_time IS NULL
         AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
         AND ($2::bigint IS NULL OR branch_id = $2)`,
      [scheduleDate, scoped]
    );
    return Number.parseInt(result.rows[0]?.count, 10) || 0;
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") return 0;
    throw error;
  }
}

async function loadBookedAppointments(db, scheduleDate, branchId) {
  const scoped = await scopeBranchId(db, branchId);
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
         AND ($2::bigint IS NULL OR appointment.branch_id = $2)
       ORDER BY appointment.appointment_time ASC NULLS LAST`,
      [scheduleDate, scoped]
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
    if (error?.code === "42703") {
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
    }
    throw error;
  }
}

// A day has one place per generated clock slot that is not marked unavailable.
// A timed booking occupies that clock time. A date-only booking consumes one
// place and leaves every unbooked clock time unmarked, until no places remain.
function assessCapacity(hours, defaults, savedSlots, bookedTimes, dateOnlyCount = 0) {
  if (hours.closed) {
    return { capacity: 0, used: 0, remaining: 0, openTimes: [] };
  }
  const times = generateSlotTimes(hours.open, hours.close, defaults.slotMinutes);
  const openTimes = times.filter((time) => savedSlots.get(time) !== "unavailable");
  let timedOnOpenSlots = 0;
  for (const time of openTimes) {
    if (Number(bookedTimes.get(time) || 0) > 0) timedOnOpenSlots += 1;
  }
  let timedOutside = 0;
  for (const [time, count] of bookedTimes.entries()) {
    if (!time || openTimes.includes(time)) continue;
    timedOutside += Number(count) || 0;
  }
  const used = timedOnOpenSlots + timedOutside + (Number(dateOnlyCount) || 0);
  return {
    capacity: openTimes.length,
    used,
    remaining: openTimes.length - used,
    openTimes,
  };
}

function buildSlots(hours, defaults, savedSlots, bookedTimes, dateOnlyCount = 0) {
  if (hours.closed) return [];
  const times = generateSlotTimes(hours.open, hours.close, defaults.slotMinutes);
  const capacity = assessCapacity(hours, defaults, savedSlots, bookedTimes, dateOnlyCount);
  return times.map((time) => {
    const booked = Number(bookedTimes.get(time) || 0) > 0;
    const saved = savedSlots.get(time);
    let status = "available";
    if (booked) status = "booked";
    else if (saved === "unavailable") status = "unavailable";
    else if (capacity.remaining <= 0) status = "full";
    return {
      time,
      period: slotPeriod(time),
      status,
      booked,
      bookable: status === "available",
    };
  });
}

function isSlotBookable(hours, defaults, savedSlots, bookedTimes, appointmentTime, dateOnlyCount = 0) {
  const time = normalizeTime(appointmentTime);
  if (!time || hours.closed) return false;
  const slot = buildSlots(hours, defaults, savedSlots, bookedTimes, dateOnlyCount).find((item) => item.time === time);
  return Boolean(slot?.bookable);
}

function isDateOnlyBookable(hours, defaults, savedSlots, bookedTimes, dateOnlyCount = 0) {
  if (hours.closed) return false;
  return assessCapacity(hours, defaults, savedSlots, bookedTimes, dateOnlyCount).remaining > 0;
}

function addDaysYmd(ymd, days) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function loadUpcomingClosures(db, now = new Date(), horizonDays = 366) {
  const start = clinicTodayYmd(now);
  const end = addDaysYmd(start, horizonDays);
  const dayMap = await loadDayMap(db, start, end);
  const closures = [];
  for (const [date, row] of dayMap.entries()) {
    if (String(row?.mode || "").toLowerCase() !== "closed") continue;
    const note = String(row?.notes || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    closures.push({ date, note });
  }
  closures.sort((left, right) => left.date.localeCompare(right.date));
  return closures;
}

async function summarizeOperatingHours(db, now = new Date()) {
  const defaults = await loadDefaults(db);
  const today = clinicTodayYmd(now);
  const dayMap = await loadDayMap(db, today, today);
  const todayHours = resolveOperatingHours(today, dayMap.get(today), defaults);
  const weekday = formatHourRange(defaults.weekdayOpen, defaults.weekdayClose);
  const weekend = formatHourRange(defaults.weekendOpen, defaults.weekendClose);
  const holiday = formatHourRange(defaults.holidayOpen, defaults.holidayClose);
  const weekLabel = `Monday–Friday ${weekday} · Saturday–Sunday ${weekend} · holidays ${holiday}`;
  const weekdayName = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: process.env.CLINIC_TIMEZONE || "Asia/Manila",
  }).format(now);
  const todayLabel = todayHours.closed
    ? `Closed today (${weekdayName})`
    : `${weekdayName} ${formatHourRange(todayHours.open, todayHours.close)}`;
  return {
    defaults,
    today,
    todayHours,
    todayClosed: Boolean(todayHours.closed),
    todayLabel,
    weekLabel,
  };
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
  mainBranchId,
  loadDayMap,
  loadSlotMap,
  loadBookedTimes,
  loadDateOnlyCount,
  loadBookedAppointments,
  assessCapacity,
  buildSlots,
  isSlotBookable,
  isDateOnlyBookable,
  toMinutes,
  formatClock,
  formatHourRange,
  clinicTodayYmd,
  loadUpcomingClosures,
  summarizeOperatingHours,
};
