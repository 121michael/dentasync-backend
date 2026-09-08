"use strict";

const fs = require("fs");
const path = require("path");

const INVALID_DOCUMENT_MESSAGE =
  "Invalid document. Please upload or scan a document containing readable patient or treatment information.";

const UNSUPPORTED_DOCUMENT_MESSAGE =
  "Invalid document. The uploaded file does not appear to contain a readable document. Please upload a PDF, PNG, or JPEG document.";

const DOCUMENT_KEYWORD_RE =
  /\b(patient|full\s*name|date\s*of\s*birth|dob|birth\s*date|cellphone|mobile|phone|procedure|treatment|dental|clinic|amount|charged|age|address|tooth|diagnosis|record|form|appointment|service|orthodontic|cleaning|extraction|filling)\b/i;

class DocumentValidationError extends Error {
  constructor(message = INVALID_DOCUMENT_MESSAGE) {
    super(message);
    this.name = "DocumentValidationError";
    this.code = "INVALID_DOCUMENT";
    this.status = 400;
  }
}

function emptyPayload() {
  return {
    patient: {
      firstName: "",
      lastName: "",
      fullName: "",
      email: "",
      phone: "",
      dateOfBirth: "",
      age: "",
      gender: "",
      address: "",
    },
    procedure: {
      treatment: "",
      dentistName: "",
      treatmentDate: "",
      amountCharged: "",
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

function labelPresent(text, labelPattern) {
  return labelPattern.test(String(text || ""));
}

function fieldStatus(value, labelSeen) {
  if (value) return "detected";
  if (labelSeen) return "unable_to_read";
  return "not_detected";
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

function normalizeAmount(value) {
  const text = cleanLine(value);
  if (!text) return "";
  const match = text.replace(/,/g, "").match(/(?:₱|php|p\s*)?\s*(-?\d+(?:\.\d{1,2})?)/i);
  if (!match) return "";
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount < 0) return "";
  return String(Math.round(amount * 100) / 100);
}

function normalizeAge(value) {
  const text = cleanLine(value);
  if (!text) return "";
  const match = text.match(/(\d{1,3})/);
  if (!match) return "";
  const age = Number(match[1]);
  if (!Number.isInteger(age) || age < 0 || age > 120) return "";
  return String(age);
}

function extractStructuredPayload(rawText) {
  const text = String(rawText || "");
  const payload = emptyPayload();
  const fieldStatuses = {};
  const notes = [];

  const fullName = capture(text, [
    /(?:patient\s*name|full\s*name|name)\s*[:\-]\s*([A-Za-z .,'-]+)/i,
    /(?:mr\.?|ms\.?|mrs\.?|dr\.?)\s+([A-Za-z]+(?:\s+[A-Za-z]+){1,3})/,
  ]);
  const names = splitName(fullName.replace(/^(mr|ms|mrs|dr)\.?\s+/i, ""));
  payload.patient.firstName = names.firstName;
  payload.patient.lastName = names.lastName;
  payload.patient.fullName = names.fullName;
  fieldStatuses.fullName = fieldStatus(
    payload.patient.fullName,
    labelPresent(text, /(?:patient\s*name|full\s*name|name)\s*[:\-]/i)
  );

  payload.patient.email = capture(text, [
    /(?:email|e-mail)\s*[:\-]\s*([^\s,;]+@[^\s,;]+)/i,
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  ]).toLowerCase();
  fieldStatuses.email = fieldStatus(
    payload.patient.email,
    labelPresent(text, /(?:email|e-mail)\s*[:\-]/i)
  );

  payload.patient.phone = normalizePhone(
    capture(text, [
      /(?:phone|mobile|contact|cellphone|cell\s*phone|tel\.?)\s*[:\-]\s*([+\d()[\]\-\s]{7,20})/i,
      /\b((?:\+?63|0)\s*9\d{2}[\s\-]?\d{3}[\s\-]?\d{4})\b/,
    ])
  );
  fieldStatuses.phone = fieldStatus(
    payload.patient.phone,
    labelPresent(text, /(?:phone|mobile|contact|cellphone|cell\s*phone|tel\.?)\s*[:\-]/i)
  );

  payload.patient.dateOfBirth = normalizeDate(
    capture(text, [
      /(?:date\s*of\s*birth|birth\s*date|dob)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,20})/i,
    ])
  );
  fieldStatuses.dateOfBirth = fieldStatus(
    payload.patient.dateOfBirth,
    labelPresent(text, /(?:date\s*of\s*birth|birth\s*date|dob)\s*[:\-]/i)
  );

  payload.patient.age = normalizeAge(
    capture(text, [/(?:age)\s*[:\-]\s*([0-9]{1,3})(?:\s*(?:years?|yrs?|y\.?o\.?))?/i])
  );
  fieldStatuses.age = fieldStatus(payload.patient.age, labelPresent(text, /(?:age)\s*[:\-]/i));

  payload.patient.gender = capture(text, [
    /(?:gender|sex)\s*[:\-]\s*(male|female|m|f|other)/i,
  ]);
  if (/^m$/i.test(payload.patient.gender)) payload.patient.gender = "Male";
  if (/^f$/i.test(payload.patient.gender)) payload.patient.gender = "Female";
  fieldStatuses.gender = fieldStatus(
    payload.patient.gender,
    labelPresent(text, /(?:gender|sex)\s*[:\-]/i)
  );

  payload.patient.address = capture(text, [/(?:address|residence)\s*[:\-]\s*(.+)$/im]);
  fieldStatuses.address = fieldStatus(
    payload.patient.address,
    labelPresent(text, /(?:address|residence)\s*[:\-]/i)
  );

  payload.procedure.treatment = capture(text, [
    /(?:procedure|treatment|dental\s*procedure|service)\s*[:\-]\s*(.+)$/im,
    /(?:orthodontic|cleaning|extraction|filling|root\s*canal|whitening|crown|implant)[^\n.]{0,80}/i,
  ]);
  fieldStatuses.treatment = fieldStatus(
    payload.procedure.treatment,
    labelPresent(text, /(?:procedure|treatment|dental\s*procedure|service)\s*[:\-]/i)
  );

  payload.procedure.dentistName = capture(text, [
    /(?:dentist|doctor|attending|provider)\s*[:\-]\s*(.+)$/im,
    /\b(Dr\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)\b/,
  ]);
  fieldStatuses.dentistName = fieldStatus(
    payload.procedure.dentistName,
    labelPresent(text, /(?:dentist|doctor|attending|provider)\s*[:\-]/i)
  );

  payload.procedure.treatmentDate = normalizeDate(
    capture(text, [
      /(?:treatment\s*date|procedure\s*date|date\s*performed|date\s*of\s*service|visit\s*date)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,20})/i,
      /(?:date)\s*[:\-]\s*([0-9]{1,2}[\/\-.][0-9]{1,2}[\/\-.][0-9]{2,4})/i,
    ])
  );
  fieldStatuses.treatmentDate = fieldStatus(
    payload.procedure.treatmentDate,
    labelPresent(
      text,
      /(?:treatment\s*date|procedure\s*date|date\s*performed|date\s*of\s*service|visit\s*date|date)\s*[:\-]/i
    )
  );

  payload.procedure.amountCharged = normalizeAmount(
    capture(text, [
      /(?:amount\s*(?:of\s*treatment|charged|due)?|total|fee|cost|price)\s*[:\-]\s*([₱Php\s0-9.,]+)/i,
      /(?:₱|php)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    ])
  );
  fieldStatuses.amountCharged = fieldStatus(
    payload.procedure.amountCharged,
    labelPresent(text, /(?:amount\s*(?:of\s*treatment|charged|due)?|total|fee|cost|price)\s*[:\-]/i) ||
      /(?:₱|php)\s*[0-9]/.test(text)
  );

  payload.procedure.clinicLocation =
    capture(text, [/(?:clinic|location|branch)\s*[:\-]\s*(.+)$/im]) || "Amethyst Dental Clinic";

  payload.procedure.coverageStatus = capture(text, [
    /(?:coverage|hmo|payment)\s*[:\-]\s*(.+)$/im,
  ]);

  payload.procedure.notes = capture(text, [
    /(?:notes|remarks|findings|diagnosis)\s*[:\-]\s*(.+)$/im,
  ]);

  if (!payload.patient.fullName && !payload.procedure.treatment) {
    notes.push(
      "Limited structured fields were detected. Please review and complete the form before saving."
    );
  } else {
    notes.push(
      "Extracted readable fields from the document. Correct OCR mistakes before confirming."
    );
  }

  return { payload, notes: notes.join(" "), fieldStatuses };
}

function assessDocumentLikeness(rawText, method) {
  const text = String(rawText || "").trim();
  const alphaNumeric = (text.match(/[A-Za-z0-9]/g) || []).length;
  const lines = text.split(/\n/).filter((line) => line.trim().length > 2);
  const hasKeywords = DOCUMENT_KEYWORD_RE.test(text);
  const hasLabeledFields = /[A-Za-z]{2,}\s*[:\-]\s*\S+/.test(text);

  if (method === "pdf-image-scan-required") {
    return {
      isDocument: false,
      reason: "scanned_pdf",
      message:
        "This PDF appears to be a scanned image without readable text. Please upload a PNG or JPEG scan of the document, or use Scan Document.",
    };
  }

  if (!text || alphaNumeric < 20) {
    return {
      isDocument: false,
      reason: "insufficient_text",
      message: INVALID_DOCUMENT_MESSAGE,
    };
  }

  if (alphaNumeric < 70 && !hasKeywords && !hasLabeledFields) {
    return {
      isDocument: false,
      reason: "non_document",
      message: INVALID_DOCUMENT_MESSAGE,
    };
  }

  if (!hasKeywords && !hasLabeledFields && lines.length < 3 && alphaNumeric < 140) {
    return {
      isDocument: false,
      reason: "non_document",
      message: INVALID_DOCUMENT_MESSAGE,
    };
  }

  return { isDocument: true, reason: "ok" };
}

async function classifyDocumentWithGemini(filePath, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  if (!mimeType || !mimeType.startsWith("image/")) return null;

  try {
    const buffer = fs.readFileSync(filePath);
    if (!buffer.length) return null;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `Classify this image for a dental clinic document import system.
Reply with JSON only, no markdown: {"isDocument":true|false,"reason":"short reason"}
A document is a photo or scan of paper/forms/charts/receipts/IDs/medical or dental records that contain readable text or form structure.
NOT a document: selfie, face/portrait photo, animal, landscape, food, random photograph, or any image that is clearly not a document.`,
                },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) return null;
    const data = await response.json();
    const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isDocument: Boolean(parsed.isDocument),
      reason: String(parsed.reason || "").slice(0, 200),
    };
  } catch (error) {
    console.warn("Document classification skipped:", error.message);
    return null;
  }
}

