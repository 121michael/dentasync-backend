"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const sharp = require("sharp");

const { resolvedGeminiModel, DEFAULT_GEMINI_MODEL } = require("../services/geminiModel");
const { answerFromCatalog } = require("../services/clinicAssistant");
const {
  analyzeDentalImageBuffer,
  prepareImageForProvider,
} = require("../services/dentalImageAnalysis");
const { priorImageContext } = require("../services/patientAiConversations");

test("gemini model defaults to the supported flash-lite id and ignores unknown overrides", () => {
  const previous = process.env.GEMINI_MODEL;
  try {
    delete process.env.GEMINI_MODEL;
    assert.equal(resolvedGeminiModel(), DEFAULT_GEMINI_MODEL);
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-3.5-flash-lite");
    process.env.GEMINI_MODEL = "gemini-1.5-flash";
    assert.equal(resolvedGeminiModel(), "gemini-3.5-flash-lite");
    process.env.GEMINI_MODEL = "gemini-3.8-flash";
    assert.equal(resolvedGeminiModel(), "gemini-3.8-flash");
  } finally {
    if (previous === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previous;
  }
});

test("holiday questions mention saved closures or say none are published", () => {
  const none = answerFromCatalog("Are you closed on holidays?", {
    clinic: {
      name: "Amethyst Dental Clinic",
      operatingHours: "Monday–Friday 9:00 AM–4:00 PM · Saturday–Sunday 11:00 AM–4:00 PM · holidays 11:00 AM–4:00 PM",
      phonePublished: false,
      emailPublished: false,
      addressPublished: false,
      closureDates: [],
    },
  });
  assert.match(none.answer, /No specific closure dates are saved/i);
  assert.match(none.answer, /11:00 AM–4:00 PM/);

  const saved = answerFromCatalog("Are you closed on holidays?", {
    clinic: {
      name: "Amethyst Dental Clinic",
      operatingHours: "Monday–Friday 9:00 AM–4:00 PM · Saturday–Sunday 11:00 AM–4:00 PM · holidays 11:00 AM–4:00 PM",
      phonePublished: false,
      emailPublished: false,
      addressPublished: false,
      closureDates: [{ date: "2026-12-25", note: "Christmas Day" }],
    },
  });
  assert.match(saved.answer, /2026-12-25/);
  assert.match(saved.answer, /Christmas Day/);
});

test("an x-ray follow-up stays on the saved attachment and does not claim a new look", () => {
  const prior = priorImageContext([
    {
      role: "user",
      sender: "patient",
      text: "Please review this dental image.",
      attachmentDocumentId: "doc-1",
      attachmentName: "teaching.png",
    },
    {
      role: "assistant",
      sender: "ai",
      text: "Image quality: adequate. Possible feature: a dark area a dentist should review. This is not a diagnosis.",
    },
  ]);
  assert.equal(prior.documentId, "doc-1");
  const result = answerFromCatalog("What should I ask the dentist about that x-ray?", { priorImage: prior });
  assert.equal(result.source, "image-follow-up");
  assert.match(result.answer, /still attached/i);
  assert.match(result.answer, /does not look at the image again/i);
  assert.match(result.answer, /dark area/);
  assert.match(result.answer, /not a diagnosis/i);

  const missing = answerFromCatalog("What about that x-ray?", {});
  assert.match(missing.answer, /No dental image is attached/i);
});

test("image requests send cleaned image bytes and a readable error when the file cannot be read", async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  const originalFetch = global.fetch;
  process.env.GEMINI_API_KEY = "unit-test-credential";
  delete process.env.GEMINI_MODEL;
  const marker = "PATIENT-MARKER-DO-NOT-SEND";
  const source = await sharp({
    create: { width: 48, height: 36, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .jpeg()
    .withMetadata({ exif: { IFD0: { ImageDescription: marker } } })
    .toBuffer();
  assert.match(source.toString("latin1"), new RegExp(marker));

  const prepared = await prepareImageForProvider(source, "image/jpeg");
  assert.equal(prepared.ok, true);
  assert.equal(prepared.mimeType, "image/jpeg");
  assert.doesNotMatch(prepared.buffer.toString("latin1"), new RegExp(marker));

  let seen = null;
  global.fetch = async (url, init) => {
    seen = { url: String(url), body: JSON.parse(init.body) };
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: "Image quality: the synthetic film is dark. Uncertain tooth numbers.\n\nAI-generated information is preliminary and does not replace examination or diagnosis by a licensed dentist." }] } }],
      }),
    };
  };
  try {
    const result = await analyzeDentalImageBuffer({
      buffer: source,
      mimeType: "image/jpeg",
      fileName: "chart-12345.jpg",
      question: "What do you see?",
    });
    assert.equal(result.status, "completed");
    assert.equal(result.model, "gemini-3.5-flash-lite");
    assert.match(seen.url, /models\/gemini-3\.5-flash-lite:generateContent/);
    assert.doesNotMatch(seen.url, /gemini-1\.5-flash/);
    const imagePart = seen.body.contents[0].parts[1].inline_data;
    assert.equal(imagePart.mime_type, "image/jpeg");
    assert.equal(Buffer.from(imagePart.data, "base64").length, prepared.buffer.length);
    assert.doesNotMatch(seen.body.contents[0].parts[0].text, /chart-12345/);
    assert.doesNotMatch(JSON.stringify(seen.body), new RegExp(marker));
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});

test("corrupt, unsupported, and failed image calls do not claim an examination", async () => {
  const corrupt = await analyzeDentalImageBuffer({
    buffer: Buffer.from("not-an-image"),
    mimeType: "image/jpeg",
  });
  assert.equal(corrupt.model, "none");
  assert.match(corrupt.summary, /did not examine/i);

  const pdf = await analyzeDentalImageBuffer({
    buffer: Buffer.from("%PDF-1.4"),
    mimeType: "application/pdf",
  });
  assert.match(pdf.summary, /will not pretend to have seen/i);

  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "unit-test-credential";
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const image = await sharp({
    create: { width: 16, height: 16, channels: 3, background: { r: 0, g: 0, b: 0 } },
  })
    .png()
    .toBuffer();
  try {
    const failed = await analyzeDentalImageBuffer({
      buffer: image,
      mimeType: "image/png",
      question: "Is this an x-ray?",
    });
    assert.match(failed.summary, /could not examine/i);
    assert.match(failed.summary, /will not describe findings/i);
  } finally {
    global.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
