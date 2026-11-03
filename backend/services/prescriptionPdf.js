"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { EXTRACTION_AFTERCARE, RX_PAD_HEADER } = require("./prescriptionAftercare");

const NAVY = "#1b2a6b";
const INK = "#111111";
const MUTED = "#333333";
const RULE = "#222222";
// ISO A5 portrait: 148 mm × 210 mm. PDFKit "A5" is 419.53 × 595.28 pt.
const PAGE_SIZE = "A5";
const PAGE_WIDTH = 419.53;
const PAGE_HEIGHT = 595.28;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const RX_FONT_SIZE = 42;
const LINE_SPACING = 1.5;
const QTY_CHAR_GAP = 16;
const FONT = {
  patientLabel: 12,
  patientValue: 13,
  medication: 14,
  dosage: 13,
  sig: 13,
  extra: 12,
  dentistName: 13,
  dentistMeta: 12,
  issued: 10,
  validity: 10,
  integrity: 8,
  continued: 10,
};
const VALIDITY_NOTE =
  "This document is valid without signature, and valid 24hrs after the issuance";
const LOGO_CANDIDATES = [
  path.join(__dirname, "..", "assets", "amethyst-logo.png"),
  path.join(__dirname, "..", "..", "frontend", "public", "logo.png"),
];
const AFTERCARE_BLOCK = 132;
const DENTIST_BLOCK = 72;
const FOOTER_RESERVE = 42;

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

function formatDosage(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  return /^dosage\s*:/i.test(text) ? text : `Dosage: ${text}`;
}

