"use strict";

/**
 * Cloud OCR fallback for dense handwritten clinic forms.
 * Uses OCR.space when local EasyOCR/Tesseract cannot fill fields.
 *
 * Set OCR_SPACE_API_KEY for production. A public free-tier key is used only
 * as a last-resort development fallback.
 */

const FS = require("fs");
const OS = require("os");
const PATH = require("path");

const FREE_OCR_SPACE_FALLBACK_KEY = "K87899142388957";

async function prepareOcrSpaceImage(filePath) {
  try {
    const sharp = require("sharp");
    const outPath = PATH.join(
      OS.tmpdir(),
      `ocrspace-${process.pid}-${Date.now()}.jpg`
    );
    await sharp(filePath, { failOn: "none" })
      .rotate()
      .resize({ width: 1600, withoutEnlargement: true })
      .grayscale()
      .normalize()
      .sharpen()
      .jpeg({ quality: 72, mozjpeg: true })
      .toFile(outPath);
    return { path: outPath, mimeType: "image/jpeg", temporary: true };
  } catch {
    return { path: filePath, mimeType: "image/jpeg", temporary: false };
  }
}

async function requestOcrSpace(base64Image, apiKey, engine) {
  const body = new URLSearchParams();
  body.set("apikey", apiKey);
  body.set("language", "eng");
  body.set("isOverlayRequired", "false");
  body.set("OCREngine", String(engine));
  body.set("scale", "true");
  body.set("detectOrientation", "true");
  body.set("base64Image", base64Image);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    return { response, data: response.ok ? await response.json() : null };
  } finally {
    clearTimeout(timer);
  }
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractTextWithOcrSpace(filePath, mimeType = "image/jpeg") {
  const apiKey =
    process.env.OCR_SPACE_API_KEY ||
    process.env.OCRSPACE_API_KEY ||
    FREE_OCR_SPACE_FALLBACK_KEY;

  if (!apiKey || !filePath || !FS.existsSync(filePath)) {
    return null;
  }

  const prepared = await prepareOcrSpaceImage(filePath);
  try {
    const buffer = FS.readFileSync(prepared.path);
    if (!buffer.length || buffer.length > 5 * 1024 * 1024) {
      return null;
    }

    const base64Image = `data:${prepared.mimeType || mimeType || "image/jpeg"};base64,${buffer.toString("base64")}`;
    const engines = [2, 1];

    for (const engine of engines) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const { response, data } = await requestOcrSpace(base64Image, apiKey, engine);
          if (response.status === 429) {
            await sleep(1200 * (attempt + 1));
            continue;
          }
          if (!response.ok) {
            console.warn("OCR.space request failed:", response.status);
            break;
          }
          if (data?.IsErroredOnProcessing) {
            console.warn("OCR.space processing error:", data?.ErrorMessage || data?.ErrorDetails);
            break;
          }
          const text = String(data?.ParsedResults?.[0]?.ParsedText || "").trim();
          if (!text) break;
          return {
            text,
            method: `ocrspace-e${engine}`,
            confidence: 60,
            fields: {},
          };
        } catch (error) {
          console.warn("OCR.space extraction skipped:", error.message);
          await sleep(800 * (attempt + 1));
        }
      }
    }
    return null;
  } finally {
    if (prepared.temporary && prepared.path) {
      FS.unlink(prepared.path, () => {});
    }
  }
}

module.exports = {
  extractTextWithOcrSpace,
};
