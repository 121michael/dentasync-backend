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
  "rawTextSummary": "",
  "visits": [{"date":"","procedure":"","amount":"","toothNos":""}]
}

Rules:
- isDocument must be false for selfies, face portraits, landscapes, or non-document photos.
- Only fill fields that are clearly readable in the image. Use empty string when not readable. Do NOT invent values.
- For Amethyst dental charts (NAME / ADDRESS / TELEPHONE / AGE / OCCUPATION / STATUS / DATE / DESCRIPTION / CREDIT):
  - age: the handwritten number beside or under AGE (often 2 digits like 25). Never leave age empty if AGE is clearly written.
  - treatmentDate: the handwritten DATE value (e.g. "SEPT. 7, 2024" or "SEPT 7, 2024").
  - procedure: the handwritten DESCRIPTION value (e.g. "ORAL PROPHYLAXIS"). Copy it exactly when readable.
  - amountCharged: the handwritten CREDIT / AMOUNT value (e.g. 800, 2000, 3000).
  - phone: TELEPHONE digits as written (09XXXXXXXXX).
  - Put the same DATE / DESCRIPTION / AMOUNT into visits[0] as date / procedure / amount.
- Copy EXACT wording from the document (procedure names, dates, amounts, tooth numbers). Do not rename procedures to a catalog label.
- phone: keep digits as written when possible, preferably Philippine mobile like 09XXXXXXXXX. Leave empty if not clearly written.
- gender prompts printed as "M/F" with no selection mean gender is empty.
- treatmentDate: keep the written date text when possible (e.g. "SEPT 7, 2024"); ISO YYYY-MM-DD is allowed only when clearly equivalent.
- amountCharged: keep the written amount text when possible (digits/commas); strip currency symbols only.
- procedure: use the written treatment/description exactly (e.g. ORAL PROPHYLAXIS, ORTHO INSTALLATION, EXO).
- For multi-row TREATMENT RECORD tables:
  - Put visit rows into "visits" (date, procedure, amount, toothNos) using exact cell text when readable.
  - Prefer the earliest Orthodontic Installation with amount for procedure/treatmentDate/amountCharged.
  - If no installation, use the latest visit that has a readable amount.
  - If amounts are dashes, still capture procedure/date.
  - Leave notes empty unless the form itself contains a notes/remarks field.
  - Name/Age/Gender may be blank on these forms — leave them empty rather than guessing.
- Ignore tooth chart drawings unless needed for notes.
- If the image is a document but no patient/treatment fields are readable, still set isDocument true and leave all fields empty.`;

  const models = [
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-latest",
  ];

  let lastError = "";
  for (const model of models) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`,
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
        lastError = `${response.status} ${detail.slice(0, 120)}`;
        continue;
      }

      const data = await response.json();
      const text = String(data?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) continue;

      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        continue;
      }
    } catch (error) {
      lastError = error.message || String(error);
    }
  }

  if (lastError) {
    console.warn("Gemini document extraction failed:", lastError);
  }
  return null;
}

module.exports = {
  extractFieldsWithGemini,
};
