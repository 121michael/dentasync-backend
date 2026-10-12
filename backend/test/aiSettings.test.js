"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  normalizeAiSettings,
  isChatbotEnabled,
  isAiFeatureEnabled,
  isMasterAiEnabled,
  invalidateAiSettingsCache,
  loadAiSettings,
} = require("../services/aiSettings");

test("normalizeAiSettings rejects unknown knowledge modes and sensitivities", () => {
  const settings = normalizeAiSettings({
    chatbotKnowledgeMode: "secret-mode",
    diagnosticsSensitivity: "nuclear",
    aiChatbot: "true",
    amethystAiEnabled: "yes",
  });
  assert.equal(settings.chatbotKnowledgeMode, "clinic");
  assert.equal(settings.diagnosticsSensitivity, "balanced");
  assert.equal(settings.aiChatbot, true);
  assert.equal(settings.amethystAiEnabled, true);
});

test("chatbot is off when the master AI switch is disabled", () => {
  const settings = normalizeAiSettings({
    amethystAiEnabled: false,
    aiChatbot: true,
    waitingTimePrediction: true,
  });
  assert.equal(isMasterAiEnabled(settings), false);
  assert.equal(isChatbotEnabled(settings), false);
  assert.equal(isAiFeatureEnabled(settings, "waitingTimePrediction"), false);
});

test("chatbot requires both master AI and the chatbot toggle", () => {
  assert.equal(
    isChatbotEnabled(normalizeAiSettings({ amethystAiEnabled: true, aiChatbot: false })),
    false
  );
  assert.equal(
    isChatbotEnabled(normalizeAiSettings({ amethystAiEnabled: true, aiChatbot: true })),
    true
  );
});

test("loadAiSettings reads PostgreSQL and ignores stale cache after invalidate", async () => {
  invalidateAiSettingsCache();
  let reads = 0;
  const db = {
    async query() {
      reads += 1;
      return {
        rows: [
          {
            setting_value: {
              amethystAiEnabled: true,
              aiChatbot: true,
              chatbotKnowledgeMode: "general",
              diagnosticsSensitivity: "aggressive",
            },
          },
        ],
      };
    },
  };
  const first = await loadAiSettings(db);
  const second = await loadAiSettings(db);
  assert.equal(first.chatbotKnowledgeMode, "general");
  assert.equal(second.diagnosticsSensitivity, "aggressive");
  assert.equal(reads, 1);
  invalidateAiSettingsCache();
  await loadAiSettings(db);
  assert.equal(reads, 2);
});
