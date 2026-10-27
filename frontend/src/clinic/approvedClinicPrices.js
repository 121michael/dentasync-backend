const CASE_ASSESSMENT_NOTE =
  "Final price depends on your dental needs and the dentist's assessment.";
const COMPACT_CASE_NOTE =
  "Final price depends on the patient's dental needs and assessment.";
const FREE_CONSULTATION_NOTE =
  "Book a FREE consultation / oral examination so our dentist can assess your needs.";
const DENTURE_ADVICE_NOTE =
  "Want to know which denture type or material is suitable for you? Book a FREE consultation with our dentist.";
const PER_UNIT_NOTE =
  "Per-unit crown and bridge fees are not automatically the total for an entire bridge or multiple teeth.";

const APPROVED_CLINIC_PRICES = [
  {
    id: "consultation",
    matchIds: ["general-consultation", "consultation"],
    matchNames: ["oral examination / consultation", "consultation / oral examination"],
    title: "Consultation / Oral Examination",
    description: "Oral examination and consultation with the dentist.",
    priceLabel: "Free",
    details: "Free",
    notes: ["You're welcome to book this consultation so our dentist can assess your needs."],
  },
  {
    id: "cleaning",
    matchIds: ["cleaning"],
    matchNames: ["dental cleaning / oral prophylaxis", "oral prophylaxis"],
    title: "Oral Prophylaxis",
    description: "Professional cleaning and oral prophylaxis.",
    priceLabel: "Starting at ₱1,000",
    details: "Starting at ₱1,000; depends on the case",
    dependsOnCase: true,
    notes: [CASE_ASSESSMENT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "filling",
    matchIds: ["filling"],
    matchNames: ["permanent filling / restoration", "restoration / permanent filling"],
    title: "Restoration / Permanent Filling",
    description: "Permanent filling and restoration.",
    priceLabel: "Starting at ₱1,000",
    details: "Starting at ₱1,000; depends on the case",
    dependsOnCase: true,
    notes: [CASE_ASSESSMENT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "extraction",
    matchIds: ["extraction"],
    matchNames: ["tooth extraction", "extraction"],
    title: "Extraction",
    description: "Tooth extraction care.",
    priceLabel: "Starting at ₱1,500",
    details: "Starting at ₱1,500; depends on the case",
    dependsOnCase: true,
    notes: [CASE_ASSESSMENT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "odontectomy",
    matchIds: ["odontectomy"],
    matchNames: ["odontectomy"],
    title: "Odontectomy",
    description: "Surgical removal of an impacted or wisdom tooth.",
    priceLabel: "₱5,000–₱15,000",
    details: "₱5,000–₱15,000; depends on the case",
    dependsOnCase: true,
    notes: [CASE_ASSESSMENT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "whitening",
    matchIds: ["whitening"],
    matchNames: ["teeth whitening", "teeth bleaching / whitening"],
    title: "Teeth Bleaching / Whitening",
    description: "Professional teeth whitening.",
    priceLabel: "₱10,000 per session",
    details: "₱10,000 per session; 2 applications",
    notes: ["This listed amount is per session and includes two applications, not an unlisted package total."],
  },
  {
    id: "fluoride",
    matchIds: ["fluoride"],
    matchNames: ["fluoride application"],
    title: "Fluoride Application",
    description: "Fluoride application.",
    priceLabel: "₱1,500",
    details: "₱1,500",
    notes: [],
  },
  {
    id: "metal-braces",
    matchIds: ["metal-braces"],
    matchNames: ["standard metal braces"],
    title: "Standard Metal Braces",
    description: "Standard metal braces treatment plan.",
    priceLabel: "₱5,000 down payment",
    details: "₱5,000 down payment + ₱1,250 monthly adjustment",
    notes: [
      "The monthly adjustment is not the total cost of treatment.",
      "Free cleaning is included every month during the adjustment visit.",
    ],
  },
  {
    id: "clear-retainer-plan",
    matchIds: ["clear-retainer-plan"],
    matchNames: ["clear retainer"],
    title: "Clear Retainer",
    description: "Clear retainer orthodontic arrangement.",
    priceLabel: "₱15,000 down payment",
    details: "₱15,000 down payment + ₱1,500 monthly adjustment",
    notes: ["The down payment and monthly adjustment are separate amounts, not an overall treatment total."],
  },
  {
    id: "pfm-crown",
    matchIds: ["pfm-crown"],
    matchNames: ["porcelain-fused-to-metal crown / fixed bridge"],
    title: "Porcelain-Fused-to-Metal Crown / Fixed Bridge",
    description: "Porcelain-fused-to-metal crown or fixed bridge.",
    priceLabel: "₱7,000 per unit/tooth",
    details: "₱7,000 per unit/tooth",
    notes: [PER_UNIT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "zirconia-crown",
    matchIds: ["zirconia-crown"],
    matchNames: ["pure porcelain / zirconia crown"],
    title: "Pure Porcelain / Zirconia Crown",
    description: "Pure porcelain or zirconia crown.",
    priceLabel: "₱15,000 per unit",
    details: "₱15,000 per unit",
    notes: [PER_UNIT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "hawley-retainer",
    matchIds: ["hawley-retainer"],
    matchNames: ["hawley / straight-wire retainer"],
    title: "Hawley / Straight-Wire Retainer",
    description: "Hawley or straight-wire retainer.",
    priceLabel: "₱3,500 for upper or lower",
    details: "₱3,500 for upper or lower",
    notes: ["The listed price is for the upper or lower retainer, not automatically both."],
  },
  {
    id: "invisible-retainer",
    matchIds: ["invisible-retainer"],
    matchNames: ["invisible retainer"],
    title: "Invisible Retainer",
    description: "Invisible retainer.",
    priceLabel: "₱5,000 for upper or lower",
    details: "₱5,000 for upper or lower",
    notes: ["The listed price is for the upper or lower retainer, not automatically both."],
  },
  {
    id: "dentures",
    matchIds: ["dentures"],
    matchNames: ["dentures"],
    title: "Dentures",
    description: "Removable dentures to replace missing teeth. The dentist confirms the type and materials after an exam.",
    priceLabel: "Starting at ₱7,500",
    details: "Starting at ₱7,500; depends on type and materials",
    dependsOnCase: true,
    notes: [CASE_ASSESSMENT_NOTE, DENTURE_ADVICE_NOTE],
  },
  {
    id: "fixed-bridge",
    matchIds: ["fixed-bridge"],
    matchNames: ["fixed bridge"],
    title: "Fixed Bridge",
    description: "A fixed bridge to replace missing teeth, priced per unit after the dentist assesses the case.",
    priceLabel: "₱7,000 per unit/tooth",
    details: "Porcelain-fused-to-metal (PFM) ₱7,000 per unit/tooth",
    lines: [
      {
        label: "Porcelain-Fused-to-Metal / PFM",
        value: "₱7,000 per unit/tooth",
      },
    ],
    notes: [PER_UNIT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "dental-crowns",
    matchIds: ["dental-crowns"],
    matchNames: ["dental crowns"],
    title: "Dental Crowns",
    description: "A dental crown to restore a tooth. Porcelain-fused-to-metal and zirconia options are confirmed after an exam.",
    priceLabel: "From ₱7,000 per unit/tooth",
    details: "PFM ₱7,000 per unit/tooth; Pure Porcelain / Zirconia ₱15,000 per unit",
    lines: [
      {
        label: "Porcelain-Fused-to-Metal / PFM",
        value: "₱7,000 per unit/tooth",
      },
      {
        label: "Pure Porcelain / Zirconia Crowns",
        value: "₱15,000 per unit",
      },
    ],
    notes: [PER_UNIT_NOTE, FREE_CONSULTATION_NOTE],
  },
  {
    id: "veneers",
    matchIds: ["veneers"],
    matchNames: ["veneers"],
    title: "Veneers",
    description: "Thin coverings placed on the front of teeth to improve appearance. The dentist confirms whether veneers are appropriate after an exam.",
    priceLabel: "Available upon consultation",
    details: "Pricing is available upon consultation or confirmation by the clinic",
    notes: [FREE_CONSULTATION_NOTE],
  },
  {
    id: "dental-implants",
    matchIds: ["dental-implants"],
    matchNames: ["dental implants"],
    title: "Dental Implants",
    description: "A dental implant to replace a missing tooth. Suitability and treatment steps are confirmed after an exam.",
    priceLabel: "Available upon consultation",
    details: "Pricing is available upon consultation or confirmation by the clinic",
    notes: [FREE_CONSULTATION_NOTE],
  },
  {
    id: "gum-contouring",
    matchIds: ["gum-contouring"],
    matchNames: ["gum contouring"],
    title: "Gum Contouring",
    description: "Gum contouring to reshape gum tissue. The dentist confirms whether this treatment is appropriate after an exam.",
    priceLabel: "Available upon consultation",
    details: "Pricing is available upon consultation or confirmation by the clinic",
    notes: [FREE_CONSULTATION_NOTE],
  },
  {
    id: "dentures-bridge-crown",
    matchIds: ["dentures-bridge-crown"],
    matchNames: ["dentures / fixed bridge / crown"],
    title: "Dentures / Fixed Bridge / Crown",
    description: "Dentures, fixed bridge, or crown — the dentist confirms which option applies after an exam.",
    priceLabel: "Verified clinic prices below",
    details: "Dentures from ₱7,500; crowns and bridges priced per unit",
    lines: [
      {
        label: "Dentures",
        value: "Starting at ₱7,500; depends on type and materials",
      },
      {
        label: "Porcelain-Fused-to-Metal Crown / Fixed Bridge",
        value: "₱7,000 per unit/tooth",
      },
      {
        label: "Pure Porcelain / Zirconia Crown",
        value: "₱15,000 per unit",
      },
    ],
    dependsOnCase: true,
    notes: [CASE_ASSESSMENT_NOTE, DENTURE_ADVICE_NOTE, PER_UNIT_NOTE],
  },
];

const UNAVAILABLE_PRICE = {
  id: "unavailable",
  title: "",
  description: "",
  priceLabel: "Price unavailable",
  details: "Price unavailable until confirmed by the clinic",
  verified: false,
  notes: [FREE_CONSULTATION_NOTE],
};

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function getApprovedClinicPrice(service) {
  if (!service) return null;
  const serviceId = String(service.id || "").trim();
  const serviceName = normalizeName(service.name);

  const match = APPROVED_CLINIC_PRICES.find(
    (entry) =>
      entry.matchIds.includes(serviceId) || entry.matchNames.includes(serviceName)
  );

  if (!match) {
    return {
      ...UNAVAILABLE_PRICE,
      title: service.name || "Selected service",
      description: service.description || "",
      compactNote: UNAVAILABLE_PRICE.notes[0] || "",
      extraNotes: [],
    };
  }

  const compactNote = match.dependsOnCase
    ? COMPACT_CASE_NOTE
    : match.notes?.includes(PER_UNIT_NOTE)
      ? PER_UNIT_NOTE
      : match.notes?.[0] || "";
  const extraNotes = (match.notes || []).filter((note) => {
    if (match.dependsOnCase && note === CASE_ASSESSMENT_NOTE) return false;
    if (note === compactNote) return false;
    return true;
  });

  return {
    ...match,
    title: service.name || match.title,
    description: service.description || match.description,
    verified: true,
    compactNote,
    extraNotes,
  };
}

export { APPROVED_CLINIC_PRICES };
