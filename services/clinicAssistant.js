"use strict";

/**
 * Clinic information assistant grounded in local catalog/FAQ content.
 * Does not diagnose conditions. Optional Gemini only when GEMINI_API_KEY is set.
 */

const CLINIC_FAQ = [
  {
    keywords: ["hour", "open", "close", "schedule", "time"],
    answer:
      "Amethyst Dental clinic hours are typically weekdays during business hours. For the exact schedule on your preferred day, check appointment availability in the Book Appointment page or contact the front desk.",
  },
  {
    keywords: ["location", "address", "where", "makati", "branch"],
    answer:
      "Appointments are scheduled at Amethyst Dental — Makati unless staff advises otherwise. Confirm your clinic location on your appointment details.",
  },
  {
    keywords: ["hmo", "insurance", "coverage"],
    answer:
      "You can book with HMO coverage or pay out of pocket. If using HMO, provide your provider, member number, company name, and birth date during booking so staff can verify eligibility.",
  },
  {
    keywords: ["queue", "wait", "check-in", "rfid", "qr"],
    answer:
      "After your appointment is confirmed, check in from Queue Status or with staff via RFID/QR. Your queue token and estimated wait appear on the patient Queue page.",
  },
  {
    keywords: ["cancel", "reschedule"],
    answer:
      "Pending or confirmed appointments can be cancelled from Appointments. Rescheduling is handled by clinic staff after you contact them or they update your booking.",
  },
  {
    keywords: ["pain", "emergency", "urgent"],
    answer:
      "For urgent dental pain, book Emergency Dental Care if available, or contact the clinic immediately. This assistant cannot diagnose emergencies — seek in-person care for severe symptoms.",
  },
  {
    keywords: ["cleaning", "whitening", "filling", "extraction", "root", "braces", "ortho"],
    answer: null, // filled from services catalog dynamically
  },
];

function normalizeQuestion(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function answerFromCatalog(question, services = []) {
  const normalized = normalizeQuestion(question);
  if (!normalized) {
    return {
      answer:
        "Ask about clinic services, appointments, HMO coverage, queue check-in, or general oral-care topics. I cannot provide a diagnosis.",
      source: "faq",
    };
  }

  for (const service of services) {
    const name = String(service.name || "").toLowerCase();
    if (name && normalized.includes(name.split(" ")[0])) {
      return {
        answer: `${service.name}: ${service.description || "Available at Amethyst Dental."} Typical duration: ${service.duration || "varies"}. Book it from Appointments. This is general information only, not a diagnosis.`,
        source: "catalog",
      };
    }
  }

  for (const item of CLINIC_FAQ) {
    if (item.keywords.some((keyword) => normalized.includes(keyword))) {
      if (item.answer) {
        return { answer: item.answer, source: "faq" };
      }
    }
  }

  if (/(teeth|tooth|gum|cavity|brush|floss|oral)/.test(normalized)) {
    return {
      answer:
        "General oral-health tip: brush twice daily, floss once daily, and keep routine cleanings. For personal symptoms or treatment decisions, please consult your dentist. This assistant does not diagnose conditions.",
      source: "faq",
    };
  }

  return {
    answer:
      "I can help with clinic services, booking, HMO fields, queue/check-in, and general oral-care information. For medical advice or diagnosis, please speak with your dentist or staff.",
    source: "faq",
  };
}

async function answerWithOptionalGemini(question, services) {
  const apiKey = process.env.GEMINI_API_KEY;
  const local = answerFromCatalog(question, services);
  if (!apiKey) {
    return { ...local, model: "clinic-faq" };
  }

  try {
    const serviceList = services
      .map((service) => `- ${service.name}: ${service.description || ""}`)
      .join("\n");
    const prompt = `You are Amethyst Dental's patient assistant for DentaSync.
Answer briefly and helpfully. You must NOT diagnose diseases or prescribe treatment.
If asked for diagnosis, refuse and suggest seeing a dentist.
Clinic services:\n${serviceList}\n\nPatient question: ${question}`;

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
      payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n") ||
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
  answerFromCatalog,
  answerWithOptionalGemini,
};
