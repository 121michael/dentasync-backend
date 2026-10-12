"use strict";

const KNOWLEDGE_MODES = new Set(["clinic", "general", "restricted"]);
const SENSITIVITIES = new Set(["conservative", "balanced", "aggressive"]);

const DEFAULT_AI_SETTINGS = {
  amethystAiEnabled: true,
  predictiveDiagnostics: true,
  automatedReminders: true,
  waitingTimePrediction: true,
  aiChatbot: false,
  scheduledSystemUpdates: true,
  chatbotKnowledgeMode: "clinic",
  diagnosticsSensitivity: "balanced",
};

const CACHE_TTL_MS = 5_000;
let cache = { at: 0, settings: null };

function asBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no") return false;
  }
  if (typeof value === "number") return value !== 0;
  return fallback;
}

function normalizeAiSettings(raw) {
  const incoming = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const mode = String(incoming.chatbotKnowledgeMode || "")
    .trim()
    .toLowerCase();
  const sensitivity = String(incoming.diagnosticsSensitivity || "")
    .trim()
    .toLowerCase();
  return {
    amethystAiEnabled: asBoolean(incoming.amethystAiEnabled, DEFAULT_AI_SETTINGS.amethystAiEnabled),
    predictiveDiagnostics: asBoolean(
      incoming.predictiveDiagnostics,
      DEFAULT_AI_SETTINGS.predictiveDiagnostics
    ),
    automatedReminders: asBoolean(
      incoming.automatedReminders,
      DEFAULT_AI_SETTINGS.automatedReminders
    ),
    waitingTimePrediction: asBoolean(
      incoming.waitingTimePrediction,
      DEFAULT_AI_SETTINGS.waitingTimePrediction
    ),
    aiChatbot: asBoolean(incoming.aiChatbot, DEFAULT_AI_SETTINGS.aiChatbot),
    scheduledSystemUpdates: asBoolean(
      incoming.scheduledSystemUpdates,
      DEFAULT_AI_SETTINGS.scheduledSystemUpdates
    ),
    chatbotKnowledgeMode: KNOWLEDGE_MODES.has(mode) ? mode : DEFAULT_AI_SETTINGS.chatbotKnowledgeMode,
    diagnosticsSensitivity: SENSITIVITIES.has(sensitivity)
      ? sensitivity
      : DEFAULT_AI_SETTINGS.diagnosticsSensitivity,
  };
}

function invalidateAiSettingsCache() {
  cache = { at: 0, settings: null };
}

function isMasterAiEnabled(settings) {
  return Boolean(settings?.amethystAiEnabled);
}

function isAiFeatureEnabled(settings, key) {
  if (!isMasterAiEnabled(settings)) return false;
  return Boolean(settings?.[key]);
}

function isChatbotEnabled(settings) {
  return isAiFeatureEnabled(settings, "aiChatbot");
}

function chatbotUnavailableMessage(lang = "en") {
  if (lang === "tl") {
    return "Pansamantalang hindi available ang AI Clinic Assistant. Makipag-ugnayan sa front desk ng Amethyst Dental para sa tulong.";
  }
  return "The AI Clinic Assistant is temporarily unavailable. Please contact the Amethyst Dental front desk for help.";
}

async function loadAiSettings(db) {
  const now = Date.now();
  if (cache.settings && now - cache.at < CACHE_TTL_MS) {
    return cache.settings;
  }
  if (!db || typeof db.query !== "function") {
    const settings = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, aiChatbot: true });
    cache = { at: now, settings };
    return settings;
  }
  try {
    const result = await db.query(
      `SELECT setting_value
       FROM admin_portal_settings
       WHERE setting_key = 'ai'
       LIMIT 1`
    );
    const settings = normalizeAiSettings(result.rows[0]?.setting_value);
    cache = { at: now, settings };
    return settings;
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      const settings = normalizeAiSettings({ ...DEFAULT_AI_SETTINGS, aiChatbot: true });
      cache = { at: now, settings };
      return settings;
    }
    throw error;
  }
}

module.exports = {
  DEFAULT_AI_SETTINGS,
  KNOWLEDGE_MODES,
  SENSITIVITIES,
  normalizeAiSettings,
  invalidateAiSettingsCache,
  loadAiSettings,
  isMasterAiEnabled,
  isAiFeatureEnabled,
  isChatbotEnabled,
  chatbotUnavailableMessage,
};
