"use strict";

/**
 * Patient-facing clinic assistant.
 * Grounds answers in Amethyst Dental clinic facts and general oral-health education.
 * Does not diagnose conditions or prescribe treatment.
 * Optional Gemini is used only when GEMINI_API_KEY is set, still grounded in clinic facts.
 */

const DEFAULT_CLINIC = {
  name: "Amethyst Dental Clinic",
  address: "Makati, Metro Manila",
  phone: "+63 2 8555 1234",
  email: "care@amethystdental.example",
  operatingHours: "Monday–Saturday · 9:00 AM – 6:00 PM",
};

const GENERIC_SERVICE_TOKENS = new Set([
  "dental",
  "teeth",
  "tooth",
  "oral",
  "care",
  "clinic",
  "general",
  "permanent",
  "fixed",
  "treatment",
  "consultation",
]);

const SERVICE_ALIASES = [
  { id: "cleaning", terms: ["cleaning", "prophylaxis", "oral prophylaxis", "hygiene"] },
  { id: "extraction", terms: ["extraction", "extract", "pull a tooth", "pulling a tooth"] },
  { id: "filling", terms: ["filling", "restoration", "cavity filling", "composite"] },
  { id: "root-canal", terms: ["root canal", "endodontic", "endo"] },
  { id: "orthodontic-consultation", terms: ["braces", "ortho", "orthodontic", "aligner", "invisalign"] },
  { id: "whitening", terms: ["whitening", "whiten", "bleaching"] },
  { id: "general-consultation", terms: ["consultation", "checkup", "check up", "examination", "exam"] },
  { id: "emergency-care", terms: ["emergency", "urgent pain"] },
  { id: "oral-surgery", terms: ["oral surgery", "surgical"] },
  { id: "dentures-bridge-crown", terms: ["denture", "dentures", "bridge", "crown", "cap"] },
];

const CLINIC_TOPICS = [
  {
    id: "hours",
    keywords: [
      "hours",
      "open",
      "opens",
      "close",
      "closes",
      "closing",
      "operating hours",
      "clinic hours",
      "business hours",
      "what time do you",
      "until what time",
    ],
    build: (clinic) =>
      `${clinic.name} is open ${clinic.operatingHours}. Appointments are booked from the Appointments page. Portal messages are reviewed during clinic hours.`,
  },
  {
    id: "location",
    keywords: ["location", "address", "where", "makati", "branch", "clinic location", "how to get there"],
    build: (clinic) =>
      `${clinic.name} is at ${clinic.address}. Confirm the location on your appointment details if staff has noted a different visit site.`,
  },
  {
    id: "contact",
    keywords: ["phone", "call", "email", "contact", "reach", "hotline", "number"],
    build: (clinic) =>
      `You can call ${clinic.name} at ${clinic.phone} or email ${clinic.email}. For a dental emergency during clinic hours, call the clinic directly.`,
  },
  {
    id: "hmo",
    keywords: ["hmo", "insurance", "coverage", "philhealth"],
    build: () =>
      "You can book with HMO coverage or pay out of pocket. If using HMO, provide your provider, member number, company name, and birth date during booking so staff can verify eligibility.",
  },
  {
    id: "queue",
    keywords: ["queue", "wait", "check-in", "check in", "rfid", "qr", "token", "now serving"],
    build: () =>
      "After your appointment is confirmed, check in from Queue Status or with staff via RFID or QR. Your queue number and estimated wait appear on the patient Queue page. Staff and dentists use the same clinic queue.",
  },
  {
    id: "booking",
    keywords: ["book", "booking", "appointment", "schedule a visit", "reserve"],
    build: () =>
      "Book from Appointments in the patient portal. Choose a service, date, and time, then submit for clinic confirmation. You do not pick a dentist — the clinic assigns an available clinician for that slot.",
  },
  {
    id: "cancel",
    keywords: ["cancel", "reschedule", "change appointment", "move my appointment"],
    build: () =>
      "Pending or confirmed appointments can be cancelled from Appointments. To reschedule, cancel the visit or contact the front desk so staff can update the booking.",
  },
  {
    id: "dentists",
    keywords: [
      "our dentist",
      "clinic dentist",
      "dentists",
      "orthodontist",
      "who are the doctors",
      "doctors at the clinic",
      "specialist at",
    ],
    build: (_clinic, dentists) => {
      if (!dentists.length) {
        return "Amethyst Dental assigns an available dentist when you book. You can review assigned clinician details on your appointment after confirmation.";
      }
      const list = dentists
        .map((dentist) => `${dentist.name}${dentist.specialty ? ` (${dentist.specialty})` : ""}`)
        .join("; ");
      return `The clinic team includes ${list}. Patients book a service and time; the clinic assigns an available dentist for that slot.`;
    },
  },
  {
    id: "services",
    keywords: ["services", "treatments", "what do you offer", "procedures", "price", "cost", "fee", "how much"],
    build: (_clinic, _dentists, services) => {
      if (!services.length) {
        return "Amethyst Dental offers cleaning, fillings, extractions, root canal treatment, whitening, orthodontic consultation, dentures or crowns, oral surgery, and emergency care. Book from Appointments.";
      }
      const list = services
        .map((service) => {
          const cost = formatPesos(service.estimatedCost);
          return cost ? `${service.name} (from about ${cost})` : service.name;
        })
        .join("; ");
      return `Clinic services include ${list}. Fees are estimates and are confirmed at the clinic. Book from Appointments.`;
    },
  },
  {
    id: "emergency",
    keywords: ["emergency", "urgent", "severe pain", "swelling", "bleeding that will not stop"],
    build: (clinic) =>
      `For urgent dental pain or swelling, book Emergency Dental Care if a slot is available, or call ${clinic.name} at ${clinic.phone}. This assistant cannot diagnose emergencies — seek in-person care for severe symptoms.`,
  },
];

