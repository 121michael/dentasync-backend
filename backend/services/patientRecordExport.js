"use strict";

const ExcelJS = require("exceljs");

const MAX_EXPORT_ROWS = 10000;

const EXPORT_COLUMNS = [
  { key: "patientId", header: "Patient ID", width: 18, kind: "text" },
  { key: "recordCode", header: "Record code", width: 22, kind: "text" },
  { key: "firstName", header: "First name", width: 18, kind: "text" },
  { key: "lastName", header: "Last name", width: 18, kind: "text" },
  { key: "gender", header: "Sex", width: 12, kind: "text" },
  { key: "dateOfBirth", header: "Date of birth", width: 16, kind: "date" },
  { key: "age", header: "Age", width: 8, kind: "number" },
  { key: "phone", header: "Phone", width: 18, kind: "text" },
  { key: "email", header: "Email", width: 28, kind: "text" },
  { key: "address", header: "Address", width: 32, kind: "text" },
  { key: "emergencyContactName", header: "Emergency contact", width: 22, kind: "text" },
  { key: "emergencyContactRelationship", header: "Emergency contact relationship", width: 28, kind: "text" },
  { key: "emergencyContactPhone", header: "Emergency contact phone", width: 22, kind: "text" },
  { key: "allergies", header: "Allergies", width: 24, kind: "text" },
  { key: "existingConditions", header: "Existing conditions", width: 24, kind: "text" },
  { key: "currentMedications", header: "Current medications", width: 24, kind: "text" },
  { key: "dentalConcerns", header: "Dental concerns", width: 24, kind: "text" },
  { key: "lastTreatment", header: "Last treatment", width: 22, kind: "text" },
  { key: "lastTreatmentDate", header: "Last treatment date", width: 20, kind: "date" },
  { key: "patientCategory", header: "Patient category", width: 18, kind: "text" },
  { key: "createdAt", header: "Record created", width: 16, kind: "date" },
  { key: "updatedAt", header: "Record updated", width: 16, kind: "date" },
];

function textValue(value) {
  if (value == null) return "";
  return String(value);
}

function calendarDate(value) {
  if (!value) return null;
  const source = value instanceof Date ? value.toISOString() : String(value);
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== match[0]) {
    return null;
  }
  return parsed;
}

function exportPhone(record) {
  const stored = textValue(record?.storedPhone).trim();
  if (stored) return stored;
  return textValue(record?.phone).trim();
}

function columnValue(record, column) {
  if (column.key === "patientId") {
    return textValue(record.patientId || record.recordCode || record.id);
  }
  if (column.key === "phone") return exportPhone(record);
  if (column.key === "emergencyContactPhone") return textValue(record.emergencyContactPhone);
  if (column.kind === "number") {
    const number = Number(record.age);
    return Number.isFinite(number) ? number : null;
  }
  if (column.kind === "date") return calendarDate(record[column.key]);
  return textValue(record[column.key]);
}

function writeCell(cell, column, record) {
  const value = columnValue(record, column);
  if (column.kind === "date") {
    cell.value = value;
    cell.numFmt = "yyyy-mm-dd";
    return;
  }
  if (column.kind === "number") {
    cell.value = value;
    cell.numFmt = "0";
    return;
  }
  cell.value = value == null ? "" : String(value);
  cell.numFmt = "@";
}

function previewRecord(record) {
  return {
    id: record.id,
    patientId: textValue(record.patientId || record.recordCode || record.id),
    fullName: textValue(record.fullName).trim(),
    gender: textValue(record.gender),
  };
}

async function buildPatientRecordsWorkbook(records) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DentaSync";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Patient Records");
  sheet.columns = EXPORT_COLUMNS.map((column) => ({
    header: column.header,
    key: column.key,
    width: column.width,
  }));
  sheet.getRow(1).font = { bold: true };
  records.forEach((record, index) => {
    const row = sheet.getRow(index + 2);
    for (const column of EXPORT_COLUMNS) {
      writeCell(row.getCell(column.key), column, record);
    }
    row.commit();
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: Math.max(records.length, 1) + 1, column: EXPORT_COLUMNS.length },
  };
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function exportFilename(generatedAt = new Date()) {
  const day = generatedAt.toISOString().slice(0, 10);
  return `DentaSync_Patient_Records_${day}.xlsx`;
}

module.exports = {
  MAX_EXPORT_ROWS,
  EXPORT_COLUMNS,
  previewRecord,
  buildPatientRecordsWorkbook,
  exportFilename,
  columnValue,
};
