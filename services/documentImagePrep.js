"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const DENTAL_KEYWORDS = [
  "name",
  "address",
  "telephone",
  "cellphone",
  "age",
  "occupation",
  "status",
  "complaint",
  "description",
  "amount",
  "debit",
  "credit",
  "balance",
  "date",
  "procedure",
  "treatment",
  "patient",
  "prophylaxis",
  "dental",
  "ortho",
  "tooth",
];

function scoreDocumentText(text) {
  const normalized = String(text || "").toLowerCase();
  if (!normalized.trim()) return 0;
  let score = Math.min(normalized.length / 40, 25);
  for (const keyword of DENTAL_KEYWORDS) {
    if (normalized.includes(keyword)) score += 8;
  }
  if (/\b0?9\d{9}\b/.test(normalized.replace(/\D/g, " "))) score += 10;
  if (/\b(19|20)\d{2}\b/.test(normalized)) score += 4;
  if (/\b(oral|cleaning|filling|extraction|prophylaxis|root\s*canal|ortho|exo)\b/i.test(normalized)) {
    score += 10;
  }
  return score;
}

function countFilledFields(fields) {
  if (!fields || typeof fields !== "object") return 0;
  const base = ["fullName", "procedure", "treatmentDate", "amountCharged", "age", "phone", "address", "gender"].filter(
    (key) => {
      const text = String(fields[key] || "").trim();
      if (!text) return false;
      if (key === "phone") {
        const digits = text.replace(/\D/g, "");
        if (!/^(0\d{10}|9\d{9}|63\d{10})$/.test(digits)) return false;
      }
      if (key === "address" && text.length < 4) return false;
      if (/^date of birth|^amount|^procedure|^treatment/i.test(text)) return false;
      if (key === "procedure" && /dentis|charged|balance|appt|tooth\s*no|amount\s*paid/i.test(text)) {
        return false;
      }
      if (key === "amountCharged") {
        const digits = text.replace(/,/g, "");
        if (/^20[1-3]\d$/.test(digits)) return false;
        if (digits.length >= 5 && Number(digits) > 10000) return false;
      }
      return true;
    }
  ).length;
  const visits = Array.isArray(fields.visits) ? fields.visits : [];
  return base + Math.min(visits.filter((row) => String(row?.treatment || "").trim()).length, 8);
}

function mergeEasyOcrResults(primary, secondary) {
  if (!primary && !secondary) return null;
  if (!primary) return secondary;
  if (!secondary) return primary;
  const preferPrimary = resultQuality(primary) >= resultQuality(secondary);
  const winner = preferPrimary ? primary : secondary;
  const other = preferPrimary ? secondary : primary;
  const fields = { ...(winner.fields || {}) };
  const otherFields = other.fields || {};
  for (const key of [
    "fullName",
    "address",
    "phone",
    "age",
    "procedure",
    "treatmentDate",
    "amountCharged",
    "notes",
    "gender",
  ]) {
    if (!fields[key] && otherFields[key]) fields[key] = otherFields[key];
  }
  const winnerVisits = Array.isArray(fields.visits) ? fields.visits : [];
  const otherVisits = Array.isArray(otherFields.visits) ? otherFields.visits : [];
  if (otherVisits.length > winnerVisits.length) {
    fields.visits = otherVisits;
  } else if (!winnerVisits.length && otherVisits.length) {
    fields.visits = otherVisits;
  }
  return {
    ...winner,
    fields,
    text: [winner.text, other.text].filter(Boolean).join("\n"),
    score: Math.max(Number(winner.score || 0), Number(other.score || 0)),
    confidence: Math.max(Number(winner.confidence || 0), Number(other.confidence || 0)),
  };
}

function resultQuality(result) {
  const fields = result?.fields && typeof result.fields === "object" ? result.fields : {};
  const filled = countFilledFields(fields);
  const hasProcedure = Boolean(fields.procedure || fields.treatment);
  const hasAmount = Boolean(fields.amountCharged);
  const hasName = Boolean(fields.fullName);
  return filled * 20 + (hasProcedure ? 25 : 0) + (hasAmount ? 15 : 0) + (hasName ? 20 : 0) + Number(result?.score || 0);
}