const ORAL_HEALTH_TOPICS = [
  {
    keywords: ["brush", "brushing", "toothpaste", "how to brush"],
    answer:
      "Brush twice a day for about two minutes with a soft-bristled brush and fluoride toothpaste. Angle the bristles toward the gumline and clean every outer, inner, and chewing surface. Replace your brush every 3 months, or sooner if the bristles fray. This is general oral-care information, not a diagnosis.",
  },
  {
    keywords: ["floss", "flossing", "interdental"],
    answer:
      "Floss once daily to clean between teeth where a brush cannot reach. Slide the floss gently to the gumline, curve it around each tooth, and avoid snapping it into the gums. Interdental brushes can help if recommended by your dentist. This is general information only.",
  },
  {
    keywords: ["cavity", "cavities", "decay", "caries", "hole in tooth"],
    answer:
      "Tooth decay happens when plaque acids wear enamel. Common prevention is brushing with fluoride toothpaste, daily flossing, limiting sugary snacks and drinks, and routine cleanings. A dark spot, hole, or lingering toothache needs an in-person exam — this assistant cannot diagnose a cavity or decide if you need a filling.",
  },
  {
    keywords: ["gum", "gums", "gingivitis", "periodontal", "bleeding gum"],
    answer:
      "Healthy gums are typically pink and firm. Bleeding while brushing can be a sign of gum inflammation from plaque. Gentle brushing, daily flossing, and professional cleanings help. Persistent bleeding, swelling, or loose teeth should be checked by a dentist. This is not a diagnosis.",
  },
  {
    keywords: ["sensitive", "sensitivity", "hurt when i drink", "cold water"],
    answer:
      "Tooth sensitivity to cold, heat, or sweets is common and can come from worn enamel, exposed roots, or a cracked filling. A desensitizing toothpaste and a dental exam can help identify the cause. Avoid guessing home treatments for sharp or lingering pain — see your dentist.",
  },
  {
    keywords: ["wisdom", "third molar"],
    answer:
      "Wisdom teeth are the third molars at the back of the mouth. They may erupt normally, stay under the gum, or come in at an angle. Only a dentist can tell from an exam and X-rays whether they need to stay or be removed. Book an oral examination if they hurt, swell, or are hard to clean.",
  },
  {
    keywords: ["tooth number", "fdi", "which tooth", "molar", "incisor", "canine", "premolar", "adult teeth", "baby teeth"],
    answer:
      "Adults typically have 32 permanent teeth: incisors at the front, canines, premolars, and molars at the back, including wisdom teeth. Dentists often use FDI numbers (upper right 11–18, upper left 21–28, lower left 31–38, lower right 41–48). Children have 20 primary teeth. This assistant can explain tooth names, not diagnose a specific tooth problem.",
  },
  {
    keywords: ["enamel", "anatomy", "pulp", "root of the tooth", "what is a tooth"],
    answer:
      "A tooth has enamel on the outside, dentin underneath, and a pulp chamber with nerves and blood vessels. Roots anchor the tooth in the jaw. Protect enamel with fluoride, limited acidic drinks, and regular checkups. Pain that lasts, swelling, or a broken tooth needs a dentist visit.",
  },
  {
    keywords: ["braces care", "wax", "elastics", "retainers"],
    answer:
      "If you wear braces, brush after meals, use floss threaders or interdental brushes, and avoid very sticky or hard foods. Orthodontic wax can ease rubbing wires. After braces, retainers keep teeth from shifting — wear them as instructed. For adjustments or broken brackets, contact the clinic rather than trying to fix them yourself.",
  },
  {
    keywords: ["after extraction", "dry socket", "post op", "after surgery"],
    answer:
      "After an extraction, bite on gauze as instructed, rest, and avoid smoking, straws, and vigorous rinsing on the first day so the blood clot can form. Mild oozing can be normal; heavy bleeding, fever, or severe pain that worsens after a few days should be reported to the clinic. Follow the written after-care from your dentist.",
  },
  {
    keywords: ["whitening at home", "stain", "yellow teeth"],
    answer:
      "Surface stains from coffee, tea, or smoking often improve with cleaning and professional whitening. Over-the-counter strips can help mild discoloration but may cause sensitivity. The clinic offers professional teeth whitening after an exam. Whitening will not change crowns or fillings, and this assistant cannot promise a shade result.",
  },
  {
    keywords: ["kids", "child", "children", "baby tooth"],
    answer:
      "Children should start dental visits as primary teeth erupt. Supervise brushing with a smear or pea-sized amount of fluoride toothpaste, depending on age. A knocked-out baby tooth is usually not replanted; a knocked-out permanent tooth is a same-day emergency. Book a consultation for your child’s specific situation.",
  },
  {
    keywords: ["bad breath", "halitosis", "mouth odor"],
    answer:
      "Bad breath is often related to plaque on the tongue and between teeth, dry mouth, or lingering food. Brush, floss, clean the tongue, and stay hydrated. If odor persists despite hygiene, a dental exam can look for gum issues or decay. This is general advice, not a diagnosis.",
  },
  {
    keywords: ["toothache", "tooth ache", "my tooth hurts", "pain in my tooth"],
    answer:
      "Toothache can come from decay, a cracked tooth, gum infection, or sinus pressure — only an exam can tell. Rinse gently with water and avoid placing aspirin on the gum. For severe, spreading, or night-time pain, book Emergency Dental Care or call the clinic. This assistant cannot diagnose the cause of your pain.",
  },
];

