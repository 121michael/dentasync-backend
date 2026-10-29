"use strict";

const fs = require("fs");
const path = require("path");

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DOCUMENT_TYPE = "medical_document";
const ALLOWED_MIME = new Set(["application/pdf", "image/jpeg", "image/png"]);

function looksLikePdf(buffer) {
  return Buffer.isBuffer(buffer) && buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-";
}

function looksLikeJpeg(buffer) {
  return (
    Buffer.isBuffer(buffer) && buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  );
}

function looksLikePng(buffer) {
  return (
    Buffer.isBuffer(buffer) &&
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  );
}

function readFileHead(filePath, length = 16) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytesRead = fs.readSync(fd, buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

function validateMedicalUpload(file) {
  if (!file) {
    const error = new Error("Choose a PDF, JPG, or PNG document.");
    error.status = 400;
    throw error;
  }
  const mime = String(file.mimetype || "").toLowerCase();
  const originalName = String(file.originalname || "document");
  if (originalName.includes("..") || originalName.includes("/") || originalName.includes("\\")) {
    const error = new Error("The uploaded file name is not valid.");
    error.status = 400;
    throw error;
  }
  const extension = path.extname(originalName).toLowerCase();
  const allowedExtensions = mime === "application/pdf" ? [".pdf"] : mime === "image/png" ? [".png"] : [".jpg", ".jpeg"];
  if (!ALLOWED_MIME.has(mime) || (extension && !allowedExtensions.includes(extension))) {
    const error = new Error("Only PDF, JPG, and PNG documents are accepted.");
    error.status = 400;
    throw error;
  }
  const size = Number(file.size);
  if (!Number.isFinite(size) || size <= 0) {
    const error = new Error("The uploaded file is empty.");
    error.status = 400;
    throw error;
  }
  if (size > MAX_UPLOAD_BYTES) {
    const error = new Error("Medical documents must be 5 MB or smaller.");
    error.status = 400;
    throw error;
  }
  const head = file.path ? readFileHead(file.path) : file.buffer;
  if (mime === "application/pdf" && !looksLikePdf(head)) {
    const error = new Error("The uploaded file is not a valid PDF.");
    error.status = 400;
    throw error;
  }
  if (mime === "image/jpeg" && !looksLikeJpeg(head)) {
    const error = new Error("The uploaded file is not a valid JPEG image.");
    error.status = 400;
    throw error;
  }
  if (mime === "image/png" && !looksLikePng(head)) {
    const error = new Error("The uploaded file is not a valid PNG image.");
    error.status = 400;
    throw error;
  }
  return { mimeType: mime, byteSize: size, originalName };
}

function resolveStoredPath(uploadDirectory, storedName) {
  const root = path.resolve(uploadDirectory);
  const filePath = path.resolve(root, path.basename(String(storedName || "")));
  if (!filePath.startsWith(`${root}${path.sep}`) && filePath !== root) {
    return null;
  }
  return filePath;
}

function mapMedicalDocument(row, appointment = null) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.original_name,
    category: row.category || "Medical clearance / supporting document",
    mimeType: row.mime_type,
    size: Number(row.byte_size) || 0,
    status: row.status || "uploaded",
    uploadedAt: row.created_at,
    reviewedAt: row.reviewed_at || null,
    reviewedByName: row.reviewed_by_name || null,
    appointmentId: row.appointment_id || null,
    appointment:
      appointment ||
      (row.service_name
        ? {
            id: row.appointment_id,
            service: row.service_name,
            date: row.appointment_date,
            time: row.appointment_time,
          }
        : null),
    disclaimer:
      "This file is supporting documentation only. It does not automatically clear a patient for treatment.",
  };
}

module.exports = {
  DOCUMENT_TYPE,
  MAX_UPLOAD_BYTES,
  ALLOWED_MIME,
  validateMedicalUpload,
  resolveStoredPath,
  mapMedicalDocument,
};
