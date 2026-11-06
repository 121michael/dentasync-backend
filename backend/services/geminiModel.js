"use strict";

/**
 * Patient assistant and dental-image calls share one Gemini model.
 * gemini-1.5-flash was shut down on 2025-09-29 (https://ai.google.dev/gemini-api/docs/changelog).
 * Default is the stable multimodal model gemini-3.5-flash-lite
 * (https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite).
 * GEMINI_MODEL may select another supported id. An unknown value is ignored.
 */

const DEFAULT_GEMINI_MODEL = "gemini-3.5-flash-lite";

const ALLOWED_GEMINI_MODELS = new Set([
  "gemini-3.5-flash-lite",
  "gemini-3.6-flash",
  "gemini-3.8-flash",
]);

function resolvedGeminiModel() {
  const requested = String(process.env.GEMINI_MODEL || "").trim();
  if (requested && ALLOWED_GEMINI_MODELS.has(requested)) return requested;
  return DEFAULT_GEMINI_MODEL;
}

function geminiGenerateUrl(apiKey, model = resolvedGeminiModel()) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function geminiRequestTimeoutMs() {
  const requested = Number(process.env.GEMINI_REQUEST_TIMEOUT_MS);
  if (Number.isFinite(requested) && requested >= 200 && requested <= 60000) return requested;
  return 12000;
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  ALLOWED_GEMINI_MODELS,
  resolvedGeminiModel,
  geminiGenerateUrl,
  geminiRequestTimeoutMs,
};
