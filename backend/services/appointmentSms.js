"use strict";

const { clinicTimezone, clinicParts } = require("./appointmentLifecycle");

const HOUR_MS = 60 * 60 * 1000;
const REMINDABLE_STATUSES = new Set(["confirmed", "checked_in"]);
const STOP_STATUSES = new Set(["cancelled", "completed", "rescheduled", "no_show"]);

function pad(value) {
  return String(value).padStart(2, "0");
}

function isoDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

function clockTime(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return `${pad(Number(match[1]))}:${match[2]}`;
}

function formatClock12(time) {
  const normalized = clockTime(time);
  if (!normalized) return "";
  const [hourRaw, minute] = normalized.split(":").map(Number);
  const suffix = hourRaw >= 12 ? "PM" : "AM";
  const hour12 = ((hourRaw + 11) % 12) + 1;
  return `${hour12}:${pad(minute)} ${suffix}`;
}

function formatLongDate(dateStr) {
  const iso = isoDateOnly(dateStr);
  if (!iso) return String(dateStr || "");
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function addDaysIso(iso, days) {
  const [year, month, day] = iso.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

function zonedParts(ms, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const read = (type) => parts.find((part) => part.type === type)?.value;
  return `${read("year")}-${read("month")}-${read("day")} ${read("hour")}:${read("minute")}`;
}

function appointmentInstant(dateValue, timeValue, timeZone = clinicTimezone()) {
  const date = isoDateOnly(dateValue);
  const time = clockTime(timeValue);
  if (!date || !time) return null;
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const wanted = `${date} ${time}`;
  const wantedUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let utc = wantedUtc;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const got = zonedParts(utc, timeZone);
    if (got === wanted) return new Date(utc);
    const [gotDate, gotTime] = got.split(" ");
    const [gotYear, gotMonth, gotDay] = gotDate.split("-").map(Number);
    const [gotHour, gotMinute] = gotTime.split(":").map(Number);
    const gotUtc = Date.UTC(gotYear, gotMonth - 1, gotDay, gotHour, gotMinute, 0);
    utc += wantedUtc - gotUtc;
  }
  return new Date(utc);
}

function whenPhrase({ date, time, now = new Date(), timeZone = clinicTimezone() }) {
  const iso = isoDateOnly(date);
  const clock = formatClock12(time);
  if (!iso) return clock;
  const today = clinicParts(now, timeZone).date;
  if (iso === today) return `today at ${clock}`;
  if (iso === addDaysIso(today, 1)) return `tomorrow at ${clock}`;
  return `${formatLongDate(iso)} at ${clock}`;
}

function planReminderTimes({ appointmentAt, now = new Date() }) {
  if (!(appointmentAt instanceof Date) || Number.isNaN(appointmentAt.getTime())) {
    return [];
  }
  const nowMs = now.getTime();
  return [
    { kind: "24h", offsetMs: 24 * HOUR_MS },
    { kind: "10h", offsetMs: 10 * HOUR_MS },
  ].map((item) => {
    const scheduledFor = new Date(appointmentAt.getTime() - item.offsetMs);
    return {
      kind: item.kind,
      scheduledFor,
      eligible: scheduledFor.getTime() > nowMs,
    };
  });
}

function reminderMessage({ serviceName, date, time, now, timeZone, clinicName }) {
  const service = serviceName || "your dental visit";
  const arrive = formatClock12(time);
  if (!isoDateOnly(date) || !arrive) {
    return `This is a reminder of your appointment for ${service}. Please arrive on or before your scheduled time. Thank you.`;
  }
  const when = whenPhrase({ date, time, now, timeZone });
  return `This is a reminder of your appointment for ${service} ${when}. Please arrive on or before ${arrive}. Thank you.`;
}

function confirmationMessage({ serviceName, date, time, now, timeZone }) {
  const service = serviceName || "your dental visit";
  const when = whenPhrase({ date, time, now, timeZone });
  const arrive = formatClock12(time);
  return `Your appointment for ${service} is confirmed for ${when}. Please arrive on or before ${arrive}. Thank you.`;
}

function rescheduleMessage({ serviceName, date, time }) {
  const service = serviceName || "your dental visit";
  const clock = formatClock12(time);
  return `Your appointment for ${service} has been rescheduled to ${formatLongDate(date)} at ${clock}. Please arrive on or before ${clock}. Thank you.`;
}

function cancelMessage({ serviceName, date, time }) {
  const service = serviceName || "your dental visit";
  const when = `${formatLongDate(date)} at ${formatClock12(time)}`;
  return `Your appointment for ${service} on ${when} has been cancelled. Please contact the clinic if you need assistance. Thank you.`;
}

function updateMessage({ serviceName, date, time, change }) {
  const service = serviceName || "your dental visit";
  const clock = formatClock12(time);
  if (change === "service") {
    return `Your appointment service is now ${service} on ${formatLongDate(date)} at ${clock}. Please arrive on or before ${clock}. Thank you.`;
  }
  return `Your appointment for ${service} was updated to ${formatLongDate(date)} at ${clock}. Please arrive on or before ${clock}. Thank you.`;
}

function queueUpdateMessage({ waitMinutes, status, clinicName }) {
  const place = clinicName || "Amethyst Dental Clinic";
  const approaching = ["preparing", "called", "dentist", "in_chair", "in_treatment"].includes(
    String(status || "").toLowerCase()
  );
  if (approaching) {
    return `Your turn is approaching. Please remain available and watch for updates from ${place}. Thank you.`;
  }
  if (waitMinutes != null && Number.isFinite(Number(waitMinutes))) {
    return `Your queue status has been updated. Estimated waiting time is about ${Number(waitMinutes)} minutes. Please check your Patient Portal for the latest details. Thank you.`;
  }
  return `Your queue status has been updated. Please check your Patient Portal for the latest estimated waiting time. Thank you.`;
}

function isRemindableStatus(status) {
  return REMINDABLE_STATUSES.has(String(status || "").toLowerCase());
}

function shouldStopReminders(status) {
  return STOP_STATUSES.has(String(status || "").toLowerCase());
}

function appointmentPayload(appointment = {}) {
  return {
    id: appointment.id,
    userId: appointment.user_id || appointment.userId || appointment.patientId,
    serviceName: appointment.service_name || appointment.service || appointment.treatment || "dental visit",
    date: isoDateOnly(appointment.appointment_date || appointment.date),
    time: clockTime(appointment.appointment_time || appointment.time),
    status: String(appointment.status || "").toLowerCase(),
  };
}

function createAppointmentSms({ db, clinicSms }) {
  async function missingOk(error) {
    return error?.code === "42P01" || error?.code === "42703";
  }

  async function nextScheduleVersion(appointmentId) {
    try {
      const result = await db.query(
        `SELECT COALESCE(MAX(schedule_version), 0) + 1 AS next_version
         FROM clinic_appointment_sms_reminders
         WHERE appointment_id = $1`,
        [appointmentId]
      );
      return Number(result.rows[0]?.next_version || 1);
    } catch (error) {
      if (await missingOk(error)) return 1;
      throw error;
    }
  }

  async function cancelPendingReminders(appointmentId, reason = "cancelled") {
    if (!appointmentId) return 0;
    try {
      const result = await db.query(
        `UPDATE clinic_appointment_sms_reminders
         SET status = 'cancelled',
             last_error = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment_id = $1
           AND status IN ('scheduled', 'processing', 'failed')
         RETURNING id`,
        [appointmentId, reason]
      );
      return result.rows.length;
    } catch (error) {
      if (await missingOk(error)) return 0;
      throw error;
    }
  }

  async function scheduleRemindersForAppointment(appointment, { now = new Date() } = {}) {
    const payload = appointmentPayload(appointment);
    if (!payload.id || !payload.userId || !payload.date || !payload.time) {
      return { scheduled: [], skipped: "missing-appointment" };
    }
    if (shouldStopReminders(payload.status)) {
      await cancelPendingReminders(payload.id, payload.status);
      return { scheduled: [], skipped: payload.status };
    }
    if (!isRemindableStatus(payload.status)) {
      return { scheduled: [], skipped: "not-confirmed" };
    }

    const appointmentAt = appointmentInstant(payload.date, payload.time);
    if (!appointmentAt) return { scheduled: [], skipped: "invalid-time" };

    const plan = planReminderTimes({ appointmentAt, now });
    const version = await nextScheduleVersion(payload.id);
    await cancelPendingReminders(payload.id, "rescheduled");

    const scheduled = [];
    for (const item of plan) {
      const status = item.eligible ? "scheduled" : "skipped";
      try {
        const result = await db.query(
          `INSERT INTO clinic_appointment_sms_reminders (
             appointment_id, patient_user_id, reminder_kind, schedule_version,
             appointment_at, scheduled_for, service_name, status, last_error
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           ON CONFLICT (appointment_id, reminder_kind, schedule_version) DO NOTHING
           RETURNING *`,
          [
            payload.id,
            String(payload.userId),
            item.kind,
            version,
            appointmentAt.toISOString(),
            item.scheduledFor.toISOString(),
            payload.serviceName,
            status,
            item.eligible ? null : "window-passed",
          ]
        );
        scheduled.push(result.rows[0] || { kind: item.kind, status, skipped: !item.eligible });
      } catch (error) {
        if (await missingOk(error)) {
          scheduled.push({ kind: item.kind, status: "unavailable", error: error.message });
          continue;
        }
        throw error;
      }
    }
    return { scheduled, version, appointmentAt };
  }

  async function refreshReminderContent(appointment) {
    const payload = appointmentPayload(appointment);
    if (!payload.id) return 0;
    try {
      const result = await db.query(
        `UPDATE clinic_appointment_sms_reminders
         SET service_name = $2,
             updated_at = CURRENT_TIMESTAMP
         WHERE appointment_id = $1
           AND status IN ('scheduled', 'failed')
         RETURNING id`,
        [payload.id, payload.serviceName]
      );
      return result.rows.length;
    } catch (error) {
      if (await missingOk(error)) return 0;
      throw error;
    }
  }

  async function claimDueReminders(limit = 25) {
    try {
      const result = await db.query(
        `UPDATE clinic_appointment_sms_reminders AS reminder
         SET status = 'processing',
             locked_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE reminder.id IN (
           SELECT id
           FROM clinic_appointment_sms_reminders
           WHERE status = 'scheduled'
             AND scheduled_for <= CURRENT_TIMESTAMP
           ORDER BY scheduled_for ASC
           LIMIT $1
           FOR UPDATE SKIP LOCKED
         )
         RETURNING *`,
        [limit]
      );
      return result.rows;
    } catch (error) {
      if (await missingOk(error)) return [];
      throw error;
    }
  }

  async function loadAppointment(appointmentId) {
    const result = await db.query(
      `SELECT *
       FROM patient_portal_appointments
       WHERE id = $1
       LIMIT 1`,
      [appointmentId]
    );
    return result.rows[0] || null;
  }

  async function finishReminder(id, fields) {
    try {
      await db.query(
        `UPDATE clinic_appointment_sms_reminders
         SET status = $2,
             sms_log_id = COALESCE($3, sms_log_id),
             retry_count = COALESCE($4, retry_count),
             last_error = $5,
             provider_message_id = COALESCE($6, provider_message_id),
             sent_at = CASE WHEN $2 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [
          id,
          fields.status,
          fields.smsLogId || null,
          fields.retryCount ?? null,
          fields.lastError || null,
          fields.providerMessageId || null,
        ]
      );
    } catch (error) {
      if (!(await missingOk(error))) {
        console.warn("Unable to finish appointment SMS reminder:", error.message);
      }
    }
  }

  async function processDueReminders({ now = new Date() } = {}) {
    const settings = await clinicSms.getSmsSettings();
    if (!settings.smsEnabled || settings.appointmentSms === false || settings.appointmentReminderSms === false) {
      return { skipped: true, reason: "disabled" };
    }

    const due = await claimDueReminders();
    const summary = { claimed: due.length, sent: 0, failed: 0, cancelled: 0, skipped: 0 };

    for (const reminder of due) {
      const appointment = await loadAppointment(reminder.appointment_id);
      if (!appointment || shouldStopReminders(appointment.status) || !isRemindableStatus(appointment.status)) {
        await finishReminder(reminder.id, {
          status: "cancelled",
          lastError: `ineligible:${appointment?.status || "missing"}`,
        });
        summary.cancelled += 1;
        continue;
      }

      const payload = appointmentPayload(appointment);
      const appointmentAt = appointmentInstant(payload.date, payload.time);
      if (!appointmentAt || appointmentAt.getTime() <= now.getTime()) {
        await finishReminder(reminder.id, { status: "skipped", lastError: "appointment-passed" });
        summary.skipped += 1;
        continue;
      }

      const message = reminderMessage({
        serviceName: payload.serviceName || reminder.service_name,
        date: payload.date,
        time: payload.time,
        now,
        clinicName: settings.clinicName,
      });

      const result = await clinicSms.sendClinicSms({
        userId: payload.userId,
        message,
        messageType: `appointment_reminder_${reminder.reminder_kind}`,
        appointmentId: payload.id,
        category: "appointment",
        actorRole: "system",
        actorId: "appointment-reminder-job",
        origin: "automatic",
        idempotencyKey: `reminder:${payload.id}:${reminder.reminder_kind}:${reminder.schedule_version}`,
      });

      if (result.status === "sent") {
        await finishReminder(reminder.id, {
          status: "sent",
          smsLogId: result.logId,
          providerMessageId: result.providerMessageId,
        });
        summary.sent += 1;
      } else if (result.status === "skipped") {
        await finishReminder(reminder.id, {
          status: "skipped",
          smsLogId: result.logId,
          lastError: result.reason,
        });
        summary.skipped += 1;
      } else if (result.uncertain) {
        await finishReminder(reminder.id, {
          status: "failed",
          smsLogId: result.logId,
          retryCount: Number(reminder.retry_count || 0) + 1,
          lastError: result.reason || "provider-timeout-unconfirmed",
        });
        summary.failed += 1;
      } else {
        await finishReminder(reminder.id, {
          status: "failed",
          smsLogId: result.logId,
          retryCount: Number(reminder.retry_count || 0) + 1,
          lastError: result.reason,
        });
        summary.failed += 1;
      }
    }

    return summary;
  }

  async function sendEventSms({ appointment, action, actorRole, actorId, previous }) {
    const payload = appointmentPayload(appointment);
    const settings = await clinicSms.getSmsSettings();
    let type = action;
    let message = null;
    if (action === "confirm" || action === "approve" || action === "created") {
      type = "confirmed";
      message = confirmationMessage({
        serviceName: payload.serviceName,
        date: payload.date,
        time: payload.time,
      });
    } else if (action === "reschedule") {
      type = "rescheduled";
      message = rescheduleMessage(payload);
    } else if (action === "cancel" || action === "deny") {
      type = action === "deny" ? "denied" : "cancelled";
      message = cancelMessage(payload);
    } else if (action === "service") {
      type = "updated";
      message = updateMessage({ ...payload, change: "service" });
    } else if (action === "updated") {
      type = "updated";
      message = updateMessage(payload);
    } else {
      return { status: "skipped", reason: "no-sms-for-action" };
    }

    return clinicSms.sendClinicSms({
      userId: payload.userId,
      message,
      messageType: `appointment_${type}`,
      appointmentId: payload.id,
      category: "appointment",
      actorRole,
      actorId,
      origin: actorRole === "system" ? "automatic" : actorRole ? "automatic" : "automatic",
      idempotencyKey: `appointment:${payload.id}:${type}:${payload.date}:${payload.time}:${previous?.service_name || payload.serviceName}`,
    });
  }

  async function handleAppointmentEvent({
    appointment,
    previous = null,
    action,
    actorRole = "staff",
    actorId = null,
    sendImmediate = true,
    now = new Date(),
  }) {
    if (!appointment) return { status: "skipped", reason: "missing-appointment" };
    const payload = appointmentPayload(appointment);
    const previousPayload = previous ? appointmentPayload(previous) : null;

    if (action === "complete" || payload.status === "completed" || payload.status === "no_show") {
      await cancelPendingReminders(payload.id, payload.status || "completed");
      return { status: "cancelled-reminders", remindersStopped: true };
    }

    if (action === "cancel" || action === "deny" || payload.status === "cancelled") {
      await cancelPendingReminders(payload.id, "cancelled");
      const sms = sendImmediate
        ? await sendEventSms({ appointment, action: action === "deny" ? "deny" : "cancel", actorRole, actorId })
        : { status: "skipped" };
      return { ...sms, remindersStopped: true };
    }

    if (action === "reschedule" || payload.status === "rescheduled") {
      if (previousPayload?.id && previousPayload.id !== payload.id) {
        await cancelPendingReminders(previousPayload.id, "rescheduled");
      }
      const reminders = await scheduleRemindersForAppointment(appointment, { now });
      const sms = sendImmediate
        ? await sendEventSms({ appointment, action: "reschedule", actorRole, actorId, previous })
        : { status: "skipped" };
      return { ...sms, reminders };
    }

    if (action === "confirm" || action === "approve" || action === "created") {
      const reminders = await scheduleRemindersForAppointment(appointment, { now });
      const sms = sendImmediate
        ? await sendEventSms({ appointment, action, actorRole, actorId })
        : { status: "skipped" };
      return { ...sms, reminders };
    }

    const dateChanged =
      previousPayload && (previousPayload.date !== payload.date || previousPayload.time !== payload.time);
    const serviceChanged = previousPayload && previousPayload.serviceName !== payload.serviceName;

    if (dateChanged) {
      const reminders = await scheduleRemindersForAppointment(appointment, { now });
      const sms = sendImmediate
        ? await sendEventSms({ appointment, action: "reschedule", actorRole, actorId, previous })
        : { status: "skipped" };
      return { ...sms, reminders };
    }

    if (serviceChanged) {
      await refreshReminderContent(appointment);
      const sms = sendImmediate
        ? await sendEventSms({ appointment, action: "service", actorRole, actorId, previous })
        : { status: "skipped" };
      return { ...sms, contentUpdated: true };
    }

    if (isRemindableStatus(payload.status)) {
      const reminders = await scheduleRemindersForAppointment(appointment, { now });
      return { status: "scheduled", reminders };
    }

    return { status: "skipped", reason: "no-meaningful-change" };
  }

  async function listReminders(appointmentId) {
    try {
      const result = await db.query(
        `SELECT *
         FROM clinic_appointment_sms_reminders
         WHERE appointment_id = $1
         ORDER BY schedule_version DESC, reminder_kind ASC`,
        [appointmentId]
      );
      return result.rows.map((row) => ({
        id: row.id,
        appointmentId: row.appointment_id,
        kind: row.reminder_kind,
        version: row.schedule_version,
        scheduledFor: row.scheduled_for,
        appointmentAt: row.appointment_at,
        status: row.status,
        serviceName: row.service_name,
        retryCount: Number(row.retry_count || 0),
        lastError: row.last_error,
        sentAt: row.sent_at,
      }));
    } catch (error) {
      if (await missingOk(error)) return [];
      throw error;
    }
  }

  function previewMessage({ messageType, appointment, queueEntry, customMessage, clinicName }) {
    const payload = appointment ? appointmentPayload(appointment) : {};
    if (customMessage) return String(customMessage).trim().slice(0, 480);
    switch (messageType) {
      case "appointment_confirmed":
        return confirmationMessage(payload);
      case "appointment_reminder":
      case "appointment_reminder_24h":
      case "appointment_reminder_10h":
        return reminderMessage({ ...payload, clinicName });
      case "appointment_rescheduled":
        return rescheduleMessage(payload);
      case "appointment_cancelled":
        return cancelMessage(payload);
      case "appointment_updated":
        return updateMessage(payload);
      case "queue_updated":
      case "queue_wait":
        return queueUpdateMessage({
          waitMinutes: queueEntry?.estimated_wait_minutes ?? queueEntry?.waitMinutes,
          status: queueEntry?.status,
          clinicName,
        });
      case "queue_approaching":
        return queueUpdateMessage({ status: "preparing", clinicName });
      default:
        return customMessage || "";
    }
  }

  return {
    scheduleRemindersForAppointment,
    cancelPendingReminders,
    handleAppointmentEvent,
    processDueReminders,
    listReminders,
    previewMessage,
    refreshReminderContent,
  };
}

module.exports = {
  createAppointmentSms,
  planReminderTimes,
  reminderMessage,
  confirmationMessage,
  rescheduleMessage,
  cancelMessage,
  updateMessage,
  queueUpdateMessage,
  whenPhrase,
  appointmentInstant,
  formatClock12,
  isRemindableStatus,
  shouldStopReminders,
};
