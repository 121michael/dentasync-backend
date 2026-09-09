"use strict";

/**
 * Cloud OCR fallback for dense handwritten clinic forms.
 * Uses OCR.space when local EasyOCR/Tesseract cannot fill fields.
 *
 * Set OCR_SPACE_API_KEY for production. A public free-tier key is used only
 * as a last-resort development fallback.
 */

const FS = require("fs");

const FREE_OCR_SPACE_FALLBACK_KEY = "K87899142388957";

async function extractTextWithOcrSpace(filePath, mimeType = "image/jpeg") {
  const apiKey =
    process.env.OCR_SPACE_API_KEY ||
    process.env.OCRSPACE_API_KEY ||
    FREE_OCR_SPACE_FALLBACK_KEY;

  if (!apiKey || !filePath || !FS.existsSync(filePath)) {
    return null;
  }

  const buffer = FS.readFileSync(filePath);
  if (!buffer.length || buffer.length > 1024 * 1024) {
    // Free OCR.space limit is ~1MB for the free tier; still try smaller files.
    if (buffer.length > 5 * 1024 * 1024) return null;
  }

  const base64 = buffer.toString("base64");
  const mime = mimeType || "image/jpeg";
  const body = new URLSearchParams();
  body.set("apikey", apiKey);
  body.set("language", "eng");
  body.set("isOverlayRequired", "false");
  body.set("OCREngine", "2");
  body.set("scale", "true");
  body.set("detectOrientation", "true");
  body.set("base64Image", `data:${mime};base64,${base64}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetch("https://api.ocr.space/parse/image", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn("OCR.space request failed:", response.status);
      return null;
    }
    const data = await response.json();
    if (data?.IsErroredOnProcessing) {
      console.warn("OCR.space processing error:", data?.ErrorMessage || data?.ErrorDetails);
      return null;
    }
    const text = String(data?.ParsedResults?.[0]?.ParsedText || "").trim();
    if (!text) return null;
    return {
      text,
      method: "ocrspace",
      confidence: 60,
      fields: {},
    };
  } catch (error) {
    console.warn("OCR.space extraction skipped:", error.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  extractTextWithOcrSpace,
};
