"use strict";

function createAppointmentReminderJob({ db, clinicSms, intervalMs = 60 * 1000 }) {
  let timer = null;
  let running = false;

  async function runOnce() {
    if (running) return { skipped: true, reason: "already-running" };
    running = true;
    try {
      if (!clinicSms?.processDueReminders) {
        return { skipped: true, reason: "sms-service-missing" };
      }
      return await clinicSms.processDueReminders();
    } catch (error) {
      console.error("Appointment reminder job failed:", error.message);
      return { error: error.message };
    } finally {
      running = false;
    }
  }

  function start() {
    if (timer) return;
    setTimeout(() => {
      runOnce().then((result) => {
        if (!result?.skipped && !result?.error) {
          console.log(
            `Appointment reminder job finished: sent=${result.sent || 0} failed=${result.failed || 0} skipped=${result.skipped || 0} cancelled=${result.cancelled || 0}`
          );
        }
      });
    }, 15_000);
    timer = setInterval(() => {
      runOnce().catch((error) => console.error("Appointment reminder interval error:", error.message));
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
  createAppointmentReminderJob,
};
