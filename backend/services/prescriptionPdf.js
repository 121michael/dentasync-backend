"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { EXTRACTION_AFTERCARE, RX_PAD_HEADER } = require("./prescriptionAftercare");

const NAVY = "#1b2a6b";
const INK = "#111111";
const MUTED = "#333333";
const RULE = "#222222";
// ISO A4 portrait: 210 mm × 297 mm. PDFKit "A4" is 595.28 × 841.89 pt.
const PAGE_SIZE = "A4";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const RX_GUTTER = 78;
const LOGO_CANDIDATES = [
  path.join(__dirname, "..", "assets", "amethyst-logo.png"),
  path.join(__dirname, "..", "..", "frontend", "public", "logo.png"),
];
const AFTERCARE_BLOCK = 168;
const SIGNATURE_BLOCK = 108;
const FOOTER_RESERVE = 22;

function textOrDash(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

function formatDate(value) {
  if (!value) return "—";
  const raw = String(value);
  const day = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00`) : new Date(day);
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return new Intl.DateTimeFormat("en-PH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(date);
}

function formatDateTime(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return textOrDash(value);
  return new Intl.DateTimeFormat("en-PH", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Manila",
  }).format(date);
}

function findLogo() {
  return LOGO_CANDIDATES.find((candidate) => fs.existsSync(candidate)) || null;
}

function readPdfMediaBoxes(pdfBuffer) {
  const source = Buffer.isBuffer(pdfBuffer) ? pdfBuffer.toString("latin1") : String(pdfBuffer);
  const boxes = [];
  const pattern = /\/MediaBox\s*\[\s*([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s*\]/g;
  let match = pattern.exec(source);
  while (match) {
    boxes.push({
      x: Number(match[1]),
      y: Number(match[2]),
      width: Number(match[3]) - Number(match[1]),
      height: Number(match[4]) - Number(match[2]),
    });
    match = pattern.exec(source);
  }
  return boxes;
}

function formatQuantity(value) {
  const text = textOrDash(value);
  if (text === "—") return "#";
  return text.startsWith("#") ? text : `#${text.replace(/^#\s*/, "")}`;
}

function formatSig(value) {
  const text = textOrDash(value);
  if (text === "—") return "Sig:";
  return /^sig\s*:/i.test(text) ? text : `Sig: ${text}`;
}

function padDentistLine(dentist) {
  const raw = textOrDash(dentist.fullName).replace(/^dr\.?\s+/i, "");
  const designation = String(dentist.professionalDesignation || dentist.professional_designation || "DMD").trim();
  const name = raw === "—" ? "—" : raw.toUpperCase();
  return designation ? `${name}, ${designation}` : name;
}

function medicationLines(item) {
  const name = item.medicationName || "Medication";
  const quantity = formatQuantity(item.quantity);
  const strength = String(item.strength || item.dosage || "").trim();
  const sig = formatSig(item.sig);
  const extra = String(item.additionalInstructions || "").trim();
  return { name, quantity, strength, sig, extra };
}

function generatePrescriptionPdf({
  prescriptionNumber,
  version,
  contentHash,
  authorizedAt,
  snapshot,
  items,
}) {
  const patient = snapshot?.patient || {};
  const dentist = snapshot?.dentist || {};
  const logoPath = findLogo();
  const showAftercare = Boolean(snapshot?.includeExtractionAftercare);
  const medicationItems = Array.isArray(items) ? items : [];

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: PAGE_SIZE,
      layout: "portrait",
      margins: { top: 0, left: 0, right: 0, bottom: 0 },
      bufferPages: true,
      info: {
        Title: `Prescription ${prescriptionNumber}`,
        Author: "Amethyst Dental Clinic",
        Subject: "Authorized dental prescription",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const usableBottom = PAGE_HEIGHT - MARGIN - FOOTER_RESERVE;
    const medLeft = MARGIN + RX_GUTTER;
    const medWidth = PAGE_WIDTH - MARGIN - medLeft;
    const qtyWidth = 70;
    const nameWidth = medWidth - qtyWidth;

    function medicationBlockHeight(item) {
      const lines = medicationLines(item);
      doc.font("Times-Bold").fontSize(12);
      const nameH = doc.heightOfString(lines.name, { width: nameWidth });
      let height = Math.max(nameH, 14) + 2;
      if (lines.strength) {
        doc.font("Times-Roman").fontSize(11);
        height += doc.heightOfString(lines.strength, { width: medWidth }) + 2;
      }
      doc.font("Times-Italic").fontSize(11);
      height += doc.heightOfString(lines.sig, { width: medWidth, lineGap: 1.5 }) + 4;
      if (lines.extra) {
        doc.font("Times-Roman").fontSize(10);
        height += doc.heightOfString(lines.extra, { width: medWidth, lineGap: 1.4 }) + 2;
      }
      return height + 16;
    }

    function drawHeader(top) {
      const logoSize = 52;
      const titleWidth = 280;
      const groupWidth = logoPath ? logoSize + 12 + titleWidth : titleWidth;
      const groupX = MARGIN + (CONTENT_WIDTH - groupWidth) / 2;
      if (logoPath) {
        try {
          doc.image(logoPath, groupX, top, {
            fit: [logoSize, logoSize],
            align: "center",
            valign: "center",
          });
        } catch {
          // continue without logo if the file cannot be decoded
        }
      }
      const textX = logoPath ? groupX + logoSize + 12 : groupX;
      doc.fillColor(INK).font("Times-Bold").fontSize(22);
      doc.text(RX_PAD_HEADER.name, textX, top + 2, { width: titleWidth, align: "left" });
      const barY = top + 28;
      const barWidth = Math.min(168, titleWidth);
      doc.save();
      doc.rect(textX, barY, barWidth, 16).fill(NAVY);
      doc.fillColor("#fff").font("Times-Bold").fontSize(9);
      doc.text(RX_PAD_HEADER.bar, textX, barY + 3.4, { width: barWidth, align: "center" });
      doc.restore();

      const addressY = top + 58;
      doc.fillColor(INK).font("Times-Roman").fontSize(9);
      doc.text(RX_PAD_HEADER.address1, MARGIN, addressY, { width: CONTENT_WIDTH, align: "center" });
      doc.text(RX_PAD_HEADER.address2, MARGIN, doc.y, { width: CONTENT_WIDTH, align: "center" });
      doc.font("Times-Roman").fontSize(9);
      doc.text(RX_PAD_HEADER.phones, MARGIN, doc.y + 1, { width: CONTENT_WIDTH, align: "center" });
      const ruleY = doc.y + 10;
      doc
        .moveTo(MARGIN, ruleY)
        .lineTo(PAGE_WIDTH - MARGIN, ruleY)
        .strokeColor(RULE)
        .lineWidth(1.15)
        .stroke();
      doc.y = ruleY + 14;
    }

    function fieldLine(label, value, x, y, width, labelWidth) {
      doc.font("Times-Roman").fontSize(10).fillColor(INK);
      doc.text(label, x, y, { width: labelWidth, lineBreak: false });
      const textX = x + labelWidth + 4;
      const textWidth = width - labelWidth - 4;
      const display = value == null || String(value).trim() === "" ? "" : String(value).trim();
      doc.font("Times-Roman").fontSize(11);
      const textH = display ? doc.heightOfString(display, { width: textWidth }) : 12;
      if (display) {
        doc.text(display, textX, y - 1, { width: textWidth });
      }
      const lineY = y + Math.max(textH, 12) + 1;
      doc
        .moveTo(textX, lineY)
        .lineTo(x + width, lineY)
        .strokeColor(RULE)
        .lineWidth(0.5)
        .stroke();
      return lineY + 8;
    }

    function drawPatientBlock() {
      const y = doc.y;
      const nameWidth = CONTENT_WIDTH * 0.52;
      const ageWidth = CONTENT_WIDTH * 0.22;
      const sexWidth = CONTENT_WIDTH * 0.26;
      const row1 = Math.max(
        fieldLine("Patient's Name:", textOrDash(patient.fullName), MARGIN, y, nameWidth, 82),
        fieldLine("Age:", textOrDash(patient.age), MARGIN + nameWidth + 8, y, ageWidth - 8, 24),
        fieldLine("Sex:", textOrDash(patient.sex), MARGIN + nameWidth + ageWidth + 8, y, sexWidth - 8, 24)
      );
      const addrWidth = CONTENT_WIDTH * 0.62;
      const dateWidth = CONTENT_WIDTH * 0.38;
      const row2 = Math.max(
        fieldLine("Address:", textOrDash(patient.address), MARGIN, row1, addrWidth, 48),
        fieldLine("Date:", formatDate(authorizedAt || new Date()), MARGIN + addrWidth + 8, row1, dateWidth - 8, 28)
      );
      doc.y = row2 + 8;
    }

    function drawRxMark() {
      const rxY = doc.y;
      doc.fillColor(INK).font("Times-BoldItalic").fontSize(42);
      doc.text("Rx", MARGIN, rxY, { width: RX_GUTTER - 8, lineBreak: false });
      doc.y = rxY;
    }

    function startContinuationPage() {
      doc.addPage({ size: PAGE_SIZE, layout: "portrait", margins: { top: 0, left: 0, right: 0, bottom: 0 } });
      drawHeader(MARGIN);
      doc.fillColor(MUTED).font("Times-Roman").fontSize(8);
      doc.text(`${prescriptionNumber}  ·  version ${version}  ·  continued`, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: "center",
      });
      doc.moveDown(0.5);
      drawRxMark();
    }

    function ensureMedicationSpace(needed) {
      if (doc.y + needed + SIGNATURE_BLOCK <= usableBottom) return;
      startContinuationPage();
    }

    function drawMedications() {
      const rxTop = doc.y;
      drawRxMark();
      let y = rxTop + 8;
      medicationItems.forEach((item) => {
        const lines = medicationLines(item);
        const needed = medicationBlockHeight(item);
        if (y + needed + SIGNATURE_BLOCK > usableBottom) {
          startContinuationPage();
          y = doc.y + 8;
        }
        doc.font("Times-Bold").fontSize(12).fillColor(INK);
        doc.text(lines.name, medLeft, y, { width: nameWidth });
        const nameBottom = doc.y;
        doc.font("Times-Bold").fontSize(12);
        doc.text(lines.quantity, medLeft + nameWidth, y, { width: qtyWidth, align: "right" });
        y = Math.max(nameBottom, y + 14) + 1;
        if (lines.strength) {
          doc.font("Times-Roman").fontSize(11);
          doc.text(lines.strength, medLeft, y, { width: medWidth });
          y = doc.y + 2;
        }
        doc.font("Times-Italic").fontSize(11);
        doc.text(lines.sig, medLeft, y, { width: medWidth, lineGap: 1.5 });
        y = doc.y + 2;
        if (lines.extra) {
          doc.font("Times-Roman").fontSize(10);
          doc.text(lines.extra, medLeft, y, { width: medWidth, lineGap: 1.4 });
          y = doc.y + 2;
        }
        y += 14;
        doc.y = y;
      });
      if (!medicationItems.length) {
        doc.y = rxTop + 48;
      }
    }

    function drawSignature() {
      const sigWidth = 220;
      const sigX = PAGE_WIDTH - MARGIN - sigWidth;
      const reserved = SIGNATURE_BLOCK + (showAftercare ? AFTERCARE_BLOCK : 0);
      if (doc.y + reserved > usableBottom) {
        startContinuationPage();
      }
      const sigY = Math.max(doc.y + 28, usableBottom - reserved - 8);
      doc.font("Times-Bold").fontSize(11).fillColor(INK);
      doc.text(padDentistLine(dentist), sigX, sigY, { width: sigWidth, align: "center" });
      doc.font("Times-Roman").fontSize(10);
      doc.text(`Lic. No. ${textOrDash(dentist.licenseNumber || dentist.license_number)}`, sigX, doc.y + 2, {
        width: sigWidth,
        align: "center",
      });
      doc.text(`PTR No. ${textOrDash(dentist.ptrNumber || dentist.ptr_number)}`, sigX, doc.y, {
        width: sigWidth,
        align: "center",
      });
      const lineY = doc.y + 28;
      doc.moveTo(sigX + 18, lineY).lineTo(sigX + sigWidth - 18, lineY).strokeColor(INK).lineWidth(0.7).stroke();
      doc.font("Times-Italic").fontSize(8).fillColor(MUTED);
      doc.text("Signature", sigX, lineY + 4, { width: sigWidth, align: "center" });
      if (authorizedAt) {
        doc.font("Times-Roman").fontSize(7.5);
        doc.text(`Authorized ${formatDateTime(authorizedAt)}`, sigX, doc.y + 2, {
          width: sigWidth,
          align: "center",
        });
      }
      doc.y = lineY + 36;
    }

    function drawAftercare() {
      if (doc.y + AFTERCARE_BLOCK > usableBottom) {
        startContinuationPage();
      }
      const y = Math.max(doc.y + 8, usableBottom - AFTERCARE_BLOCK);
      doc.save();
      doc.rect(MARGIN, y, CONTENT_WIDTH, 18).fill(NAVY);
      doc.fillColor("#fff").font("Times-Bold").fontSize(8);
      doc.text(EXTRACTION_AFTERCARE.title, MARGIN, y + 4.6, {
        width: CONTENT_WIDTH,
        align: "center",
      });
      const colW = (CONTENT_WIDTH - 16) / 2;
      const colY = y + 24;
      doc.fillColor(INK).font("Times-Bold").fontSize(8);
      doc.text(EXTRACTION_AFTERCARE.dosHeading, MARGIN + 4, colY, { width: colW });
      doc.font("Times-Roman").fontSize(7);
      EXTRACTION_AFTERCARE.dos.forEach((line) => {
        doc.text(`• ${line}`, MARGIN + 4, doc.y, { width: colW, lineGap: 0.7 });
      });
      doc.font("Times-Bold").fontSize(8);
      doc.text(EXTRACTION_AFTERCARE.dontsHeading, MARGIN + 12 + colW, colY, { width: colW });
      doc.font("Times-Roman").fontSize(7);
      let dontY = colY + 11;
      EXTRACTION_AFTERCARE.donts.forEach((line) => {
        doc.text(`• ${line}`, MARGIN + 12 + colW, dontY, { width: colW, lineGap: 0.7 });
        dontY = doc.y;
      });
      doc.restore();
    }

    drawHeader(MARGIN);
    drawPatientBlock();
    drawMedications();
    drawSignature();
    if (showAftercare) drawAftercare();

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font("Times-Roman").fontSize(7).fillColor(MUTED);
      doc.text(
        `${prescriptionNumber} v${version}  ·  integrity ${String(contentHash || "").slice(0, 16)}  ·  Authorized clinic use only`,
        MARGIN,
        PAGE_HEIGHT - 18,
        { width: CONTENT_WIDTH, align: "center", lineBreak: false, height: 10 }
      );
    }

    doc.end();
  });
}

async function rasterizePrescriptionPdf(pdfBuffer) {
  const { PDFParse } = require("pdf-parse");
  const sharp = require("sharp");
  const parser = new PDFParse({ data: pdfBuffer });
  try {
    const shots = await parser.getScreenshot({
      imageBuffer: true,
      imageDataUrl: false,
      scale: 2.2,
    });
    const pages = [];
    for (const page of shots.pages || []) {
      if (!page?.data?.length) continue;
      const jpeg = await sharp(Buffer.from(page.data)).jpeg({ quality: 90 }).toBuffer();
      pages.push(jpeg);
    }
    return pages;
  } finally {
    await parser.destroy();
  }
}

module.exports = {
  generatePrescriptionPdf,
  rasterizePrescriptionPdf,
  readPdfMediaBoxes,
  PAGE_SIZE,
  PAGE_WIDTH,
  PAGE_HEIGHT,
};
