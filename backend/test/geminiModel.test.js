"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DEFAULT_GEMINI_MODEL,
  getGeminiModel,
  getGeminiModelCandidates,
  geminiGenerateUrl,
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
