"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { EXTRACTION_AFTERCARE, RX_PAD_HEADER } = require("./prescriptionAftercare");

const AMETHYST = "#5b2a86";
const INK = "#1c1c1c";
const MUTED = "#444444";
// ISO A5 portrait: 148 mm × 210 mm. PDFKit "A5" is 419.53 × 595.28 pt.
const PAGE_SIZE = "A5";
const PAGE_WIDTH = 419.53;
const PAGE_HEIGHT = 595.28;
const MARGIN = 28;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LOGO_CANDIDATES = [
  path.join(__dirname, "..", "assets", "amethyst-logo.png"),
  path.join(__dirname, "..", "..", "frontend", "public", "logo.png"),
];
const AFTERCARE_BLOCK = 176;
const SIGNATURE_BLOCK = 78;
const FOOTER_RESERVE = 18;

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

    function medicationBlockHeight(item, index) {
      const name = `${index + 1}. ${item.medicationName || "Medication"}`;
      const details = [`Qty: ${item.quantity}`, `Dosage: ${item.dosage}`, `Sig: ${item.sig}`].join("    ");
      doc.font("Times-Bold").fontSize(10);
      const nameH = doc.heightOfString(name, { width: CONTENT_WIDTH - 6 });
      doc.font("Times-Roman").fontSize(9);
      const detailsH = doc.heightOfString(details, { width: CONTENT_WIDTH - 16, lineGap: 1.4 });
      return nameH + detailsH + 8;
    }

    function patientBlockHeight() {
      doc.font("Times-Bold").fontSize(9);
      const nameLine = `Patient's Name:  ${textOrDash(patient.fullName)}`;
      const addrLine = `Address:  ${textOrDash(patient.address)}`;
      const nameH = doc.heightOfString(nameLine, { width: CONTENT_WIDTH / 2 - 6 });
      const addrH = doc.heightOfString(addrLine, { width: CONTENT_WIDTH * 0.58 });
      return nameH + 8 + addrH + 36;
    }

    const headerHeight = 96;
    const rxHeight = 34;
    const signatureHeight = SIGNATURE_BLOCK;
    const aftercareHeight = showAftercare ? AFTERCARE_BLOCK : 0;
    const medicationsHeight = medicationItems.reduce(
      (sum, item, index) => sum + medicationBlockHeight(item, index),
      0
    );
    const bodyHeight =
      headerHeight + patientBlockHeight() + rxHeight + medicationsHeight + 12 + signatureHeight + aftercareHeight;
    const available = usableBottom - MARGIN;
    const originY = bodyHeight <= available ? MARGIN + (available - bodyHeight) / 2 : MARGIN;

    function drawHeader(top) {
      const logoSize = 48;
      const brandingLeft = logoPath ? MARGIN + logoSize + 10 : MARGIN;
      const brandingWidth = PAGE_WIDTH - brandingLeft - MARGIN;
      if (logoPath) {
        try {
          doc.image(logoPath, MARGIN, top, {
            fit: [logoSize, logoSize],
            align: "center",
            valign: "center",
          });
        } catch {
          // continue without logo if the file cannot be decoded
        }
      }
      doc.fillColor(INK).font("Times-Bold").fontSize(16);
      doc.text(RX_PAD_HEADER.name, brandingLeft, top + 2, { width: brandingWidth, align: "center" });
      const barWidth = Math.min(168, brandingWidth);
      const barX = brandingLeft + (brandingWidth - barWidth) / 2;
      const barY = top + 22;
      doc.save();
      doc.rect(barX, barY, barWidth, 13).fill(AMETHYST);
      doc.fillColor("#fff").font("Times-Bold").fontSize(7.5);
      doc.text(RX_PAD_HEADER.bar, barX, barY + 2.6, { width: barWidth, align: "center" });
      doc.restore();
      doc.fillColor(INK).font("Times-Roman").fontSize(7);
      doc.text(RX_PAD_HEADER.address1, brandingLeft, top + 40, { width: brandingWidth, align: "center" });
      doc.text(RX_PAD_HEADER.address2, brandingLeft, doc.y, { width: brandingWidth, align: "center" });
      doc.text(`Tel. ${RX_PAD_HEADER.phones}`, brandingLeft, doc.y, { width: brandingWidth, align: "center" });
      const ruleY = top + 82;
      doc
        .moveTo(MARGIN, ruleY)
        .lineTo(PAGE_WIDTH - MARGIN, ruleY)
        .strokeColor(INK)
        .lineWidth(1.6)
        .stroke();
      doc.y = ruleY + 10;
    }

    function drawPatientBlock() {
      const col = CONTENT_WIDTH / 2;
      const y = doc.y;
      doc.font("Times-Bold").fontSize(9).fillColor(INK);
      doc.text("Patient's Name:", MARGIN, y, { width: 78, lineBreak: false });
      doc.font("Times-Roman").text(textOrDash(patient.fullName), MARGIN + 80, y, { width: col - 84 });
      const nameBottom = doc.y;
      doc.font("Times-Bold").text("Age:", MARGIN + col, y, { width: 24, lineBreak: false });
      doc.font("Times-Roman").text(textOrDash(patient.age), MARGIN + col + 26, y, { width: 36 });
      doc.font("Times-Bold").text("Sex:", MARGIN + col + 68, y, { width: 24, lineBreak: false });
      doc.font("Times-Roman").text(textOrDash(patient.sex), MARGIN + col + 94, y, { width: col - 98 });
      doc.y = Math.max(nameBottom, y + 12) + 5;
      const y2 = doc.y;
      doc.font("Times-Bold").text("Address:", MARGIN, y2, { width: 48, lineBreak: false });
      doc.font("Times-Roman").text(textOrDash(patient.address), MARGIN + 50, y2, { width: col - 54 });
      const addrBottom = doc.y;
      doc.font("Times-Bold").text("Date:", MARGIN + col, y2, { width: 28, lineBreak: false });
      doc.font("Times-Roman").text(formatDate(authorizedAt || new Date()), MARGIN + col + 30, y2, {
        width: col - 34,
      });
      doc.y = Math.max(addrBottom, y2 + 12) + 8;
    }

    function drawRxMark(size) {
      doc.fillColor(AMETHYST).font("Times-BoldItalic").fontSize(size);
      doc.text("Rx", MARGIN, doc.y);
      doc.fillColor(INK);
      doc.moveDown(0.28);
    }

    function startContinuationPage() {
      doc.addPage({ size: PAGE_SIZE, layout: "portrait", margins: { top: 0, left: 0, right: 0, bottom: 0 } });
      drawHeader(MARGIN);
      doc.fillColor(MUTED).font("Times-Roman").fontSize(7.5);
      doc.text(`${prescriptionNumber}  ·  version ${version}  ·  continued`, MARGIN, doc.y, {
        width: CONTENT_WIDTH,
        align: "center",
      });
      doc.moveDown(0.35);
      drawRxMark(22);
    }

    function ensureMedicationSpace(needed) {
      if (doc.y + needed + signatureHeight <= usableBottom) return;
      startContinuationPage();
    }

    function drawMedications() {
      medicationItems.forEach((item, index) => {
        const name = `${index + 1}. ${item.medicationName || "Medication"}`;
        const details = [`Qty: ${item.quantity}`, `Dosage: ${item.dosage}`, `Sig: ${item.sig}`].join("    ");
        ensureMedicationSpace(medicationBlockHeight(item, index) + 4);
        doc.font("Times-Bold").fontSize(10).fillColor(INK);
        doc.text(name, MARGIN + 4, doc.y, { width: CONTENT_WIDTH - 6 });
        doc.font("Times-Roman").fontSize(9).fillColor(INK);
        doc.text(details, MARGIN + 14, doc.y, {
          width: CONTENT_WIDTH - 16,
          lineGap: 1.4,
        });
        doc.moveDown(0.35);
      });
    }

    function drawSignature() {
      const sigWidth = 190;
      const sigX = PAGE_WIDTH - MARGIN - sigWidth;
      const reserved = signatureHeight + aftercareHeight;
      if (doc.y + reserved > usableBottom) {
        startContinuationPage();
      }
      const sigY =
        bodyHeight <= available
          ? doc.y + 12
          : Math.max(doc.y + 12, usableBottom - reserved);
      doc.font("Times-Bold").fontSize(10).fillColor(INK);
      doc.text(textOrDash(dentist.fullName).toUpperCase(), sigX, sigY, { width: sigWidth, align: "center" });
      if (dentist.specialization) {
        doc.font("Times-Roman").fontSize(8).fillColor(MUTED);
        doc.text(dentist.specialization, sigX, doc.y, { width: sigWidth, align: "center" });
      }
      if (dentist.licenseNumber) {
        doc.font("Times-Roman").fontSize(8).fillColor(INK);
        doc.text(`Lic. No. ${dentist.licenseNumber}`, sigX, doc.y, { width: sigWidth, align: "center" });
      }
      const lineY = doc.y + 14;
      doc.moveTo(sigX + 16, lineY).lineTo(sigX + sigWidth - 16, lineY).strokeColor(INK).lineWidth(0.6).stroke();
      doc.font("Times-Italic").fontSize(6.5).fillColor(MUTED);
      doc.text(
        "Authorized in DentaSync by the authenticated dentist account. This line is not a reproduced handwritten signature.",
        sigX,
        lineY + 3,
        { width: sigWidth, align: "center" }
      );
      doc.font("Times-Roman").fontSize(6.5);
      doc.text(`Authorized ${formatDateTime(authorizedAt)}`, sigX, doc.y, { width: sigWidth, align: "center" });
    }

    function drawAftercare() {
      if (doc.y + AFTERCARE_BLOCK > usableBottom) {
        startContinuationPage();
      }
      const y = doc.y + 10;
      doc.save();
      doc.rect(MARGIN, y, CONTENT_WIDTH, 16).fill(AMETHYST);
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(7.2);
      doc.text(EXTRACTION_AFTERCARE.title, MARGIN, y + 4.2, {
        width: CONTENT_WIDTH,
        align: "center",
      });
      const colW = (CONTENT_WIDTH - 12) / 2;
      const colY = y + 20;
      doc.fillColor(INK).font("Times-Bold").fontSize(7);
      doc.text(EXTRACTION_AFTERCARE.dosHeading, MARGIN + 2, colY, { width: colW });
      doc.font("Times-Roman").fontSize(6.3);
      EXTRACTION_AFTERCARE.dos.forEach((line) => {
        doc.text(`• ${line}`, MARGIN + 2, doc.y, { width: colW, lineGap: 0.6 });
      });
      doc.font("Times-Bold").fontSize(7);
      doc.text(EXTRACTION_AFTERCARE.dontsHeading, MARGIN + 10 + colW, colY, { width: colW });
      doc.font("Times-Roman").fontSize(6.3);
      let dontY = colY + 10;
      EXTRACTION_AFTERCARE.donts.forEach((line) => {
        doc.text(`• ${line}`, MARGIN + 10 + colW, dontY, { width: colW, lineGap: 0.6 });
        dontY = doc.y;
      });
      doc.restore();
    }

    drawHeader(originY);
    drawPatientBlock();
    drawRxMark(32);
    drawMedications();
    drawSignature();
    if (showAftercare) drawAftercare();

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.font("Times-Roman").fontSize(6.5).fillColor(MUTED);
      doc.text(
        `${prescriptionNumber} v${version}  ·  integrity ${String(contentHash || "").slice(0, 16)}  ·  Authorized clinic use only`,
        MARGIN,
        PAGE_HEIGHT - 16,
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
      scale: 2.4,
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
