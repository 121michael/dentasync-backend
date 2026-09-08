"use strict";

/**
 * Vision-assisted extraction for handwritten / complex dental forms.
 * Uses Gemini when GEMINI_API_KEY is configured.
 */

async function extractFieldsWithGemini(filePath, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const fs = require("fs");
  const buffer = fs.readFileSync(filePath);
  if (!buffer.length) return null;

  const prompt = `You are extracting structured data from a dental clinic paper form or scan for Amethyst Dental / DentaSync.
Return JSON ONLY (no markdown) with this exact shape:
{
  "isDocument": true,
  "fullName": "",
  "dateOfBirth": "",
  "age": "",
  "phone": "",
  "address": "",
  "procedure": "",
  "treatmentDate": "",
  "amountCharged": "",
  "notes": "",
  "rawTextSummary": ""
}

Rules:
- isDocument must be false for selfies, face portraits, landscapes, or non-document photos.
- Only fill fields that are clearly readable in the image. Use empty string when not readable. Do NOT invent values.
- phone: keep digits, preferably Philippine mobile like 09XXXXXXXXX.
- treatmentDate: prefer ISO YYYY-MM-DD when possible (e.g. Sept 7, 2024 -> 2024-09-07).
- amountCharged: numeric only, no currency symbol.
- procedure: use the written treatment/description (e.g. Oral Prophylaxis).
- For Filipino dental charts/forms with labels NAME, TELEPHONE, AGE, DESCRIPTION, AMOUNT, DATE — map those fields.
- Ignore tooth chart drawings unless needed for notes.`;

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
                  mime_type: mimeType || "image/png",
                  data: buffer.toString("base64"),
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
        },
      }),
    }
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.warn("Gemini document extraction failed:", response.status, detail.slice(0, 200));
    return null;
  }

  const data = await response.json();
  const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = {
  extractFieldsWithGemini,
};
