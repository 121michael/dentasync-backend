"use strict";

function monthsBetween(fromDate, toDate = new Date()) {
  const from = new Date(fromDate);
  const to = new Date(toDate);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
}

function createCleaningReminderJob({ db, clinicSms, intervalMs = 6 * 60 * 60 * 1000 }) {
  let timer = null;
  let running = false;

  async function findDuePatients(months) {
    const result = await db.query(
      `WITH last_visits AS (
         SELECT
           users.id::text AS user_id,
           users.phone,
           CONCAT_WS(' ', users.first_name, users.last_name) AS full_name,
           COALESCE(
             profile.last_cleaning,
             (
               SELECT MAX(appointment.appointment_date)
               FROM patient_portal_appointments AS appointment
               WHERE appointment.user_id = users.id::text
                 AND appointment.status = 'completed'
                 AND (
                   LOWER(appointment.service_name) LIKE '%clean%'
                   OR LOWER(appointment.service_name) LIKE '%prophylaxis%'
                   OR LOWER(appointment.service_id) LIKE '%clean%'
                 )
             ),
             (
               SELECT MAX(appointment.appointment_date)
               FROM patient_portal_appointments AS appointment
               WHERE appointment.user_id = users.id::text
                 AND appointment.status = 'completed'
             )
           ) AS reference_date
         FROM users
         LEFT JOIN patient_portal_profiles AS profile ON profile.user_id = users.id::text
         WHERE LOWER(users.role) = 'patient'
           AND users.is_verified = TRUE
           AND COALESCE(users.is_archived, FALSE) = FALSE
           AND LOWER(COALESCE(users.status, 'active')) NOT IN ('inactive', 'disabled', 'suspended')
           AND COALESCE(users.phone, '') <> ''
       )
       SELECT *
       FROM last_visits
       WHERE reference_date IS NOT NULL
         AND reference_date <= (CURRENT_DATE - ($1::text || ' months')::interval)::date
       ORDER BY reference_date ASC
       LIMIT 100`,
      [String(Math.max(4, Math.min(6, Number(months) || 5)))]
    );
    return result.rows;
  }

  async function alreadyRemindedThisMonth(userId) {
    const periodKey = new Date().toISOString().slice(0, 7);
    try {
      const result = await db.query(
        `SELECT id
         FROM clinic_sms_reminder_runs
         WHERE patient_user_id = $1
           AND reminder_type = 'cleaning'
           AND period_key = $2
         LIMIT 1`,
        [String(userId), periodKey]
      );
      return Boolean(result.rows.length);
    } catch (error) {
      if (error?.code === "42P01") return false;
      throw error;
    }
  }

  async function recordReminderRun({ userId, referenceDate, messageBody, deliveryStatus, smsLogId }) {
    const periodKey = new Date().toISOString().slice(0, 7);
    try {
      await db.query(
        `INSERT INTO clinic_sms_reminder_runs (
           patient_user_id, reminder_type, reference_date, message_body, delivery_status, sms_log_id, period_key
         ) VALUES ($1, 'cleaning', $2, $3, $4, $5, $6)
         ON CONFLICT (patient_user_id, reminder_type, period_key) DO NOTHING`,
        [String(userId), referenceDate, messageBody, deliveryStatus, smsLogId || null, periodKey]
      );
    } catch (error) {
      if (error?.code === "42P01" || error?.code === "23505") return;
      console.warn("Unable to record cleaning reminder run:", error.message);
    }
  }

  async function runOnce() {
    if (running) return { skipped: true, reason: "already-running" };
    running = true;
    try {
      const settings = await clinicSms.getSmsSettings();
      if (!settings.smsEnabled || !settings.cleaningReminderSms) {
        return { skipped: true, reason: "disabled" };
      }

      const months = Math.max(4, Math.min(6, Number(settings.cleaningReminderMonths) || 5));
      const duePatients = await findDuePatients(months);
      let sent = 0;
      let failed = 0;
      let skipped = 0;

      for (const patient of duePatients) {
        if (await alreadyRemindedThisMonth(patient.user_id)) {
          skipped += 1;
          continue;
        }

        const elapsed = monthsBetween(patient.reference_date);
        const message = `${settings.clinicName || "Amethyst Dental Clinic"}: It's been about ${elapsed || months} months since your last cleaning/visit. Book your next cleaning with us when you're ready.`;

        const result = await clinicSms.sendClinicSms({
          userId: patient.user_id,
          phone: patient.phone,
          message,
          messageType: "cleaning_reminder",
          category: "cleaning",
          actorRole: "system",
          actorId: "cleaning-reminder-job",
        });

        await recordReminderRun({
          userId: patient.user_id,
          referenceDate: patient.reference_date,
          messageBody: message,
          deliveryStatus: result.status,
          smsLogId: result.logId,
        });

        if (result.status === "sent") sent += 1;
        else if (result.status === "failed") failed += 1;
        else skipped += 1;
      }

      return { sent, failed, skipped, due: duePatients.length, months };
    } catch (error) {
      console.error("Cleaning reminder job failed:", error.message);
      return { error: error.message };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    // Run shortly after boot, then on an interval.
    setTimeout(() => {
      runOnce().then((result) => {
        if (!result?.skipped) {
          console.log(
            `Cleaning reminder job finished: sent=${result.sent || 0} failed=${result.failed || 0} skipped=${result.skipped || 0}`
          );
        }
      });
    }, 20_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.error("Cleaning reminder interval error:", error.message));
    }, intervalMs);
    if (typeof timer.unref === "function") timer.unref();
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return { start, stop, runOnce };
}

module.exports = {
  createCleaningReminderJob,
  monthsBetween,
};
