"use strict";

const fs = require("fs");
const path = require("path");

function emptyPayload() {
  return {
    patient: {
      firstName: "",
      lastName: "",
      fullName: "",
      email: "",
      phone: "",
      dateOfBirth: "",
      gender: "",
      address: "",
    },
    procedure: {
      treatment: "",
      dentistName: "",
      treatmentDate: "",
      clinicLocation: "Amethyst Dental Clinic",
      status: "completed",
      notes: "",
      coverageStatus: "",
    },
  };
}

function cleanLine(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[|:]+$/g, "")
    .trim();
}

function capture(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return cleanLine(match[1]);
    }
  }
  return "";
}

function splitName(fullName) {
  const parts = cleanLine(fullName).split(" ").filter(Boolean);
  if (!parts.length) {
    return { firstName: "", lastName: "", fullName: "" };
  }
  if (parts.length === 1) {
    return { firstName: parts[0], lastName: "", fullName: parts[0] };
  }
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(" "),
    fullName: parts.join(" "),
  };
}

function normalizePhone(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  if (/^0\d{10}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  return digits;
}

function normalizeDate(value) {
  const text = cleanLine(value);
  if (!text) return "";

  const embedded = text.match(/(\d{4}-\d{2}-\d{2})|(\d{1,2}[\/\-.](\d{1,2})[\/\-.](\d{2,4}))/);
  const candidate = embedded ? embedded[0] : text;
  if (/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return candidate;

  const slash = candidate.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (slash) {
    let [, month, day, year] = slash;
    if (year.length === 2) year = `20${year}`;
    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(candidate);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return "";
}

function extractStructuredPayload(rawText) {
  const text = String(rawText || "");
  const payload = emptyPayload();
  const notes = [];

  const fullName = capture(text, [
    /(?:patient\s*name|full\s*name|name)\s*[:\-]\s*([A-Za-z .,'-]+)/i,
    /(?:mr\.?|ms\.?|mrs\.?|dr\.?)\s+([A-Za-z]+(?:\s+[A-Za-z]+){1,3})/,
  ]);
  const names = splitName(fullName.replace(/^(mr|ms|mrs|dr)\.?\s+/i, ""));
  payload.patient.firstName = names.firstName;
  payload.patient.lastName = names.lastName;
  payload.patient.fullName = names.fullName;

  payload.patient.email = capture(text, [
    /(?:email|e-mail)\s*[:\-]\s*([^\s,;]+@[^\s,;]+)/i,
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  ]).toLowerCase();

  payload.patient.phone = normalizePhone(
    capture(text, [
      /(?:phone|mobile|contact|cellphone|tel\.?)\s*[:\-]\s*([+\d()[\]\-\s]{7,20})/i,
      /\b((?:\+?63|0)\s*9\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/,
    ])
  );

  payload.patient.dateOfBirth = normalizeDate(
    capture(text, [
      /(?:date\s*of\s*birth|birth\s*date|dob)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,20})/i,
    ])
  );

  payload.patient.gender = capture(text, [
    /(?:gender|sex)\s*[:\-]\s*(male|female|m|f|other)/i,
  ]);
  if (/^m$/i.test(payload.patient.gender)) payload.patient.gender = "Male";
  if (/^f$/i.test(payload.patient.gender)) payload.patient.gender = "Female";

  payload.patient.address = capture(text, [
    /(?:address|residence)\s*[:\-]\s*(.+)$/im,
  ]);

  payload.procedure.treatment = capture(text, [
    /(?:procedure|treatment|dental\s*procedure|service)\s*[:\-]\s*(.+)$/im,
    /(?:orthodontic|cleaning|extraction|filling|root\s*canal|whitening|crown|implant)[^\n.]{0,80}/i,
  ]);

  payload.procedure.dentistName = capture(text, [
    /(?:dentist|doctor|attending|provider)\s*[:\-]\s*(.+)$/im,
    /\b(Dr\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)\b/,
  ]);

  payload.procedure.treatmentDate = normalizeDate(
    capture(text, [
      /(?:treatment\s*date|procedure\s*date|date\s*of\s*service|visit\s*date)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,20})/i,
      /(?:date)\s*[:\-]\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i,
    ])
  );

  payload.procedure.clinicLocation = capture(text, [
    /(?:clinic|location|branch)\s*[:\-]\s*(.+)$/im,
  ]) || "Amethyst Dental Clinic";

  payload.procedure.coverageStatus = capture(text, [
    /(?:coverage|hmo|payment)\s*[:\-]\s*(.+)$/im,
  ]);

  payload.procedure.notes = capture(text, [
    /(?:notes|remarks|findings|diagnosis)\s*[:\-]\s*(.+)$/im,
  ]);

  if (!payload.patient.fullName && !payload.procedure.treatment) {
    notes.push(
      "Limited structured fields were detected. Please review and complete the form before syncing."
    );
  } else {
    notes.push("Extracted fields from the document. Please verify accuracy before syncing.");
  }

  return { payload, notes: notes.join(" ") };
}

async function extractTextFromFile(filePath, mimeType, originalName) {
  const extension = path.extname(originalName || filePath).toLowerCase();
  const isPdf = mimeType === "application/pdf" || extension === ".pdf";
  const isText =
    mimeType.startsWith("text/") ||
    [".txt", ".csv", ".md", ".json"].includes(extension);
  const isImage =
    mimeType.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension);

  if (isText) {
    return {
      text: fs.readFileSync(filePath, "utf8"),
      method: "text",
    };
  }

  if (isPdf) {
    const { PDFParse } = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    try {
      const parsed = await parser.getText();
      const text = String(parsed?.text || "").trim();
      if (text) {
        return { text, method: "pdf-text" };
      }
      return {
        text: "",
        method: "pdf-image-scan-required",
        warning:
          "This PDF appears to be a scanned image. Upload a JPG/PNG scan or enter fields manually.",
      };
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy().catch(() => {});
      }
    }
  }

  if (isImage) {
    const { createWorker } = require("tesseract.js");
    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(filePath);
      return {
        text: String(result?.data?.text || "").trim(),
        method: "ocr",
      };
    } finally {
      await worker.terminate();
    }
  }

  throw new Error("Unsupported document type. Upload PDF, TXT, JPG, or PNG files.");
}

async function extractDocumentData(filePath, mimeType, originalName) {
  const extracted = await extractTextFromFile(filePath, mimeType, originalName);
  const structured = extractStructuredPayload(extracted.text);
  const notes = [structured.notes, extracted.warning].filter(Boolean).join(" ");

  return {
    rawText: extracted.text,
    payload: structured.payload,
    extractionNotes: notes,
    method: extracted.method,
  };
}

module.exports = {
  emptyPayload,
  extractDocumentData,
  extractStructuredPayload,
  normalizePhone,
  normalizeDate,
};
