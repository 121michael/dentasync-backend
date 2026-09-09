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
  { pattern: /\bexo\b|tooth\s*extraction|\bextraction\b/i, value: "Tooth Extraction" },
  { pattern: /root\s*canal|\brct\b/i, value: "Root Canal" },
  { pattern: /\bfilling\b|\bresto\b/i, value: "Dental Filling" },
  { pattern: /whitening|bleaching/i, value: "Teeth Whitening" },
  { pattern: /\bcrown\b/i, value: "Dental Crown" },
  { pattern: /\bimplant\b/i, value: "Dental Implant" },
  { pattern: /ortho(?:dontic)?\s*install|brace\s*install/i, value: "Orthodontic Installation" },
  { pattern: /ortho(?:dontic)?\s*adjust|brace\s*adjust|orthodont|\bbrace/i, value: "Orthodontic Adjustment" },
  { pattern: /consultation/i, value: "Consultation" },
];

const MONTH_TOKEN_RE =
  "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

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
  return "";
}

function looksLikePrintedGenderPrompt(value) {
  const text = cleanLine(value).toLowerCase();
  return /^(m\s*\/\s*f|m\/f|male\s*\/\s*female|f\s*\/\s*m)$/i.test(text);
}

function isTreatmentRecordForm(text) {
  const source = String(text || "");
  const hasTitle = /treatment\s*record/i.test(source);
  const hasTableHeaders =
    /\bdate\b/i.test(source) &&
    /\bprocedure\b/i.test(source) &&
    /amount\s*charged|\bamount\b/i.test(source);
  const hasToothCol = /tooth\s*no|\btooth\b/i.test(source);
  // Require the tooth column so simple "Patient Treatment Record" forms are not treated as multi-row grids.
  return hasToothCol && (hasTitle || hasTableHeaders);
}

function inferProcedureToken(chunk) {
  const source = String(chunk || "");
  const fuzzy = source
    .replace(/0/g, "O")
    .replace(/1/g, "I")
    .replace(/5/g, "S");
  if (/\bEXO\b|extraction/i.test(source)) return "Tooth Extraction";
  if (/ortho\s*install|installation/i.test(source) || /ORTHO.*INSTAL/i.test(fuzzy)) {
    return "Orthodontic Installation";
  }
  if (
    /ortho\s*adjust|adjustment/i.test(source) ||
    /ORTHO.*ADJUST|ORTHO.*ADJM|ORM.*ADJUST|OATH.*ADJUST/i.test(fuzzy)
  ) {
    return "Orthodontic Adjustment";
  }
  return inferProcedure(source);
}

/**
 * Parse multi-row clinic "TREATMENT RECORD" tables into visit entries.
 * Handles common handwriting layouts where the year sits in the Tooth column.
 */
