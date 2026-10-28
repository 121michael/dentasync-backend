"use strict";

const PDFDocument = require("pdfkit");

const AMETHYST = "#5b2a86";
const INK = "#2a2433";
const MUTED = "#5d5668";
const RULE = "#cfc3dd";
const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 54;

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
  }).format(date);
}

function statusLabel(status) {
  const map = {
    draft: "Draft — not signed",
    awaiting_signature: "Awaiting patient signature",
    signed: "Signed",
    superseded: "Superseded",
    voided: "Voided",
  };
  return map[status] || String(status || "Draft");
}

function drawHeader(doc, clinic, documentNumber) {
  doc.save();
  doc.rect(0, 0, PAGE_WIDTH, 8).fill(AMETHYST);
  doc.restore();

  doc.fillColor(AMETHYST).font("Times-Bold").fontSize(16);
  doc.text(String(clinic.name || "Amethyst Dental Clinic").toUpperCase(), MARGIN, 28, {
    align: "center",
    width: PAGE_WIDTH - MARGIN * 2,
  });
  doc.fillColor(MUTED).font("Times-Roman").fontSize(9);
  const contact = [clinic.address, clinic.phone, clinic.email].filter(Boolean).join("  ·  ");
  if (contact) {
    doc.text(contact, MARGIN, doc.y + 2, { align: "center", width: PAGE_WIDTH - MARGIN * 2 });
  }
  if (clinic.operatingHours) {
    doc.text(clinic.operatingHours, MARGIN, doc.y, { align: "center", width: PAGE_WIDTH - MARGIN * 2 });
  }
  doc.moveTo(MARGIN, doc.y + 10).lineTo(PAGE_WIDTH - MARGIN, doc.y + 10).strokeColor(AMETHYST).lineWidth(1).stroke();
  doc.moveDown(1.2);
  doc.fillColor(INK).font("Times-Bold").fontSize(13);
  doc.text("AUTHORIZATION AND INFORMED CONSENT FOR DENTAL PROCEDURE", MARGIN, doc.y, {
    align: "center",
    width: PAGE_WIDTH - MARGIN * 2,
  });
  doc.fillColor(MUTED).font("Times-Roman").fontSize(9);
  doc.text(`Document No. ${textOrDash(documentNumber)}`, { align: "center" });
  doc.moveDown(0.6);
}

function sectionTitle(doc, title) {
  if (doc.y > PAGE_HEIGHT - 140) doc.addPage();
  doc.x = MARGIN;
  doc.moveDown(0.35);
  doc.fillColor(AMETHYST).font("Times-Bold").fontSize(10).text(title.toUpperCase(), MARGIN, doc.y, {
    width: PAGE_WIDTH - MARGIN * 2,
  });
  doc.moveTo(MARGIN, doc.y + 2).lineTo(PAGE_WIDTH - MARGIN, doc.y + 2).strokeColor(RULE).lineWidth(0.6).stroke();
  doc.moveDown(0.45);
  doc.fillColor(INK);
  doc.x = MARGIN;
}

function fieldRow(doc, pairs) {
  const colWidth = (PAGE_WIDTH - MARGIN * 2) / pairs.length;
  const startY = doc.y;
  let maxY = startY;
  pairs.forEach((pair, index) => {
    const x = MARGIN + colWidth * index;
    doc.font("Times-Bold").fontSize(8).fillColor(MUTED).text(pair.label, x, startY, { width: colWidth - 8 });
    doc.font("Times-Roman").fontSize(10).fillColor(INK).text(textOrDash(pair.value), x, startY + 11, {
      width: colWidth - 8,
    });
    maxY = Math.max(maxY, doc.y);
  });
  doc.x = MARGIN;
  doc.y = maxY + 8;
}

function bodyParagraph(doc, text) {
  doc.x = MARGIN;
  doc.font("Times-Roman").fontSize(10).fillColor(INK).text(text, MARGIN, doc.y, {
    align: "justify",
    lineGap: 2,
    width: PAGE_WIDTH - MARGIN * 2,
  });
  doc.moveDown(0.45);
  doc.x = MARGIN;
}

function signatureBlock(doc, title, nameValue) {
  if (doc.y > PAGE_HEIGHT - 130) doc.addPage();
  const y = doc.y + 8;
  doc.font("Times-Bold").fontSize(9).fillColor(AMETHYST).text(title, MARGIN, y);
  doc.strokeColor(INK).lineWidth(0.7);
  doc.moveTo(MARGIN, y + 42).lineTo(MARGIN + 220, y + 42).stroke();
  doc.font("Times-Roman").fontSize(8).fillColor(MUTED).text("Signature", MARGIN, y + 46);
  doc.moveTo(MARGIN + 250, y + 42).lineTo(PAGE_WIDTH - MARGIN, y + 42).stroke();
  doc.font("Times-Roman").fontSize(8).fillColor(MUTED).text("Name / Date", MARGIN + 250, y + 46);
  if (nameValue) {
    doc.font("Times-Italic").fontSize(10).fillColor(INK).text(nameValue, MARGIN + 250, y + 24, {
      width: PAGE_WIDTH - MARGIN * 2 - 250,
    });
  }
  doc.y = y + 68;
}

