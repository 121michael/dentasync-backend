"use strict";

const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

function reportFilename(format, generatedAt) {
  const day = String(generatedAt || new Date().toISOString()).slice(0, 10);
  const ext = format === "xlsx" ? "xlsx" : "pdf";
  return `DentaSync_General_Analytics_${day}.${ext}`;
}

function metricRows(data) {
  const summary = data.summary || {};
  const queue = data.queuePerformance || {};
  const ai = data.aiUsage?.summary || {};
  const rows = [
    ["Total clinic revenue", summary.totalRevenue],
    ["Patient satisfaction (%)", summary.patientSatisfaction],
    ["Total appointments", summary.totalAppointments],
    ["Completed appointments", summary.completedAppointments],
    ["Cancelled appointments", summary.cancelledAppointments],
    ["No-show appointments", summary.noShowAppointments],
    ["Patient growth", summary.patientGrowth],
    ["Queue active", queue.active ?? summary.queueActive],
    ["Queue completed", queue.completed ?? summary.queueCompleted],
    ["Average wait (minutes)", queue.averageWaitMinutes ?? summary.averageWaitMinutes],
    ["AI requests", ai.totalRequests],
    ["AI successful requests", ai.successfulRequests],
    ["AI failed requests", ai.failedRequests],
    ["AI active users", ai.activeUsers],
  ];
  if (ai.tokensAvailable) {
    rows.push(["AI input tokens", ai.inputTokens]);
    rows.push(["AI output tokens", ai.outputTokens]);
    rows.push(["AI total tokens", ai.totalTokens]);
  }
  if (ai.costAvailable) {
    rows.push(["Estimated AI API cost (USD)", ai.estimatedCostUsd]);
  }
  return rows;
}

function addSheet(workbook, name, headers, records) {
  const sheet = workbook.addWorksheet(name);
  sheet.columns = headers.map((header) => ({
    header: header.label,
    key: header.key,
    width: header.width || 22,
    style: header.numFmt ? { numFmt: header.numFmt } : undefined,
  }));
  sheet.getRow(1).font = { bold: true, color: { argb: "FF5B2A86" } };
  for (const record of records) {
    sheet.addRow(record);
  }
  return sheet;
}

