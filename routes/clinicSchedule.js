"use strict";

const clinicSchedule = require("../services/clinicSchedule");
const { writeAdminAudit } = require("../services/adminAudit");

function stringValue(value, maxLength = 500) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function adminLabel(admin) {
  return `${admin?.first_name || ""} ${admin?.last_name || ""}`.trim() || admin?.email || "Administrator";
}

function attachClinicScheduleRoutes(router, { db }) {
  router.get("/clinic-schedule", async (req, res) => {
    const now = new Date();
    const year = Number.parseInt(req.query.year, 10) || now.getUTCFullYear();
    const month = Number.parseInt(req.query.month, 10) || now.getUTCMonth() + 1;
    if (year < 2000 || year > 2100 || month < 1 || month > 12) {
      return res.status(400).json({ message: "Provide a valid year and month." });
    }

    try {
      const defaults = await clinicSchedule.loadDefaults(db);
      const dates = clinicSchedule.datesInMonth(year, month);
      const { start, end } = clinicSchedule.monthDateRange(year, month);
      const dayMap = await clinicSchedule.loadDayMap(db, start, end);
      const bookedByDate = new Map();
      const unavailableByDate = new Map();
      try {
        const booked = await db.query(
          `SELECT appointment_date::text AS appointment_date, COUNT(*) AS count
           FROM patient_portal_appointments
           WHERE appointment_date >= $1::date
             AND appointment_date <= $2::date
             AND LOWER(COALESCE(status, 'pending')) <> 'cancelled'
           GROUP BY appointment_date`,
          [start, end]
        );
        for (const row of booked.rows) {
          bookedByDate.set(String(row.appointment_date).slice(0, 10), Number.parseInt(row.count, 10) || 0);
        }
      } catch (error) {
        if (error?.code !== "42P01") throw error;
      }
      try {
        const blocked = await db.query(
          `SELECT schedule_date::text AS schedule_date, COUNT(*) AS count
           FROM clinic_schedule_slots
           WHERE schedule_date >= $1::date
             AND schedule_date <= $2::date
             AND LOWER(status) = 'unavailable'
           GROUP BY schedule_date`,
          [start, end]
        );
        for (const row of blocked.rows) {
          unavailableByDate.set(String(row.schedule_date).slice(0, 10), Number.parseInt(row.count, 10) || 0);
        }
      } catch (error) {
        if (error?.code !== "42P01") throw error;
      }

      const days = dates.map((date) => {
        const hours = clinicSchedule.resolveOperatingHours(date, dayMap.get(date), defaults);
        const bookedCount = bookedByDate.get(date) || 0;
        const unavailableCount = unavailableByDate.get(date) || 0;
        return {
          date,
          weekday: clinicSchedule.weekdayIndex(date),
          ...hours,
          bookedCount,
          unavailableCount,
          hasBookings: bookedCount > 0,
          hasUnavailableSlots: unavailableCount > 0,
        };
      });

      return res.json({
        year,
        month,
        defaults,
        days,
      });
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          message: "Clinic schedule tables are not available. Run npm run migrate:clinic-schedule.",
        });
      }
      console.error("Clinic schedule month error:", error.message);
      return res.status(500).json({ message: "Unable to load the clinic calendar." });
    }
  });

  router.get("/clinic-schedule/day", async (req, res) => {
    const date = stringValue(req.query.date, 10);
    if (!clinicSchedule.isIsoDate(date)) {
      return res.status(400).json({ message: "Provide a valid date (YYYY-MM-DD)." });
    }
    try {
      const defaults = await clinicSchedule.loadDefaults(db);
      const dayMap = await clinicSchedule.loadDayMap(db, date, date);
      const dayRow = dayMap.get(date) || null;
      const hours = clinicSchedule.resolveOperatingHours(date, dayRow, defaults);
      const savedSlots = await clinicSchedule.loadSlotMap(db, date);
      const bookedTimes = await clinicSchedule.loadBookedTimes(db, date);
      const appointments = await clinicSchedule.loadBookedAppointments(db, date);
      return res.json({
        date,
        defaults,
        saved: dayRow
          ? {
              mode: dayRow.mode,
              isHoliday: Boolean(dayRow.is_holiday),
              openTime: dayRow.open_time || null,
              closeTime: dayRow.close_time || null,
              notes: dayRow.notes || "",
            }
          : null,
        hours,
        slots: clinicSchedule.buildSlots(hours, defaults, savedSlots, bookedTimes),
        appointments,
      });
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          message: "Clinic schedule tables are not available. Run npm run migrate:clinic-schedule.",
        });
      }
      console.error("Clinic schedule day error:", error.message);
      return res.status(500).json({ message: "Unable to load the selected date." });
    }
  });

  router.put("/clinic-schedule/day", async (req, res) => {
    const date = stringValue(req.body?.date, 10);
    const mode = stringValue(req.body?.mode, 20)?.toLowerCase() || "default";
    const isHoliday = Boolean(req.body?.isHoliday);
    const openTime = clinicSchedule.normalizeTime(req.body?.openTime);
    const closeTime = clinicSchedule.normalizeTime(req.body?.closeTime);
    const notes = stringValue(req.body?.notes, 500);

    if (!clinicSchedule.isIsoDate(date)) {
      return res.status(400).json({ message: "Provide a valid date (YYYY-MM-DD)." });
    }
    if (!["default", "custom", "closed"].includes(mode)) {
      return res.status(400).json({ message: "Mode must be default, custom, or closed." });
    }
    if (mode === "custom" && (!openTime || !closeTime)) {
      return res.status(400).json({ message: "Custom hours require an opening and closing time." });
    }
    if (mode === "custom" && clinicSchedule.toMinutes && clinicSchedule.toMinutes(closeTime) <= clinicSchedule.toMinutes(openTime)) {
      return res.status(400).json({ message: "Closing time must be after opening time." });
    }

    try {
      const appointments = await clinicSchedule.loadBookedAppointments(db, date);
      const result = await db.query(
        `INSERT INTO clinic_schedule_days (
           schedule_date, mode, is_holiday, open_time, close_time, notes, updated_by, updated_at
         ) VALUES ($1::date, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)
         ON CONFLICT (schedule_date) DO UPDATE SET
           mode = EXCLUDED.mode,
           is_holiday = EXCLUDED.is_holiday,
           open_time = EXCLUDED.open_time,
           close_time = EXCLUDED.close_time,
           notes = EXCLUDED.notes,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP
         RETURNING schedule_date::text AS schedule_date, mode, is_holiday, open_time, close_time, notes`,
        [
          date,
          mode,
          isHoliday,
          mode === "custom" ? openTime : null,
          mode === "custom" ? closeTime : null,
          notes,
          String(req.admin.id),
        ]
      );

      await writeAdminAudit(db, {
        actorId: req.admin.id,
        actorName: adminLabel(req.admin),
        actorRole: "admin",
        action: "update_clinic_schedule_day",
        targetType: "clinic_schedule",
        targetId: date,
        targetLabel: date,
        result: mode === "closed" && appointments.length ? "warning" : "success",
        detail: mode === "closed" && appointments.length
          ? `Marked closed with ${appointments.length} existing appointment(s) left unchanged.`
          : `Schedule saved as ${mode}${isHoliday ? " (holiday)" : ""}.`,
      });

      const defaults = await clinicSchedule.loadDefaults(db);
      const hours = clinicSchedule.resolveOperatingHours(date, result.rows[0], defaults);
      return res.json({
        message: "Clinic schedule saved.",
        hours,
        appointments,
        existingAppointmentsWarning:
          mode === "closed" && appointments.length
            ? `${appointments.length} existing appointment(s) remain booked and were not cancelled.`
            : null,
      });
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          message: "Clinic schedule tables are not available. Run npm run migrate:clinic-schedule.",
        });
      }
      console.error("Clinic schedule save day error:", error.message);
      return res.status(500).json({ message: "Unable to save the clinic schedule." });
    }
  });

  router.put("/clinic-schedule/slots", async (req, res) => {
    const date = stringValue(req.body?.date, 10);
    const slots = Array.isArray(req.body?.slots) ? req.body.slots : null;
    if (!clinicSchedule.isIsoDate(date)) {
      return res.status(400).json({ message: "Provide a valid date (YYYY-MM-DD)." });
    }
    if (!slots) {
      return res.status(400).json({ message: "Provide the slot list to save." });
    }

    try {
      const defaults = await clinicSchedule.loadDefaults(db);
      const dayMap = await clinicSchedule.loadDayMap(db, date, date);
      const hours = clinicSchedule.resolveOperatingHours(date, dayMap.get(date), defaults);
      if (hours.closed) {
        return res.status(409).json({ message: "The clinic is closed on this date. Open it before setting slots." });
      }

      const generated = new Set(clinicSchedule.generateSlotTimes(hours.open, hours.close, defaults.slotMinutes));
      const bookedTimes = await clinicSchedule.loadBookedTimes(db, date);
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM clinic_schedule_slots WHERE schedule_date = $1::date`, [date]);
        for (const slot of slots) {
          const time = clinicSchedule.normalizeTime(slot?.time);
          const status = String(slot?.status || "available").toLowerCase() === "unavailable"
            ? "unavailable"
            : "available";
          if (!time || !generated.has(time)) continue;
          if (bookedTimes.get(time) && status === "unavailable") continue;
          await client.query(
            `INSERT INTO clinic_schedule_slots (schedule_date, slot_time, status, updated_by, updated_at)
             VALUES ($1::date, $2, $3, $4, CURRENT_TIMESTAMP)`,
            [date, time, status, String(req.admin.id)]
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }

      await writeAdminAudit(db, {
        actorId: req.admin.id,
        actorName: adminLabel(req.admin),
        actorRole: "admin",
        action: "update_clinic_schedule_slots",
        targetType: "clinic_schedule",
        targetId: date,
        targetLabel: date,
        result: "success",
      });

      const savedSlots = await clinicSchedule.loadSlotMap(db, date);
      return res.json({
        message: "Appointment slots saved.",
        hours,
        slots: clinicSchedule.buildSlots(hours, defaults, savedSlots, bookedTimes),
      });
    } catch (error) {
      if (error?.code === "42P01") {
        return res.status(503).json({
          message: "Clinic schedule tables are not available. Run npm run migrate:clinic-schedule.",
        });
      }
      console.error("Clinic schedule save slots error:", error.message);
      return res.status(500).json({ message: "Unable to save appointment slots." });
    }
  });

  router.put("/clinic-schedule/defaults", async (req, res) => {
    const slotMinutes = req.body?.slotMinutes == null ? null : Number.parseInt(req.body.slotMinutes, 10);
    if (slotMinutes != null && (!Number.isFinite(slotMinutes) || slotMinutes < 5 || slotMinutes > 240)) {
      return res.status(400).json({ message: "Slot duration must be between 5 and 240 minutes." });
    }
    try {
      const current = await clinicSchedule.loadDefaults(db);
      const next = clinicSchedule.mergeDefaults({
        ...current,
        ...req.body,
        slotMinutes: slotMinutes ?? current.slotMinutes,
      });
      await db.query(
        `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
         VALUES ('clinic_schedule', $1::jsonb, CURRENT_TIMESTAMP, $2)
         ON CONFLICT (setting_key) DO UPDATE SET
           setting_value = EXCLUDED.setting_value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = EXCLUDED.updated_by`,
        [JSON.stringify(next), String(req.admin.id)]
      );
      return res.json({ message: "Clinic schedule defaults saved.", defaults: next });
    } catch (error) {
      console.error("Clinic schedule defaults error:", error.message);
      return res.status(500).json({ message: "Unable to save clinic schedule defaults." });
    }
  });
}

module.exports = { attachClinicScheduleRoutes };
