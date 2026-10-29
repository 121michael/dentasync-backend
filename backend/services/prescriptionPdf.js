"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");
const { EXTRACTION_AFTERCARE, RX_PAD_HEADER } = require("./prescriptionAftercare");

const AMETHYST = "#5b2a86";
const INK = "#1c1c1c";
const MUTED = "#444444";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;
const LOGO_CANDIDATES = [
  path.join(__dirname, "..", "assets", "amethyst-logo.png"),
  path.join(__dirname, "..", "..", "frontend", "public", "logo.png"),
];
const AFTERCARE_BLOCK = 188;
const SIGNATURE_BLOCK = 84;
const FOOTER_RESERVE = 28;

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
  const closingBlock = SIGNATURE_BLOCK + (showAftercare ? AFTERCARE_BLOCK : 0) + FOOTER_RESERVE;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margins: { top: 28, left: MARGIN, right: MARGIN, bottom: 0 },
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

    function drawHeader() {
      const logoSize = 62;
      if (logoPath) {
        try {
          doc.image(logoPath, MARGIN, 28, { fit: [logoSize, logoSize], align: "center", valign: "center" });
        } catch {
          // continue without logo if the file cannot be decoded
        }
      }
      const textX = logoPath ? MARGIN + logoSize + 12 : MARGIN;
      const textWidth = PAGE_WIDTH - textX - MARGIN;
      doc.fillColor(INK).font("Times-Bold").fontSize(22);
      doc.text(RX_PAD_HEADER.name, textX, 30, { width: textWidth, align: "center" });
      const barY = 56;
      const barWidth = Math.min(220, textWidth);
      const barX = textX + (textWidth - barWidth) / 2;
      doc.save();
      doc.rect(barX, barY, barWidth, 16).fill(AMETHYST);
      doc.fillColor("#fff").font("Times-Bold").fontSize(9);
      doc.text(RX_PAD_HEADER.bar, barX, barY + 3.5, { width: barWidth, align: "center" });
      doc.restore();
      doc.fillColor(INK).font("Times-Roman").fontSize(8.5);
      doc.text(RX_PAD_HEADER.address1, textX, 78, { width: textWidth, align: "center" });
      doc.text(RX_PAD_HEADER.address2, textX, doc.y, { width: textWidth, align: "center" });
      doc.text(`Tel. ${RX_PAD_HEADER.phones}`, textX, doc.y, { width: textWidth, align: "center" });
      const ruleY = 118;
      doc.moveTo(MARGIN, ruleY).lineTo(PAGE_WIDTH - MARGIN, ruleY).strokeColor(INK).lineWidth(2.2).stroke();
      doc.y = ruleY + 14;
    }

    function drawPatientBlock() {
      const col = (PAGE_WIDTH - MARGIN * 2) / 2;
      const y = doc.y;
      doc.font("Times-Bold").fontSize(10).fillColor(INK);
      doc.text("Patient's Name:", MARGIN, y, { continued: true });
      doc.font("Times-Roman").text(`  ${textOrDash(patient.fullName)}`, { width: col - 8 });
      const nameBottom = doc.y;
      doc.font("Times-Bold").text("Age:", MARGIN + col, y, { continued: true });
      doc.font("Times-Roman").text(`  ${textOrDash(patient.age)}`);
      doc.font("Times-Bold").text("Sex:", MARGIN + col + 90, y, { continued: true });
      doc.font("Times-Roman").text(`  ${textOrDash(patient.sex)}`);
      doc.y = Math.max(nameBottom, doc.y) + 6;
      const y2 = doc.y;
      doc.font("Times-Bold").text("Address:", MARGIN, y2, { continued: true });
      doc.font("Times-Roman").text(`  ${textOrDash(patient.address)}`, { width: col + 40 });
      const addrBottom = doc.y;
      doc.font("Times-Bold").text("Date:", MARGIN + col, y2, { continued: true });
      doc.font("Times-Roman").text(`  ${formatDate(authorizedAt || new Date())}`);
      doc.y = Math.max(addrBottom, doc.y) + 10;
      doc.fillColor(AMETHYST).font("Times-BoldItalic").fontSize(42);
      doc.text("Rx", MARGIN, doc.y);
      doc.fillColor(INK);
      doc.moveDown(0.35);
    }

    function startContinuationPage() {
      doc.addPage();
      drawHeader();
      doc.fillColor(MUTED).font("Times-Roman").fontSize(8);
      doc.text(`${prescriptionNumber}  ·  version ${version}  ·  continued`, MARGIN, doc.y, {
        width: PAGE_WIDTH - MARGIN * 2,
      });
      doc.moveDown(0.5);
      doc.fillColor(AMETHYST).font("Times-BoldItalic").fontSize(28).text("Rx", MARGIN, doc.y);
      doc.fillColor(INK);
      doc.moveDown(0.3);
    }

    function ensureMedicationSpace(needed) {
      if (doc.y + needed + closingBlock < PAGE_HEIGHT - 8) return;
      startContinuationPage();
    }

    function drawMedications() {
      (items || []).forEach((item, index) => {
        const name = item.medicationName || "Medication";
        const details = [
          `Qty: ${item.quantity}`,
          `Dosage: ${item.dosage}`,
          `Sig: ${item.sig}`,
        ].join("    ");
        ensureMedicationSpace(72);
        doc.font("Times-Bold").fontSize(11).fillColor(INK);
        doc.text(`${index + 1}. ${name}`, MARGIN + 8, doc.y, {
          width: PAGE_WIDTH - MARGIN * 2 - 8,
        });
        doc.font("Times-Roman").fontSize(10).fillColor(INK);
        doc.text(details, MARGIN + 22, doc.y, {
          width: PAGE_WIDTH - MARGIN * 2 - 22,
          lineGap: 2,
        });
        doc.moveDown(0.45);
      });
    }

    function drawSignature() {
      if (doc.y + closingBlock > PAGE_HEIGHT - 12) {
        startContinuationPage();
      }
      const sigWidth = 220;
      const sigX = PAGE_WIDTH - MARGIN - sigWidth;
      const y = Math.max(doc.y + 18, PAGE_HEIGHT - closingBlock);
      doc.font("Times-Bold").fontSize(11).fillColor(INK);
      doc.text(textOrDash(dentist.fullName).toUpperCase(), sigX, y, { width: sigWidth, align: "center" });
      if (dentist.specialization) {
        doc.font("Times-Roman").fontSize(9).fillColor(MUTED);
        doc.text(dentist.specialization, sigX, doc.y, { width: sigWidth, align: "center" });
      }
      if (dentist.licenseNumber) {
        doc.font("Times-Roman").fontSize(9).fillColor(INK);
        doc.text(`Lic. No. ${dentist.licenseNumber}`, sigX, doc.y, { width: sigWidth, align: "center" });
      }
      const lineY = doc.y + 18;
      doc.moveTo(sigX + 20, lineY).lineTo(sigX + sigWidth - 20, lineY).strokeColor(INK).lineWidth(0.7).stroke();
      doc.font("Times-Italic").fontSize(7.5).fillColor(MUTED);
      doc.text(
        "Authorized in DentaSync by the authenticated dentist account. This line is not a reproduced handwritten signature.",
        sigX,
        lineY + 4,
        { width: sigWidth, align: "center" }
      );
      doc.font("Times-Roman").fontSize(7.5);
      doc.text(`Authorized ${formatDateTime(authorizedAt)}`, sigX, doc.y, { width: sigWidth, align: "center" });
    }

    function drawAftercare() {
      const y = PAGE_HEIGHT - AFTERCARE_BLOCK - FOOTER_RESERVE;
      doc.page.margins.bottom = 0;
      doc.save();
      doc.rect(MARGIN, y, PAGE_WIDTH - MARGIN * 2, 22).fill(AMETHYST);
      doc.fillColor("#fff").font("Helvetica-Bold").fontSize(9);
      doc.text(EXTRACTION_AFTERCARE.title, MARGIN, y + 6.5, {
        width: PAGE_WIDTH - MARGIN * 2,
        align: "center",
      });
      const colW = (PAGE_WIDTH - MARGIN * 2 - 16) / 2;
      const colY = y + 28;
      doc.fillColor(INK).font("Times-Bold").fontSize(8);
      doc.text(EXTRACTION_AFTERCARE.dosHeading, MARGIN + 4, colY, { width: colW });
      doc.font("Times-Roman").fontSize(7.4);
      EXTRACTION_AFTERCARE.dos.forEach((line) => {
        doc.text(`• ${line}`, MARGIN + 4, doc.y, { width: colW, lineGap: 1.1 });
      });
      doc.font("Times-Bold").fontSize(8);
      doc.text(EXTRACTION_AFTERCARE.dontsHeading, MARGIN + 12 + colW, colY, { width: colW });
      doc.font("Times-Roman").fontSize(7.4);
      let dontY = colY + 12;
      EXTRACTION_AFTERCARE.donts.forEach((line) => {
        doc.text(`• ${line}`, MARGIN + 12 + colW, dontY, { width: colW, lineGap: 1.1 });
        dontY = doc.y;
      });
      doc.restore();
    }

    drawHeader();
    drawPatientBlock();
    drawMedications();
    drawSignature();
    if (showAftercare) drawAftercare();

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i += 1) {
      doc.switchToPage(i);
      doc.page.margins.bottom = 0;
      doc.font("Times-Roman").fontSize(7).fillColor(MUTED);
      doc.text(
        `${prescriptionNumber} v${version}  ·  integrity ${String(contentHash || "").slice(0, 16)}  ·  Authorized clinic use only`,
        MARGIN,
        PAGE_HEIGHT - 14,
        { width: PAGE_WIDTH - MARGIN * 2, align: "center", lineBreak: false, height: 10 }
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
      scale: 2,
    });
    const pages = [];
    for (const page of shots.pages || []) {
      if (!page?.data?.length) continue;
      const jpeg = await sharp(Buffer.from(page.data)).jpeg({ quality: 88 }).toBuffer();
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
};
