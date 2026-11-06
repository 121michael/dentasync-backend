"use strict";

/**
 * Preliminary dental image review for the patient AI Assistant.
 * Never presents output as a clinical diagnosis.
 * Uses Gemini vision only when GEMINI_API_KEY is configured.
 */

const DISCLAIMER =
  "AI-generated information is preliminary and does not replace examination or diagnosis by a licensed dentist.";

const IMAGE_MIME = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

async function prepareImageForProvider(buffer, mimeType) {
  const allowed = new Set(Object.values(IMAGE_MIME));
  if (!allowed.has(mimeType)) {
    return {
      ok: false,
      message:
        "This file type cannot be examined here. JPG, PNG, WEBP, and GIF images can be reviewed. PDF and other files are stored for your dentist, and I will not pretend to have seen them.",
    };
  }
  if (!buffer || !Buffer.isBuffer(buffer) || !buffer.length) {
    return { ok: false, message: "No image data was received, so I cannot examine an image." };
  }
  try {
    const sharp = require("sharp");
    const source = sharp(buffer, { failOn: "error", animated: false });
    const meta = await source.metadata();
    const format = meta.format;
    if (!IMAGE_MIME[format]) {
      return {
        ok: false,
        message:
          "I could not read this file as an image, so I did not examine it. Please upload a clear JPG, PNG, or WEBP dental photo or X-ray.",
      };
    }
    const cleaned = await source.rotate().toFormat(format).toBuffer();
    if (!cleaned.length) {
      return {
        ok: false,
        message: "I could not read this image, so I did not examine it.",
      };
    }
    return { ok: true, buffer: cleaned, mimeType: IMAGE_MIME[format] };
  } catch {
    return {
      ok: false,
      message:
        "This file looks corrupted or is not a readable image. I did not examine it. Please upload a clear JPG, PNG, or WEBP dental photo or X-ray.",
    };
  }
}

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

function sensitivityPrompt(sensitivity) {
  const value = String(sensitivity || "balanced").toLowerCase();
  if (value === "conservative") {
    return "Sensitivity: conservative. Prefer uncertainty. Do not speculate about lesions. Send the patient to a dentist for almost any concerning visual finding. Keep urgent-care advice for severe symptoms.";
  }
  if (value === "aggressive") {
    return "Sensitivity: aggressive. You may point out possible areas a dentist should examine, but you still MUST NOT diagnose or prescribe treatment. Keep urgent-care advice when warning signs are present.";
  }
  return "Sensitivity: balanced. Stay cautious and preliminary. Never diagnose or replace a dentist.";
}

async function analyzeDentalImageBuffer({
  buffer,
  mimeType,
  fileName,
  question,
  diagnosticsSensitivity = "balanced",
  usageUserId = null,
  usageUserRole = "patient",
  db = null,
} = {}) {
  const prepared = await prepareImageForProvider(buffer, mimeType);
  if (!prepared.ok) {
    return unavailableResult(prepared.message);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return unavailableResult(
      "Your image was saved securely. Automated preliminary analysis is not configured on this server. I could not examine the image. Please share it with your dentist for professional review."
    );
  }

  const prompt = `You are Amethyst Dental's patient AI assistant inside DentaSync.
The patient uploaded a dental photo or X-ray. Do not repeat names, chart numbers, or dates that look like patient identifiers.
Patient note: ${question || "(none)"}

Reply in the same language the patient used (English, Filipino/Tagalog, or mixed Taglish). If the note is empty, use English.

Provide PRELIMINARY observations only. You MUST NOT diagnose, prescribe medication, or decide treatment from the image alone.
If the image is blurry, dark, or too small to see tooth shapes, say you cannot identify features and do not invent them.
If the image is not a dental photo or X-ray, say so and do not describe teeth.
Suggest questions the patient can ask their dentist. Do not sound certain.

Respond in plain text with short sections:
1) Image quality
2) Possible FDI tooth number(s) if reasonably visible (examples: 11, 16, 26, 36, 46). Say "uncertain" if unclear.
3) Possible visible tooth surface if applicable (occlusal, incisal, buccal, facial, lingual, palatal, mesial, distal) or "uncertain"
4) Possible visible feature a dentist should review (preliminary only)
5) Questions to ask the dentist

${sensitivityPrompt(diagnosticsSensitivity)}

Always end with: ${DISCLAIMER}`;

  const { resolvedGeminiModel, geminiGenerateUrl } = require("./geminiModel");
  const model = resolvedGeminiModel();
  const { parseGeminiUsage, trackAiUsage, withAiUsageContext } = require("./aiUsage");
  return withAiUsageContext(
    {
      feature: "patient_image_analysis",
      userId: usageUserId,
      userRole: usageUserRole,
      db,
    },
    async () => {
      try {
        const response = await fetch(
          geminiGenerateUrl(apiKey, model),
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
                        mime_type: prepared.mimeType,
                        data: prepared.buffer.toString("base64"),
                      },
                    },
                  ],
                },
              ],
            }),
          }
        );

        if (!response.ok) {
          trackAiUsage({
            feature: "patient_image_analysis",
            outcome: "failed",
            httpStatus: response.status,
            model,
          });
          return unavailableResult(
            "I could not examine this image because the provider did not accept it. Your upload was saved. I will not describe findings from an image I could not access."
          );
        }

        const payload = await response.json();
        const text =
          payload?.candidates?.[0]?.content?.parts?.map((part) => part.text).join("\n").trim() ||
          "";
        const usage = parseGeminiUsage(payload);

        if (!text) {
          trackAiUsage({
            feature: "patient_image_analysis",
            outcome: "failed",
            httpStatus: 200,
            model,
            usage,
          });
          return unavailableResult(
            "I could not examine this image because the provider returned no description. Your upload was saved. I will not invent findings."
          );
        }

        trackAiUsage({
          feature: "patient_image_analysis",
          outcome: "success",
          httpStatus: 200,
          model,
          usage,
        });

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
          model,
        };
      } catch (error) {
        console.warn("Dental image analysis failed.");
        trackAiUsage({
          feature: "patient_image_analysis",
          outcome: "failed",
          model,
        });
        return unavailableResult(
          "I could not examine this image because the provider request failed. Your upload was saved. I will not describe findings from an image I could not access."
        );
      }
    }
  );
}

module.exports = {
  analyzeDentalImageBuffer,
  prepareImageForProvider,
  DISCLAIMER,
};
