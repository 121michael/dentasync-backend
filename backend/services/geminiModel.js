"use strict";

/**
 * Google shut down gemini-1.5-flash (Sep 2025) and gemini-2.0-flash (Jun 2026).
 * gemini-flash-latest is Google's stable Flash alias and tracks the current GA model.
 * Override with GEMINI_MODEL on Render if a pinned model is required.
 *
 * Current Flash models spend thinking tokens against maxOutputTokens. A low cap
 * (for example 420) returns empty candidates and every request is counted Failed.
 */
const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
const DEFAULT_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_TIMEOUT_MS = 25000;
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

function geminiGenerationConfig(overrides = {}) {
  const { omitThinking, ...rest } = overrides;
  const config = {
    maxOutputTokens: DEFAULT_MAX_OUTPUT_TOKENS,
    ...rest,
  };
  if (!omitThinking && config.thinkingConfig === undefined) {
    config.thinkingConfig = { thinkingLevel: "low" };
  }
  if (omitThinking) delete config.thinkingConfig;
  return config;
}

function extractGeminiText(payload) {
  const parts = payload?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((part) => part && part.thought !== true && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

async function readFetchPayload(response) {
  if (typeof response.text === "function") {
    const raw = await response.text();
    try {
      return { payload: raw ? JSON.parse(raw) : null, raw };
    } catch {
      return { payload: null, raw };
    }
  }
  if (typeof response.json === "function") {
    return { payload: await response.json(), raw: "" };
  }
  return { payload: null, raw: "" };
}

async function postGeminiGenerate({ apiKey, model, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(geminiGenerateUrl(apiKey, model), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const { payload, raw } = await readFetchPayload(response);
    return { ok: response.ok, status: response.status, payload, raw };
  } finally {
    clearTimeout(timer);
  }
}

async function generateGeminiContent({
  apiKey,
  model = getGeminiModel(),
  parts,
  generationConfig,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const contents = [{ parts }];
  const attempts = [
    geminiGenerationConfig(generationConfig),
    geminiGenerationConfig({ ...generationConfig, thinkingConfig: { thinkingBudget: 0 } }),
    geminiGenerationConfig({ ...generationConfig, omitThinking: true }),
  ];
  let result = { ok: false, status: 0, payload: null, raw: "" };
  for (const [index, config] of attempts.entries()) {
    result = await postGeminiGenerate({
      apiKey,
      model,
      timeoutMs,
      body: { contents, generationConfig: config },
    });
    if (result.ok && extractGeminiText(result.payload)) return result;
    const retryable = result.ok || result.status === 400;
    if (!retryable || index === attempts.length - 1) return result;
  }
  return result;
}

module.exports = {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  getGeminiModel,
  getGeminiModelCandidates,
  geminiGenerateUrl,
  geminiGenerationConfig,
  extractGeminiText,
  generateGeminiContent,
};
