"use strict";

const { createAppointmentSms, queueUpdateMessage } = require("./appointmentSms");

function formatPhoneE164(phone) {
  if (phone == null) return null;
  let formatted = String(phone).trim();
  if (!formatted) return null;
  if (formatted.startsWith("0")) {
    formatted = `+63${formatted.substring(1)}`;
  } else if (/^63\d+$/.test(formatted)) {
    formatted = `+${formatted}`;
  } else if (!formatted.startsWith("+") && /^\d{10,15}$/.test(formatted)) {
    formatted = `+${formatted}`;
  }
  return formatted;
}

/** Semaphore accepts 09xxxxxxxxx, 63xxxxxxxxx, or 9xxxxxxxxx (no +). */
function formatPhoneSemaphore(phone) {
  const e164 = formatPhoneE164(phone);
  if (!e164) return null;
  const digits = e164.replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length >= 12) return digits;
  if (digits.startsWith("0") && digits.length >= 11) return `63${digits.slice(1)}`;
  if (digits.length === 10) return `63${digits}`;
  return digits || null;
}

function isValidPhMobile(phone) {
  const formatted = formatPhoneSemaphore(phone);
  return Boolean(formatted && /^63\d{10}$/.test(formatted));
}

function maskPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length < 7) return "••••";
  return `${digits.slice(0, 4)}****${digits.slice(-3)}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientProviderError(error) {
  const code = error?.code || "";
  const status = Number(error?.httpStatus || 0);
  if (code === "SEMAPHORE_TIMEOUT" || code === "SEMAPHORE_NETWORK") return true;
  if (status === 429 || status >= 500) return true;
  return false;
}

function parseSemaphoreResult(data) {
  const row = Array.isArray(data) ? data[0] : data;
  const providerMessageId =
    row?.message_id != null
      ? String(row.message_id)
      : row?.messageId != null
        ? String(row.messageId)
        : null;
  const rawStatus = String(row?.status || "").toLowerCase();
  if (rawStatus === "delivered") {
    return { providerMessageId, deliveryStatus: "delivered", accepted: true };
  }
  if (["failed", "refunded", "rejected"].includes(rawStatus)) {
    return { providerMessageId, deliveryStatus: "failed", accepted: false, reason: row?.status };
  }
  return { providerMessageId, deliveryStatus: "sent", accepted: true };
}

function createClinicSmsService({
  db,
  semaphoreApiKey = null,
  semaphoreSenderName = null,
  clinicName = "Amethyst Dental Clinic",
  fetchImpl = fetch,
  sleepImpl = sleep,
}) {
  async function getSmsSettings() {
    const defaults = {
      smsEnabled: true,
      appointmentSms: true,
      appointmentReminderSms: true,
      queueSms: true,
      cleaningReminderSms: true,
      cleaningReminderMonths: 5,
      clinicName,
      provider: "semaphore",
    };
    try {
      const result = await db.query(
        `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'sms' LIMIT 1`
      );
      const value = result.rows[0]?.setting_value || {};
      return {
        ...defaults,
        ...value,
        provider: "semaphore",
        cleaningReminderMonths: Number(value.cleaningReminderMonths || defaults.cleaningReminderMonths) || 5,
      };
    } catch (error) {
      if (error?.code === "42P01") return defaults;
      throw error;
    }
  }

  async function getPatientSmsPrefs(userId) {
    const defaults = {
      notifySms: true,
      notifyAppointmentSms: true,
      notifyQueueSms: true,
      notifyCleaningSms: true,
    };
    try {
      const result = await db.query(
        `SELECT
           COALESCE(notify_sms, TRUE) AS notify_sms,
           COALESCE(notify_appointment_sms, TRUE) AS notify_appointment_sms,
           COALESCE(notify_queue_sms, TRUE) AS notify_queue_sms,
           COALESCE(notify_cleaning_sms, TRUE) AS notify_cleaning_sms
         FROM patient_portal_preferences
         WHERE user_id = $1
         LIMIT 1`,
        [String(userId)]
      );
      if (!result.rows.length) return defaults;
      const row = result.rows[0];
      return {
        notifySms: Boolean(row.notify_sms),
        notifyAppointmentSms: Boolean(row.notify_appointment_sms),
        notifyQueueSms: Boolean(row.notify_queue_sms),
        notifyCleaningSms: Boolean(row.notify_cleaning_sms),
      };
    } catch (error) {
      if (error?.code === "42P01" || error?.code === "42703") return defaults;
      throw error;
    }
  }

  async function resolvePatientContact(userId) {
    const result = await db.query(
      `SELECT id, first_name, last_name, phone, email
       FROM users
       WHERE id::text = $1
       LIMIT 1`,
      [String(userId)]
    );
    return result.rows[0] || null;
  }

  function mapSmsLog(row) {
    if (!row) return null;
    return {
      id: row.id,
      patientUserId: row.patient_user_id,
      appointmentId: row.appointment_id,
      queueEntryId: row.queue_entry_id,
      messageType: row.message_type,
      messageBody: row.message_body,
      status: row.delivery_status,
      errorDetail: row.error_detail,
      origin: row.origin || null,
      actorRole: row.actor_role,
      actorId: row.actor_id,
      providerMessageId: row.provider_message_id || null,
      retryCount: Number(row.retry_count || 0),
      scheduledAt: row.scheduled_at || null,
      sentAt: row.sent_at || null,
      createdAt: row.created_at,
      recipientMasked: maskPhone(row.patient_phone),
    };
  }

  async function writeLog({
    patientUserId = null,
    patientPhone = null,
    appointmentId = null,
    queueEntryId = null,
    messageType,
    messageBody,
    deliveryStatus,
    errorDetail = null,
    actorRole = null,
    actorId = null,
    origin = "automatic",
    providerMessageId = null,
    retryCount = 0,
    scheduledAt = null,
    sentAt = null,
    idempotencyKey = null,
  }) {
    try {
      const result = await db.query(
        `INSERT INTO clinic_sms_logs (
           patient_user_id, patient_phone, appointment_id, queue_entry_id,
           message_type, message_body, delivery_status, error_detail, actor_role, actor_id,
           origin, provider_message_id, retry_count, scheduled_at, sent_at, idempotency_key
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
         RETURNING *`,
        [
          patientUserId ? String(patientUserId) : null,
          patientPhone,
          appointmentId,
          queueEntryId,
          messageType,
          messageBody,
          deliveryStatus,
          errorDetail,
          actorRole,
          actorId ? String(actorId) : null,
          origin,
          providerMessageId,
          retryCount,
          scheduledAt,
          sentAt,
          idempotencyKey,
        ]
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error?.code === "42703") {
        try {
          const fallback = await db.query(
            `INSERT INTO clinic_sms_logs (
               patient_user_id, patient_phone, appointment_id, queue_entry_id,
               message_type, message_body, delivery_status, error_detail, actor_role, actor_id
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING *`,
            [
              patientUserId ? String(patientUserId) : null,
              patientPhone,
              appointmentId,
              queueEntryId,
              messageType,
              messageBody,
              deliveryStatus,
              errorDetail,
              actorRole,
              actorId ? String(actorId) : null,
            ]
          );
          return fallback.rows[0] || null;
        } catch (fallbackError) {
          if (fallbackError?.code === "42P01") {
            console.warn("clinic_sms_logs missing; run npm run migrate:patient-sms");
            return null;
          }
          console.warn("Unable to write clinic SMS log:", fallbackError.message);
          return null;
        }
      }
      if (error?.code === "42P01") {
        console.warn("clinic_sms_logs missing; run npm run migrate:patient-sms");
        return null;
      }
      if (error?.code === "23505") {
        return { id: null, duplicate: true, delivery_status: deliveryStatus };
      }
      console.warn("Unable to write clinic SMS log:", error.message);
      return null;
    }
  }

  async function readIdempotency(key) {
    if (!key) return null;
    try {
      const result = await db.query(
        `SELECT * FROM clinic_sms_idempotency WHERE idempotency_key = $1 LIMIT 1`,
        [key]
      );
      return result.rows[0] || null;
    } catch (error) {
      if (error?.code === "42P01") return null;
      throw error;
    }
  }

  async function writeIdempotency(key, smsLogId, deliveryStatus) {
    if (!key) return;
    try {
      await db.query(
        `INSERT INTO clinic_sms_idempotency (idempotency_key, sms_log_id, delivery_status)
         VALUES ($1,$2,$3)
         ON CONFLICT (idempotency_key) DO UPDATE
           SET sms_log_id = COALESCE(EXCLUDED.sms_log_id, clinic_sms_idempotency.sms_log_id),
               delivery_status = EXCLUDED.delivery_status,
               updated_at = CURRENT_TIMESTAMP`,
        [key, smsLogId || null, deliveryStatus]
      );
    } catch (error) {
      if (error?.code !== "42P01") {
        console.warn("Unable to store SMS idempotency key:", error.message);
      }
    }
  }

  async function dispatchSms(toPhone, body) {
    if (!semaphoreApiKey) {
      const error = new Error(
        "Semaphore is not configured. Set SEMAPHORE_API_KEY in the server environment (optional SEMAPHORE_SENDER_NAME)."
      );
      error.code = "SEMAPHORE_NOT_CONFIGURED";
      throw error;
    }

    const number = formatPhoneSemaphore(toPhone);
    if (!number || !isValidPhMobile(number)) {
      const error = new Error("Patient phone number is missing or invalid.");
      error.code = "INVALID_PHONE";
      throw error;
    }

    // Semaphore silently ignores messages that start with "TEST".
    const safeBody = /^\s*test\b/i.test(body) ? `Amethyst notice: ${body.trim()}` : body;

    const payload = new URLSearchParams();
    payload.set("apikey", semaphoreApiKey);
    payload.set("number", number);
    payload.set("message", safeBody.slice(0, 480));
    if (semaphoreSenderName) {
      payload.set("sendername", semaphoreSenderName);
    }

    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        let response;
        try {
          response = await fetchImpl("https://api.semaphore.co/api/v4/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: payload.toString(),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        const text = await response.text();
        let data = null;
        try {
          data = text ? JSON.parse(text) : null;
        } catch {
          data = { raw: text };
        }

        if (!response.ok) {
          const detail =
            (Array.isArray(data) && data[0]?.message) ||
            data?.message ||
            data?.raw ||
            `Semaphore HTTP ${response.status}`;
          const error = new Error(String(detail));
          error.code = "SEMAPHORE_HTTP_ERROR";
          error.httpStatus = response.status;
          error.details = data;
          throw error;
        }

        return parseSemaphoreResult(data);
      } catch (error) {
        lastError = error;
        if (error?.name === "AbortError") {
          const timeoutError = new Error("Semaphore request timed out.");
          timeoutError.code = "SEMAPHORE_TIMEOUT";
          timeoutError.uncertain = true;
          throw timeoutError;
        }
        if (!isTransientProviderError(error) || attempt === 2) {
          throw error;
        }
        await sleepImpl(250 * 2 ** attempt);
      }
    }
    throw lastError;
  }

  async function sendClinicSms({
    userId,
    phone = null,
    message,
    messageType = "manual",
    appointmentId = null,
    queueEntryId = null,
    actorRole = null,
    actorId = null,
    category = "general",
    respectPreferences = true,
    origin = actorRole === "staff" || actorRole === "admin" ? "manual" : "automatic",
    idempotencyKey = null,
  }) {
    const settings = await getSmsSettings();
    const body = String(message || "").trim().slice(0, 480);
    if (!body) {
      return { status: "skipped", reason: "Empty message body." };
    }

    if (idempotencyKey) {
      const existing = await readIdempotency(idempotencyKey);
      if (existing && ["sent", "delivered"].includes(String(existing.delivery_status || ""))) {
        return { status: existing.delivery_status, logId: existing.sms_log_id, duplicate: true };
      }
    }

    if (!settings.smsEnabled && category !== "otp") {
      const log = await writeLog({
        patientUserId: userId,
        patientPhone: phone,
        appointmentId,
        queueEntryId,
        messageType,
        messageBody: body,
        deliveryStatus: "skipped",
        errorDetail: "Clinic SMS is disabled in admin settings.",
        actorRole,
        actorId,
        origin,
        idempotencyKey,
      });
      return { status: "skipped", reason: "Clinic SMS disabled.", logId: log?.id };
    }

    if (category === "appointment" && !settings.appointmentSms) {
      return { status: "skipped", reason: "Appointment SMS disabled." };
    }
    if (category === "queue" && !settings.queueSms) {
      return { status: "skipped", reason: "Queue SMS disabled." };
    }
    if (category === "cleaning" && !settings.cleaningReminderSms) {
      return { status: "skipped", reason: "Cleaning reminder SMS disabled." };
    }

    let patient = null;
    if (userId) {
      patient = await resolvePatientContact(userId);
    }
    const targetPhone = phone || patient?.phone || null;

    if (respectPreferences && userId && category !== "otp") {
      const prefs = await getPatientSmsPrefs(userId);
      if (!prefs.notifySms) {
        return { status: "skipped", reason: "Patient opted out of SMS." };
      }
      if (category === "appointment" && !prefs.notifyAppointmentSms) {
        return { status: "skipped", reason: "Patient opted out of appointment SMS." };
      }
      if (category === "queue" && !prefs.notifyQueueSms) {
        return { status: "skipped", reason: "Patient opted out of queue SMS." };
      }
      if (category === "cleaning" && !prefs.notifyCleaningSms) {
        return { status: "skipped", reason: "Patient opted out of cleaning reminders." };
      }
    }

    if (appointmentId && userId) {
      try {
        const owned = await db.query(
          `SELECT id FROM patient_portal_appointments WHERE id = $1 AND user_id = $2 LIMIT 1`,
          [appointmentId, String(userId)]
        );
        if (!owned.rows.length) {
          return { status: "failed", reason: "Patient and appointment do not match." };
        }
      } catch (error) {
        if (error?.code !== "42P01") throw error;
      }
    }

    try {
      const dispatched = await dispatchSms(targetPhone, body);
      const log = await writeLog({
        patientUserId: userId || patient?.id,
        patientPhone: formatPhoneSemaphore(targetPhone),
        appointmentId,
        queueEntryId,
        messageType,
        messageBody: body,
        deliveryStatus: dispatched.deliveryStatus,
        actorRole,
        actorId,
        origin,
        providerMessageId: dispatched.providerMessageId,
        sentAt: new Date().toISOString(),
        idempotencyKey,
      });
      await writeIdempotency(idempotencyKey, log?.id, dispatched.deliveryStatus);
      return {
        status: dispatched.deliveryStatus,
        logId: log?.id,
        phone: formatPhoneSemaphore(targetPhone),
        recipientMasked: maskPhone(targetPhone),
        providerMessageId: dispatched.providerMessageId,
      };
    } catch (error) {
      const log = await writeLog({
        patientUserId: userId || patient?.id,
        patientPhone: formatPhoneSemaphore(targetPhone),
        appointmentId,
        queueEntryId,
        messageType,
        messageBody: body,
        deliveryStatus: "failed",
        errorDetail: error.message,
        actorRole,
        actorId,
        origin,
        idempotencyKey,
        retryCount: error.uncertain ? 0 : 1,
      });
      if (!error.uncertain) {
        await writeIdempotency(idempotencyKey, log?.id, "failed");
      }
      return {
        status: "failed",
        reason: error.message,
        logId: log?.id,
        uncertain: Boolean(error.uncertain),
        recipientMasked: maskPhone(targetPhone),
      };
    }
  }

  function appointmentMessage(type, { serviceName, date, time, clinic }) {
    const { confirmationMessage, rescheduleMessage, cancelMessage, reminderMessage, updateMessage } =
      require("./appointmentSms");
    if (type === "confirmed") {
      return confirmationMessage({ serviceName, date, time });
    }
    if (type === "rescheduled") {
      return rescheduleMessage({ serviceName, date, time });
    }
    if (type === "cancelled") {
      return cancelMessage({ serviceName, date, time });
    }
    if (type === "reminder") {
      return reminderMessage({ serviceName, date, time, clinicName: clinic });
    }
    if (type === "denied") {
      return `${clinic || clinicName}: Your ${serviceName} appointment request for ${date} at ${String(time || "").slice(0, 5)} could not be approved. Please choose another time.`;
    }
    return updateMessage({ serviceName, date, time });
  }

  function queueMessage({ token, position, status, waitMinutes, clinic }) {
    return queueUpdateMessage({
      waitMinutes,
      status,
      clinicName: clinic || clinicName,
    });
  }

  async function notifyAppointmentSms({
    userId,
    appointment,
    action,
    actorRole = "staff",
    actorId = null,
  }) {
    if (["complete", "completed", "no_show"].includes(String(action || "").toLowerCase())) {
      if (service.handleAppointmentEvent) {
        return service.handleAppointmentEvent({
          appointment: { ...appointment, user_id: userId || appointment.user_id },
          action: "complete",
          actorRole,
          actorId,
          sendImmediate: false,
        });
      }
      return { status: "skipped", reason: "completed" };
    }
    if (service.handleAppointmentEvent) {
      return service.handleAppointmentEvent({
        appointment: { ...appointment, user_id: userId || appointment.user_id },
        action,
        actorRole,
        actorId,
      });
    }
    const settings = await getSmsSettings();
    const type =
      action === "approve" || action === "confirm"
        ? "confirmed"
        : action === "reschedule"
          ? "rescheduled"
          : action === "deny"
            ? "denied"
            : "cancelled";
    const message = appointmentMessage(type, {
      serviceName: appointment.service_name || appointment.service || "dental",
      date: appointment.appointment_date || appointment.date,
      time: appointment.appointment_time || appointment.time,
      clinic: settings.clinicName,
    });
    return sendClinicSms({
      userId,
      message,
      messageType: `appointment_${type}`,
      appointmentId: appointment.id,
      actorRole,
      actorId,
      category: "appointment",
    });
  }

  async function recentQueueFingerprint(queueEntryId, fingerprint) {
    if (!queueEntryId) return false;
    try {
      const result = await db.query(
        `SELECT message_body
         FROM clinic_sms_logs
         WHERE queue_entry_id = $1
           AND message_type LIKE 'queue%'
           AND delivery_status IN ('sent', 'delivered')
           AND created_at > NOW() - INTERVAL '6 hours'
         ORDER BY created_at DESC
         LIMIT 1`,
        [queueEntryId]
      );
      return result.rows[0]?.message_body === fingerprint;
    } catch (error) {
      if (error?.code === "42P01") return false;
      throw error;
    }
  }

  async function notifyQueueSms({
    userId,
    queueEntry,
    actorRole = "staff",
    actorId = null,
    force = false,
  }) {
    const settings = await getSmsSettings();
    const message = queueMessage({
      token: queueEntry.token,
      position: queueEntry.position,
      status: queueEntry.status,
      waitMinutes: queueEntry.estimated_wait_minutes ?? queueEntry.waitMinutes,
      clinic: settings.clinicName,
    });
    if (!force && (await recentQueueFingerprint(queueEntry.id, message))) {
      return { status: "skipped", reason: "unchanged-queue-status" };
    }
    return sendClinicSms({
      userId,
      message,
      messageType: "queue_updated",
      queueEntryId: queueEntry.id,
      appointmentId: queueEntry.appointment_id || null,
      actorRole,
      actorId,
      category: "queue",
    });
  }

  async function listSmsLogs({ limit = 50, appointmentId = null, patientUserId = null } = {}) {
    const clauses = [];
    const params = [];
    if (appointmentId) {
      params.push(appointmentId);
      clauses.push(`appointment_id = $${params.length}`);
    }
    if (patientUserId) {
      params.push(String(patientUserId));
      clauses.push(`patient_user_id = $${params.length}`);
    }
    params.push(Math.max(1, Math.min(200, Number(limit) || 50)));
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    try {
      const result = await db.query(
        `SELECT *
         FROM clinic_sms_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
        params
      );
      return result.rows.map(mapSmsLog);
    } catch (error) {
      if (error?.code === "42P01") return [];
      throw error;
    }
  }

  const service = {
    getSmsSettings,
    getPatientSmsPrefs,
    sendClinicSms,
    notifyAppointmentSms,
    notifyQueueSms,
    formatPhoneE164,
    formatPhoneSemaphore,
    isValidPhMobile,
    maskPhone,
    appointmentMessage,
    queueMessage,
    listSmsLogs,
    mapSmsLog,
  };

  Object.assign(service, createAppointmentSms({ db, clinicSms: service }));
  return service;
}

module.exports = {
  createClinicSmsService,
  formatPhoneE164,
  formatPhoneSemaphore,
  isValidPhMobile,
  maskPhone,
};