function writeTempVariant(buffer, label) {
  const tempPath = path.join(
    os.tmpdir(),
    `doc-sync-${process.pid}-${label}-${Date.now()}.png`
  );
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
}

async function buildPreprocessVariants(filePath) {
  const sharp = require("sharp");
  const original = fs.readFileSync(filePath);
  const base = sharp(original, { failOn: "none" }).rotate();
  const meta = await base.metadata();
  const targetWidth =
    !meta.width || meta.width < 1600
      ? Math.round((meta.width || 1000) * 1.8)
      : meta.width > 2600
        ? 2200
        : meta.width;

  const sized = await sharp(original, { failOn: "none" })
    .rotate()
    .resize({ width: targetWidth, withoutEnlargement: false })
    .toBuffer();

  const { data, info } = await sharp(sized, { failOn: "none" })
    .ensureAlpha()
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const redSuppressed = Buffer.alloc(info.width * info.height);
  for (let i = 0, j = 0; i < data.length; i += 3, j += 1) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    // Fade red printed form lines; keep dark handwritten ink.
    let value = Math.min(g, b);
    if (r > g + 20 && r > b + 20) {
      value = Math.min(255, value + 90);
    }
    redSuppressed[j] = value;
  }

  const variants = [];
  variants.push({
    label: "gray",
    degrees: 0,
    buffer: await sharp(sized, { failOn: "none" }).grayscale().normalize().sharpen().png().toBuffer(),
  });
  variants.push({
    label: "contrast",
    degrees: 0,
    buffer: await sharp(sized, { failOn: "none" })
      .grayscale()
      .normalize()
      .linear(1.45, -35)
      .sharpen()
      .png()
      .toBuffer(),
  });
  variants.push({
    label: "redsup",
    degrees: 0,
    buffer: await sharp(redSuppressed, {
      raw: { width: info.width, height: info.height, channels: 1 },
    })
      .normalize()
      .sharpen()
      .png()
      .toBuffer(),
  });

  // Also try 90/180/270 on the strongest contrast pipeline for sideways phone photos.
  for (const degrees of [90, 180, 270]) {
    variants.push({
      label: `contrast-${degrees}`,
      degrees,
      buffer: await sharp(sized, { failOn: "none" })
        .rotate(degrees)
        .grayscale()
        .normalize()
        .linear(1.35, -30)
        .sharpen()
        .png()
        .toBuffer(),
    });
  }

  return variants;
}

function runEasyOcr(filePath) {
  const scriptPath = path.join(__dirname, "..", "scripts", "easyocr_extract.py");
  if (!fs.existsSync(scriptPath)) {
    return null;
  }
  const result = spawnSync("python3", [scriptPath, filePath], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180000,
    env: { ...process.env, PYTHONWARNINGS: "ignore" },
  });
  if (result.status !== 0) {
    return null;
  }
  try {
    const parsed = JSON.parse(result.stdout || "{}");
    if (!parsed || typeof parsed.text !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

async function recognizeWithTesseract(filePath, pageSegMode = "6") {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker("eng", 1, { legacyCore: true, legacyLang: true });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: String(pageSegMode),
      preserve_interword_spaces: "1",
    });
    const result = await worker.recognize(filePath);
    return {
      text: String(result?.data?.text || "").trim(),
      confidence: Number(result?.data?.confidence || 0),
    };
  } finally {
    await worker.terminate();
  }
}

