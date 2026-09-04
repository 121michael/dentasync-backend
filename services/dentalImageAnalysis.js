"use strict";

/**
 * Preliminary dental image review for the patient AI Assistant.
 * Never presents output as a clinical diagnosis.
 * Uses Gemini vision only when GEMINI_API_KEY is configured.
 */

const DISCLAIMER =
  "AI-generated information is preliminary and does not replace examination or diagnosis by a licensed dentist.";

function unavailableResult(reason) {
  return {
    status: "unavailable",
    summary: reason,
    findings: null,
    confidence: null,
    possibleToothNumber: null,
    possibleSurface: null,
    disclaimer: DISCLAIMER,
    model: "none",
  };
}

async function analyzeDentalImageBuffer({ buffer, mimeType, fileName, question }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return unavailableResult(
      "Your image was saved securely. Automated preliminary analysis is not configured on this server (GEMINI_API_KEY). Please share the image with your dentist for professional review."
    );
  }

  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return unavailableResult("No image data was received for analysis.");
  }

  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
  if (!allowed.has(mimeType)) {
    return unavailableResult(
      "Preliminary image analysis supports JPG, PNG, or WEBP photos/X-rays. PDF or other formats are stored for your dentist but are not auto-analyzed here."
    );
  }

  const prompt = `You are Amethyst Dental's patient AI assistant inside DentaSync.
The patient uploaded a dental photo or X-ray${fileName ? ` named "${fileName}"` : ""}.
Patient note: ${question || "(none)"}

Provide PRELIMINARY observations only. You MUST NOT claim a diagnosis, prescribe treatment, or sound certain.
If image quality is poor, say so and avoid guessing.

Respond in plain text with short sections:
1) Image quality
2) Possible FDI tooth number(s) if reasonably visible (examples: 11, 16, 26, 36, 46). Say "uncertain" if unclear.
3) Possible visible tooth surface if applicable (occlusal, incisal, buccal, facial, lingual, palatal, mesial, distal) or "uncertain"
4) Possible visible abnormality area requiring professional attention (preliminary only)
5) Recommendation to see a licensed dentist

Always end with: ${DISCLAIMER}`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: prompt },
                {
                  inline_data: {
                    mime_type: mimeType,
                    data: buffer.toString("base64"),
                  },
                },
              ],
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      return unavailableResult(
        "Preliminary image analysis could not be completed right now. Your upload was saved for your care team. Please try again later or consult your dentist."
      );
    }

    const payload = await response.json();
    const text =
      payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim() ||
      "";

    if (!text) {
      return unavailableResult(
        "No preliminary findings could be generated from this image. Please consult your dentist for professional evaluation."
      );
    }

    const toothMatch = text.match(/\b([1-4][1-8])\b/);
    const surfaceMatch = text.match(
      /\b(occlusal|incisal|buccal|facial|lingual|palatal|mesial|distal)\b/i
    );

    return {
      status: "completed",
      summary: text.includes(DISCLAIMER) ? text : `${text}\n\n${DISCLAIMER}`,
      findings: {
        raw: text,
        possibleToothNumber: toothMatch ? toothMatch[1] : null,
        possibleSurface: surfaceMatch ? surfaceMatch[1].toLowerCase() : null,
      },
      confidence: null,
      possibleToothNumber: toothMatch ? toothMatch[1] : null,
      possibleSurface: surfaceMatch ? surfaceMatch[1].toLowerCase() : null,
      disclaimer: DISCLAIMER,
      model: "gemini-1.5-flash",
    };
  } catch (error) {
    console.warn("Dental image analysis failed:", error.message);
    return unavailableResult(
      "Preliminary image analysis failed unexpectedly. Your upload was saved. Please consult your dentist."
    );
  }
}

module.exports = {
  analyzeDentalImageBuffer,
  DISCLAIMER,
};