async function extractTextFromFile(filePath, mimeType, originalName) {
  const extension = path.extname(originalName || filePath).toLowerCase();
  const isPdf = mimeType === "application/pdf" || extension === ".pdf";
  const isImage =
    mimeType.startsWith("image/") ||
    [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension);

  if (isPdf) {
    const { PDFParse } = require("pdf-parse");
    const buffer = fs.readFileSync(filePath);
    if (!buffer.length) {
      throw new DocumentValidationError(UNSUPPORTED_DOCUMENT_MESSAGE);
    }
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
          "This PDF appears to be a scanned image. Upload a JPG/PNG scan or use Scan Document.",
      };
    } finally {
      if (typeof parser.destroy === "function") {
        await parser.destroy().catch(() => {});
      }
    }
  }

  if (isImage) {
    const buffer = fs.readFileSync(filePath);
    if (!buffer.length) {
      throw new DocumentValidationError(UNSUPPORTED_DOCUMENT_MESSAGE);
    }
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

  throw new DocumentValidationError(UNSUPPORTED_DOCUMENT_MESSAGE);
}

async function extractDocumentData(filePath, mimeType, originalName) {
  const geminiClassification = await classifyDocumentWithGemini(filePath, mimeType);
  if (geminiClassification && geminiClassification.isDocument === false) {
    throw new DocumentValidationError(INVALID_DOCUMENT_MESSAGE);
  }

  const extracted = await extractTextFromFile(filePath, mimeType, originalName);
  const likeness = assessDocumentLikeness(extracted.text, extracted.method);
  if (!likeness.isDocument) {
    throw new DocumentValidationError(likeness.message || INVALID_DOCUMENT_MESSAGE);
  }

  const structured = extractStructuredPayload(extracted.text);
  const notes = [structured.notes, extracted.warning].filter(Boolean).join(" ");

  return {
    rawText: extracted.text,
    payload: structured.payload,
    fieldStatuses: structured.fieldStatuses,
    extractionNotes: notes,
    method: extracted.method,
    validation: likeness,
  };
}

module.exports = {
  INVALID_DOCUMENT_MESSAGE,
  UNSUPPORTED_DOCUMENT_MESSAGE,
  DocumentValidationError,
  emptyPayload,
  extractDocumentData,
  extractStructuredPayload,
  assessDocumentLikeness,
  normalizePhone,
  normalizeDate,
  normalizeAmount,
  normalizeAge,
  fieldStatus,
};