async function renderAuthorizationPdf(payload) {
  const clinic = payload.clinic || {};
  const doc = payload.document || payload;

  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({
      size: "A4",
      compress: false,
      margins: { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 36 },
      bufferPages: true,
      info: {
        Title: "Authorization and Informed Consent for Dental Procedure",
        Author: String(clinic.name || "Amethyst Dental Clinic"),
        Subject: "Dental procedure authorization (clinic template pending dentist/legal review)",
      },
    });
    const chunks = [];
    pdf.on("data", (chunk) => chunks.push(chunk));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);

    drawHeader(pdf, clinic, doc.documentNumber);

    sectionTitle(pdf, "Patient information");
    fieldRow(pdf, [
      { label: "Full name", value: doc.patientFullName },
      { label: "Patient ID", value: doc.patientClinicId },
    ]);
    fieldRow(pdf, [
      { label: "Date of birth", value: formatDate(doc.patientDateOfBirth) },
      { label: "Age", value: doc.patientAge },
      { label: "Contact number", value: doc.patientPhone },
    ]);

    sectionTitle(pdf, "Dental procedure information");
    fieldRow(pdf, [
      { label: "Procedure / treatment", value: doc.procedureName },
      { label: "Tooth number / treatment area", value: doc.toothOrArea },
    ]);
    fieldRow(pdf, [
      { label: "Treating dentist", value: doc.treatingDentist },
      { label: "Planned procedure date", value: formatDate(doc.plannedProcedureDate) },
    ]);
    if (doc.clinicalNotes) {
      pdf.font("Times-Bold").fontSize(8).fillColor(MUTED).text("Relevant clinical notes");
      bodyParagraph(pdf, doc.clinicalNotes);
    }

    sectionTitle(pdf, "Explanation and consent");
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Proposed procedure");
    bodyParagraph(pdf, doc.explanation);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Expected benefits");
    bodyParagraph(pdf, doc.expectedBenefits);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Material risks");
    bodyParagraph(pdf, doc.materialRisks);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Relevant alternatives");
    bodyParagraph(pdf, doc.alternatives);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Questions");
    bodyParagraph(pdf, doc.questionsOpportunity);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Voluntary authorization");
    bodyParagraph(pdf, doc.voluntaryAuthorization);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Withdrawal of consent");
    bodyParagraph(pdf, doc.withdrawalStatement);
    pdf.font("Times-Bold").fontSize(9).fillColor(INK).text("Confirmation of understanding");
    bodyParagraph(pdf, doc.understandingConfirmation);

    sectionTitle(pdf, "Signatures");
    signatureBlock(
      pdf,
      "Patient or authorized representative",
      [doc.patientOrRepresentativeName, doc.representativeRelationship, formatDateTime(doc.patientSignedAt)]
        .filter((part) => part && part !== "—")
        .join(" · ")
    );
    signatureBlock(pdf, "Treating dentist", [doc.dentistName, formatDateTime(doc.dentistSignedAt)].filter((part) => part && part !== "—").join(" · "));
    signatureBlock(
      pdf,
      "Witness / guardian (if applicable)",
      [doc.witnessName && `Witness: ${doc.witnessName}`, doc.guardianName && `Guardian: ${doc.guardianName}`]
        .filter(Boolean)
        .join(" · ")
    );

    sectionTitle(pdf, "Recordkeeping");
    fieldRow(pdf, [
      { label: "Document status", value: statusLabel(doc.status) },
      { label: "Version", value: String(doc.version || 1) },
      { label: "Consent date / time", value: formatDateTime(doc.consentRecordedAt || doc.patientSignedAt) },
    ]);
    fieldRow(pdf, [
      { label: "Prepared by", value: doc.createdByRole ? `${doc.createdByRole}` : "—" },
      { label: "Upload date", value: formatDateTime(doc.uploadedAt) },
    ]);

    pdf.font("Times-Italic").fontSize(8).fillColor(MUTED).text(
      "This is a clinic template for recordkeeping. It is not a substitute for a dentist-to-patient discussion of procedure-specific risks and alternatives. The responsible dentist (and any required legal adviser) must review this wording before it is used with patients. Generating or uploading this form does not, by itself, constitute legally sufficient informed consent.",
      { align: "justify", lineGap: 1.5 }
    );

    const range = pdf.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
      pdf.switchToPage(i);
      pdf.page.margins = { top: MARGIN, left: MARGIN, right: MARGIN, bottom: 0 };
      pdf.rect(0, PAGE_HEIGHT - 6, PAGE_WIDTH, 6).fill(AMETHYST);
      pdf.fillColor(MUTED).font("Times-Roman").fontSize(8);
      pdf.text(`Page ${i + 1} of ${range.count}`, 0, PAGE_HEIGHT - 18, {
        width: PAGE_WIDTH,
        align: "center",
        lineBreak: false,
      });
    }

    pdf.end();
  });
}

module.exports = {
  renderAuthorizationPdf,
  statusLabel,
  formatDate,
};