function formatPesos(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  return `₱${amount.toLocaleString("en-PH")}`;
}

function normalizeQuestion(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clinicFrom(value) {
  const incoming = value && typeof value === "object" ? value : {};
  return {
    name: String(incoming.name || "").trim() || DEFAULT_CLINIC.name,
    address: String(incoming.address || "").trim() || DEFAULT_CLINIC.address,
    phone: String(incoming.phone || "").trim() || DEFAULT_CLINIC.phone,
    email: String(incoming.email || "").trim() || DEFAULT_CLINIC.email,
    operatingHours:
      String(incoming.operatingHours || incoming.operating_hours || "").trim() ||
      DEFAULT_CLINIC.operatingHours,
  };
}

function normalizeOptions(servicesOrOptions) {
  if (Array.isArray(servicesOrOptions)) {
    return { services: servicesOrOptions, dentists: [], clinic: DEFAULT_CLINIC };
  }
  const options = servicesOrOptions && typeof servicesOrOptions === "object" ? servicesOrOptions : {};
  return {
    services: Array.isArray(options.services) ? options.services : [],
    dentists: Array.isArray(options.dentists) ? options.dentists : [],
    clinic: clinicFrom(options.clinic),
  };
}

function keywordHits(normalized, keywords) {
  return keywords.filter((keyword) => normalized.includes(keyword)).length;
}

function matchService(normalized, services) {
  let best = null;
  let bestScore = 0;
  for (const service of services) {
    let score = 0;
    const name = String(service.name || "").toLowerCase();
    if (name && normalized.includes(name)) score += 5;
    const tokens = name
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 5 && !GENERIC_SERVICE_TOKENS.has(token));
    for (const token of tokens) {
      if (normalized.includes(token)) score += 2;
    }
    const aliases = SERVICE_ALIASES.find((item) => item.id === service.id);
    for (const term of aliases?.terms || []) {
      if (normalized.includes(term)) score += 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = service;
    }
  }
  return bestScore >= 2 ? best : null;
}

