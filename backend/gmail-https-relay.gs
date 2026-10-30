/**
 * DentaSync Gmail HTTPS relay for Render Free.
 *
 * OTP, password reset, and authorized prescription PDFs all POST here because
 * Render Free blocks SMTP ports 587/465.
 *
 * Prescription PDFs are uploaded as small `action=chunk` posts, then sent with
 * `action=send`. Do not POST the whole PDF in one request (Google returns HTTP 403).
 *
 * Setup (one-time or when updating):
 * 1. https://script.google.com → the existing DentaSync relay project (or New project).
 * 2. Replace Code.gs with this file.
 * 3. Project Settings → Script properties: keep SECRET (already used by OTP)
 *    or set DENTASYNC_RELAY_SECRET to the same value as GMAIL_APPS_SCRIPT_SECRET.
 * 4. Deploy → Manage deployments → the existing Web App → pencil/Edit → New version.
 *    Do not click "New deployment" (that creates a new /exec URL).
 *    Type: Web app. Execute as: Me. Who has access: Anyone
 *    (not "Anyone with a Google account").
 * 5. GMAIL_APPS_SCRIPT_URL on Render must stay the /exec URL already used for OTP.
 */

const RELAY_SECRET = "";

function relaySecret_() {
  const props = PropertiesService.getScriptProperties();
  return String(
    props.getProperty("DENTASYNC_RELAY_SECRET") ||
      props.getProperty("SECRET") ||
      RELAY_SECRET ||
      ""
  ).trim();
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

function cache_() {
  return CacheService.getScriptCache();
}

function storeChunk_(params) {
  const uploadId = String(params.uploadId || "");
  const index = String(params.index || "");
  const data = String(params.data || "");
  if (!/^[a-zA-Z0-9_-]+$/.test(uploadId)) {
    throw new Error("bad upload");
  }
  if (!/^\d+$/.test(index)) {
    throw new Error("bad index");
  }
  if (data.length > 12000) {
    throw new Error("chunk too large");
  }
  const cache = cache_();
  cache.put("rx:" + uploadId + ":" + index, data, 600);
  if (params.parts) {
    cache.put(
      "rx:" + uploadId + ":meta",
      JSON.stringify({
        parts: Number(params.parts),
        filename: params.filename || "prescription.pdf",
        mimeType: params.mimeType || "application/pdf",
      }),
      600
    );
  }
}

function blobFromUpload_(uploadId) {
  const cache = cache_();
  const metaRaw = cache.get("rx:" + uploadId + ":meta");
  if (!metaRaw) {
    throw new Error("upload expired");
  }
  const meta = JSON.parse(metaRaw);
  const pieces = [];
  const keys = ["rx:" + uploadId + ":meta"];
  for (var i = 0; i < meta.parts; i++) {
    const piece = cache.get("rx:" + uploadId + ":" + i);
    if (piece == null) {
      throw new Error("missing chunk " + i);
    }
    pieces.push(piece);
    keys.push("rx:" + uploadId + ":" + i);
  }
  cache.removeAll(keys);
  return Utilities.newBlob(Utilities.base64Decode(pieces.join("")), meta.mimeType, meta.filename);
}

function attachmentBlobs_(params) {
  const blobs = [];
  if (params.uploadIds) {
    String(params.uploadIds)
      .split(",")
      .forEach(function (id) {
        const uploadId = String(id || "").trim();
        if (uploadId) blobs.push(blobFromUpload_(uploadId));
      });
  }
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
  return blobs;
}

function doPost(e) {
  try {
    const params = parseParams_(e);
    const expected = relaySecret_();
    if (!expected || String(params.secret || "") !== expected) {
      return ContentService.createTextOutput("forbidden");
    }

    if (String(params.action || "") === "chunk") {
      storeChunk_(params);
      return ContentService.createTextOutput("ok");
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
