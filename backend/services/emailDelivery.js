"use strict";

const crypto = require("crypto");
const nodemailer = require("nodemailer");

function getMailConfig(env = process.env) {
  const user = String(env.EMAIL_USER || "").trim();
  const pass = String(env.EMAIL_PASSWORD || env.EMAIL_PASS || "").replace(/\s+/g, "");
  const from = String(env.EMAIL_FROM || user || "").trim();
  const host = String(env.EMAIL_HOST || "").trim();
  const port = Number(env.EMAIL_PORT || 587);
  const appsScriptUrl = String(env.GMAIL_APPS_SCRIPT_URL || "").replace(/\s+/g, "").trim();
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

async function probeGmailHttpsRelay(env = process.env, fetchImpl = fetch) {
  const config = getMailConfig(env);
  if (!config.httpsRelayConfigured) {
    return null;
  }
  const response = await fetchImpl(config.appsScriptUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      secret: "__dentasync_boot_probe__",
      to: "otp-probe@example.invalid",
      subject: "probe",
      html: "<p>probe</p>",
    }).toString(),
  });
  const body = String(await response.text()).replace(/\s+/g, " ").slice(0, 180);
  return {
    status: response.status,
    body,
    scriptReached: /forbidden|\bok\b|error:/i.test(body),
  };
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

const MAX_RELAY_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const RELAY_CHUNK_CHARS = 8000;

function encodeRelayAttachments(attachments = []) {
  return (attachments || []).map((attachment) => {
    const raw = attachment.content;
    const buffer = Buffer.isBuffer(raw)
      ? raw
      : raw instanceof Uint8Array
        ? Buffer.from(raw)
        : Buffer.from(raw || "");
    if (buffer.length > MAX_RELAY_ATTACHMENT_BYTES) {
      throw new Error("The prescription PDF is too large to send through the Gmail HTTPS relay.");
    }
    return {
      filename: String(attachment.filename || "prescription.pdf"),
      mimeType: String(attachment.contentType || "application/pdf"),
      contentBase64: buffer.toString("base64"),
    };
  });
}

function relayAccepted(body, attachmentCount = 0) {
  const text = String(body || "");
  const ok = /\bok\b/i.test(text) || /"status"\s*:\s*"ok"/i.test(text);
  if (!ok) return false;
  if (attachmentCount > 0) {
    const match = text.match(/"attachments"\s*:\s*(\d+)/);
    return Boolean(match && Number(match[1]) >= attachmentCount);
  }
  return true;
}

function describeRelayFailure(status, body) {
  const text = String(body || "").replace(/\s+/g, " ").trim();
  if (Number(status) === 403 || /<!DOCTYPE html/i.test(text) || /ppConfig/i.test(text)) {
    return (
      "Google blocked the Gmail relay (HTTP 403). Paste the latest backend/gmail-https-relay.gs into the existing Apps Script project, then Deploy → Manage deployments → Edit the current Web App → New version. Execute as: Me. Who has access: Anyone. Keep the same /exec URL on Render."
    );
  }
  return `Gmail HTTPS relay failed (${status}): ${text.slice(0, 220)}`;
}

async function postRelayForm(config, fields, fetchImpl) {
  const response = await fetchImpl(config.appsScriptUrl, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(fields).toString(),
  });
  const body = String(await response.text());
  return { response, body };
}

async function uploadRelayAttachment(config, file, fetchImpl) {
  const uploadId = crypto.randomUUID();
  const parts = Math.max(1, Math.ceil(file.contentBase64.length / RELAY_CHUNK_CHARS));
  for (let index = 0; index < parts; index += 1) {
    const fields = {
      secret: config.appsScriptSecret,
      action: "chunk",
      uploadId,
      index: String(index),
      data: file.contentBase64.slice(index * RELAY_CHUNK_CHARS, (index + 1) * RELAY_CHUNK_CHARS),
    };
    if (index === 0) {
      fields.parts = String(parts);
      fields.filename = file.filename;
      fields.mimeType = file.mimeType;
    }
    const { response, body } = await postRelayForm(config, fields, fetchImpl);
    if (!response.ok || !relayAccepted(body, 0)) {
      throw new Error(describeRelayFailure(response.status, body));
    }
  }
  return uploadId;
}

async function sendViaGmailHttpsRelay(config, { to, subject, html, attachments }, fetchImpl = fetch) {
  const encodedAttachments = encodeRelayAttachments(attachments);
  const uploadIds = [];
  for (const file of encodedAttachments) {
    uploadIds.push(await uploadRelayAttachment(config, file, fetchImpl));
  }

  const params = {
    secret: config.appsScriptSecret,
    to,
    subject,
    html,
  };
  if (uploadIds.length) {
    params.action = "send";
    params.expectAttachments = String(uploadIds.length);
    params.uploadIds = uploadIds.join(",");
  }

  const { response, body } = await postRelayForm(config, params, fetchImpl);
  if (response.ok && /\bok\b/i.test(body) && uploadIds.length && !relayAccepted(body, uploadIds.length)) {
    throw new Error(
      "The Gmail HTTPS relay sent the message without confirming the PDF attachment. Deploy backend/gmail-https-relay.gs as a new version of the existing Web App (keep the same secret), then retry Send authorized PDF."
    );
  }
  if (!response.ok || !relayAccepted(body, uploadIds.length)) {
    throw new Error(describeRelayFailure(response.status, body));
  }
  return { messageId: `gmail-https-relay:${Date.now()}` };
}

async function sendMailMessage({ to, subject, html, attachments }, env = process.env, fetchImpl = fetch) {
  const config = getMailConfig(env);
  if (!config.configured) {
    throw new Error("Email delivery is not configured.");
  }

  if (config.httpsRelayConfigured) {
    return sendViaGmailHttpsRelay(config, { to, subject, html, attachments }, fetchImpl);
  }

  try {
    return await createMailTransporter(env).sendMail({
      from: `"Amethyst Dental Clinic" <${config.from}>`,
      to,
      subject,
      html,
      attachments: attachments || undefined,
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
  probeGmailHttpsRelay,
  createMailTransporter,
  describeRelayFailure,
  sendMailMessage,
  sendEmailOtp,
  sendPasswordResetEmail,
};
