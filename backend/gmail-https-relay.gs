/**
 * DentaSync Gmail HTTPS relay for Render Free.
 * Use the V8 runtime (Project Settings) or this file stays Rhino-safe (var, no trailing commas).
 *
 * Script property SECRET (existing OTP) or DENTASYNC_RELAY_SECRET must match
 * GMAIL_APPS_SCRIPT_SECRET on Render.
 *
 * Deploy: Manage deployments -> edit the existing Web app -> New version.
 * Execute as: Me. Who has access: Anyone.
 */

var RELAY_SECRET = "";

function relaySecret_() {
  var props = PropertiesService.getScriptProperties();
  var named =
    props.getProperty("DENTASYNC_RELAY_SECRET") ||
    props.getProperty("SECRET") ||
    RELAY_SECRET ||
    "";
  return String(named).trim();
}

function parseParams_(e) {
  var params = {};
  var contents = e && e.postData && e.postData.contents;
  var type = String((e && e.postData && e.postData.type) || "");
  var parsed;
  var form;
  if (contents && /json/i.test(type)) {
    parsed = JSON.parse(contents);
    Object.keys(parsed).forEach(function (key) {
      params[key] = parsed[key];
    });
  } else if (contents) {
    String(contents).split("&").forEach(function (pair) {
      var parts = pair.split("=");
      var key = decodeURIComponent((parts[0] || "").replace(/\+/g, " "));
      var value = decodeURIComponent((parts.slice(1).join("=") || "").replace(/\+/g, " "));
      if (key) {
        params[key] = value;
      }
    });
  }
  form = (e && e.parameter) || {};
  Object.keys(form).forEach(function (key) {
    if (params[key] == null) {
      params[key] = form[key];
    }
  });
  return params;
}

function cache_() {
  return CacheService.getScriptCache();
}

function storeChunk_(params) {
  var uploadId = String(params.uploadId || "");
  var index = String(params.index || "");
  var data = String(params.data || "");
  var cache;
  var meta;
  if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) {
    throw new Error("bad upload");
  }
  if (!/^[0-9]+$/.test(index)) {
    throw new Error("bad index");
  }
  if (data.length > 12000) {
    throw new Error("chunk too large");
  }
  cache = cache_();
  cache.put("rx:" + uploadId + ":" + index, data, 600);
  if (params.parts) {
    meta = {
      parts: Number(params.parts),
      filename: params.filename || "prescription.pdf",
      mimeType: params.mimeType || "application/pdf"
    };
    cache.put("rx:" + uploadId + ":meta", JSON.stringify(meta), 600);
  }
}

function blobFromUpload_(uploadId) {
  var cache = cache_();
  var metaRaw = cache.get("rx:" + uploadId + ":meta");
  var meta;
  var pieces = [];
  var keys = ["rx:" + uploadId + ":meta"];
  var i;
  var piece;
  if (!metaRaw) {
    throw new Error("upload expired");
  }
  meta = JSON.parse(metaRaw);
  for (i = 0; i < meta.parts; i++) {
    piece = cache.get("rx:" + uploadId + ":" + i);
    if (piece == null) {
      throw new Error("missing chunk " + i);
    }
    pieces.push(piece);
    keys.push("rx:" + uploadId + ":" + i);
  }
  cache.removeAll(keys);
  return Utilities.newBlob(
    Utilities.base64Decode(pieces.join("")),
    meta.mimeType,
    meta.filename
  );
}

function attachmentBlobs_(params) {
  var blobs = [];
  if (params.uploadIds) {
    String(params.uploadIds).split(",").forEach(function (id) {
      var uploadId = String(id || "").trim();
      if (uploadId) {
        blobs.push(blobFromUpload_(uploadId));
      }
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
    JSON.parse(params.attachmentsJson).forEach(function (item) {
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
    var params = parseParams_(e);
    var expected = relaySecret_();
    var blobs;
    if (!expected || String(params.secret || "") !== expected) {
      return ContentService.createTextOutput("forbidden");
    }
    if (String(params.action || "") === "chunk") {
      storeChunk_(params);
      return ContentService.createTextOutput("ok");
    }
    blobs = attachmentBlobs_(params);
    MailApp.sendEmail({
      to: String(params.to || ""),
      subject: String(params.subject || ""),
      htmlBody: String(params.html || ""),
      name: "Amethyst Dental Clinic",
      attachments: blobs.length ? blobs : undefined
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
