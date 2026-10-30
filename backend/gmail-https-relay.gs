/**
 * DentaSync Gmail HTTPS relay for Render Free.
 *
 * OTP, password reset, and authorized prescription PDFs all POST here because
 * Render Free blocks SMTP ports 587/465.
 *
 * Setup (one-time or when updating):
 * 1. https://script.google.com → the existing DentaSync relay project (or New project).
 * 2. Replace Code.gs with this file.
 * 3. Project Settings → Script properties → DENTASYNC_RELAY_SECRET
 *    = the same value as GMAIL_APPS_SCRIPT_SECRET on Render.
 *    If that property is empty, the script falls back to RELAY_SECRET below.
 * 4. Deploy → New deployment (or Manage deployments → Edit → New version).
 *    Type: Web app. Execute as: Me. Who has access: Anyone.
 * 5. Copy the /exec URL into GMAIL_APPS_SCRIPT_URL on the Render web service.
 * 6. Redeploy is not required on Render if the URL and secret are unchanged.
 */

const RELAY_SECRET = "";

function relaySecret_() {
  const fromProperties = PropertiesService.getScriptProperties().getProperty("DENTASYNC_RELAY_SECRET");
  return String(fromProperties || RELAY_SECRET || "").trim();
}

function parseParams_(e) {
  const params = {};
  const contents = e && e.postData && e.postData.contents;
  const type = String((e && e.postData && e.postData.type) || "");
  if (contents && /json/i.test(type)) {
    const parsed = JSON.parse(contents);
    Object.keys(parsed).forEach(function (key) {
      params[key] = parsed[key];
    });
  } else if (contents) {
    String(contents).split("&").forEach(function (pair) {
      const parts = pair.split("=");
      const key = decodeURIComponent((parts[0] || "").replace(/\+/g, " "));
      const value = decodeURIComponent((parts.slice(1).join("=") || "").replace(/\+/g, " "));
      if (key) params[key] = value;
    });
  }
  const form = (e && e.parameter) || {};
  Object.keys(form).forEach(function (key) {
    if (params[key] == null) params[key] = form[key];
  });
  return params;
}

function attachmentBlobs_(params) {
  const blobs = [];
  if (params.pdfBase64) {
    blobs.push(
      Utilities.newBlob(
        Utilities.base64Decode(String(params.pdfBase64)),
        params.mimeType || "application/pdf",
        params.filename || "prescription.pdf"
      )
    );
  }
  if (params.attachmentsJson) {
    const list = JSON.parse(params.attachmentsJson);
    list.forEach(function (item) {
      blobs.push(
        Utilities.newBlob(
          Utilities.base64Decode(String(item.contentBase64 || "")),
          item.mimeType || "application/octet-stream",
          item.filename || "attachment.bin"
        )
      );
    });
  }
  if (Array.isArray(params.attachments)) {
    params.attachments.forEach(function (item) {
      blobs.push(
        Utilities.newBlob(
          Utilities.base64Decode(String(item.contentBase64 || "")),
          item.mimeType || "application/octet-stream",
          item.filename || "attachment.bin"
        )
      );
    });
  }
  return blobs;
}

function doPost(e) {
  try {
    const params = parseParams_(e);
    const expected = relaySecret_();
    if (!expected || String(params.secret || "") !== expected) {
      return ContentService.createTextOutput("forbidden");
    }

    const blobs = attachmentBlobs_(params);
    MailApp.sendEmail({
      to: String(params.to || ""),
      subject: String(params.subject || ""),
      htmlBody: String(params.html || ""),
      name: "Amethyst Dental Clinic",
      attachments: blobs.length ? blobs : undefined,
    });

    if (blobs.length) {
      return ContentService.createTextOutput(
        JSON.stringify({ status: "ok", attachments: blobs.length })
      );
    }
    return ContentService.createTextOutput("ok");
  } catch (error) {
    return ContentService.createTextOutput("error: " + error.message);
  }
}
