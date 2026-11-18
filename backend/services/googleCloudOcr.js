"use strict";

/**
 * Google Cloud OCR for Admin Document Data Sync.
 * Replaces Tesseract.js. Uses Document AI when a processor is configured,
 * otherwise Cloud Vision DOCUMENT_TEXT_DETECTION (images and PDFs).
 *
 * Env (keep secrets in backend environment variables, never the frontend):
 * - GOOGLE_CLOUD_API_KEY or GOOGLE_VISION_API_KEY
 * - GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS
 * - GOOGLE_CLOUD_PROJECT
 * - GOOGLE_DOCUMENT_AI_LOCATION (default us)
 * - GOOGLE_DOCUMENT_AI_PROCESSOR_ID  (Enterprise Document OCR processor)
 * - GOOGLE_DOCUMENT_AI_PROCESSOR (optional full resource name)
 */

const LOW_CONFIDENCE_THRESHOLD = 0.55;
const DOCUMENT_AI_MISSING_MESSAGE =
  "Google Document AI is not configured for handwritten forms. Set GOOGLE_CLOUD_PROJECT, GOOGLE_DOCUMENT_AI_LOCATION, GOOGLE_DOCUMENT_AI_PROCESSOR_ID, and a service account or API key on the server. You can still type the fields from the original document.";
const DOCUMENT_AI_FAILED_MESSAGE =
  "Document AI could not read this handwritten form. Leave unreadable values blank and enter them from the original document, then Confirm & Save.";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const VISION_SCOPE = "https://www.googleapis.com/auth/cloud-vision";
const DOCUMENT_AI_SCOPE = "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_URI = "https://oauth2.googleapis.com/token";
const MAX_PDF_PAGES = 5;
const IMAGE_MAX_BYTES = 18 * 1024 * 1024;
const cache = new Map();
let tokenCache = null;
let fetchImpl = globalThis.fetch;

function setGoogleCloudOcrFetch(fn) {
  fetchImpl = fn || globalThis.fetch;
}

function clearGoogleCloudOcrCache() {
  cache.clear();
  tokenCache = null;
}

