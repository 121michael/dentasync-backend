"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const dentalChartSync = require("../services/dentalChartSync");

test("mapTreatmentNameToChart maps common procedures", () => {
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Root Canal").key, "root_canal");
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Dental Filling").key, "filling");
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Tooth Restoration").key, "filling");
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Extraction").key, "extraction");
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Extraction").status, "missing");
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Crown").key, "crown");
  assert.equal(dentalChartSync.mapTreatmentNameToChart("Cleaning / Oral Prophylaxis").key, "cleaning");
});

test("parseAffectedTeeth accepts FDI lists and ranges", () => {
  assert.deepEqual(dentalChartSync.parseAffectedTeeth("#36"), ["36"]);
  assert.deepEqual(dentalChartSync.parseAffectedTeeth("14, 15, 16"), ["14", "15", "16"]);
  assert.deepEqual(dentalChartSync.parseAffectedTeeth("14-16"), ["14", "15", "16"]);
  assert.deepEqual(dentalChartSync.parseAffectedTeeth("99"), []);
});

test("parseAffectedTeeth accepts primary (pediatric) teeth", () => {
  assert.deepEqual(dentalChartSync.parseAffectedTeeth("#75"), ["75"]);
  assert.deepEqual(dentalChartSync.parseAffectedTeeth("51, 61"), ["51", "61"]);
  assert.equal(dentalChartSync.isValidFdiTooth(85), true);
  assert.equal(dentalChartSync.isValidFdiTooth(86), false);
  assert.equal(dentalChartSync.isValidFdiTooth(49), false);
});

test("isToothSpecificTreatment requires tooth for root canal and filling", () => {
  assert.equal(dentalChartSync.isToothSpecificTreatment("Root Canal"), true);
  assert.equal(dentalChartSync.isToothSpecificTreatment("Dental Filling"), true);
  assert.equal(dentalChartSync.isToothSpecificTreatment("Cleaning / Oral Prophylaxis"), false);
});

test("syncChartFromTreatment upserts chart entry for root canal on #36", async () => {
  const calls = [];
  const db = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes("FROM clinic_dental_chart_entries") && sql.includes("SELECT")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO clinic_dental_chart_entries")) {
        return {
          rows: [
            {
              tooth_number: params[1],
              tooth_status: params[6],
              treatments_json: JSON.parse(params[8]),
              condition_label: params[2],
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  const saved = await dentalChartSync.syncChartFromTreatment(
    db,
    3,
    {
      treatment: "Root Canal",
      tooth_number: "36",
      diagnosis_notes: "Irreversible pulpitis",
    },
    { id: "dentist-1", role: "dentist" }
  );

  assert.equal(saved.length, 1);
  assert.equal(saved[0].tooth_number, "36");
  assert.equal(saved[0].tooth_status, "treated");
  assert.ok(saved[0].treatments_json.includes("root_canal"));
});

test("syncChartFromTreatment requires tooth for tooth-specific treatments", async () => {
  const db = { async query() { return { rows: [] }; } };
  await assert.rejects(
    () =>
      dentalChartSync.syncChartFromTreatment(
        db,
        3,
        { treatment: "Root Canal", tooth_number: "" },
        { id: "d1", role: "dentist" }
      ),
    (error) => error.status === 400
  );
});
