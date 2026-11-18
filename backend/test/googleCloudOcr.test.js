"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const PDFDocument = require("pdfkit");
const {
  extractTextWithGoogleCloud,
  extractHandwrittenFormWithDocumentAi,
  documentAiProcessorName,
  documentAiIsConfigured,
  applyLowConfidenceFields,
  googleCloudOcrIsConfigured,
  setGoogleCloudOcrFetch,
  clearGoogleCloudOcrCache,
} = require("../services/googleCloudOcr");
const { extractDocumentData } = require("../services/documentSyncExtraction");

const HANDWRITING_TEXT = `NAME
Maria Santos
ADDRESS
Mandaluyong City
TELEPHONE
09171234567
AGE
28
DESCRIPTION
ORAL PROPHYLAXIS
DATE
SEPT 7, 2024
AMOUNT
800`;

function handwritingSvg() {
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
  <rect width="100%" height="100%" fill="#f7f4ee"/>
  <text x="80" y="90" font-size="28" font-family="serif">NAME</text>
  <text x="80" y="140" font-size="36" font-family="cursive" font-style="italic">Maria Santos</text>
  <text x="80" y="210" font-size="28" font-family="serif">ADDRESS</text>
  <text x="80" y="260" font-size="32" font-family="cursive" font-style="italic">Mandaluyong City</text>
  <text x="80" y="330" font-size="28" font-family="serif">TELEPHONE</text>
  <text x="80" y="380" font-size="32" font-family="cursive" font-style="italic">09171234567</text>
  <text x="80" y="450" font-size="28" font-family="serif">AGE</text>
  <text x="80" y="500" font-size="32" font-family="cursive" font-style="italic">28</text>
  <text x="80" y="600" font-size="28" font-family="serif">DATE</text>
  <text x="80" y="650" font-size="30" font-family="cursive" font-style="italic">SEPT 7, 2024</text>
  <text x="380" y="600" font-size="28" font-family="serif">DESCRIPTION</text>
  <text x="380" y="650" font-size="30" font-family="cursive" font-style="italic">ORAL PROPHYLAXIS</text>
  <text x="80" y="740" font-size="28" font-family="serif">AMOUNT</text>
  <text x="80" y="790" font-size="32" font-family="cursive" font-style="italic">800</text>
</svg>`);
}

async function writeHandwritingPng() {
  const sharp = require("sharp");
  const filePath = path.join(os.tmpdir(), `gcp-hw-${process.pid}.png`);
  await sharp(handwritingSvg()).png().toFile(filePath);
  return filePath;
}

async function writeImagePdf(imagePath) {
  const filePath = path.join(os.tmpdir(), `gcp-hw-${process.pid}.pdf`);
  await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 36 });
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);
    doc.image(imagePath, 36, 36, { fit: [520, 740] });
    doc.end();
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
  return filePath;
}

function mockVisionFetch(calls) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body || "" });
    const href = String(url);
    if (href.includes("oauth2.googleapis.com/token")) {
      return {
        ok: true,
        status: 200,
        async json() {
          return { access_token: "test-token", expires_in: 3600 };
        },
        async text() {
          return JSON.stringify({ access_token: "test-token", expires_in: 3600 });
        },
      };
    }
    if (href.includes("documentai.googleapis.com")) {
      return jsonResponse({
        document: {
          text: HANDWRITING_TEXT,
          pages: [
            {
              layout: { confidence: 0.92 },
              tokens: [
                {
                  layout: {
                    confidence: 0.94,
                    textAnchor: { textSegments: [{ startIndex: String(HANDWRITING_TEXT.indexOf("Maria")), endIndex: String(HANDWRITING_TEXT.indexOf("Santos") + 6) }] },
                  },
                },
                {
                  layout: {
                    confidence: 0.2,
                    textAnchor: { textSegments: [{ startIndex: String(HANDWRITING_TEXT.lastIndexOf("800")), endIndex: String(HANDWRITING_TEXT.lastIndexOf("800") + 3) }] },
                  },
                },
              ],
            },
          ],
        },
      });
    }
    if (href.includes("files:annotate")) {
      return jsonResponse({
        responses: [
          {
            responses: [{ fullTextAnnotation: { text: HANDWRITING_TEXT, pages: [{ confidence: 0.88 }] } }],
          },
        ],
      });
    }
    if (href.includes("images:annotate")) {
      return jsonResponse({
        responses: [{ fullTextAnnotation: { text: HANDWRITING_TEXT, pages: [{ confidence: 0.91 }] } }],
      });
    }
    return jsonResponse({ error: { message: `unexpected ${href}` } }, 500);
  };
}

function jsonResponse(payload, status = 200) {
  const text = JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return payload;
    },
    async text() {
      return text;
    },
  };
}

test("Google Cloud OCR is skipped when credentials are missing", async () => {
  clearGoogleCloudOcrCache();
  const filePath = await writeHandwritingPng();
  try {
    const result = await extractTextWithGoogleCloud({
      filePath,
      env: {},
    });
    assert.equal(result, null);
    assert.equal(googleCloudOcrIsConfigured({}), false);
  } finally {
    fs.unlink(filePath, () => {});
  }
});

test("Document AI processor name is built from project, location, and processor id", () => {
  assert.equal(
    documentAiProcessorName({
      GOOGLE_CLOUD_PROJECT: "clinic-sync",
      GOOGLE_DOCUMENT_AI_LOCATION: "us",
      GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "proc-handwriting",
    }),
    "projects/clinic-sync/locations/us/processors/proc-handwriting"
  );
  assert.equal(documentAiIsConfigured({ GOOGLE_CLOUD_PROJECT: "clinic-sync" }), false);
});

test("Enterprise Document OCR reads a synthetic handwritten form and blanks low-confidence values", async () => {
  clearGoogleCloudOcrCache();
  const calls = [];
  setGoogleCloudOcrFetch(mockVisionFetch(calls));
  const filePath = await writeHandwritingPng();
  const env = {
    GOOGLE_CLOUD_API_KEY: "test-document-ai-key",
    GOOGLE_CLOUD_PROJECT: "clinic-sync",
    GOOGLE_DOCUMENT_AI_LOCATION: "us",
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: "proc-handwriting",
  };
  const previous = {
    GOOGLE_CLOUD_API_KEY: process.env.GOOGLE_CLOUD_API_KEY,
    GOOGLE_CLOUD_PROJECT: process.env.GOOGLE_CLOUD_PROJECT,
    GOOGLE_DOCUMENT_AI_LOCATION: process.env.GOOGLE_DOCUMENT_AI_LOCATION,
    GOOGLE_DOCUMENT_AI_PROCESSOR_ID: process.env.GOOGLE_DOCUMENT_AI_PROCESSOR_ID,
  };
  Object.assign(process.env, env);
  try {
    const ocr = await extractHandwrittenFormWithDocumentAi({
      filePath,
      mimeType: "image/png",
      env,
    });
    assert.equal(ocr.ok, true);
    assert.equal(ocr.method, "gcp-document-ai-ocr");
    assert.match(ocr.text, /Maria Santos/);
    assert.ok(calls.some((call) => call.url.includes("documentai.googleapis.com")));
    assert.match(String(calls.find((call) => call.url.includes("documentai.googleapis.com")).body), /ocrConfig/);

    const extracted = await extractDocumentData(filePath, "image/png", "handwriting-chart.png", {
      sourceType: "hard_copy_scan",
    });
    assert.match(String(extracted.method), /gcp-document-ai-ocr/);
    assert.equal(extracted.payload.patient.fullName, "Maria Santos");
    assert.equal(extracted.payload.patient.age, "28");
    assert.equal(extracted.payload.procedure.treatment, "Oral Prophylaxis");
    assert.equal(extracted.payload.procedure.amountCharged, "");
    assert.equal(extracted.fieldStatuses.amountCharged, "unable_to_read");
  } finally {
    setGoogleCloudOcrFetch(null);
    clearGoogleCloudOcrCache();
    fs.unlink(filePath, () => {});
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("missing Document AI credentials keep manual entry available", async () => {
  const filePath = await writeHandwritingPng();
  try {
    const ocr = await extractHandwrittenFormWithDocumentAi({
      filePath,
      mimeType: "image/png",
      env: {},
    });
    assert.equal(ocr.ok, false);
    assert.equal(ocr.code, "not_configured");
    const payload = {
      patient: { fullName: "Guessed Name", firstName: "Guessed", lastName: "Name", age: "99" },
      procedure: { amountCharged: "12" },
    };
    const statuses = applyLowConfidenceFields(payload, {}, [{ text: "Guessed", confidence: 0.1 }]);
    assert.equal(payload.patient.fullName, "");
    assert.equal(statuses.fullName, "unable_to_read");
  } finally {
    fs.unlink(filePath, () => {});
  }
});

test("Google Cloud Vision reads a handwriting-style dental chart image", async () => {
  clearGoogleCloudOcrCache();
  const calls = [];
  setGoogleCloudOcrFetch(mockVisionFetch(calls));
  const filePath = await writeHandwritingPng();
  const previous = process.env.GOOGLE_CLOUD_API_KEY;
  process.env.GOOGLE_CLOUD_API_KEY = "test-vision-key";
  try {
    const result = await extractTextWithGoogleCloud({
      filePath,
      mimeType: "image/png",
      env: { GOOGLE_CLOUD_API_KEY: "test-vision-key" },
    });
    assert.match(result.text, /Maria Santos/);
    assert.match(result.text, /ORAL PROPHYLAXIS/i);
    assert.equal(result.method, "gcp-vision");
    assert.ok(calls.some((call) => call.url.includes("images:annotate")));
    assert.match(calls.find((call) => call.url.includes("images:annotate")).body, /DOCUMENT_TEXT_DETECTION/);

    const extracted = await extractDocumentData(filePath, "image/png", "handwriting-chart.png");
    assert.match(String(extracted.method), /gcp-vision/);
    assert.equal(extracted.payload.patient.fullName, "Maria Santos");
    assert.equal(extracted.payload.patient.age, "28");
    assert.equal(extracted.payload.procedure.treatment, "Oral Prophylaxis");
    assert.doesNotMatch(JSON.stringify(calls), /tesseract/i);
  } finally {
    setGoogleCloudOcrFetch(null);
    clearGoogleCloudOcrCache();
    fs.unlink(filePath, () => {});
    if (previous === undefined) delete process.env.GOOGLE_CLOUD_API_KEY;
    else process.env.GOOGLE_CLOUD_API_KEY = previous;
  }
});

test("Google Cloud Vision reads a scanned PDF of the same chart", async () => {
  clearGoogleCloudOcrCache();
  const calls = [];
  setGoogleCloudOcrFetch(mockVisionFetch(calls));
  const imagePath = await writeHandwritingPng();
  const pdfPath = await writeImagePdf(imagePath);
  const previous = process.env.GOOGLE_CLOUD_API_KEY;
  process.env.GOOGLE_CLOUD_API_KEY = "test-vision-key";
  try {
    const result = await extractTextWithGoogleCloud({
      filePath: pdfPath,
      mimeType: "application/pdf",
      env: { GOOGLE_CLOUD_API_KEY: "test-vision-key" },
    });
    assert.match(result.text, /09171234567/);
    assert.equal(result.method, "gcp-vision-pdf");
    assert.ok(calls.some((call) => call.url.includes("files:annotate")));
    assert.match(calls.find((call) => call.url.includes("files:annotate")).body, /application\/pdf/);

    const extracted = await extractDocumentData(pdfPath, "application/pdf", "handwriting-chart.pdf");
    assert.match(String(extracted.method), /gcp-vision-pdf|gcp-vision/);
    assert.equal(extracted.payload.patient.phone, "09171234567");
    assert.match(extracted.payload.procedure.treatmentDate, /SEPT\s*7,\s*2024/i);
  } finally {
    setGoogleCloudOcrFetch(null);
    clearGoogleCloudOcrCache();
    fs.unlink(imagePath, () => {});
    fs.unlink(pdfPath, () => {});
    if (previous === undefined) delete process.env.GOOGLE_CLOUD_API_KEY;
    else process.env.GOOGLE_CLOUD_API_KEY = previous;
  }
});

test("live Google Cloud handwriting and PDF read", async (t) => {
  if (!googleCloudOcrIsConfigured(process.env)) {
    t.skip("GOOGLE_CLOUD_API_KEY or a Google service account is not configured in this environment");
    return;
  }
  setGoogleCloudOcrFetch(null);
  clearGoogleCloudOcrCache();
  const imagePath = await writeHandwritingPng();
  const pdfPath = await writeImagePdf(imagePath);
  try {
    const image = await extractTextWithGoogleCloud({
      filePath: imagePath,
      mimeType: "image/png",
      env: process.env,
    });
    assert.ok(image?.text, "Live Vision/Document AI returned no handwriting image text");
    const pdf = await extractTextWithGoogleCloud({
      filePath: pdfPath,
      mimeType: "application/pdf",
      env: process.env,
    });
    assert.ok(pdf?.text, "Live Vision/Document AI returned no PDF text");
  } finally {
    fs.unlink(imagePath, () => {});
    fs.unlink(pdfPath, () => {});
  }
});