function matchTopic(normalized, topics) {
  let best = null;
  let bestScore = 0;
  for (const topic of topics) {
    const score = keywordHits(normalized, topic.keywords);
    if (score > bestScore) {
      bestScore = score;
      best = topic;
    }
  }
  return bestScore > 0 ? best : null;
}

function describeService(service) {
  const parts = [
    `${service.name}: ${service.description || "Available at Amethyst Dental."}`,
  ];
  if (service.durationMinutes) {
    parts.push(`A typical visit is about ${service.durationMinutes} minutes.`);
  }
  const cost = formatPesos(service.estimatedCost);
  if (cost) {
    parts.push(`Estimated fee starts around ${cost}; the clinic confirms the final amount.`);
  }
  parts.push("Book it from Appointments. This is general information only, not a diagnosis.");
  return parts.join(" ");
}

function answerFromCatalog(question, servicesOrOptions) {
  const { services, dentists, clinic } = normalizeOptions(servicesOrOptions);
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    return {
      answer:
        `Ask about ${clinic.name} hours, location, services, booking, queue check-in, or teeth and oral-care topics. I cannot provide a diagnosis.`,
      source: "faq",
    };
  }

  const service = matchService(normalized, services);
  const clinicTopic = matchTopic(normalized, CLINIC_TOPICS);
  const oralTopic = matchTopic(normalized, ORAL_HEALTH_TOPICS);

  if (service && (!clinicTopic || clinicTopic.id === "services" || clinicTopic.id === "emergency")) {
    return { answer: describeService(service), source: "catalog" };
  }

  if (clinicTopic && (!oralTopic || keywordHits(normalized, clinicTopic.keywords) >= keywordHits(normalized, oralTopic.keywords))) {
    return {
      answer: clinicTopic.build(clinic, dentists, services),
      source: "faq",
    };
  }

  if (oralTopic) {
    return { answer: oralTopic.answer, source: "oral-health" };
  }

  if (/(teeth|tooth|gum|oral|enamel|dentin)/.test(normalized)) {
    return {
      answer:
        "I can explain general tooth anatomy, brushing, flossing, cavities, gum care, sensitivity, and clinic services. Share a more specific question — for example, how to brush, what a molar is, or our cleaning service. I cannot diagnose your symptoms; a dentist needs an in-person exam for that.",
      source: "oral-health",
    };
  }

  return {
    answer:
      `I can help with ${clinic.name} hours, location, services, booking, HMO, queue check-in, and general questions about teeth and oral care. For personal medical advice or a diagnosis, please speak with your dentist or staff.`,
    source: "faq",
  };
}

