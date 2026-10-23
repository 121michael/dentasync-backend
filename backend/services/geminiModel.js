"use strict";

/**
 * Google shut down gemini-1.5-flash (Sep 2025) and gemini-2.0-flash (Jun 2026).
 * gemini-flash-latest is Google's stable Flash alias and tracks the current GA model.
 * Override with GEMINI_MODEL on Render if a pinned model is required.
 */
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const MODEL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/;

function sanitizeModelName(value) {
  const name = String(value || "").trim();
  return MODEL_NAME.test(name) ? name : "";
}

function getGeminiModel() {
  return sanitizeModelName(process.env.GEMINI_MODEL) || DEFAULT_GEMINI_MODEL;
}

function getGeminiModelCandidates() {
  const primary = getGeminiModel();
  const extras = [
    ...new Set(
      String(process.env.GEMINI_MODEL_FALLBACKS || "")
        .split(",")
        .map((item) => sanitizeModelName(item))
        .filter((name) => name && name !== primary)
    ),
  ];
  const defaults = ["gemini-3.8-flash", "gemini-3.5-flash"].filter(
    (name) => name !== primary && !extras.includes(name)
  );
  return [primary, ...extras, ...defaults];
}

function geminiGenerateUrl(apiKey, model = getGeminiModel()) {
  const name = sanitizeModelName(model) || DEFAULT_GEMINI_MODEL;
  return `https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  getGeminiModel,
  getGeminiModelCandidates,
  geminiGenerateUrl,
};
