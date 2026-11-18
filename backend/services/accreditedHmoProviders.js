"use strict";

/**
 * Clinic-accredited HMO catalog.
 * This is the authoritative patient-facing list (booking, profile, landing, assistant).
 * There is no per-branch HMO table; accreditation is clinic-wide.
 * Mark a provider `active: false` to keep it out of new selections while
 * still allowing a patient to keep a previously saved value.
 */
const APPROVED_HMO_PROVIDERS = [
  { id: "maxicare", name: "Maxicare", aliases: ["maxicare"], filipinoDoctors: false, active: true },
  { id: "icare", name: "iCare", aliases: ["icare", "i care"], filipinoDoctors: true, active: true },
  { id: "pacific-cross", name: "Pacific Cross", aliases: ["pacific cross", "pacificcross"], filipinoDoctors: true, active: true },
  { id: "etiqa", name: "Etiqa", aliases: ["etiqa"], filipinoDoctors: true, active: true },
  { id: "lacson", name: "Lacson & Lacson", aliases: ["lacson", "lacson & lacson", "lacson and lacson"], filipinoDoctors: true, active: true },
  { id: "hppi", name: "HPPI", aliases: ["hppi"], filipinoDoctors: true, active: true },
  { id: "flexicare", name: "Flexicare", aliases: ["flexicare", "flexi care"], filipinoDoctors: true, active: true },
  { id: "cocolife", name: "Cocolife", aliases: ["cocolife", "coco life"], filipinoDoctors: false, active: true },
  { id: "valucare", name: "ValuCare", aliases: ["valucare", "valuecare", "valu care", "value care"], filipinoDoctors: false, active: true },
];

function isHmoActive(provider) {
  return Boolean(provider) && provider.active !== false;
}

function listAccreditedHmoProviders({ includeInactive = false, source = APPROVED_HMO_PROVIDERS } = {}) {
  return source.filter((provider) => includeInactive || isHmoActive(provider));
}

function publicHmoProviders(options = {}) {
  return listAccreditedHmoProviders(options).map((provider) => ({
    id: provider.id,
    name: provider.name,
    filipinoDoctors: Boolean(provider.filipinoDoctors),
    active: isHmoActive(provider),
  }));
}

function findAccreditedHmoByName(name, { includeInactive = false, source = APPROVED_HMO_PROVIDERS } = {}) {
  const normalized = String(name || "").trim();
  if (!normalized) return null;
  return (
    listAccreditedHmoProviders({ includeInactive, source }).find((provider) => provider.name === normalized) || null
  );
}

function canSaveHmoProvider(name, { currentProvider = "", source = APPROVED_HMO_PROVIDERS } = {}) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    return { ok: true, provider: null, preserved: false };
  }
  const active = findAccreditedHmoByName(normalized, { source });
  if (active) {
    return { ok: true, provider: active, preserved: false };
  }
  if (String(currentProvider || "").trim() === normalized) {
    const inactive = findAccreditedHmoByName(normalized, { includeInactive: true, source });
    return { ok: true, provider: inactive || { name: normalized, active: false }, preserved: true };
  }
  return { ok: false, provider: null, preserved: false };
}

module.exports = {
  APPROVED_HMO_PROVIDERS,
  isHmoActive,
  listAccreditedHmoProviders,
  publicHmoProviders,
  findAccreditedHmoByName,
  canSaveHmoProvider,
};
