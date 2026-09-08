"use strict";

const fs = require("fs");
const path = require("path");
const { extractBestImageText, scoreDocumentText } = require("./documentImagePrep");
const { extractFieldsWithGemini } = require("./documentVisionExtraction");

const INVALID_DOCUMENT_MESSAGE =
  "Invalid document. Please upload or scan a document containing readable patient or treatment information.";

const UNSUPPORTED_DOCUMENT_MESSAGE =
  "Invalid document. The uploaded file does not appear to contain a readable document. Please upload a PDF, PNG, or JPEG document.";

const DOCUMENT_KEYWORD_RE =
  /\b(patient|full\s*name|name|date\s*of\s*birth|dob|birth\s*date|cellphone|mobile|phone|telephone|procedure|treatment|description|dental|clinic|amount|charged|age|address|occupation|status|complaint|tooth|diagnosis|record|form|appointment|service|orthodontic|cleaning|extraction|filling|prophylaxis|debit|credit|balance)\b/i;

const KNOWN_PROCEDURES = [
  { pattern: /oral\s*prophylaxis|prophylax|pr[o0]r?h?[il1y]{2,}a?x?|prophy(?![a-z])/i, value: "Oral Prophylaxis" },
  { pattern: /dental\s*cleaning|\bcleaning\b|oral\s*prophy/i, value: "Dental Cleaning" },
  { pattern: /tooth\s*extraction|\bextraction\b/i, value: "Tooth Extraction" },
  { pattern: /root\s*canal|\brct\b/i, value: "Root Canal" },
  { pattern: /\bfilling\b|\bresto\b/i, value: "Dental Filling" },
  { pattern: /whitening|bleaching/i, value: "Teeth Whitening" },
  { pattern: /\bcrown\b/i, value: "Dental Crown" },
  { pattern: /\bimplant\b/i, value: "Dental Implant" },
  { pattern: /brace|orthodont/i, value: "Orthodontic Adjustment" },
  { pattern: /consultation/i, value: "Consultation" },
];

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
    .replace(/^[\-_]+|[\-_]+$/g, "")
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
  const parts = cleanLine(fullName)
    .replace(/[_]+/g, " ")
    .split(" ")
    .filter(Boolean);
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
  let digits = String(value || "").replace(/\D/g, "");
  if (!digits) {
    // OCR often confuses O/o with 0 and I/l with 1
    const repaired = String(value || "")
      .toLowerCase()
      .replace(/[o]/g, "0")
      .replace(/[il]/g, "1")
      .replace(/[s]/g, "5")
      .replace(/[b]/g, "8")
      .replace(/\D/g, "");
    digits = repaired;
  }
  if (!digits) return "";
  if (/^0\d{10}$/.test(digits)) return `63${digits.slice(1)}`;
  if (/^9\d{9}$/.test(digits)) return `63${digits}`;
  if (/^63\d{10}$/.test(digits)) return digits;
  return digits.length >= 10 ? digits : "";
}

function monthToNumber(monthToken) {
  const key = String(monthToken || "")
    .toLowerCase()
    .replace(/\./g, "")
    .slice(0, 3);
  const map = {
    jan: "01",
    feb: "02",
    mar: "03",
    apr: "04",
    may: "05",
    jun: "06",
    jul: "07",
    aug: "08",
    sep: "09",
    oct: "10",
    nov: "11",
    dec: "12",
  };
  return map[key] || "";
}

