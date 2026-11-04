"use strict";

const {
  getMailConfig,
  probeGmailHttpsRelay,
  sendEmailOtp,
} = require("./emailDelivery");

function sanitizeProbe(probe) {
  if (!probe) {
    return { reached: false, httpOk: false };
  }
  const status = Number(probe.status) || 0;
  return {
    reached: Boolean(probe.scriptReached),
    httpOk: status >= 200 && status < 300,
  };
}

async function buildAdminOtpMailStatus({ sendTest = false, env = process.env } = {}) {
  const mail = getMailConfig(env);
  let probe = null;
  try {
    probe = await probeGmailHttpsRelay(env);
  } catch {
    probe = { status: 0, scriptReached: false };
  }

  const payload = {
    emailDeliveryConfigured: Boolean(mail.configured),
    httpsRelayConfigured: Boolean(mail.httpsRelayConfigured),
    smtpConfigured: Boolean(mail.smtpConfigured),
    relay: sanitizeProbe(probe),
  };

  if (sendTest && mail.httpsRelayConfigured && mail.user) {
    try {
      await sendEmailOtp({
        to: mail.user,
        otp: "000000",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      });
      payload.testSend = { ok: true };
    } catch {
      payload.testSend = { ok: false };
    }
  }

  return payload;
}

module.exports = {
  buildAdminOtpMailStatus,
  sanitizeProbe,
};
