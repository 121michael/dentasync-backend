"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { analyzeDentalImageBuffer } = require("../services/dentalImageAnalysis");

test("image analysis calls the current Gemini Flash alias", async () => {
  const previous = process.env.GEMINI_API_KEY;
  const previousModel = process.env.GEMINI_MODEL;
  process.env.GEMINI_API_KEY = "test-key";
  delete process.env.GEMINI_MODEL;
  const originalFetch = global.fetch;
  let calledUrl = "";
  global.fetch = async (input) => {
    calledUrl = String(input);
    return {
      ok: true,
      json: async () => ({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: "1) Image quality: adequate\n2) Possible FDI tooth number: 16\nAlways end with: AI-generated information is preliminary and does not replace examination or diagnosis by a licensed dentist.",
                },
              ],
            },
          },
        ],
      }),
    };
  };
  try {
    const result = await analyzeDentalImageBuffer({
      buffer: Buffer.from("fake-image"),
      mimeType: "image/jpeg",
      fileName: "tooth.jpg",
      question: "What is this?",
    });
    assert.equal(result.status, "completed");
    assert.equal(result.model, "gemini-flash-latest");
    assert.match(calledUrl, /models\/gemini-flash-latest:generateContent/);
    assert.doesNotMatch(calledUrl, /gemini-1\.5-flash|gemini-2\.0-flash/);
  } finally {
    global.fetch = originalFetch;
    if (previous === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previous;
    if (previousModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = previousModel;
  }
});
