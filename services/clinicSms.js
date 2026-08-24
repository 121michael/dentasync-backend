"use strict";

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

function createClinicSmsService({
  db,
  twilioClient = null,
  fromNumber = null,
  clinicName = "Amethyst Dental Clinic",
}) {
  async function getSmsSettings() {
    const defaults = {
      smsEnabled: true,
      appointmentSms: true,
      queueSms: true,
      cleaningReminderSms: true,
      cleaningReminderMonths: 5,
      clinicName,
    };
    try {
      const result = await db.query(
        `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'sms' LIMIT 1`
      );
      const value = result.rows[0]?.setting_value || {};
      return {
        ...defaults,
        ...value,
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
  }) {
    try {
      const result = await db.query(
        `INSERT INTO clinic_sms_logs (
           patient_user_id, patient_phone, appointment_id, queue_entry_id,
           message_type, message_body, delivery_status, error_detail, actor_role, actor_id
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id`,
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
      return result.rows[0]?.id || null;
    } catch (error) {
      if (error?.code === "42P01") {
        console.warn("clinic_sms_logs missing; run npm run migrate:patient-sms");
        return null;
      }
      console.warn("Unable to write clinic SMS log:", error.message);
      return null;
    }
  }

  async function dispatchSms(toPhone, body) {
    if (!twilioClient || !fromNumber) {
      const error = new Error("Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER.");
      error.code = "TWILIO_NOT_CONFIGURED";
      throw error;
    }
    const to = formatPhoneE164(toPhone);
    if (!to) {
      const error = new Error("Patient phone number is missing or invalid.");
      error.code = "INVALID_PHONE";
      throw error;
    }
    return twilioClient.messages.create({
      body,
      from: fromNumber,
      to,
    });
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
    category = "general", // appointment | queue | cleaning | general | otp
    respectPreferences = true,
  }) {
    const settings = await getSmsSettings();
    const body = String(message || "").trim().slice(0, 480);
    if (!body) {
      return { status: "skipped", reason: "Empty message body." };
    }

    if (!settings.smsEnabled && category !== "otp") {
      const logId = await writeLog({
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
      });
      return { status: "skipped", reason: "Clinic SMS disabled.", logId };
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

    try {
      await dispatchSms(targetPhone, body);
      const logId = await writeLog({
        patientUserId: userId || patient?.id,
        patientPhone: formatPhoneE164(targetPhone),
        appointmentId,
        queueEntryId,
        messageType,
        messageBody: body,
        deliveryStatus: "sent",
        actorRole,
        actorId,
      });
      return { status: "sent", logId, phone: formatPhoneE164(targetPhone) };
    } catch (error) {
      const logId = await writeLog({
        patientUserId: userId || patient?.id,
        patientPhone: formatPhoneE164(targetPhone),
        appointmentId,
        queueEntryId,
        messageType,
        messageBody: body,
        deliveryStatus: "failed",
        errorDetail: error.message,
        actorRole,
        actorId,
      });
      return { status: "failed", reason: error.message, logId };
    }
  }

  function appointmentMessage(type, { serviceName, date, time, clinic }) {
    const when = `${date} at ${String(time || "").slice(0, 5)}`;
    const place = clinic || settingsClinicFallback();
    if (type === "confirmed") {
      return `${place}: Your ${serviceName} appointment is confirmed for ${when}.`;
    }
    if (type === "rescheduled") {
      return `${place}: Your ${serviceName} appointment was rescheduled to ${when}.`;
    }
    if (type === "cancelled") {
      return `${place}: Your ${serviceName} appointment on ${when} was cancelled. Please contact the clinic if needed.`;
    }
    if (type === "denied") {
      return `${place}: Your ${serviceName} appointment request for ${when} could not be approved. Please choose another time.`;
    }
    return `${place}: Your appointment was updated (${when}).`;
  }

  function settingsClinicFallback() {
    return clinicName;
  }

  function queueMessage({ token, position, status, waitMinutes, clinic }) {
    const place = clinic || clinicName;
    const label = String(status || "updated").replaceAll("_", " ");
    if (status === "dentist" || status === "in_chair" || status === "called" || status === "preparing") {
      return `${place}: You are next / being called. Queue ${token || `#${position}`}. Please proceed to the waiting area.`;
    }
    if (status === "completed") {
      return `${place}: Your visit is marked completed. Thank you for choosing ${place}.`;
    }
    if (status === "checked_in" || status === "waiting") {
      return `${place}: Checked in. Queue ${token || `#${position}`}. Est. wait ~${waitMinutes ?? 0} min.`;
    }
    return `${place}: Queue update – ${token || `#${position}`} is now ${label}.`;
  }

  async function notifyAppointmentSms({
    userId,
    appointment,
    action,
    actorRole = "staff",
    actorId = null,
  }) {
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

  async function notifyQueueSms({
    userId,
    queueEntry,
    actorRole = "staff",
    actorId = null,
  }) {
    const settings = await getSmsSettings();
    const message = queueMessage({
      token: queueEntry.token,
      position: queueEntry.position,
      status: queueEntry.status,
      waitMinutes: queueEntry.estimated_wait_minutes ?? queueEntry.waitMinutes,
      clinic: settings.clinicName,
    });
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

  return {
    getSmsSettings,
    getPatientSmsPrefs,
    sendClinicSms,
    notifyAppointmentSms,
    notifyQueueSms,
    formatPhoneE164,
    appointmentMessage,
    queueMessage,
  };
}

module.exports = {
  createClinicSmsService,
  formatPhoneE164,
};