async function buildExcel(data) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "DentaSync";
  workbook.created = new Date(data.generatedAt || Date.now());

  addSheet(
    workbook,
    "Summary",
    [
      { label: "Metric", key: "metric", width: 36 },
      { label: "Value", key: "value", width: 22 },
    ],
    [
      { metric: "Report title", value: "DentaSync General Analytics" },
      { metric: "Generated at", value: data.generatedAt },
      { metric: "Reporting period", value: data.periodLabel },
      ...metricRows(data).map(([metric, value]) => ({ metric, value })),
    ]
  );

  addSheet(
    workbook,
    "Revenue",
    [
      { label: "Period", key: "label", width: 18 },
      { label: "Revenue (PHP)", key: "value", width: 18, numFmt: "#,##0.00" },
    ],
    data.revenueByPeriod || []
  );

  const breakdown = data.appointmentBreakdown || {};
  addSheet(
    workbook,
    "Appointments",
    [
      { label: "Status", key: "status", width: 18 },
      { label: "Count", key: "count", width: 12 },
    ],
    Object.entries(breakdown).map(([status, count]) => ({ status, count }))
  );

  addSheet(
    workbook,
    "Patient Volume",
    [
      { label: "Date", key: "label", width: 16 },
      { label: "Visits", key: "count", width: 12 },
    ],
    data.patientVolume || []
  );

  addSheet(
    workbook,
    "Patient Growth",
    [
      { label: "Month", key: "label", width: 16 },
      { label: "New patients", key: "count", width: 16 },
    ],
    data.patientGrowth || []
  );

  addSheet(
    workbook,
    "Queue",
    [
      { label: "Metric", key: "metric", width: 28 },
      { label: "Value", key: "value", width: 14 },
    ],
    [
      { metric: "Active", value: data.queuePerformance?.active ?? 0 },
      { metric: "Completed", value: data.queuePerformance?.completed ?? 0 },
      { metric: "Average wait minutes", value: data.queuePerformance?.averageWaitMinutes ?? 0 },
    ]
  );

  addSheet(
    workbook,
    "Dentist Load",
    [
      { label: "Dentist", key: "dentist", width: 28 },
      { label: "Completed", key: "completed", width: 14 },
      { label: "Total", key: "total", width: 12 },
    ],
    data.dentistPerformance || []
  );

  const ai = data.aiUsage || {};
  const aiRows = [
    { field: "Reporting period", value: ai.periodLabel || data.periodLabel },
    { field: "Tracking available", value: ai.trackingAvailable ? "yes" : "no" },
    {
      field: "Tracking started at",
      value: ai.trackingStartedAt || "No recorded usage yet",
    },
    ...metricRows(data)
      .filter(([metric]) => String(metric).startsWith("AI "))
      .map(([field, value]) => ({ field, value })),
  ];
  for (const item of ai.byFeature || []) {
    aiRows.push({ field: `Feature: ${item.label}`, value: item.count });
  }
  for (const item of ai.byRole || []) {
    aiRows.push({ field: `Role: ${item.role}`, value: item.count });
  }
  addSheet(
    workbook,
    "AI Usage",
    [
      { label: "Field", key: "field", width: 36 },
      { label: "Value", key: "value", width: 28 },
    ],
    aiRows
  );

  if ((ai.requestsOverTime || []).length) {
    addSheet(
      workbook,
      "AI Requests Over Time",
      [
        { label: "Period", key: "label", width: 18 },
        { label: "Requests", key: "count", width: 12 },
      ],
      ai.requestsOverTime
    );
  }

  if ((ai.tokensOverTime || []).length) {
    addSheet(
      workbook,
      "AI Tokens Over Time",
      [
        { label: "Period", key: "label", width: 18 },
        { label: "Input tokens", key: "input", width: 16 },
        { label: "Output tokens", key: "output", width: 16 },
        { label: "Total tokens", key: "total", width: 16 },
      ],
      ai.tokensOverTime
    );
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

function writePdfSection(doc, title, lines) {
  doc.moveDown(0.6);
  doc.fontSize(13).fillColor("#5b2a86").text(title);
  doc.moveDown(0.2);
  doc.fontSize(10).fillColor("#2d2140");
  for (const line of lines) {
    doc.text(line);
  }
}

async function buildPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(20).fillColor("#5b2a86").text("DentaSync General Analytics");
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor("#5a4b6b");
    doc.text(`Generated: ${data.generatedAt}`);
    doc.text(`Reporting period: ${data.periodLabel}`);
    doc.text("Amethyst Dental Clinic");

    writePdfSection(
      doc,
      "Clinic metrics",
      metricRows(data).map(([label, value]) => `${label}: ${value ?? "—"}`)
    );

    const breakdown = data.appointmentBreakdown || {};
    writePdfSection(
      doc,
      "Appointment status",
      Object.entries(breakdown).map(([status, count]) => `${status}: ${count}`)
    );

    writePdfSection(
      doc,
      "Queue performance",
      [
        `Active: ${data.queuePerformance?.active ?? 0}`,
        `Completed: ${data.queuePerformance?.completed ?? 0}`,
        `Average wait (minutes): ${data.queuePerformance?.averageWaitMinutes ?? 0}`,
      ]
    );

    const dentists = (data.dentistPerformance || []).slice(0, 20);
    writePdfSection(
      doc,
      "Dentist completion load",
      dentists.length
        ? dentists.map((entry) => `${entry.dentist}: ${entry.completed} completed / ${entry.total} total`)
        : ["No dentist performance data for this range."]
    );

    const ai = data.aiUsage || {};
    const aiLines = [
      `Period: ${ai.periodLabel || data.periodLabel}`,
      ai.trackingAvailable
        ? `Tracking started: ${ai.trackingStartedAt || "No events recorded yet"}`
        : "Usage tracking table is not installed.",
      `Total AI requests: ${ai.summary?.totalRequests ?? 0}`,
      `Successful: ${ai.summary?.successfulRequests ?? 0}`,
      `Failed: ${ai.summary?.failedRequests ?? 0}`,
      `Active AI users: ${ai.summary?.activeUsers ?? 0}`,
    ];
    if (ai.summary?.tokensAvailable) {
      aiLines.push(`Input tokens: ${ai.summary.inputTokens}`);
      aiLines.push(`Output tokens: ${ai.summary.outputTokens}`);
      aiLines.push(`Total tokens: ${ai.summary.totalTokens}`);
    } else {
      aiLines.push("Token usage: not reported by the provider for recorded requests.");
    }
    if (ai.summary?.costAvailable) {
      aiLines.push(`Estimated API cost (USD): ${ai.summary.estimatedCostUsd}`);
    }
    for (const item of ai.byFeature || []) {
      aiLines.push(`${item.label}: ${item.count}`);
    }
    writePdfSection(doc, "AI Usage", aiLines);

    if ((data.revenueByPeriod || []).length) {
      writePdfSection(
        doc,
        "Revenue by period",
        data.revenueByPeriod.map((item) => `${item.label}: ${item.value}`)
      );
    }

    doc.end();
  });
}

async function renderAdminAnalyticsExport(data, format) {
  const filename = reportFilename(format, data.generatedAt);
  if (format === "xlsx") {
    return {
      filename,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: await buildExcel(data),
    };
  }
  return {
    filename,
    contentType: "application/pdf",
    buffer: await buildPdf(data),
  };
}

module.exports = {
  reportFilename,
  renderAdminAnalyticsExport,
};