function stringEnv(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

function loadServiceAccount(env = process.env) {
  const inline = stringEnv(env, ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_CLOUD_CREDENTIALS"]);
  if (inline) {
    try {
      return JSON.parse(inline);
    } catch {
      return null;
    }
  }
  const filePath = stringEnv(env, ["GOOGLE_APPLICATION_CREDENTIALS"]);
  if (!filePath || !fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function googleCloudOcrIsConfigured(env = process.env) {
  return Boolean(
    stringEnv(env, ["GOOGLE_CLOUD_API_KEY", "GOOGLE_VISION_API_KEY", "GCP_VISION_API_KEY"]) ||
      stringEnv(env, ["GOOGLE_CLOUD_ACCESS_TOKEN"]) ||
      loadServiceAccount(env)
  );
}

function toBase64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signServiceAccountJwt(credentials, scopes) {
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iss: credentials.client_email,
      sub: credentials.client_email,
      scope: scopes.join(" "),
      aud: credentials.token_uri || TOKEN_URI,
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  signer.end();
  const signature = signer
    .sign(credentials.private_key, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${header}.${payload}.${signature}`;
}

async function getAccessToken(env, scopes) {
  const staticToken = stringEnv(env, ["GOOGLE_CLOUD_ACCESS_TOKEN"]);
  if (staticToken) return staticToken;
  const credentials = loadServiceAccount(env);
  if (!credentials?.private_key || !credentials?.client_email) return "";
  const key = `${credentials.client_email}:${scopes.join(",")}`;
  if (tokenCache?.key === key && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  const assertion = signServiceAccountJwt(credentials, scopes);
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion,
  });
  const response = await fetchImpl(credentials.token_uri || TOKEN_URI, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Google auth failed (${response.status}): ${detail.slice(0, 180)}`);
  }
  const data = await response.json();
  const token = String(data.access_token || "");
  tokenCache = {
    key,
    token,
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  return token;
}

function documentAiProcessorName(env = process.env) {
  const full = stringEnv(env, ["GOOGLE_DOCUMENT_AI_PROCESSOR", "DOCUMENT_AI_PROCESSOR_NAME"]);
  if (full.includes("/processors/")) {
    return full.replace(/^\/+/, "");
  }
  const project = stringEnv(env, [
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_CLOUD_PROJECT_ID",
    "GCLOUD_PROJECT",
    "DOCUMENT_AI_PROJECT",
  ]);
  const location = stringEnv(env, ["GOOGLE_DOCUMENT_AI_LOCATION", "DOCUMENT_AI_LOCATION"]) || "us";
  const processorId = stringEnv(env, ["GOOGLE_DOCUMENT_AI_PROCESSOR_ID", "DOCUMENT_AI_PROCESSOR_ID"]);
  if (project && processorId) {
    return `projects/${project}/locations/${location}/processors/${processorId}`;
  }
  return "";
}

function documentAiProcessor(env) {
  return documentAiProcessorName(env);
}

function documentAiIsConfigured(env = process.env) {
  return Boolean(documentAiProcessorName(env) && googleCloudOcrIsConfigured(env));
}

function collectDocumentAiTokens(document) {
  const fullText = String(document?.text || "");
  const tokens = [];
  for (const page of document?.pages || []) {
    for (const token of page?.tokens || []) {
      const confidence = Number(token?.layout?.confidence);
      const segments = token?.layout?.textAnchor?.textSegments || [];
      let text = "";
      for (const segment of segments) {
        const start = Number(segment.startIndex || 0);
        const end = Number(segment.endIndex || fullText.length);
        text += fullText.slice(start, end);
      }
      const trimmed = text.trim();
      if (trimmed) {
        tokens.push({
          text: trimmed,
          confidence: Number.isFinite(confidence) ? confidence : null,
        });
      }
    }
  }
  return tokens;
}

function documentAiConfidencePercent(document, tokens) {
  const scores = [];
  for (const token of tokens || []) {
    if (Number.isFinite(token.confidence)) scores.push(token.confidence);
  }
  for (const page of document?.pages || []) {
    const pageScore = Number(page?.layout?.confidence);
    if (Number.isFinite(pageScore)) scores.push(pageScore);
    for (const block of page?.blocks || []) {
      const blockScore = Number(block?.layout?.confidence);
      if (Number.isFinite(blockScore)) scores.push(blockScore);
    }
  }
  if (!scores.length) return null;
  return Math.round((scores.reduce((sum, value) => sum + value, 0) / scores.length) * 100);
}

function tokenConfidenceForValue(tokens, value) {
  const needle = String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!needle) return null;
  const hits = [];
  for (const token of tokens || []) {
    const piece = String(token.text || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
    if (!piece) continue;
    if (needle.includes(piece) || piece.includes(needle)) {
      if (Number.isFinite(token.confidence)) hits.push(token.confidence);
    }
  }
  if (!hits.length) return null;
  return Math.min(...hits);
}

function blankPatientName(patient) {
  patient.fullName = "";
  patient.firstName = "";
  patient.lastName = "";
}

function applyLowConfidenceFields(payload, fieldStatuses, tokens, threshold = LOW_CONFIDENCE_THRESHOLD) {
  if (!payload || !Array.isArray(tokens) || !tokens.length) {
    return fieldStatuses || {};
  }
  const next = { ...(fieldStatuses || {}) };
  const patient = payload.patient || (payload.patient = {});
  const procedure = payload.procedure || (payload.procedure = {});
  const fields = [
    {
      key: "fullName",
      value: patient.fullName,
      clear() {
        blankPatientName(patient);
      },
    },
    {
      key: "dateOfBirth",
      value: patient.dateOfBirth,
      clear() {
        patient.dateOfBirth = "";
      },
    },
    {
      key: "age",
      value: patient.age,
      clear() {
        patient.age = "";
      },
    },
    {
      key: "phone",
      value: patient.phone,
      clear() {
        patient.phone = "";
      },
    },
    {
      key: "address",
      value: patient.address,
      clear() {
        patient.address = "";
      },
    },
    {
      key: "gender",
      value: patient.gender,
      clear() {
        patient.gender = "";
      },
    },
    {
      key: "procedure",
      value: procedure.treatment,
      clear() {
        procedure.treatment = "";
      },
    },
    {
      key: "treatmentDate",
      value: procedure.treatmentDate,
      clear() {
        procedure.treatmentDate = "";
      },
    },
    {
      key: "amountCharged",
      value: procedure.amountCharged,
      clear() {
        procedure.amountCharged = "";
      },
    },
    {
      key: "notes",
      value: procedure.notes,
      clear() {
        procedure.notes = "";
      },
    },
  ];
  for (const field of fields) {
    const confidence = tokenConfidenceForValue(tokens, field.value);
    if (confidence == null) continue;
    if (confidence < threshold) {
      field.clear();
      next[field.key] = "unable_to_read";
    } else if (confidence < 0.75) {
      next[field.key] = next[field.key] === "unable_to_read" ? "unable_to_read" : "low_confidence";
    }
  }
  if (Array.isArray(procedure.visits)) {
    for (const row of procedure.visits) {
      if (!row || typeof row !== "object") continue;
      if (tokenConfidenceForValue(tokens, row.amountCharged) < threshold) row.amountCharged = "";
      if (tokenConfidenceForValue(tokens, row.treatmentDate) < threshold) row.treatmentDate = "";
      if (tokenConfidenceForValue(tokens, row.treatment) < threshold) row.treatment = "";
      if (tokenConfidenceForValue(tokens, row.toothNos) < threshold) row.toothNos = "";
    }
  }
  return next;
}

async function requestGoogleJson(url, { env, scopes, body }) {
  const apiKey = stringEnv(env, ["GOOGLE_CLOUD_API_KEY", "GOOGLE_VISION_API_KEY", "GCP_VISION_API_KEY"]);
  const headers = { "Content-Type": "application/json" };
  const token = await getAccessToken(env, scopes);
  let endpoint = url;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (apiKey) {
    endpoint += `${url.includes("?") ? "&" : "?"}key=${encodeURIComponent(apiKey)}`;
  } else {
    throw new Error("Google Cloud OCR is not configured.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90000);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { error: { message: text.slice(0, 240) } };
    }
    if (!response.ok) {
      const message = data?.error?.message || text.slice(0, 240) || `HTTP ${response.status}`;
      const error = new Error(`Google Cloud OCR failed (${response.status}): ${message}`);
      error.status = response.status;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

function digitsOnlyText(text) {
  return String(text || "")
    .replace(/[^\d\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function visionConfidence(annotation) {
  const pages = annotation?.pages || [];
  const confidences = [];
  for (const page of pages) {
    if (Number.isFinite(page?.confidence)) confidences.push(page.confidence);
    for (const block of page?.blocks || []) {
      if (Number.isFinite(block?.confidence)) confidences.push(block.confidence);
    }
  }
  if (!confidences.length) return 70;
  return Math.round((confidences.reduce((sum, value) => sum + value, 0) / confidences.length) * 100);
}

function collectVisionText(payload) {
  const responses = payload?.responses || [];
  const texts = [];
  let confidence = 0;
  for (const item of responses) {
    const nested = Array.isArray(item?.responses) ? item.responses : [item];
    for (const page of nested) {
      const annotation = page?.fullTextAnnotation;
      const text = String(annotation?.text || page?.textAnnotations?.[0]?.description || "").trim();
      if (text) texts.push(text);
      confidence = Math.max(confidence, visionConfidence(annotation));
    }
  }
  return { text: texts.join("\n\n").trim(), confidence };
}

async function prepareImageBuffer(filePath) {
  const original = fs.readFileSync(filePath);
  if (original.length <= IMAGE_MAX_BYTES) return original;
  try {
    const sharp = require("sharp");
    return await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width: 2400, withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch {
    return original.slice(0, IMAGE_MAX_BYTES);
  }
}

async function extractWithDocumentAi({ filePath, mimeType, env }) {
  const processor = documentAiProcessor(env);
  if (!processor) return null;
  const buffer = fs.readFileSync(filePath);
  const data = await requestGoogleJson(
    `https://documentai.googleapis.com/v1/${processor}:process`,
    {
      env,
      scopes: [DOCUMENT_AI_SCOPE],
      body: {
        rawDocument: {
          content: buffer.toString("base64"),
          mimeType: mimeType || "image/jpeg",
        },
        processOptions: {
          ocrConfig: {
            enableNativePdfParsing: true,
            hints: { languageHints: ["en"] },
          },
        },
      },
    }
  );
  const document = data?.document || {};
  const text = String(document.text || "").trim();
  if (!text) return null;
  const tokens = collectDocumentAiTokens(document);
  const confidence = documentAiConfidencePercent(document, tokens);
  return {
    text,
    confidence: confidence == null ? 80 : confidence,
    method: "gcp-document-ai-ocr",
    pages: Array.isArray(document.pages) ? document.pages.length : 1,
    tokens,
  };
}

async function extractHandwrittenFormWithDocumentAi({ filePath, mimeType, env = process.env } = {}) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { ok: false, code: "ocr_failed", message: DOCUMENT_AI_FAILED_MESSAGE };
  }
  if (!documentAiIsConfigured(env)) {
    return { ok: false, code: "not_configured", message: DOCUMENT_AI_MISSING_MESSAGE };
  }
  const extension = path.extname(filePath).toLowerCase();
  const isPdf = mimeType === "application/pdf" || extension === ".pdf";
  try {
    const result = await extractWithDocumentAi({
      filePath,
      mimeType: isPdf ? "application/pdf" : mimeType || "image/jpeg",
      env,
    });
    if (!result?.text) {
      return { ok: false, code: "ocr_failed", message: DOCUMENT_AI_FAILED_MESSAGE };
    }
    return { ok: true, ...result };
  } catch {
    return { ok: false, code: "ocr_failed", message: DOCUMENT_AI_FAILED_MESSAGE };
  }
}

async function extractWithVisionImage({ filePath, env }) {
  const buffer = await prepareImageBuffer(filePath);
  const data = await requestGoogleJson("https://vision.googleapis.com/v1/images:annotate", {
    env,
    scopes: [VISION_SCOPE],
    body: {
      requests: [
        {
          image: { content: buffer.toString("base64") },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          imageContext: { languageHints: ["en"] },
        },
      ],
    },
  });
  const parsed = collectVisionText(data);
  if (!parsed.text) return null;
  return { ...parsed, method: "gcp-vision", pages: 1 };
}

async function extractWithVisionPdf({ filePath, env }) {
  const buffer = fs.readFileSync(filePath);
  const data = await requestGoogleJson("https://vision.googleapis.com/v1/files:annotate", {
    env,
    scopes: [VISION_SCOPE],
    body: {
      requests: [
        {
          inputConfig: {
            mimeType: "application/pdf",
            content: buffer.toString("base64"),
          },
          features: [{ type: "DOCUMENT_TEXT_DETECTION" }],
          pages: Array.from({ length: MAX_PDF_PAGES }, (_, index) => index + 1),
        },
      ],
    },
  });
  const parsed = collectVisionText(data);
  if (!parsed.text) return null;
  return { ...parsed, method: "gcp-vision-pdf", pages: MAX_PDF_PAGES };
}

function cacheKey(filePath, digitsOnly) {
  const buffer = fs.readFileSync(filePath);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex");
  return `${hash}:${digitsOnly ? "digits" : "text"}:${path.basename(filePath)}`;
}

async function extractTextWithGoogleCloud({
  filePath,
  mimeType = "",
  digitsOnly = false,
  env = process.env,
} = {}) {
  if (!filePath || !fs.existsSync(filePath) || !googleCloudOcrIsConfigured(env)) {
    return null;
  }
  const key = cacheKey(filePath, Boolean(digitsOnly));
  if (cache.has(key)) return cache.get(key);

  const extension = path.extname(filePath).toLowerCase();
  const isPdf = mimeType === "application/pdf" || extension === ".pdf";
  let result = null;
  try {
    result = await extractWithDocumentAi({
      filePath,
      mimeType: isPdf ? "application/pdf" : mimeType || "image/png",
      env,
    });
  } catch {
    console.warn("Document AI OCR skipped.");
  }
  if (!result) {
    try {
      result = isPdf
        ? await extractWithVisionPdf({ filePath, env })
        : await extractWithVisionImage({ filePath, env });
    } catch (error) {
      console.warn("Google Vision OCR skipped:", error.message);
      result = null;
    }
  }
  if (!result?.text) {
    cache.set(key, null);
    return null;
  }
  const normalized = {
    text: digitsOnly ? digitsOnlyText(result.text) : result.text,
    confidence: Number(result.confidence || 0),
    method: result.method,
    pages: result.pages || 1,
    tokens: Array.isArray(result.tokens) ? result.tokens : [],
  };
  cache.set(key, normalized);
  return normalized;
}

module.exports = {
  LOW_CONFIDENCE_THRESHOLD,
  DOCUMENT_AI_MISSING_MESSAGE,
  DOCUMENT_AI_FAILED_MESSAGE,
  extractTextWithGoogleCloud,
  extractHandwrittenFormWithDocumentAi,
  documentAiProcessorName,
  documentAiIsConfigured,
  applyLowConfidenceFields,
  googleCloudOcrIsConfigured,
  setGoogleCloudOcrFetch,
  clearGoogleCloudOcrCache,
};