function normalizeDate(value) {
  const text = cleanLine(value);
  if (!text) return "";

  const iso = text.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const monthName = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-.]?\s*(\d{1,2})(?:st|nd|rd|th)?(?:,)?\s*(\d{4})\b/i
  );
  if (monthName) {
    const month = monthToNumber(monthName[1]);
    const day = String(monthName[2]).padStart(2, "0");
    return `${monthName[3]}-${month}-${day}`;
  }

  const slash = text.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
  if (slash) {
    let [, month, day, year] = slash;
    if (year.length === 2) year = `20${year}`;
    return `${year.padStart(4, "0")}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  const parsed = new Date(text);
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

function inferProcedure(text) {
  const source = String(text || "");
  for (const entry of KNOWN_PROCEDURES) {
    if (entry.pattern.test(source)) {
      return entry.value;
    }
  }
  return "";
}

function extractPhoneFromText(text) {
  const compact = String(text || "").replace(/[^\d]/g, " ");
  const candidates = compact.match(/\b0?9\d{9}\b/g) || [];
  if (candidates.length) {
    return normalizePhone(candidates[0]);
  }
  // OCR may split digits across lines; gather long digit runs.
  const digitsOnly = String(text || "").replace(/\D/g, " ");
  const runs = digitsOnly.match(/\d{10,12}/g) || [];
  for (const run of runs) {
    const normalized = normalizePhone(run);
    if (normalized) return normalized;
  }
  return "";
}

function applyExternalFields(payload, fields = {}) {
  if (!fields || typeof fields !== "object") return payload;
  const next = payload;

  if (fields.fullName) {
    const names = splitName(fields.fullName);
    next.patient.firstName = names.firstName;
    next.patient.lastName = names.lastName;
    next.patient.fullName = names.fullName;
  }
  if (fields.dateOfBirth) next.patient.dateOfBirth = normalizeDate(fields.dateOfBirth);
  if (fields.age) next.patient.age = normalizeAge(fields.age);
  if (fields.phone) next.patient.phone = normalizePhone(fields.phone);
  if (fields.address) next.patient.address = cleanLine(fields.address);
  if (fields.procedure) {
    next.procedure.treatment = inferProcedure(fields.procedure) || cleanLine(fields.procedure);
  }
  if (fields.treatmentDate) next.procedure.treatmentDate = normalizeDate(fields.treatmentDate);
  if (fields.amountCharged) next.procedure.amountCharged = normalizeAmount(fields.amountCharged);
  if (fields.notes) next.procedure.notes = cleanLine(fields.notes);
  return next;
}

function refreshFieldStatuses(payload, fieldStatuses = {}) {
  const next = { ...fieldStatuses };
  const pairs = {
    fullName: payload.patient.fullName,
    phone: payload.patient.phone,
    age: payload.patient.age,
    dateOfBirth: payload.patient.dateOfBirth,
    address: payload.patient.address,
    treatment: payload.procedure.treatment,
    treatmentDate: payload.procedure.treatmentDate,
    amountCharged: payload.procedure.amountCharged,
  };
  for (const [key, value] of Object.entries(pairs)) {
    if (value) next[key] = "detected";
  }
  return next;
}

function captureLabeledBlock(text, labelNames, stopLabels = []) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean);
  const labelSet = labelNames.map((v) => v.toLowerCase());
  const stopSet = new Set(
    [
      ...stopLabels,
      "name",
      "patient name",
      "full name",
      "address",
      "telephone",
      "cellphone",
      "cell phone",
      "phone",
      "age",
      "occupation",
      "status",
      "complaint",
      "date",
      "date of birth",
      "birth date",
      "dob",
      "description",
      "procedure",
      "treatment",
      "amount",
      "debit",
      "credit",
      "balance",
      "time",
      "no",
      "no.",
      "right",
      "left",
      "upper",
      "lower",
      "email",
      "gender",
      "sex",
    ].map((v) => v.toLowerCase())
  );

  const normalizeLabelLine = (line) =>
    String(line || "")
      .toLowerCase()
      .replace(/[:\-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  const lineMatchesLabel = (normalized, label) => {
    if (normalized === label) return true;
    if (!normalized.startsWith(`${label} `) && !normalized.startsWith(`${label}:`)) return false;
    const rest = normalized.slice(label.length).replace(/^[:\-\s]+/, "");
    // Prevent short label "date" matching "date of birth" / "date performed".
    if (label === "date" && /^(of|performed|birth)/i.test(rest)) return false;
    return true;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const normalized = normalizeLabelLine(line);
    const matchedLabel = labelSet
      .slice()
      .sort((a, b) => b.length - a.length)
      .find((label) => lineMatchesLabel(normalized, label));
    if (!matchedLabel) continue;

    const sameLine = cleanLine(line.replace(new RegExp(`^.*?${matchedLabel}\\s*[:\\-]?\\s*`, "i"), ""));
    // If the line is exactly the label (or label + punctuation), read following lines.
    const values = [];
    if (sameLine && normalizeLabelLine(sameLine) !== matchedLabel && !stopSet.has(normalizeLabelLine(sameLine))) {
      // Avoid swallowing the rest of a single prose line that includes later labels.
      const cut = sameLine.split(
        /\b(?:date of birth|dob|age|cellphone|telephone|phone|procedure|treatment|address)\s*[:\-]/i
      )[0];
      values.push(cleanLine(cut));
    } else {
      for (let j = i + 1; j < lines.length; j += 1) {
        const next = lines[j];
        const nextLower = normalizeLabelLine(next);
        if (stopSet.has(nextLower) || labelSet.includes(nextLower)) break;
        if (/^(date|no\.?|description|time|debit|credit|amount|balance)$/i.test(next)) break;
        values.push(next);
        if (values.join(" ").length > 80) break;
      }
    }
    const joined = cleanLine(values.join(" "));
    if (joined) return joined;
  }
  return "";
}

function extractStructuredPayload(rawText) {
  const text = String(rawText || "");
  const payload = emptyPayload();
  const fieldStatuses = {};
  const notes = [];

  const fullName =
    captureLabeledBlock(text, ["name", "patient name", "full name"]) ||
    capture(text, [
      /(?:patient\s*name|full\s*name|^name)\s*[:\-]\s*([A-Za-z0-9 .,'\-_]+)/im,
      /(?:^|\n)\s*name\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 .,'\-_]{2,80})/im,
      /(?:mr\.?|ms\.?|mrs\.?|dr\.?)\s+([A-Za-z]+(?:\s+[A-Za-z\-]+){1,4})/,
    ]);
  const names = splitName(fullName.replace(/^(mr|ms|mrs|dr)\.?\s+/i, ""));
  payload.patient.firstName = names.firstName;
  payload.patient.lastName = names.lastName;
  payload.patient.fullName = names.fullName;
  fieldStatuses.fullName = fieldStatus(
    payload.patient.fullName,
    labelPresent(text, /(?:patient\s*name|full\s*name|(?:^|\n)\s*name)\b/i)
  );

  payload.patient.email = capture(text, [
    /(?:email|e-mail)\s*[:\-]\s*([^\s,;]+@[^\s,;]+)/i,
    /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/i,
  ]).toLowerCase();
  fieldStatuses.email = fieldStatus(
    payload.patient.email,
    labelPresent(text, /(?:email|e-mail)\s*[:\-]/i)
  );

  const phoneBlock =
    captureLabeledBlock(text, ["telephone", "cellphone", "cell phone", "phone", "mobile", "tel"]) ||
    capture(text, [
      /(?:phone|mobile|contact|cellphone|cell\s*phone|telephone|tel\.?)\s*[:\-]?\s*([+\d()[\]\-\sA-Za-z]{7,24})/i,
    ]);
  payload.patient.phone = normalizePhone(phoneBlock) || extractPhoneFromText(text);
  fieldStatuses.phone = fieldStatus(
    payload.patient.phone,
    labelPresent(text, /(?:phone|mobile|contact|cellphone|cell\s*phone|telephone|tel\.?)\b/i)
  );

  payload.patient.dateOfBirth = normalizeDate(
    capture(text, [
      /(?:date\s*of\s*birth|birth\s*date|dob)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,28})/i,
    ])
  );
  fieldStatuses.dateOfBirth = fieldStatus(
    payload.patient.dateOfBirth,
    labelPresent(text, /(?:date\s*of\s*birth|birth\s*date|dob)\b/i)
  );

  payload.patient.age = normalizeAge(
    captureLabeledBlock(text, ["age"]) ||
      capture(text, [
        /(?:^|\n)\s*age\s*[:\-]?\s*([0-9]{1,3})(?:\s*(?:years?|yrs?|y\.?o\.?))?/im,
        /\bage\s*[:\-]?\s*([0-9]{1,3})\b/i,
      ])
  );
  fieldStatuses.age = fieldStatus(payload.patient.age, labelPresent(text, /\bage\b/i));

  payload.patient.gender = capture(text, [
    /(?:gender|sex)\s*[:\-]\s*(male|female|m|f|other)/i,
  ]);
  if (/^m$/i.test(payload.patient.gender)) payload.patient.gender = "Male";
  if (/^f$/i.test(payload.patient.gender)) payload.patient.gender = "Female";
  fieldStatuses.gender = fieldStatus(
    payload.patient.gender,
    labelPresent(text, /(?:gender|sex)\b/i)
  );

  payload.patient.address =
    captureLabeledBlock(text, ["address", "residence"]) ||
    capture(text, [/(?:address|residence)\s*[:\-]?\s*(.+)$/im]);
  fieldStatuses.address = fieldStatus(
    payload.patient.address,
    labelPresent(text, /(?:address|residence)\b/i)
  );

  const treatmentBlock =
    captureLabeledBlock(text, ["description", "procedure", "treatment", "dental procedure", "service"], [
      "time",
      "debit",
      "credit",
      "amount",
      "balance",
    ]) ||
    capture(text, [
      /(?:procedure|treatment|dental\s*procedure|service|description)\s*[:\-]?\s*(.+)$/im,
      /(?:orthodontic|cleaning|extraction|filling|root\s*canal|whitening|crown|implant|oral\s*prophylaxis|prophylaxis)[^\n.]{0,80}/i,
    ]);
  const headerLike = /^(time|debit|credit|date|amount|balance|no\.?|description)$/i;
  payload.procedure.treatment = treatmentBlock && !headerLike.test(treatmentBlock)
    ? treatmentBlock
    : "";
  const inferred = inferProcedure(payload.procedure.treatment || text);
  if (inferred) payload.procedure.treatment = inferred;
  fieldStatuses.treatment = fieldStatus(
    payload.procedure.treatment,
    labelPresent(text, /(?:procedure|treatment|dental\s*procedure|service|description)\b/i)
  );

  payload.procedure.dentistName = capture(text, [
    /(?:dentist|doctor|attending|provider)\s*[:\-]\s*(.+)$/im,
    /\b(Dr\.?\s+[A-Za-z]+(?:\s+[A-Za-z]+)?)\b/,
  ]);
  fieldStatuses.dentistName = fieldStatus(
    payload.procedure.dentistName,
    labelPresent(text, /(?:dentist|doctor|attending|provider)\b/i)
  );

  const dateBlock =
    captureLabeledBlock(text, ["treatment date", "procedure date", "date performed", "visit date"]) ||
    // Plain DATE rows on dental charts (exact label line only).
    captureLabeledBlock(text, ["date"]) ||
    capture(text, [
      /(?:treatment\s*date|procedure\s*date|date\s*performed|date\s*of\s*service|visit\s*date)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,28})/i,
      /\b((?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s*[-.]?\s*\d{1,2}(?:,)?\s*\d{4})\b/i,
      /(?:^|\n)\s*date\s*[:\-]\s*([A-Za-z]{3,9}\s*[-.]?\s*\d{1,2}(?:,)?\s*\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/im,
    ]);
  payload.procedure.treatmentDate = normalizeDate(dateBlock);
  // If we accidentally picked DOB, clear when an explicit treatment date exists elsewhere.
  if (
    payload.procedure.treatmentDate &&
    payload.patient.dateOfBirth &&
    payload.procedure.treatmentDate === payload.patient.dateOfBirth
  ) {
    const explicitTreatment = capture(text, [
      /(?:treatment\s*date|procedure\s*date|date\s*performed)\s*[:\-]\s*([0-9A-Za-z\/\-.,\s]{4,28})/i,
      /(?:^|\n)\s*date\s*[:\-]\s*([A-Za-z]{3,9}\s*[-.]?\s*\d{1,2}(?:,)?\s*\d{4}|\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4})/im,
    ]);
    payload.procedure.treatmentDate = normalizeDate(explicitTreatment);
  }
  // OCR noise around Sept-7, 2024 style dates (SEPT often misread as tet/trt/spt)
  if (!payload.procedure.treatmentDate) {
    const fuzzyMonth = text.match(
      /\b(?:sept?|sep|oct|nov|dec|jan|feb|mar|apr|may|jun|jul|aug)[a-z]*[^\n\d]{0,8}(\d{1,2})[^\n\d]{0,8}(20\d{2})\b/i
    );
    if (fuzzyMonth) {
      payload.procedure.treatmentDate = normalizeDate(
        `${fuzzyMonth[0].match(/[a-z]+/i)?.[0] || "sep"} ${fuzzyMonth[1]}, ${fuzzyMonth[2]}`
      );
    }
  }
  fieldStatuses.treatmentDate = fieldStatus(
    payload.procedure.treatmentDate,
    labelPresent(
      text,
      /(?:treatment\s*date|procedure\s*date|date\s*performed|date\s*of\s*service|visit\s*date|(?:^|\n)\s*date)\b/im
    )
  );

  const amountBlock =
    captureLabeledBlock(text, ["amount", "amount charged", "fee", "total", "price"]) ||
    capture(text, [
      /(?:amount\s*(?:of\s*treatment|charged|due)?|total|fee|cost|price|credit)\s*[:\-]?\s*([₱Php\s0-9.,]+)/i,
      /(?:₱|php)\s*([0-9][0-9,]*(?:\.\d{1,2})?)/i,
    ]);
  payload.procedure.amountCharged = normalizeAmount(amountBlock);
  if (!payload.procedure.amountCharged) {
    // Common dental form amounts near AMOUNT/BALANCE columns.
    const amountNearLabel = text.match(/\bamount\b[\s\S]{0,80}?\b([1-9]\d{2,5})(?:\.00)?\b/i);
    if (amountNearLabel) {
      payload.procedure.amountCharged = normalizeAmount(amountNearLabel[1]);
    }
  }
  fieldStatuses.amountCharged = fieldStatus(
    payload.procedure.amountCharged,
    labelPresent(text, /(?:amount|total|fee|cost|price|credit)\b/i) || /(?:₱|php)\s*[0-9]/.test(text)
  );

  payload.procedure.clinicLocation =
    capture(text, [/(?:clinic|location|branch)\s*[:\-]\s*(.+)$/im]) || "Amethyst Dental Clinic";

  payload.procedure.coverageStatus = capture(text, [
    /(?:coverage|hmo|payment)\s*[:\-]\s*(.+)$/im,
  ]);

  payload.procedure.notes =
    captureLabeledBlock(text, ["complaint", "notes", "remarks", "findings", "diagnosis"]) ||
    capture(text, [/(?:notes|remarks|findings|diagnosis|complaint)\s*[:\-]\s*(.+)$/im]);

  if (!payload.patient.fullName && !payload.procedure.treatment) {
    notes.push(
      "Limited structured fields were detected. Please type the values from the document preview before saving."
    );
  } else {
    notes.push(
      "Extracted readable fields from the document. Correct any OCR mistakes before confirming. The source file stays temporary only."
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
  const score = scoreDocumentText(text);

  if (method === "pdf-image-scan-required") {
    return {
      isDocument: false,
      reason: "scanned_pdf",
      message:
        "This PDF appears to be a scanned image without readable text. Please upload a PNG or JPEG scan of the document, or use Scan Document.",
    };
  }

  if (!text || alphaNumeric < 12) {
    return {
      isDocument: false,
      reason: "insufficient_text",
      message: INVALID_DOCUMENT_MESSAGE,
    };
  }

  if (score < 8 && alphaNumeric < 70 && !hasKeywords && !hasLabeledFields) {
    return {
      isDocument: false,
      reason: "non_document",
      message: INVALID_DOCUMENT_MESSAGE,
    };
  }

  if (!hasKeywords && !hasLabeledFields && lines.length < 3 && alphaNumeric < 140 && score < 12) {
    return {
      isDocument: false,
      reason: "non_document",
      message: INVALID_DOCUMENT_MESSAGE,
    };
  }

  return { isDocument: true, reason: "ok", score };
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
    const best = await extractBestImageText(filePath);
    return {
      text: best.text || "",
      method: best.method || "ocr",
      orientationDegrees: best.degrees || 0,
      confidence: best.confidence || 0,
      uprightPath: best.uprightPath || null,
      fields: best.fields || {},
      warning:
        best.score < 12
          ? "Low OCR confidence. Please verify every field against the document preview."
          : null,
    };
  }

  throw new DocumentValidationError(UNSUPPORTED_DOCUMENT_MESSAGE);
}

async function extractDocumentData(filePath, mimeType, originalName) {
  const extension = path.extname(originalName || filePath).toLowerCase();
  const isImage =
    (mimeType && mimeType.startsWith("image/")) ||
    [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff"].includes(extension);

  // Fast vision path for complex handwritten forms when configured.
  let vision = null;
  if (isImage) {
    try {
      vision = await extractFieldsWithGemini(filePath, mimeType || "image/png");
    } catch (error) {
      console.warn("Vision extraction skipped:", error.message);
    }
  }

  if (vision && vision.isDocument === false) {
    throw new DocumentValidationError(INVALID_DOCUMENT_MESSAGE);
  }

  const extracted = await extractTextFromFile(filePath, mimeType, originalName);

  // If Gemini returned fields, also try Gemini on the upright corrected image for better accuracy.
  if (isImage && extracted.uprightPath && process.env.GEMINI_API_KEY) {
    try {
      const uprightVision = await extractFieldsWithGemini(extracted.uprightPath, "image/png");
      if (uprightVision && uprightVision.isDocument !== false) {
        vision = uprightVision;
      }
    } catch {
      /* keep original vision */
    }
  }

  if (extracted.uprightPath) {
    fs.unlink(extracted.uprightPath, () => {});
  }

  const likeness = assessDocumentLikeness(
    [extracted.text, vision?.rawTextSummary, vision?.fullName, vision?.procedure]
      .filter(Boolean)
      .join("\n"),
    extracted.method
  );
  if (!likeness.isDocument && !(vision && vision.isDocument)) {
    throw new DocumentValidationError(likeness.message || INVALID_DOCUMENT_MESSAGE);
  }

  const structured = extractStructuredPayload(extracted.text);
  // Layout-aware OCR fields and vision fields overwrite weaker regex guesses.
  structured.payload = applyExternalFields(structured.payload, extracted.fields || {});
  if (vision && vision.isDocument !== false) {
    structured.payload = applyExternalFields(structured.payload, {
      fullName: vision.fullName,
      dateOfBirth: vision.dateOfBirth,
      age: vision.age,
      phone: vision.phone,
      address: vision.address,
      procedure: vision.procedure,
      treatmentDate: vision.treatmentDate,
      amountCharged: vision.amountCharged,
      notes: vision.notes,
    });
  }
  structured.fieldStatuses = refreshFieldStatuses(structured.payload, structured.fieldStatuses);

  const notes = [structured.notes, extracted.warning].filter(Boolean).join(" ");

  return {
    rawText: extracted.text,
    payload: structured.payload,
    fieldStatuses: structured.fieldStatuses,
    extractionNotes: notes,
    method: vision ? `${extracted.method}+vision` : extracted.method,
    validation: likeness,
    orientationDegrees: extracted.orientationDegrees || 0,
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
  inferProcedure,
  fieldStatus,
};
