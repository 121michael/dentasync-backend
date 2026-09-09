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
  return ["fullName", "procedure", "treatmentDate", "amountCharged", "age", "phone"].filter((key) => {
    const text = String(fields[key] || "").trim();
    if (!text) return false;
    if (key === "phone") {
      const digits = text.replace(/\D/g, "");
      if (!/^(0\d{10}|9\d{9}|63\d{10})$/.test(digits)) return false;
    }
    if (/^date of birth|^amount|^procedure|^treatment/i.test(text)) return false;
    return true;
  }).length;
}

function resultQuality(result) {
  const fields = result?.fields && typeof result.fields === "object" ? result.fields : {};
  const filled = countFilledFields(fields);
  const hasProcedure = Boolean(fields.procedure || fields.treatment);
  const hasAmount = Boolean(fields.amountCharged);
  const hasName = Boolean(fields.fullName);
  return filled * 20 + (hasProcedure ? 25 : 0) + (hasAmount ? 15 : 0) + (hasName ? 20 : 0) + Number(result?.score || 0);
}

async function prepareOrientedVariants(filePath) {
  const sharp = require("sharp");
  const original = fs.readFileSync(filePath);
  const image = sharp(original, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const variants = [];

  for (const degrees of [0, 90, 180, 270]) {
    let pipeline = sharp(original, { failOn: "none" }).rotate();
    if (degrees) {
      pipeline = pipeline.rotate(degrees);
    }
    const width = meta.width || 1200;
    if (width < 1600) {
      pipeline = pipeline.resize({ width: Math.round(width * 1.8), withoutEnlargement: false });
    } else if (width > 2800) {
      pipeline = pipeline.resize({ width: 2400 });
    }
    const buffer = await pipeline.grayscale().normalize().sharpen().png().toBuffer();
    variants.push({ degrees, buffer });
  }
  return variants;
}

function writeTempVariant(buffer, degrees) {
  const tempPath = path.join(
    os.tmpdir(),
    `doc-sync-${process.pid}-${degrees}-${Date.now()}.png`
  );
  fs.writeFileSync(tempPath, buffer);
  return tempPath;
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

async function recognizeWithTesseract(filePath) {
  const { createWorker } = require("tesseract.js");
  const worker = await createWorker("eng", 1, { legacyCore: true, legacyLang: true });
  try {
    await worker.setParameters({
      tessedit_pageseg_mode: "6",
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

async function extractBestImageText(filePath) {
  // Layout-aware EasyOCR rotates internally and returns structured fields.
  const easyDirect = runEasyOcr(filePath);
  const easyFilled = countFilledFields(easyDirect?.fields);
  const easyStrong =
    easyDirect?.text &&
    Number(easyDirect.score || 0) >= 20 &&
    easyFilled >= 2;

  // Only short-circuit when EasyOCR already produced usable autofill fields.
  // Header-only forms (TREATMENT RECORD tables) often score high on keywords
  // while handwriting remains unread — those must continue to Tesseract merge.
  if (easyStrong) {
    return {
      text: easyDirect.text,
      score: Number(easyDirect.score || 0),
      degrees: Number(easyDirect.degrees || 0),
      method: "easyocr",
      confidence: Number(easyDirect.confidence || 0),
      fields: easyDirect.fields && typeof easyDirect.fields === "object" ? easyDirect.fields : {},
      uprightPath: null,
    };
  }

  const variants = await prepareOrientedVariants(filePath);
  const tempPaths = [];
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

  try {
    for (const variant of variants) {
      const tempPath = writeTempVariant(variant.buffer, variant.degrees);
      tempPaths.push(tempPath);
      const tess = await recognizeWithTesseract(tempPath);
      const mergedText = [easyDirect?.text || "", tess.text].filter(Boolean).join("\n");
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
      const quality = resultQuality(candidate) + (tess.text ? 5 : 0);
      if (quality > bestQuality) {
        best = candidate;
        bestQuality = quality;
        keepPath = tempPath;
      }
    }
  } finally {
    for (const tempPath of tempPaths) {
      if (tempPath !== keepPath) {
        fs.unlink(tempPath, () => {});
      }
    }
  }

  return best;
}

module.exports = {
  scoreDocumentText,
  prepareOrientedVariants,
  extractBestImageText,
  runEasyOcr,
  countFilledFields,
};