async function extractDentalChartPanelTexts(filePath) {
  const sharp = require("sharp");
  const original = fs.readFileSync(filePath);
  const image = sharp(original, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const width = meta.width || 1200;
  const height = meta.height || 1600;
  const panels = [];

  const specs = [
    {
      key: "patient",
      left: Math.floor(width * 0.4),
      top: Math.floor(height * 0.04),
      width: Math.floor(width * 0.58),
      height: Math.floor(height * 0.4),
    },
    {
      key: "treatment",
      left: Math.floor(width * 0.02),
      top: Math.floor(height * 0.48),
      width: Math.floor(width * 0.96),
      height: Math.floor(height * 0.2),
    },
    {
      key: "amount",
      left: Math.floor(width * 0.62),
      top: Math.floor(height * 0.48),
      width: Math.floor(width * 0.34),
      height: Math.floor(height * 0.18),
    },
  ];

  for (const spec of specs) {
    if (spec.width < 40 || spec.height < 40) continue;
    const buffer = await sharp(original, { failOn: "none" })
      .rotate()
      .extract({
        left: Math.max(0, spec.left),
        top: Math.max(0, spec.top),
        width: Math.min(spec.width, width - Math.max(0, spec.left)),
        height: Math.min(spec.height, height - Math.max(0, spec.top)),
      })
      .grayscale()
      .normalize()
      .linear(1.45, -30)
      .sharpen()
      .resize({ width: 1600, withoutEnlargement: false })
      .png()
      .toBuffer();
    const tempPath = writeTempVariant(buffer, `panel-${spec.key}`);
    try {
      const tess = await recognizeWithTesseract(tempPath, spec.key === "amount" ? "7" : "6");
      panels.push({ key: spec.key, text: tess.text || "", confidence: tess.confidence || 0 });
    } finally {
      fs.unlink(tempPath, () => {});
    }
  }

  return panels;
}

function panelNameQuality(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  let score = Math.min(text.length, 36);
  const tokens = text.split(/[\s\-]+/).filter(Boolean);
  if (tokens.length >= 2) score += 12;
  if (/bneelou|bnegenou|saehtnan|brghtnan|\bors\b/i.test(text)) score -= 25;
  if (/[0-9]/.test(text)) score -= 8;
  if (/^[A-Za-z]+(?:[\s\-][A-Za-z]+)+$/.test(text)) score += 10;
  return score;
}

function panelProcedureQuality(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  if (/prophylax|pr[o0].{0,8}h[il1y].{0,6}x/i.test(text)) return 40 + text.length;
  if (/oral/i.test(text)) return 30 + text.length;
  if (/ortho|install|adjust|exo|cleaning|filling/i.test(text)) return 20 + text.length;
  if (/^pr[o0][a-z]{2,}$/i.test(text)) return 5 + text.length;
  return 0;
}

function mergeChartPanelFields(fields = {}, panels = []) {
  const next = { ...(fields || {}) };
  const patientPanel = panels.find((panel) => panel.key === "patient");
  const treatmentPanel = panels.find((panel) => panel.key === "treatment");
  const amountPanel = panels.find((panel) => panel.key === "amount");
  const patientText = patientPanel?.text || "";
  const treatmentText = treatmentPanel?.text || "";
  const amountText = amountPanel?.text || "";
  const combinedTreat = `${treatmentText}\n${amountText}\n${patientText}`;

  const nameMatch = patientText.match(
    /\bname\b\s*[:\-]?\s*([A-Za-z0-9][A-Za-z0-9 .,\-]{2,70})/i
  );
  if (nameMatch?.[1]) {
    let candidate = nameMatch[1]
      .replace(/\s+/g, " ")
      .replace(/\b0/g, "O")
      .replace(/\s*-\s*/g, "-")
      .trim();
    candidate = candidate.replace(/[^A-Za-z .,'\-]/g, " ").replace(/\s+/g, " ").trim();
    if (candidate.length >= 5 && panelNameQuality(candidate) > panelNameQuality(next.fullName)) {
      next.fullName = candidate;
    }
  }

  const ageMatch =
    patientText.match(/\bage\b\s*[:\-]?\s*([1-9]\d)\b/i) ||
    patientText.match(/\bage\b\s*[:\-]?\s*([0-9A-Za-z]{2})\b/i);
  if (ageMatch?.[1]) {
    const candidate = String(ageMatch[1]).trim();
    if (!next.age) {
      next.age = candidate;
    } else if (/^\d{2}$/.test(candidate) && Number(candidate) >= 10 && Number(candidate) <= 90) {
      // Patient-panel age is usually more trustworthy than whole-page OCR guesses.
      next.age = candidate;
    }
  }

  const phoneMatch = patientText.match(
    /\b(?:telephone|cellphone|phone|tel\.?)\b\s*[:\-]?\s*([0-9OIl][0-9OIl\-\s]{8,16})/i
  );
  if (phoneMatch?.[1] && !next.phone) {
    next.phone = phoneMatch[1];
  }

  const addressMatch = patientText.match(/\baddress\b\s*[:\-]?\s*([A-Za-z][A-Za-z0-9 ,.\-]{3,60})/i);
  if (addressMatch?.[1] && (!next.address || addressMatch[1].trim().length > String(next.address).length + 2)) {
    next.address = addressMatch[1].trim();
  }

  const procedureMatches = [
    ...combinedTreat.matchAll(
      /\b(oral\s*prophylaxis|pr[o0][A-Za-z]{2,14}|ortho(?:dontic)?\s*install(?:ation)?|ortho(?:dontic)?\s*adjust(?:ment)?)\b/gi
    ),
  ].map((match) => match[1]);
  for (const candidate of procedureMatches) {
    if (panelProcedureQuality(candidate) > panelProcedureQuality(next.procedure)) {
      next.procedure = candidate;
    }
  }

  const dateMatch = combinedTreat.match(
    /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s*[-.]?\s*\d{1,2}(?:st|nd|rd|th)?(?:,)?\s*20\d{2}\b/i
  );
  if (dateMatch?.[0]) next.treatmentDate = dateMatch[0];
  else if (!next.treatmentDate) {
    const noisyDate = combinedTreat.match(/(?:[\(\[]|\b)((?:tpt|jtp[1l7]?|itet|5ept|sept)[^\n]{0,24})/i);
    if (noisyDate?.[1]) next.treatmentDate = noisyDate[1];
  }

  const amountCandidates = [
    ...((`${amountText}\n${treatmentText}`.match(/\b([bB8][0oOdqvuw]{2,4})\b/g) || [])),
    ...(amountText.match(/\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,5})\b/g) || []),
    ...(treatmentText.match(/\b([1-9]\d{0,2}(?:,\d{3})+|[1-9]\d{3,5})\b/g) || []),
  ];
  const currentAmount = String(next.amountCharged || "").replace(/,/g, "");
  const needsAmount =
    !next.amountCharged ||
    /^20[1-3]\d$/.test(currentAmount) ||
    (currentAmount.length >= 5 && Number(currentAmount) > 10000);
  if (needsAmount) {
    for (const candidate of amountCandidates) {
      const digits = String(candidate).replace(/,/g, "");
      if (/^20[1-3]\d$/.test(digits)) continue;
      if (digits.length >= 5 && Number(digits) > 10000) continue;
      // Prefer letter-repaired Buvd/B0vd style tokens that map to 2000/3000.
      if (/^[bB8][0oOdqvuw]{2,4}$/.test(candidate)) {
        next.amountCharged = candidate;
        break;
      }
      if (/^[1-9]\d{2,4}$/.test(digits) && Number(digits) >= 100 && Number(digits) <= 20000) {
        next.amountCharged = candidate;
        break;
      }
    }
  }

  return next;
}

function mergeUniqueTexts(parts) {
  const seen = new Set();
  const kept = [];
  for (const part of parts) {
    const text = String(part || "").trim();
    if (!text) continue;
    const key = text.toLowerCase().replace(/\s+/g, " ").slice(0, 240);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept.join("\n");
}

async function extractBestImageText(filePath) {
  // Always OCR the original photo with EasyOCR first — aggressive preprocess can erase ink.
  const easyOriginal = runEasyOcr(filePath);
  let easyPrepPath = null;
  let easyPreprocessed = null;
  try {
    const variantsForEasy = await buildPreprocessVariants(filePath);
    const preferred =
      variantsForEasy.find((entry) => entry.label === "contrast") ||
      variantsForEasy.find((entry) => entry.label === "redsup") ||
      variantsForEasy[0];
    if (preferred?.buffer) {
      easyPrepPath = writeTempVariant(preferred.buffer, "easy-source");
      easyPreprocessed = runEasyOcr(easyPrepPath);
    }
  } catch {
    easyPreprocessed = null;
  }

  const easyDirect = mergeEasyOcrResults(easyOriginal, easyPreprocessed);
  const easyFilled = countFilledFields(easyDirect?.fields);
  const easyStrong =
    easyDirect?.text &&
    Number(easyDirect.score || 0) >= 18 &&
    easyFilled >= 2;

  if (easyStrong) {
    let fields = easyDirect.fields && typeof easyDirect.fields === "object" ? easyDirect.fields : {};
    let text = easyDirect.text;
    try {
      const panels = await extractDentalChartPanelTexts(filePath);
      fields = mergeChartPanelFields(fields, panels);
      const panelText = panels.map((panel) => panel.text).filter(Boolean).join("\n");
      if (panelText) text = mergeUniqueTexts([text, panelText]);
    } catch {
      /* panel OCR is best-effort */
    }
    if (easyPrepPath) fs.unlink(easyPrepPath, () => {});
    return {
      text,
      score: Number(easyDirect.score || 0),
      degrees: Number(easyDirect.degrees || 0),
      method: "easyocr",
      confidence: Number(easyDirect.confidence || 0),
      fields,
      uprightPath: null,
    };
  }

  const variants = await buildPreprocessVariants(filePath);
  const uprightVariants = variants.filter((entry) => entry.degrees === 0);
  const rotatedVariants = variants.filter((entry) => entry.degrees !== 0);
  const tempPaths = [];
  const textParts = [easyDirect?.text || ""];
  let best = {
    text: easyDirect?.text || "",
    score: Number(easyDirect?.score || -1),
    degrees: Number(easyDirect?.degrees || 0),
    method: easyDirect?.text ? "easyocr" : "ocr",
    confidence: Number(easyDirect?.confidence || 0),
    fields: easyDirect?.fields || {},
    uprightPath: null,
  };
  let keepPath = null;
  let bestQuality = resultQuality(best);

  async function considerVariant(variant) {
    const tempPath = writeTempVariant(variant.buffer, `${variant.label}-${variant.degrees}`);
    tempPaths.push(tempPath);
    const modes = variant.label === "redsup" || variant.label === "contrast" ? ["6", "4"] : ["6"];
    for (const psm of modes) {
      const tess = await recognizeWithTesseract(tempPath, psm);
      if (tess.text) textParts.push(tess.text);
      const mergedText = mergeUniqueTexts([easyDirect?.text || "", ...textParts]);
      const tessScore = scoreDocumentText(mergedText || tess.text) + tess.confidence / 20;
      const candidate = {
        text: mergedText || tess.text,
        score: Math.max(tessScore, Number(easyDirect?.score || 0)),
        degrees: variant.degrees,
        method: easyDirect?.text ? "easyocr+ocr" : "ocr",
        confidence: Math.max(Number(easyDirect?.confidence || 0), tess.confidence),
        fields: easyDirect?.fields || {},
        uprightPath: tempPath,
      };
      const quality = resultQuality(candidate) + (tess.text ? 5 : 0) + (variant.degrees === 0 ? 3 : 0);
      if (quality > bestQuality) {
        best = candidate;
        bestQuality = quality;
        keepPath = tempPath;
      }
    }
  }

  try {
    for (const variant of uprightVariants) {
      await considerVariant(variant);
    }
    if (countFilledFields(best.fields) < 2 && scoreDocumentText(best.text) < 24) {
      for (const variant of rotatedVariants) {
        await considerVariant(variant);
      }
    }

    // Always return the richest merged text, even if field quality stayed weak.
    best.text = mergeUniqueTexts([best.text, ...textParts]);
    best.score = Math.max(best.score, scoreDocumentText(best.text));
    try {
      const panels = await extractDentalChartPanelTexts(filePath);
      best.fields = mergeChartPanelFields(best.fields || {}, panels);
      const panelText = panels.map((panel) => panel.text).filter(Boolean).join("\n");
      if (panelText) best.text = mergeUniqueTexts([best.text, panelText]);
    } catch {
      /* panel OCR is best-effort */
    }
  } finally {
    for (const tempPath of tempPaths) {
      if (tempPath !== keepPath) {
        fs.unlink(tempPath, () => {});
      }
    }
    if (easyPrepPath && easyPrepPath !== keepPath) {
      fs.unlink(easyPrepPath, () => {});
    }
  }

  return best;
}

module.exports = {
  scoreDocumentText,
  prepareOrientedVariants: buildPreprocessVariants,
  extractBestImageText,
  runEasyOcr,
  countFilledFields,
};