function medicationLines(item) {
  const name = item.medicationName || "Medication";
  const quantity = formatQuantity(item.quantity);
  const strength = formatDosage(item.strength || item.dosage);
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
    let medLeft = MARGIN;
    let medWidth = CONTENT_WIDTH;

    function lineGapFor(fontSize) {
      return fontSize * (LINE_SPACING - 1);
    }

    function wrapHeight(text, width, fontSize) {
      return doc.heightOfString(text, { width, lineGap: lineGapFor(fontSize) });
    }

    function nameQtyLayout(lines) {
      doc.font("Times-Bold").fontSize(FONT.medication);
      const qtyWidth = Math.max(doc.widthOfString(lines.quantity), doc.widthOfString("#00"));
      const gap = doc.widthOfString(" ") * QTY_CHAR_GAP;
      const maxNameWidth = Math.max(48, medWidth - qtyWidth - gap);
      const naturalNameWidth = doc.widthOfString(lines.name);
      const compactNameCap = doc.widthOfString("Amoxicillin clavu");
      const nameWidth = Math.min(naturalNameWidth, compactNameCap, maxNameWidth);
      const qtyX = medLeft + nameWidth + gap;
      return { nameWidth, qtyWidth, qtyX, gap };
    }

    function medicationBlockHeight(item) {
      const lines = medicationLines(item);
      const layout = nameQtyLayout(lines);
      doc.font("Times-Bold").fontSize(FONT.medication);
      let height = wrapHeight(lines.name, layout.nameWidth, FONT.medication);
      if (lines.strength) {
        doc.font("Times-Roman").fontSize(FONT.dosage);
        height += wrapHeight(lines.strength, medWidth, FONT.dosage) + 2;
      }
      doc.font("Times-Italic").fontSize(FONT.sig);
      height += wrapHeight(lines.sig, medWidth, FONT.sig) + 2;
      if (lines.extra) {
        doc.font("Times-Roman").fontSize(FONT.extra);
        height += wrapHeight(lines.extra, medWidth, FONT.extra) + 2;
      }
      return height + 8;
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
      doc.font("Times-Roman").fontSize(FONT.patientLabel).fillColor(INK);
      doc.text(label, x, y, { width: labelWidth, lineBreak: false });
      const textX = x + labelWidth + 4;
      const textWidth = width - labelWidth - 4;
      const display = value == null || String(value).trim() === "" ? "" : String(value).trim();
      doc.font("Times-Roman").fontSize(FONT.patientValue);
      const textH = display
        ? doc.heightOfString(display, { width: textWidth, lineGap: lineGapFor(FONT.patientValue) })
        : FONT.patientValue * LINE_SPACING;
      if (display) {
        doc.text(display, textX, y - 1, {
          width: textWidth,
          lineGap: lineGapFor(FONT.patientValue),
        });
      }
      const lineY = y + Math.max(textH, FONT.patientValue * LINE_SPACING) + 1;
      doc
        .moveTo(textX, lineY)
        .lineTo(x + width, lineY)
        .strokeColor(RULE)
        .lineWidth(0.5)
        .stroke();
      return lineY + 6;
    }

    function drawPatientBlock() {
      const y = doc.y;
      const nameWidth = CONTENT_WIDTH * 0.58;
      const ageWidth = CONTENT_WIDTH * 0.2;
      const sexWidth = CONTENT_WIDTH * 0.22;
      const row1 = Math.max(
        fieldLine("Patient's Name:", textOrDash(patient.fullName), MARGIN, y, nameWidth, 88),
        fieldLine("Age:", textOrDash(patient.age), MARGIN + nameWidth + 6, y, ageWidth - 6, 28),
        fieldLine("Sex:", textOrDash(patient.sex), MARGIN + nameWidth + ageWidth + 6, y, sexWidth - 6, 28)
      );
      const addrWidth = CONTENT_WIDTH * 0.54;
      const dateWidth = CONTENT_WIDTH * 0.46;
      const row2 = Math.max(
        fieldLine("Address:", textOrDash(patient.address), MARGIN, row1, addrWidth, 52),
        fieldLine("Date:", formatDate(authorizedAt || new Date()), MARGIN + addrWidth + 6, row1, dateWidth - 6, 32)
      );
      doc.y = row2 + 6;
    }

    function measureRx(rxY) {
      doc.font("Times-BoldItalic").fontSize(RX_FONT_SIZE);
      const width = doc.widthOfString("Rx");
      const height = Math.max(doc.currentLineHeight(), RX_FONT_SIZE * 0.9);
      return {
        x: MARGIN,
        y: rxY,
        width,
        height,
        right: MARGIN + width,
        bottom: rxY + height,
      };
    }

    function applyRxAlignment(rx) {
      medLeft = rx.right;
      medWidth = PAGE_WIDTH - MARGIN - medLeft;
      doc.y = rx.bottom + 6;
    }

    function drawRxMark() {
      const rx = measureRx(doc.y);
      doc.fillColor(INK).font("Times-BoldItalic").fontSize(RX_FONT_SIZE);
      doc.text("Rx", rx.x, rx.y, { width: rx.width + 4, lineBreak: false });
      applyRxAlignment(rx);
      return rx;
    }

    function startContinuationPage() {
      doc.addPage({ size: PAGE_SIZE, layout: "portrait", margins: { top: 0, left: 0, right: 0, bottom: 0 } });
      drawHeader(MARGIN);
      doc.fillColor(MUTED).font("Times-Roman").fontSize(FONT.continued);
      doc.text(`${prescriptionNumber}  ·  version ${version}  ·  continued`, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: "center",
      });
      doc.moveDown(0.35);
      drawRxMark();
    }

    function drawMedications() {
      drawRxMark();
      let y = doc.y;
      medicationItems.forEach((item) => {
        const lines = medicationLines(item);
        const needed = medicationBlockHeight(item);
        if (y + needed + DENTIST_BLOCK > usableBottom) {
          startContinuationPage();
          y = doc.y;
        }
        const layout = nameQtyLayout(lines);
        doc.font("Times-Bold").fontSize(FONT.medication).fillColor(INK);
        doc.text(lines.name, medLeft, y, {
          width: layout.nameWidth,
          lineGap: lineGapFor(FONT.medication),
        });
        const nameBottom = doc.y;
        doc.font("Times-Bold").fontSize(FONT.medication);
        doc.text(lines.quantity, layout.qtyX, y, {
          width: layout.qtyWidth,
          align: "left",
          lineBreak: false,
        });
        y = Math.max(nameBottom, y + FONT.medication * LINE_SPACING) + 1;
        if (lines.strength) {
          doc.font("Times-Roman").fontSize(FONT.dosage);
          doc.text(lines.strength, medLeft, y, {
            width: medWidth,
            lineGap: lineGapFor(FONT.dosage),
          });
          y = doc.y + 2;
        }
        doc.font("Times-Italic").fontSize(FONT.sig);
        doc.text(lines.sig, medLeft, y, {
          width: medWidth,
          lineGap: lineGapFor(FONT.sig),
        });
        y = doc.y + 2;
        if (lines.extra) {
          doc.font("Times-Roman").fontSize(FONT.extra);
          doc.text(lines.extra, medLeft, y, {
            width: medWidth,
            lineGap: lineGapFor(FONT.extra),
          });
          y = doc.y + 2;
        }
        y += 8;
        doc.y = y;
      });
    }

    function drawDentistBlock() {
      const blockWidth = Math.min(220, CONTENT_WIDTH * 0.72);
      const blockX = PAGE_WIDTH - MARGIN - blockWidth;
      if (doc.y + DENTIST_BLOCK > usableBottom) {
        startContinuationPage();
      }
      const blockY = doc.y + 14;
      doc.font("Times-Bold").fontSize(FONT.dentistName).fillColor(INK);
      doc.text(padDentistLine(dentist), blockX, blockY, { width: blockWidth, align: "center" });
      doc.font("Times-Roman").fontSize(FONT.dentistMeta);
      doc.text(`PTR No. ${textOrDash(dentist.ptrNumber || dentist.ptr_number)}`, blockX, doc.y + 3, {
        width: blockWidth,
        align: "center",
      });
      if (authorizedAt) {
        doc.font("Times-Roman").fontSize(FONT.issued).fillColor(MUTED);
        doc.text(`Issued ${formatDateTime(authorizedAt)}`, blockX, doc.y + 3, {
          width: blockWidth,
          align: "center",
        });
      }
      doc.y = doc.y + 8;
    }

    function drawAftercare() {
      if (doc.y + AFTERCARE_BLOCK > usableBottom) {
        startContinuationPage();
      }
      const y = doc.y + 8;
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
    drawDentistBlock();
    if (showAftercare) drawAftercare();

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font("Times-Italic").fontSize(FONT.validity).fillColor(INK);
      doc.text(VALIDITY_NOTE, MARGIN, PAGE_HEIGHT - 36, {
        width: CONTENT_WIDTH,
        align: "center",
        lineBreak: false,
        height: 14,
      });
      doc.font("Times-Roman").fontSize(FONT.integrity).fillColor(MUTED);
      doc.text(
        `${prescriptionNumber} v${version}  ·  integrity ${String(contentHash || "").slice(0, 16)}  ·  Authorized clinic use only`,
        MARGIN,
        PAGE_HEIGHT - 20,
        { width: CONTENT_WIDTH, align: "center", lineBreak: false, height: 11 }
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
