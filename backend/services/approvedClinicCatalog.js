"use strict";

const path = require("path");
const DEFAULT_CATALOG = require("../../frontend/src/clinic/clinicServicesCatalog.json");

const SETTING_KEY = "clinic_services";
const CACHE_TTL_MS = 5_000;
const TEXT_MAX = 2_000;
const LINE_MAX = 240;
const MAX_LINES = 8;
const MAX_NOTES = 8;

const EDITABLE_FIELDS = [
  "title",
  "description",
  "priceLabel",
  "details",
  "compactNote",
  "chatbotEn",
  "chatbotTl",
  "chatbotAdviceEn",
  "chatbotAdviceTl",
  "factLineEn",
  "factLineTl",
];

let cache = { at: 0, catalog: null };

function cloneCatalog(catalog = DEFAULT_CATALOG) {
  return JSON.parse(JSON.stringify(catalog));
}

function sanitizeText(value, max = TEXT_MAX) {
  if (typeof value !== "string") return null;
  const cleaned = value
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .trim();
  if (!cleaned) return null;
  return cleaned.slice(0, max);
}

function sanitizeLines(value) {
  if (!Array.isArray(value)) return null;
  return value
    .slice(0, MAX_LINES)
    .map((line) => ({
      label: sanitizeText(line?.label, LINE_MAX) || "",
      value: sanitizeText(line?.value, LINE_MAX) || "",
    }))
    .filter((line) => line.label || line.value);
}

function sanitizeNotes(value) {
  if (!Array.isArray(value)) return null;
  return value
    .map((note) => sanitizeText(note, TEXT_MAX))
    .filter(Boolean)
    .slice(0, MAX_NOTES);
}

function defaultById() {
  const map = new Map();
  for (const service of DEFAULT_CATALOG.services) {
    map.set(service.id, service);
  }
  return map;
}

function applyOverrides(rawOverrides) {
  const catalog = cloneCatalog();
  const defaults = defaultById();
  const incoming = Array.isArray(rawOverrides)
    ? rawOverrides
    : Array.isArray(rawOverrides?.services)
      ? rawOverrides.services
      : [];

  for (const override of incoming) {
    const id = typeof override?.id === "string" ? override.id.trim() : "";
    if (!id || !defaults.has(id)) continue;
    const target = catalog.services.find((item) => item.id === id);
    if (!target) continue;
    for (const field of EDITABLE_FIELDS) {
      const next = sanitizeText(override[field]);
      if (next != null) target[field] = next;
    }
    const lines = sanitizeLines(override.lines);
    if (lines) target.lines = lines;
    const notes = sanitizeNotes(override.notes);
    if (notes) target.notes = notes;
  }

  return catalog;
}

function chatbotServicesFrom(catalog) {
  return catalog.services
    .filter((service) => Array.isArray(service.terms) && service.terms.length > 0 && service.chatbotEn)
    .map((service) => ({
      id: service.id,
      terms: service.terms,
      en: service.chatbotEn,
      tl: service.chatbotTl || service.chatbotEn,
      adviceEn: service.chatbotAdviceEn || "",
      adviceTl: service.chatbotAdviceTl || service.chatbotAdviceEn || "",
    }));
}

function buildFacts(catalog, lang = "en") {
  const lines = catalog.services
    .filter((service) => (lang === "tl" ? service.factLineTl : service.factLineEn))
    .map((service) => `- ${lang === "tl" ? service.factLineTl : service.factLineEn}`);
  const header =
    lang === "tl"
      ? "Opisyal na serbisyo at presyo ng Amethyst Dental Clinic (huwag imbento ng discount, extra, o total):"
      : "Official Amethyst Dental Clinic services and prices (quote exactly; do not invent discounts, extras, or totals):";
  const footer =
    lang === "tl"
      ? "Huwag ituring na guaranteed final price ang listed amount. Kung tinanong kung anong material, denture type, o treatment ang best, huwag humula. Ipaliwanag na depende ito sa pangangailangan at mag-imbita ng FREE consultation / oral examination. Huwag sabihing na-evaluate na ng dentista ang pasyente kung walang recorded assessment."
      : "Never present a listed amount as a guaranteed final price. If the patient asks which material, denture type, or treatment is best for them, do not guess. Explain that it depends on their needs and invite a FREE consultation / oral examination. Do not claim a dentist has evaluated the patient unless an assessment is recorded.";
  return `${header}\n${lines.join("\n")}\n${footer}`;
}

