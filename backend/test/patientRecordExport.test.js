"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const express = require("express");
const ExcelJS = require("exceljs");
const { createAdminPortalRouter } = require("../routes/adminPortal");
const { EXPORT_COLUMNS } = require("../services/patientRecordExport");

const SECRET = "synthetic-auth-secret-do-not-export";
const NOTE = "synthetic-clinical-note-do-not-export";

function syntheticRows() {
  return [
    {
      id: 11,
      record_code: "CPR-00011",
      first_name: "=Mira",
      last_name: "Santos",
      email: "mira@example.test",
      phone: "09170001111",
      patient_id: "00042",
      gender: "Female",
      date_of_birth: "1990-04-02",
      address: "+Quezon City",
      allergies: "@none",
      existing_conditions: "",
      current_medications: "",
      dental_concerns: "",
      emergency_contact_name: "Ana",
      emergency_contact_relationship: "Mother",
      emergency_contact_phone: "09180002222",
      notes: NOTE,
      password_hash: SECRET,
      password: SECRET,
      reset_token: SECRET,
      is_archived: false,
      created_at: "2026-01-15T02:00:00.000Z",
      updated_at: "2026-02-01T02:00:00.000Z",
      last_treatment: "Cleaning",
      last_treatment_date: "2026-02-01",
      age: 36,
    },
    {
      id: 12,
      record_code: "CPR-00012",
      first_name: "Luis",
      last_name: "Reyes",
      email: "luis@example.test",
      phone: "09170003333",
      patient_id: "00077",
      gender: "Male",
      date_of_birth: "1988-11-09",
      address: "Manila",
      notes: NOTE,
      password_hash: SECRET,
      is_archived: false,
      created_at: "2026-03-01T00:00:00.000Z",
      updated_at: "2026-03-02T00:00:00.000Z",
      last_treatment: "Filling",
      last_treatment_date: "2026-03-02",
      age: 37,
    },
    {
      id: 13,
      record_code: "CPR-00013",
      first_name: "Other",
      last_name: "Patient",
      email: "other@example.test",
      phone: "09170004444",
      patient_id: "00088",
      gender: "Female",
      date_of_birth: "2001-01-01",
      is_archived: false,
      age: 25,
    },
  ];
}

function matchesSearch(row, pattern) {
  if (!pattern) return true;
  const term = String(pattern).replaceAll("%", "").toLowerCase();
  return [row.first_name, row.last_name, row.email, row.phone, row.record_code, row.id, row.linked_user_id]
    .join(" ")
    .toLowerCase()
    .includes(term);
}