function parseTreatmentRecordRows(rawText) {
  const text = String(rawText || "");
  if (!text.trim()) return [];

  const rows = [];
  const monthDateRe = new RegExp(
    `\\b(${MONTH_TOKEN_RE})\\s*[-.]?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,)?\\s*(20\\d{2})?\\b`,
    "i"
  );

  const lines = text
    .split(/\r?\n/)
    .map((line) => cleanLine(line))
    .filter(Boolean);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const dateMatch = line.match(monthDateRe);
    if (!dateMatch) continue;

    // Keep the row local: current line + next line only when it supplies year / amount / procedure.
    const next = lines[i + 1] || "";
    const next2 = lines[i + 2] || "";
    const next3 = lines[i + 3] || "";
    const monthDateReLocal = new RegExp(monthDateRe.source, "i");
    const nextHasOwnDate = monthDateReLocal.test(next);
    const parts = [line];
    if (!nextHasOwnDate && /^(20\d{2})\b/.test(next)) {
      parts.push(next);
      if (next2 && !monthDateReLocal.test(next2) && /ortho|exo|install|adjust|bracket/i.test(next2)) {
        parts.push(next2);
        if (next3 && !monthDateReLocal.test(next3) && /\b\d{1,3}(?:,\d{3})*(?:\.\d{2})?\b/.test(next3)) {
          parts.push(next3);
        }
      }
    } else if (
      !nextHasOwnDate &&
      /ortho|exo|install|adjust|bracket|\b\d{3,5}\b/i.test(next)
    ) {
      parts.push(next);
    }
    const window = parts.join(" ");

    let year = dateMatch[3] || "";
    if (!year) {
      const nearbyYear = window.match(/\b(20\d{2})\b/);
      year = nearbyYear?.[1] || "";
    }
    if (!year) continue;

    const month = monthToNumber(dateMatch[1]);
    const day = String(dateMatch[2]).padStart(2, "0");
    if (!month) continue;
    const treatmentDate = `${year}-${month}-${day}`;

    const treatment = inferProcedureToken(window);
    const amountMatches = [
      ...window.replace(/,/g, "").matchAll(/\b([1-9]\d{2,5})(?:\.00)?\b/g),
    ].map((m) => m[1]);
    const amount =
      amountMatches.find((value) => {
        const n = Number(value);
        return n >= 100 && n <= 200000 && !/^20\d{2}$/.test(value);
      }) || "";

    const toothMatch = window.match(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\b/);
    const toothNos = toothMatch ? `${toothMatch[1]}-${toothMatch[2]}` : "";

    if (!treatment && !amount) continue;

    rows.push({
      treatmentDate,
      treatment: treatment || "",
      amountCharged: amount ? normalizeAmount(amount) : "",
      toothNos,
      raw: window.slice(0, 180),
    });
  }

  const seen = new Set();
  return rows.filter((row) => {
    const key = `${row.treatmentDate}|${row.treatment}|${row.amountCharged}|${row.toothNos}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function pickPrimaryTreatmentRow(rows) {
  if (!rows?.length) return null;
  // Prefer the earliest installation with an amount, else latest visit with amount, else latest visit.
  const withAmount = rows.filter((row) => row.amountCharged);
  const installation = withAmount.find((row) => /install/i.test(row.treatment));
  if (installation) return installation;
  if (withAmount.length) return withAmount[withAmount.length - 1];
  return rows[rows.length - 1];
}

function summarizeTreatmentRows(rows, limit = 8) {
  if (!rows?.length) return "";
  const lines = rows.slice(0, limit).map((row) => {
    const bits = [row.treatmentDate, row.treatment || "Visit"];
    if (row.toothNos) bits.push(`tooth ${row.toothNos}`);
    if (row.amountCharged) bits.push(`₱${row.amountCharged}`);
    return bits.join(" · ");
  });
  const extra = rows.length > limit ? ` (+${rows.length - limit} more visits)` : "";
  return `Treatment record visits: ${lines.join("; ")}${extra}`;
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
  // Single-digit OCR ages are usually truncated handwriting (25 -> 2).
  if (age < 10) return "";
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
  // Only accept mobiles next to an explicit phone label — OCR noise invents digit runs.
  const labeled = String(text || "").match(
    /(?:phone|mobile|cellphone|cell\s*phone|telephone|tel\.?)\s*[:\-]?\s*([+\d()[\]\-\s]{10,20})/i
  );
  if (labeled?.[1]) {
    return normalizePhone(labeled[1]);
  }
  return "";
}

function isPlausiblePersonName(value) {
  const text = cleanLine(value);
  if (!text || text.length < 3 || text.length > 60) return false;
  if (/^(date|age|gender|phone|address|patient|name|procedure|treatment|amount|tooth)\b/i.test(text)) {
    return false;
  }
  if (/[0-9:;|_=]/.test(text)) return false;
  if ((text.match(/[A-Za-z]/g) || []).length < 3) return false;
  // Reject OCR soup with too many short junk tokens.
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length > 6) return false;
  return /^[A-Za-z][A-Za-z .,'\-]+$/.test(text);
}

function applyExternalFields(payload, fields = {}) {
  if (!fields || typeof fields !== "object") return payload;
  const next = payload;

  if (fields.fullName && isPlausiblePersonName(fields.fullName) && !next.patient.fullName) {
    const names = splitName(fields.fullName);
    next.patient.firstName = names.firstName;
    next.patient.lastName = names.lastName;
    next.patient.fullName = names.fullName;
  }
  if (fields.dateOfBirth && !next.patient.dateOfBirth) {
    next.patient.dateOfBirth = normalizeDate(fields.dateOfBirth);
  }
  if (fields.age && !next.patient.age) next.patient.age = normalizeAge(fields.age);
  if (fields.phone && !next.patient.phone) {
    const phone = normalizePhone(fields.phone);
    if (phone) next.patient.phone = phone;
  }
  if (fields.address && !next.patient.address) next.patient.address = cleanLine(fields.address);
  if (fields.procedure && !next.procedure.treatment) {
    next.procedure.treatment = inferProcedure(fields.procedure) || cleanLine(fields.procedure);
  }
  if (fields.treatmentDate && !next.procedure.treatmentDate) {
    next.procedure.treatmentDate = normalizeDate(fields.treatmentDate);
  }
  if (fields.amountCharged && !next.procedure.amountCharged) {
    next.procedure.amountCharged = normalizeAmount(fields.amountCharged);
  }
  if (fields.notes && !next.procedure.notes) next.procedure.notes = cleanLine(fields.notes);
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
        const startsWithKnownLabel = [...stopSet].some(
          (label) =>
            nextLower === label ||
            nextLower.startsWith(`${label} `) ||
            nextLower.startsWith(`${label}:`)
        );
        if (stopSet.has(nextLower) || labelSet.includes(nextLower) || startsWithKnownLabel) break;
        if (
          /^(date|no\.?|description|time|debit|credit|amount|balance|gender|sex|tooth|procedure|dentist)/i.test(
            next
          )
        ) {
          break;
        }
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
      /(?:^|\n)\s*name\s*[:\-]\s*([A-Za-z][A-Za-z0-9 .,'\-_]{2,80})/im,
      /(?:mr\.?|ms\.?|mrs\.?|dr\.?)\s+([A-Za-z]+(?:\s+[A-Za-z\-]+){1,4})/,
    ]);
  const rejectedName =
    /^(age|gender|sex|date|address|phone|telephone|cellphone|procedure|treatment|amount|tooth|dentist|name)$/i;
  const cleanedName = fullName.replace(/^(mr|ms|mrs|dr)\.?\s+/i, "");
  const names = splitName(
    rejectedName.test(cleanedName) || !isPlausiblePersonName(cleanedName) ? "" : cleanedName
  );
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
        /(?:^|\n)\s*age\s*[:\-]\s*([0-9]{1,3})(?:\s*(?:years?|yrs?|y\.?o\.?))?(?:\n|$)/im,
        /\bage\s*[:\-]\s*([0-9]{1,3})\b/i,
      ])
  );
  // Blank Age: labels on treatment records must not steal day numbers from visit dates.
  if (isTreatmentRecordForm(text) && !/(?:^|\n)\s*age\s*[:\-]\s*[0-9]{1,3}\b/im.test(text)) {
    payload.patient.age = "";
  }
  fieldStatuses.age = fieldStatus(payload.patient.age, labelPresent(text, /\bage\b/i));

  payload.patient.gender = capture(text, [
    /(?:gender|sex)\s*[:\-]\s*(male|female|m|f|other)\b/i,
  ]);
  if (looksLikePrintedGenderPrompt(payload.patient.gender) || /m\s*\/\s*f/i.test(payload.patient.gender)) {
    payload.patient.gender = "";
  }
  // Printed forms often show "Gender: M/F" with no selection — ignore that prompt text.
  if (/gender\s*[:\-]?\s*m\s*\/?\s*f/i.test(text) && !/(?:gender|sex)\s*[:\-]\s*(male|female)\b/i.test(text)) {
    const selected = text.match(/(?:gender|sex)\s*[:\-]\s*([mf])\b(?!\s*\/)/i);
    payload.patient.gender = selected?.[1] || "";
  }
  if (/^m$/i.test(payload.patient.gender)) payload.patient.gender = "Male";
  if (/^f$/i.test(payload.patient.gender)) payload.patient.gender = "Female";
  if (!/^(male|female|other)$/i.test(payload.patient.gender || "")) {
    payload.patient.gender = "";
  }
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

  // Multi-row TREATMENT RECORD tables: auto-fill primary visit + history notes.
  const treatmentRows = parseTreatmentRecordRows(text);
  if (treatmentRows.length) {
    const primary = pickPrimaryTreatmentRow(treatmentRows);
    if (primary?.treatment && !payload.procedure.treatment) {
      payload.procedure.treatment = primary.treatment;
      fieldStatuses.treatment = "detected";
    } else if (primary?.treatment && /ortho|extraction|exo/i.test(primary.treatment)) {
      payload.procedure.treatment = primary.treatment;
      fieldStatuses.treatment = "detected";
    }
    if (primary?.treatmentDate) {
      payload.procedure.treatmentDate = primary.treatmentDate;
      fieldStatuses.treatmentDate = "detected";
    }
    if (primary?.amountCharged) {
      payload.procedure.amountCharged = primary.amountCharged;
      fieldStatuses.amountCharged = "detected";
    }
    const history = summarizeTreatmentRows(treatmentRows);
    payload.procedure.notes = payload.procedure.notes
      ? `${payload.procedure.notes} | ${history}`
      : history;
  } else if (isTreatmentRecordForm(text)) {
    // Headers detected but row OCR was weak — still try fuzzy procedure tokens.
    const fuzzyTreatment = inferProcedureToken(text);
    if (fuzzyTreatment && !payload.procedure.treatment) {
      payload.procedure.treatment = fuzzyTreatment;
      fieldStatuses.treatment = "detected";
    }
    if (!payload.procedure.notes) {
      payload.procedure.notes =
        "Treatment record form detected. Review handwriting and confirm procedure/amount before saving.";
    }
  }

  const filledCount = [
    payload.patient.fullName,
    payload.patient.phone,
    payload.patient.age,
    payload.patient.dateOfBirth,
    payload.procedure.treatment,
    payload.procedure.treatmentDate,
    payload.procedure.amountCharged,
  ].filter(Boolean).length;

  if (filledCount === 0) {
    notes.push(
      "Document detected, but structured fields could not be read automatically. Type values from the preview, then Confirm & Save."
    );
  } else {
    notes.push(
      `Auto-filled ${filledCount} field${filledCount === 1 ? "" : "s"} from the document. Review them, then Confirm & Save.`
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
    if (Array.isArray(vision.visits) && vision.visits.length) {
      const visitLines = vision.visits
        .slice(0, 10)
        .map((visit) => {
          const bits = [visit.date, visit.procedure, visit.toothNos, visit.amount]
            .map((value) => cleanLine(value))
            .filter(Boolean);
          return bits.join(" · ");
        })
        .filter(Boolean);
      if (visitLines.length) {
        const history = `Treatment record visits: ${visitLines.join("; ")}`;
        structured.payload.procedure.notes = structured.payload.procedure.notes
          ? `${structured.payload.procedure.notes} | ${history}`
          : history;
      }
    }
  }
  structured.fieldStatuses = refreshFieldStatuses(structured.payload, structured.fieldStatuses);

  const filledCount = [
    structured.payload.patient.fullName,
    structured.payload.patient.phone,
    structured.payload.patient.age,
    structured.payload.patient.dateOfBirth,
    structured.payload.procedure.treatment,
    structured.payload.procedure.treatmentDate,
    structured.payload.procedure.amountCharged,
  ].filter(Boolean).length;

  const notes = [
    filledCount
      ? `Auto-filled ${filledCount} field${filledCount === 1 ? "" : "s"} from the document. Review them, then Confirm & Save.`
      : structured.notes,
    extracted.warning,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    rawText: extracted.text,
    payload: structured.payload,
    fieldStatuses: structured.fieldStatuses,
    extractionNotes: notes,
    method: vision ? `${extracted.method}+vision` : extracted.method,
    validation: likeness,
    orientationDegrees: extracted.orientationDegrees || 0,
    autoFilledCount: filledCount,
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
  parseTreatmentRecordRows,
  pickPrimaryTreatmentRow,
  isTreatmentRecordForm,
};
