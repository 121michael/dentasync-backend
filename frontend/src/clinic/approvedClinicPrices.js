import catalog from "./clinicServicesCatalog.json" with { type: "json" };

const CASE_ASSESSMENT_NOTE =
  "Final treatment recommendations and applicable costs may depend on the patient's dental condition and the dentist's assessment.";
const COMPACT_CASE_NOTE =
  "Final price depends on the patient's dental needs and assessment.";
const PER_UNIT_NOTE =
  "Per-unit crown and bridge fees are not automatically the total for an entire bridge or multiple teeth.";

const APPROVED_CLINIC_PRICES = catalog.services.map((entry) => ({
  ...entry,
  notes: entry.notes || [],
  lines: entry.lines || [],
  matchIds: entry.matchIds || [],
  matchNames: entry.matchNames || [],
}));

const UNAVAILABLE_PRICE = {
  id: "unavailable",
  title: "",
  description: "",
  priceLabel: "Price unavailable",
  details: "Price unavailable until confirmed by the clinic",
  verified: false,
  notes: ["Book a FREE consultation / oral examination so our dentist can assess your needs."],
};

let runtimeOverrides = [];

function overlayFields(entry, overlay) {
  if (!overlay) return entry;
  return {
    ...entry,
    title: overlay.title || entry.title,
    description: overlay.description || entry.description,
    priceLabel: overlay.priceLabel || entry.priceLabel,
    details: overlay.details || entry.details,
    compactNote: overlay.compactNote || entry.compactNote,
    lines: Array.isArray(overlay.lines) ? overlay.lines : entry.lines,
    notes: Array.isArray(overlay.notes) ? overlay.notes : entry.notes,
    dependsOnCase: overlay.dependsOnCase != null ? Boolean(overlay.dependsOnCase) : entry.dependsOnCase,
  };
}

export function applyApprovedClinicPriceOverrides(list) {
  runtimeOverrides = Array.isArray(list) ? list : [];
}

function liveCatalog() {
  if (!runtimeOverrides.length) return APPROVED_CLINIC_PRICES;
  return APPROVED_CLINIC_PRICES.map((entry) => {
    const overlay = runtimeOverrides.find((item) => item?.id === entry.id);
    return overlayFields(entry, overlay);
  });
}

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function findCatalogEntry(service) {
  if (!service) return null;
  const serviceId = String(service.id || "").trim();
  const serviceName = normalizeName(service.name);
  return liveCatalog().find(
    (entry) =>
      entry.matchIds.includes(serviceId) || entry.matchNames.includes(serviceName)
  );
}

function formatPrice(entry, service, verified) {
  const compactNote = entry.compactNote
    || (entry.dependsOnCase
      ? COMPACT_CASE_NOTE
      : entry.notes?.includes(PER_UNIT_NOTE)
        ? PER_UNIT_NOTE
        : entry.notes?.[0] || "");
  const extraNotes = (entry.notes || []).filter((note) => {
    if (entry.dependsOnCase && (note === CASE_ASSESSMENT_NOTE || note === compactNote)) return false;
    if (note === compactNote) return false;
    return true;
  });

  return {
    ...entry,
    title: service?.name || entry.title,
    description: service?.description || entry.description,
    verified,
    compactNote,
    extraNotes,
  };
}

function getInvisibleBracesOption() {
  const confirmed = liveCatalog().find((entry) => {
    const names = (entry.matchNames || []).concat(entry.title || "").map(normalizeName);
    return (
      entry.id === "invisible-braces" ||
      names.includes("invisible braces") ||
      names.includes("clear aligners") ||
      names.includes("clear aligner")
    );
  });
  if (confirmed) {
    return {
      id: confirmed.id,
      title: "Invisible Braces",
      description:
        confirmed.description ||
        "Invisible braces or clear aligner treatment may help improve the alignment of teeth using a less noticeable orthodontic approach. Suitability, treatment duration, and cost depend on the patient's needs and the dentist's assessment.",
      priceLabel: confirmed.priceLabel,
      details: confirmed.details,
      lines: confirmed.lines || [],
      notes: confirmed.notes || [],
      verified: true,
    };
  }
  return {
    id: "invisible-braces",
    title: "Invisible Braces",
    description:
      "Invisible braces or clear aligner treatment may help improve the alignment of teeth using a less noticeable orthodontic approach. Suitability, treatment duration, and cost depend on the patient's needs and the dentist's assessment.",
    priceLabel: "Price available upon consultation",
    details: "Price available upon consultation",
    lines: [],
    notes: ["Book a FREE consultation / oral examination so our dentist can assess your needs."],
    verified: false,
  };
}

export function getOrthodonticBracesOptions() {
  const metal = findCatalogEntry({ id: "metal-braces", name: "Standard Metal Braces" });
  const adjustment = findCatalogEntry({ id: "ortho-adjustment", name: "Ortho Adjustment" });
  return [
    {
      id: "metal-braces",
      title: "Standard Metal Braces",
      description:
        metal?.description ||
        "Standard metal braces use brackets and wires to gradually align teeth and improve the bite. Treatment suitability and duration depend on the dentist's assessment.",
      priceLabel: metal?.priceLabel || "₱5,000 down payment + ₱1,250 monthly",
      details: metal?.details || "₱5,000 down payment; ₱1,250 monthly adjustment",
      lines: metal?.lines || [],
      notes: metal?.notes || [],
      verified: true,
    },
    getInvisibleBracesOption(),
    {
      id: "ortho-adjustment",
      title: adjustment?.title || "Ortho Adjustment",
      description:
        adjustment?.description ||
        "An orthodontic adjustment visit. This is a separate procedure from braces payment plans and from retainer products.",
      priceLabel: adjustment?.priceLabel || "Price available upon consultation",
      details: adjustment?.details || "Price available upon consultation",
      lines: adjustment?.lines || [],
      notes: adjustment?.notes || [],
      verified: Boolean(adjustment),
    },
  ];
}

export function getApprovedClinicPrice(service) {
  if (!service) return null;
  const match = findCatalogEntry(service);

  if (!match) {
    return {
      ...UNAVAILABLE_PRICE,
      title: service.name || "Selected service",
      description: service.description || "",
      compactNote: UNAVAILABLE_PRICE.notes[0] || "",
      extraNotes: [],
      options: [],
    };
  }

  const priced = formatPrice(match, service, true);
  if (match.id === "orthodontic-consultation") {
    return {
      ...priced,
      options: getOrthodonticBracesOptions(),
    };
  }
  return { ...priced, options: [] };
}

export function getApprovedClinicCatalogGroups() {
  return catalog.groups || [];
}

export { APPROVED_CLINIC_PRICES };