async function startPortal({ databaseRole = "admin", userId = "admin-1" } = {}) {
  const seen = [];
  const db = {
    async query(sql, params = []) {
      seen.push(sql);
      if (sql.includes("FROM users") && sql.includes("LOWER(role) = 'admin'")) {
        if (databaseRole !== "admin") return { rows: [] };
        return {
          rows: [
            {
              id: userId,
              first_name: "Ada",
              last_name: "Admin",
              email: "ada@example.test",
              phone: "09170000000",
              role: "admin",
              status: "Active",
              is_verified: true,
              password_hash: SECRET,
              created_at: "2026-01-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO admin_portal_audit_logs") || sql.includes("admin_portal_document_sync_jobs")) {
        return { rows: [{ id: 1 }] };
      }
      if (sql.includes("FROM clinic_patient_records")) {
        const pattern = params.find((value) => typeof value === "string" && value.includes("%"));
        let rows = syntheticRows().filter((row) => matchesSearch(row, pattern));
        if (pattern && String(pattern).includes("overflow")) {
          rows = Array.from({ length: 10001 }, (_, index) => ({
            id: index + 1,
            record_code: `CPR-${index + 1}`,
            first_name: "Pat",
            last_name: String(index + 1),
            phone: "09170000000",
            patient_id: String(index + 1).padStart(5, "0"),
            gender: "Female",
            date_of_birth: "1990-01-01",
          }));
        }
        const paged = /LIMIT \$\d+ OFFSET \$\d+/.test(sql);
        if (paged) {
          const limit = Number(params[params.length - 2]);
          const offset = Number(params[params.length - 1]);
          rows = rows.slice(offset, offset + limit);
        }
        return { rows };
      }
      throw new Error(`Unexpected test query: ${sql}`);
    },
  };

  const app = express();
  app.use(
    "/api/admin",
    createAdminPortalRouter({
      db,
      emailDeliveryIsConfigured: () => false,
      authenticateToken(req, _res, next) {
        if (!userId) return next();
        req.user = { id: userId, role: "staff" };
        return next();
      },
    })
  );
  const server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return {
    seen,
    url: `http://127.0.0.1:${server.address().port}/api/admin`,
    async close() {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

test("patient record workbook keeps text, dates, and leaves out authentication data", async () => {
  const portal = await startPortal();
  try {
    const preview = await fetch(`${portal.url}/clinical-records/export/preview?search=${encodeURIComponent("Mira")}`);
    assert.equal(preview.status, 200);
    const listed = await preview.json();
    assert.equal(listed.total, 1);
    assert.equal(listed.records[0].patientId, "00042");
    assert.equal(listed.records[0].fullName, "=Mira Santos");
    assert.equal(JSON.stringify(listed).includes(SECRET), false);
    assert.equal(JSON.stringify(listed).includes(NOTE), false);

    const response = await fetch(`${portal.url}/clinical-records/export.xlsx?search=${encodeURIComponent("Mira")}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /spreadsheetml/i);
    assert.match(response.headers.get("content-disposition"), /DentaSync_Patient_Records_/);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(bytes.includes(Buffer.from(SECRET)), false);
    assert.equal(bytes.includes(Buffer.from(NOTE)), false);
    assert.equal(/LIMIT \$\d+ OFFSET \$\d+/.test(portal.seen.find((sql) => sql.includes("export") || sql.includes("clinic_patient_records")) || ""), false);
    const exportSql = portal.seen.filter((sql) => sql.includes("FROM clinic_patient_records"));
    assert.equal(exportSql.some((sql) => /LIMIT \$\d+ OFFSET \$\d+/.test(sql)), false);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    const sheet = workbook.getWorksheet("Patient Records");
    assert.ok(sheet);
    assert.deepEqual(
      EXPORT_COLUMNS.map((column) => column.header),
      sheet.getRow(1).values.slice(1)
    );
    const columnIndex = Object.fromEntries(EXPORT_COLUMNS.map((column, index) => [column.key, index + 1]));
    const row = sheet.getRow(2);
    const cell = (key) => row.getCell(columnIndex[key]);
    const patientId = cell("patientId");
    const phone = cell("phone");
    const firstName = cell("firstName");
    const address = cell("address");
    const allergies = cell("allergies");
    const birth = cell("dateOfBirth");
    assert.equal(patientId.value, "00042");
    assert.equal(patientId.numFmt, "@");
    assert.equal(phone.value, "09170001111");
    assert.equal(phone.numFmt, "@");
    assert.equal(cell("emergencyContactPhone").value, "09180002222");
    assert.equal(firstName.value, "=Mira");
    assert.notEqual(firstName.type, ExcelJS.ValueType.Formula);
    assert.equal(address.value, "+Quezon City");
    assert.notEqual(address.type, ExcelJS.ValueType.Formula);
    assert.equal(allergies.value, "@none");
    assert.equal(birth.numFmt, "yyyy-mm-dd");
    assert.equal(birth.value.toISOString().slice(0, 10), "1990-04-02");
    assert.equal(cell("lastTreatmentDate").value.toISOString().slice(0, 10), "2026-02-01");
    assert.equal(cell("lastTreatmentDate").numFmt, "yyyy-mm-dd");
    assert.equal(cell("age").value, 36);
    assert.equal(sheet.getRow(3).getCell(columnIndex.patientId).value, null);

    const file = path.join(os.tmpdir(), `patient-records-${process.pid}.xlsx`);
    fs.writeFileSync(file, bytes);
    const inspected = spawnSync("python3", ["-c", `
import re, zipfile, sys
archive = zipfile.ZipFile(sys.argv[1])
xml = "\\n".join(
    archive.read(name).decode("utf-8", "replace")
    for name in archive.namelist()
    if name.startswith("xl/")
)
assert not re.search(r"<f[ >]", xml)
assert "00042" in xml
assert "09170001111" in xml
assert "synthetic-auth-secret-do-not-export" not in xml
print("xlsx-ok")
`, file], { encoding: "utf8" });
    assert.equal(inspected.status, 0, inspected.stderr || inspected.stdout);
    assert.match(inspected.stdout, /xlsx-ok/);
    fs.unlinkSync(file);
  } finally {
    await portal.close();
  }
});

test("patient record export includes every search match, not only the current page", async () => {
  const portal = await startPortal();
  try {
    const preview = await fetch(`${portal.url}/clinical-records/export/preview?search=${encodeURIComponent("0917")}`);
    const body = await preview.json();
    assert.equal(body.total, 3);
    assert.deepEqual(
      body.records.map((record) => record.patientId).sort(),
      ["00042", "00077", "00088"]
    );
  } finally {
    await portal.close();
  }
});

test("patient record export reports an empty search instead of an empty workbook", async () => {
  const portal = await startPortal();
  try {
    const preview = await fetch(`${portal.url}/clinical-records/export/preview?search=${encodeURIComponent("nobody")}`);
    const body = await preview.json();
    assert.equal(body.total, 0);
    const response = await fetch(`${portal.url}/clinical-records/export.xlsx?search=${encodeURIComponent("nobody")}`);
    assert.equal(response.status, 400);
    assert.match((await response.json()).message, /No patient records match the current search/);
  } finally {
    await portal.close();
  }
});

test("patient record export refuses a search that is too large to download", async () => {
  const portal = await startPortal();
  try {
    const response = await fetch(`${portal.url}/clinical-records/export.xlsx?search=${encodeURIComponent("overflow")}`);
    assert.equal(response.status, 413);
    assert.match((await response.json()).message, /Narrow the search/);
  } finally {
    await portal.close();
  }
});

test("staff and anonymous sessions cannot export patient records", async () => {
  const staff = await startPortal({ databaseRole: "staff" });
  try {
    const response = await fetch(`${staff.url}/clinical-records/export.xlsx`);
    assert.equal(response.status, 403);
    assert.equal(staff.seen.some((sql) => sql.includes("clinic_patient_records")), false);
    const preview = await fetch(`${staff.url}/clinical-records/export/preview`);
    assert.equal(preview.status, 403);
  } finally {
    await staff.close();
  }

  const anonymous = await startPortal({ userId: "" });
  try {
    const response = await fetch(`${anonymous.url}/clinical-records/export.xlsx`);
    assert.equal(response.status, 401);
    assert.equal(anonymous.seen.some((sql) => sql.includes("clinic_patient_records")), false);
  } finally {
    await anonymous.close();
  }
});

test("backup recovery still offers the PostgreSQL dump download", () => {
  const page = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/AdminBackupPage.jsx"), "utf8");
  const api = fs.readFileSync(path.join(__dirname, "../../frontend/src/api.js"), "utf8");
  assert.match(page, /Create PostgreSQL backup/);
  assert.match(page, /downloadAdminBackup/);
  assert.match(api, /downloadAdminBackup:/);
  const records = fs.readFileSync(path.join(__dirname, "../../frontend/src/pages/AdminPatientRecordsPage.jsx"), "utf8");
  assert.match(records, /Export Data \(\.xlsx\)/);
});
