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
  return ["fullName", "procedure", "treatmentDate", "amountCharged", "age", "phone", "address"].filter((key) => {
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

  const easyDirect =
    resultQuality(easyOriginal) >= resultQuality(easyPreprocessed) ? easyOriginal : easyPreprocessed || easyOriginal;
  const easyFilled = countFilledFields(easyDirect?.fields);
  const easyStrong =
    easyDirect?.text &&
    Number(easyDirect.score || 0) >= 18 &&
    easyFilled >= 2;

  if (easyStrong) {
    if (easyPrepPath) fs.unlink(easyPrepPath, () => {});
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
