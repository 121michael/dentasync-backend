"use strict";

const nodemailer = require("nodemailer");

function getMailConfig(env = process.env) {
  const user = String(env.EMAIL_USER || "").trim();
  const pass = String(env.EMAIL_PASSWORD || env.EMAIL_PASS || "").replace(/\s+/g, "");
  const from = String(env.EMAIL_FROM || user || "").trim();
  const host = String(env.EMAIL_HOST || "").trim();
  const port = Number(env.EMAIL_PORT || 587);
  const appsScriptUrl = String(env.GMAIL_APPS_SCRIPT_URL || "").trim();
  const appsScriptSecret = String(env.GMAIL_APPS_SCRIPT_SECRET || "").trim();
  const smtpConfigured = Boolean(user && pass && from);
  const httpsRelayConfigured = Boolean(appsScriptUrl && appsScriptSecret);
  return {
    user,
    pass,
    from,
    host,
    port,
    appsScriptUrl,
    appsScriptSecret,
    secure:
      env.EMAIL_SECURE === "true" ||
      (!env.EMAIL_SECURE && Number(env.EMAIL_PORT) === 465),
    smtpConfigured,
    httpsRelayConfigured,
    configured: smtpConfigured || httpsRelayConfigured,
  };
}

function emailDeliveryIsConfigured(env = process.env) {
  return getMailConfig(env).configured;
}

function createMailTransporter(env = process.env) {
  const config = getMailConfig(env);
  if (config.host) {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
  }

  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: config.user, pass: config.pass },
  });
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function describeSmtpFailure(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "unknown");
  if (
    ["ETIMEDOUT", "ESOCKET", "ECONNECTION", "ENETUNREACH", "ECONNREFUSED"].includes(code) ||
    /timeout|network is unreachable|connect e/i.test(message)
  ) {
    return (
      "Gmail SMTP is blocked on Render Free (ports 587/465). " +
      "Set GMAIL_APPS_SCRIPT_URL and GMAIL_APPS_SCRIPT_SECRET to send OTP over HTTPS, " +
      "or upgrade the dentasync web service off Free."
    );
  }
  return message;
}

async function sendViaGmailHttpsRelay(config, { to, subject, html }, fetchImpl = fetch) {
  const response = await fetchImpl(config.appsScriptUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      secret: config.appsScriptSecret,
      to,
      subject,
      html,
    }),
  });
  const body = String(await response.text());
  const accepted = /\bok\b/i.test(body) || /"status"\s*:\s*"ok"/i.test(body);
  if (!response.ok || !accepted) {
    throw new Error(
      `Gmail HTTPS relay failed (${response.status}): ${body.replace(/\s+/g, " ").slice(0, 220)}`
    );
  }
}

async function sendMailMessage({ to, subject, html }, env = process.env, fetchImpl = fetch) {
  const config = getMailConfig(env);
  if (!config.configured) {
    throw new Error("Email delivery is not configured.");
  }

  if (config.httpsRelayConfigured) {
    return sendViaGmailHttpsRelay(config, { to, subject, html }, fetchImpl);
  }

  try {
    return await createMailTransporter(env).sendMail({
      from: `"Amethyst Dental Clinic" <${config.from}>`,
      to,
      subject,
      html,
    });
  } catch (error) {
    throw new Error(describeSmtpFailure(error));
  }
}

function otpHtml(otp, minutesRemaining) {
  return `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Welcome to DentaSync!</h2>
        <p>Your 6-digit verification code is:</p>
        <h1 style="color: #4F46E5; letter-spacing: 5px;">${otp}</h1>
        <p>This code will expire in approximately ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"}.</p>
      </div>
    `;
}

async function sendEmailOtp({ to, otp, expiresAt }, env = process.env, fetchImpl = fetch) {
  const expiration = new Date(expiresAt);
  const minutesRemaining = Number.isNaN(expiration.getTime())
    ? 5
    : Math.max(1, Math.ceil((expiration.getTime() - Date.now()) / 60000));

  return sendMailMessage(
    {
      to,
      subject: "Your DentaSync Verification Code",
      html: otpHtml(otp, minutesRemaining),
    },
    env,
    fetchImpl
  );
}

async function sendPasswordResetEmail(
  { to, token, expiresAt, recipientName },
  env = process.env,
  fetchImpl = fetch
) {
  const expiration = new Date(expiresAt);
  const minutesRemaining = Number.isNaN(expiration.getTime())
    ? 30
    : Math.max(1, Math.ceil((expiration.getTime() - Date.now()) / 60000));
  const resetUrl = new URL(
    env.FRONTEND_URL || env.PASSWORD_RESET_URL || "http://localhost:5173"
  );
  const basePath = resetUrl.pathname.replace(/\/$/, "");
  const resetPath = basePath.endsWith("/reset-password")
    ? basePath
    : `${basePath}/reset-password`;
  resetUrl.pathname = `${resetPath}/${encodeURIComponent(token)}`;
  resetUrl.search = "";
  const safeRecipientName = escapeHtml(recipientName || "there");

  return sendMailMessage(
    {
      to,
      subject: "Password Reset Request - Amethyst Dental Clinic",
      html: `
      <div style="font-family: Arial, sans-serif; padding: 20px; color: #333;">
        <h2>Reset your password</h2>
        <p>Hello ${safeRecipientName},</p>
        <p>We received a request to reset your password for your Amethyst Dental Clinic account.</p>
        <p>
          <a href="${resetUrl.toString()}" style="display:inline-block;padding:12px 18px;border-radius:8px;color:#fff;background:#5B2A86;text-decoration:none;">
            Reset Password
          </a>
        </p>
        <p>This link expires in approximately ${minutesRemaining} minute${minutesRemaining === 1 ? "" : "s"} and can be used once.</p>
        <p>If you did not request this change, you can safely ignore this email.</p>
      </div>
    `,
    },
    env,
    fetchImpl
  );
}

module.exports = {
  getMailConfig,
  emailDeliveryIsConfigured,
  createMailTransporter,
  sendEmailOtp,
  sendPasswordResetEmail,
};
