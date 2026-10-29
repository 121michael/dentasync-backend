"use strict";

const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const AMETHYST = "#5b2a86";
const INK = "#2a2433";
const MUTED = "#5d5668";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const LOGO_CANDIDATES = [
  path.join(__dirname, "..", "assets", "amethyst-logo.png"),
  path.join(__dirname, "..", "..", "frontend", "public", "logo.png"),
];

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
  clinicalNotes,
}) {
  const clinic = snapshot?.clinic || {};
  const patient = snapshot?.patient || {};
  const dentist = snapshot?.dentist || {};
  const logoPath = findLogo();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: MARGIN,
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

    function drawChrome() {
      doc.save();
      doc.rect(0, 0, PAGE_WIDTH, 10).fill(AMETHYST);
      doc.restore();
      let headerY = 22;
      if (logoPath) {
        try {
          doc.image(logoPath, MARGIN, 18, { width: 52, height: 52, fit: [52, 52] });
        } catch {
          // continue without logo if the file cannot be decoded
        }
      }
      const textX = logoPath ? MARGIN + 62 : MARGIN;
      const textWidth = PAGE_WIDTH - textX - MARGIN;
      doc.fillColor(AMETHYST).font("Times-Bold").fontSize(16);
      doc.text(String(clinic.name || "Amethyst Dental Clinic").toUpperCase(), textX, headerY, {
        width: textWidth,
      });
      doc.fillColor(MUTED).font("Times-Roman").fontSize(9);
      doc.text(
        [clinic.address, clinic.phone, clinic.email].filter(Boolean).join("  ·  "),
        textX,
        doc.y,
        { width: textWidth }
      );
      doc.moveTo(MARGIN, 78).lineTo(PAGE_WIDTH - MARGIN, 78).strokeColor(AMETHYST).lineWidth(1.1).stroke();
      doc.y = 88;
    }

    function ensureSpace(needed = 90) {
      if (doc.y > PAGE_HEIGHT - needed) {
        doc.addPage();
        drawChrome();
        doc.fillColor(MUTED).font("Times-Roman").fontSize(8);
        doc.text(
          `${prescriptionNumber}  ·  version ${version}  ·  continued`,
          MARGIN,
          doc.y,
          { width: PAGE_WIDTH - MARGIN * 2 }
        );
        doc.moveDown(0.6);
      }
    }

    drawChrome();
    doc.fillColor(INK).font("Times-Bold").fontSize(14);
    doc.text("DENTAL PRESCRIPTION", MARGIN, doc.y, {
      align: "center",
      width: PAGE_WIDTH - MARGIN * 2,
    });
    doc.fillColor(MUTED).font("Times-Roman").fontSize(9);
    doc.text(`No. ${prescriptionNumber}   ·   Version ${version}`, {
      align: "center",
    });
    doc.moveDown(0.7);

    const col = (PAGE_WIDTH - MARGIN * 2) / 2;
    const startY = doc.y;
    doc.font("Times-Bold").fontSize(8).fillColor(MUTED).text("PATIENT", MARGIN, startY);
    doc.font("Times-Roman").fontSize(11).fillColor(INK).text(textOrDash(patient.fullName), MARGIN, startY + 12, {
      width: col - 10,
    });
    doc.font("Times-Roman").fontSize(9).fillColor(MUTED);
    doc.text(
      `ID ${textOrDash(patient.patientId)}  ·  Age ${textOrDash(patient.age)}  ·  Sex ${textOrDash(patient.sex)}`,
      MARGIN,
      doc.y,
      { width: col - 10 }
    );
    if (patient.dateOfBirth) {
      doc.text(`Birthdate ${formatDate(patient.dateOfBirth)}`, MARGIN, doc.y, { width: col - 10 });
    }
    const leftBottom = doc.y;
    doc.font("Times-Bold").fontSize(8).fillColor(MUTED).text("DATE", MARGIN + col, startY);
    doc.font("Times-Roman").fontSize(11).fillColor(INK).text(formatDate(authorizedAt || new Date()), MARGIN + col, startY + 12, {
      width: col - 10,
    });
    doc.y = Math.max(leftBottom, doc.y) + 10;
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor("#d9cce8").lineWidth(0.6).stroke();
    doc.moveDown(0.8);

    doc.fillColor(AMETHYST).font("Times-Bold").fontSize(28).text("Rx", MARGIN, doc.y);
    doc.moveDown(0.35);
    doc.fillColor(INK);

    (items || []).forEach((item, index) => {
      ensureSpace(110);
      doc.font("Times-Bold").fontSize(11).fillColor(INK);
      const title = [item.medicationName, item.strength].filter(Boolean).join("  ·  ");
      doc.text(`${index + 1}. ${title}`, MARGIN, doc.y, { width: PAGE_WIDTH - MARGIN * 2 });
      doc.font("Times-Roman").fontSize(10).fillColor(INK);
      const lines = [
        `Dosage: ${item.dosage}`,
        `Quantity: ${item.quantity}`,
        `Frequency: ${item.frequency}`,
        `Duration: ${item.duration}`,
        item.route ? `Route: ${item.route}` : null,
        `Sig: ${item.sig}`,
        item.additionalInstructions ? `Notes: ${item.additionalInstructions}` : null,
      ].filter(Boolean);
      lines.forEach((line) => {
        ensureSpace(28);
        doc.text(line, MARGIN + 16, doc.y, { width: PAGE_WIDTH - MARGIN * 2 - 16, lineGap: 1.5 });
      });
      doc.moveDown(0.45);
    });

    if (clinicalNotes) {
      ensureSpace(70);
      doc.font("Times-Bold").fontSize(9).fillColor(AMETHYST).text("CLINICAL NOTES", MARGIN, doc.y);
      doc.font("Times-Roman").fontSize(10).fillColor(INK).text(clinicalNotes, MARGIN, doc.y + 2, {
        width: PAGE_WIDTH - MARGIN * 2,
      });
    }

    if (snapshot?.includeExtractionAftercare) {
      ensureSpace(60);
      doc.font("Times-Bold").fontSize(9).fillColor(AMETHYST).text("TOOTH-EXTRACTION AFTERCARE", MARGIN, doc.y);
      doc.font("Times-Italic").fontSize(9).fillColor(MUTED).text(
        "Clinic-approved extraction aftercare wording is not on file in DentaSync. This flag was recorded but the aftercare block is omitted so unverified clinical instructions are not printed.",
        MARGIN,
        doc.y + 2,
        { width: PAGE_WIDTH - MARGIN * 2 }
      );
    }

    ensureSpace(130);
    doc.moveDown(1);
    doc.moveTo(MARGIN, doc.y).lineTo(PAGE_WIDTH - MARGIN, doc.y).strokeColor("#d9cce8").lineWidth(0.6).stroke();
    doc.moveDown(0.7);
    const sigWidth = 240;
    const sigX = PAGE_WIDTH - MARGIN - sigWidth;
    doc.font("Times-Bold").fontSize(8).fillColor(MUTED).text("PRESCRIBING DENTIST", sigX, doc.y, { width: sigWidth });
    doc.font("Times-Roman").fontSize(11).fillColor(INK).text(textOrDash(dentist.fullName), sigX, doc.y, { width: sigWidth });
    if (dentist.specialization) {
      doc.font("Times-Roman").fontSize(9).fillColor(MUTED).text(dentist.specialization, sigX, doc.y, { width: sigWidth });
    }
    doc.moveDown(1.1);
    doc.moveTo(sigX, doc.y).lineTo(sigX + sigWidth, doc.y).strokeColor(INK).lineWidth(0.8).stroke();
    doc.font("Times-Italic").fontSize(8).fillColor(MUTED).text(
      "Authorized in DentaSync by the dentist’s verified account. This line is not a reproduced handwritten signature.",
      sigX,
      doc.y + 6,
      { width: sigWidth }
    );
    doc.font("Times-Roman").fontSize(8).fillColor(MUTED).text(
      `Authorized ${formatDateTime(authorizedAt)}  ·  Method: authenticated dentist account`,
      sigX,
      doc.y + 4,
      { width: sigWidth }
    );

    doc.font("Times-Roman").fontSize(7.5).fillColor(MUTED);
    doc.text(
      `Integrity ${String(contentHash || "").slice(0, 16)}  ·  ${prescriptionNumber} v${version}. Generated for authorized clinic use. Do not copy as a blank prescription pad.`,
      MARGIN,
      PAGE_HEIGHT - 36,
      { width: PAGE_WIDTH - MARGIN * 2, align: "center" }
    );

    doc.end();
  });
}

module.exports = {
  generatePrescriptionPdf,
};