function publicServicesFrom(catalog) {
  return catalog.services.map((service) => ({
    id: service.id,
    title: service.title,
    description: service.description || "",
    priceLabel: service.priceLabel,
    details: service.details,
    lines: service.lines || [],
    notes: service.notes || [],
    compactNote: service.compactNote || "",
    dependsOnCase: Boolean(service.dependsOnCase),
    matchIds: service.matchIds || [],
    matchNames: service.matchNames || [],
  }));
}

function adminCatalogFrom(catalog) {
  return {
    groups: catalog.groups,
    services: catalog.services.map((service) => ({
      id: service.id,
      group: service.group,
      adminVisible: service.adminVisible !== false,
      title: service.title,
      description: service.description || "",
      priceLabel: service.priceLabel,
      details: service.details,
      lines: service.lines || [],
      notes: service.notes || [],
      compactNote: service.compactNote || "",
      chatbotEn: service.chatbotEn || "",
      chatbotTl: service.chatbotTl || "",
      chatbotAdviceEn: service.chatbotAdviceEn || "",
      chatbotAdviceTl: service.chatbotAdviceTl || "",
    })),
  };
}

function resolveCatalog(rawOverrides) {
  const catalog = applyOverrides(rawOverrides);
  return {
    catalog,
    chatbotServices: chatbotServicesFrom(catalog),
    factsEn: buildFacts(catalog, "en"),
    factsTl: buildFacts(catalog, "tl"),
    publicServices: publicServicesFrom(catalog),
    adminCatalog: adminCatalogFrom(catalog),
  };
}

function invalidateClinicCatalogCache() {
  cache = { at: 0, catalog: null };
}

async function loadApprovedClinicCatalog(db) {
  const now = Date.now();
  if (cache.catalog && now - cache.at < CACHE_TTL_MS) {
    return cache.catalog;
  }
  if (!db || typeof db.query !== "function") {
    const resolved = resolveCatalog(null);
    cache = { at: now, catalog: resolved };
    return resolved;
  }
  try {
    const result = await db.query(
      `SELECT setting_value
       FROM admin_portal_settings
       WHERE setting_key = $1
       LIMIT 1`,
      [SETTING_KEY]
    );
    const resolved = resolveCatalog(result.rows[0]?.setting_value || null);
    cache = { at: now, catalog: resolved };
    return resolved;
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      const resolved = resolveCatalog(null);
      cache = { at: now, catalog: resolved };
      return resolved;
    }
    throw error;
  }
}

async function saveApprovedClinicCatalog(db, incoming, actorId) {
  const resolved = resolveCatalog(incoming);
  const stored = {
    services: resolved.catalog.services.map((service) => {
      const payload = { id: service.id };
      for (const field of EDITABLE_FIELDS) {
        if (service[field]) payload[field] = service[field];
      }
      if (service.lines?.length) payload.lines = service.lines;
      if (service.notes?.length) payload.notes = service.notes;
      return payload;
    }),
  };
  const result = await db.query(
    `INSERT INTO admin_portal_settings (setting_key, setting_value, updated_at, updated_by)
     VALUES ($1, $2::jsonb, CURRENT_TIMESTAMP, $3)
     ON CONFLICT (setting_key) DO UPDATE SET
       setting_value = EXCLUDED.setting_value,
       updated_at = CURRENT_TIMESTAMP,
       updated_by = EXCLUDED.updated_by
     RETURNING setting_value, updated_at, updated_by`,
    [SETTING_KEY, JSON.stringify(stored), actorId || null]
  );
  invalidateClinicCatalogCache();
  const next = resolveCatalog(result.rows[0].setting_value);
  cache = { at: Date.now(), catalog: next };
  return {
    catalog: next,
    updatedAt: result.rows[0].updated_at,
    updatedBy: result.rows[0].updated_by,
  };
}

module.exports = {
  SETTING_KEY,
  DEFAULT_CATALOG,
  cloneCatalog,
  applyOverrides,
  resolveCatalog,
  chatbotServicesFrom,
  buildFacts,
  invalidateClinicCatalogCache,
  loadApprovedClinicCatalog,
  saveApprovedClinicCatalog,
  catalogJsonPath: path.join(__dirname, "../../frontend/src/clinic/clinicServicesCatalog.json"),
};