function clinicContextBlock(clinic, services, dentists) {
  const serviceLines = services
    .map((service) => {
      const cost = formatPesos(service.estimatedCost);
      const duration = service.durationMinutes ? `${service.durationMinutes} min` : "";
      return `- ${service.name}: ${service.description || ""} ${duration} ${cost ? `from about ${cost}` : ""}`.trim();
    })
    .join("\n");
  const dentistLines = dentists
    .map((dentist) => `- ${dentist.name}${dentist.specialty ? `, ${dentist.specialty}` : ""}`)
    .join("\n");
  return `Clinic facts (use these; do not invent different hours or contact details):
Name: ${clinic.name}
Address: ${clinic.address}
Phone: ${clinic.phone}
Email: ${clinic.email}
Hours: ${clinic.operatingHours}
Patients book a service and time; the clinic assigns an available dentist.

Services:
${serviceLines || "(see Appointments in the patient portal)"}

Dentists:
${dentistLines || "(assigned by the clinic)"}`;
}

async function loadClinicProfile(db) {
  if (!db || typeof db.query !== "function") {
    return { ...DEFAULT_CLINIC };
  }
  try {
    const result = await db.query(
      `SELECT setting_value FROM admin_portal_settings WHERE setting_key = 'clinic' LIMIT 1`
    );
    return clinicFrom(result.rows[0]?.setting_value);
  } catch (error) {
    if (error?.code === "42P01" || error?.code === "42703") {
      return { ...DEFAULT_CLINIC };
    }
    return { ...DEFAULT_CLINIC };
  }
}

async function answerWithOptionalGemini(question, servicesOrOptions) {
  const options = normalizeOptions(servicesOrOptions);
  const local = answerFromCatalog(question, options);
  const apiKey = process.env.GEMINI_API_KEY;
  const clinicIntent = Boolean(matchTopic(normalizeQuestion(question), CLINIC_TOPICS));
  const oralIntent = Boolean(matchTopic(normalizeQuestion(question), ORAL_HEALTH_TOPICS)) ||
    /(teeth|tooth|gum|oral|enamel|cavity|brush|floss)/.test(normalizeQuestion(question));

  // Clinic facts stay on the local catalog so hours, phone, and fees are not invented.
  if (!apiKey || (clinicIntent && !oralIntent)) {
    return { ...local, model: "clinic-faq" };
  }

  try {
    const prompt = `You are the patient assistant for ${options.clinic.name} in the DentaSync portal.
Answer clearly about teeth, oral health, and this clinic.
You must NOT diagnose diseases, identify a patient's specific condition from symptoms, or prescribe treatment.
If asked for a diagnosis, refuse and suggest booking an oral examination or calling the clinic.
Keep answers brief (about 80-140 words). Use the clinic facts below when the question is about location, hours, contact, services, or dentists.

${clinicContextBlock(options.clinic, options.services, options.dentists)}

Patient question: ${question}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      }
    );

    if (!response.ok) {
      return { ...local, model: "clinic-faq-fallback" };
    }

    const payload = await response.json();
    const text =
      payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim() ||
      local.answer;

    return {
      answer: `${text}\n\nNote: General information only — not a professional dental diagnosis.`,
      source: "gemini",
      model: "gemini-1.5-flash",
    };
  } catch {
    return { ...local, model: "clinic-faq-fallback" };
  }
}

module.exports = {
  DEFAULT_CLINIC,
  answerFromCatalog,
  answerWithOptionalGemini,
  loadClinicProfile,
};
