"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_GEMINI_MODEL,
  DEFAULT_MAX_OUTPUT_TOKENS,
  getGeminiModel,
  getGeminiModelCandidates,
  geminiGenerateUrl,
  geminiGenerationConfig,
  extractGeminiText,
  generateGeminiContent,
} = require("../services/geminiModel");

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
}

test("default Gemini model is Google's current Flash alias, not a retired id", () => {
  return withEnv("GEMINI_MODEL", undefined, () => {
    assert.equal(getGeminiModel(), "gemini-flash-latest");
    assert.equal(DEFAULT_GEMINI_MODEL, "gemini-flash-latest");
    assert.doesNotMatch(getGeminiModel(), /gemini-1\.5-flash|gemini-2\.0-flash/);
  });
});

test("GEMINI_MODEL pins a valid model id", () => {
  return withEnv("GEMINI_MODEL", "gemini-3.8-flash", () => {
    assert.equal(getGeminiModel(), "gemini-3.8-flash");
    assert.match(
      geminiGenerateUrl("key-1", getGeminiModel()),
      /models\/gemini-3\.8-flash:generateContent/
    );
  });
});

test("invalid GEMINI_MODEL values fall back to the default alias", async () => {
  for (const value of ["", "../etc/passwd", "gemini 1.5", "https://evil.example/model"]) {
    await withEnv("GEMINI_MODEL", value, () => {
      assert.equal(getGeminiModel(), DEFAULT_GEMINI_MODEL);
    });
  }
});

test("document vision tries the configured model first, then current Flash fallbacks", () => {
  return withEnv("GEMINI_MODEL", undefined, () =>
    withEnv("GEMINI_MODEL_FALLBACKS", undefined, () => {
      const models = getGeminiModelCandidates();
      assert.equal(models[0], "gemini-flash-latest");
      assert.ok(models.includes("gemini-3.8-flash"));
      assert.ok(!models.includes("gemini-1.5-flash"));
      assert.ok(!models.includes("gemini-2.0-flash"));
    })
  );
});

test("GEMINI_MODEL_FALLBACKS prepend extra models after the primary", () => {
  return withEnv("GEMINI_MODEL", "gemini-flash-latest", () =>
    withEnv("GEMINI_MODEL_FALLBACKS", "gemini-3.8-flash, not a model, gemini-3.8-flash", () => {
      const models = getGeminiModelCandidates();
      assert.equal(models[0], "gemini-flash-latest");
      assert.equal(models[1], "gemini-3.8-flash");
      assert.equal(models.filter((name) => name === "gemini-3.8-flash").length, 1);
    })
  );
});

test("generation config leaves room for Gemini 3 thinking plus visible text", () => {
  const config = geminiGenerationConfig({ temperature: 0.3 });
  assert.ok(config.maxOutputTokens >= 2048);
  assert.equal(config.maxOutputTokens, DEFAULT_MAX_OUTPUT_TOKENS);
  assert.equal(config.thinkingConfig.thinkingLevel, "low");
  assert.equal(geminiGenerationConfig({ omitThinking: true }).thinkingConfig, undefined);
});

test("extractGeminiText ignores thought parts so empty thinking is not treated as an answer", () => {
  assert.equal(extractGeminiText({ candidates: [{ content: { parts: [{ thought: true, text: "..." }] } }] }), "");
  assert.equal(
    extractGeminiText({
      candidates: [
        {
          content: {
            parts: [
              { thought: true, text: "internal" },
              { text: "Floss once a day." },
            ],
          },
        },
      ],
    }),
    "Floss once a day."
  );
});

test("a 400 from thinkingLevel is retried with thinkingBudget 0", async () => {
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    if (bodies.length === 1) {
      return { ok: false, status: 400, text: async () => "thinkingLevel not supported" };
    }
    return {
      ok: true,
      text: async () =>
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "ok" }] } }] }),
    };
  };
  try {
    const result = await generateGeminiContent({
      apiKey: "test-key",
      parts: [{ text: "hi" }],
      generationConfig: { temperature: 0.3 },
    });
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].generationConfig.thinkingConfig.thinkingLevel, "low");
    assert.equal(bodies[1].generationConfig.thinkingConfig.thinkingBudget, 0);
    assert.equal(extractGeminiText(result.payload), "ok");
  } finally {
    global.fetch = originalFetch;
  }
});
