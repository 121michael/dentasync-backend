"use strict";

/**
 * End-to-end synchronization flow for ONE patient (A2026_01):
 *   profile → dentist adds Root Canal #36 → chart derives #36 → staff reads the same record
 *   → staff updates Amount Paid + Next Appointment → dentist reads the same values.
 *
 * Uses an in-memory stand-in for the four canonical tables. Every portal goes through the
 * shared clinicalPatients service, so there is one record and no per-portal copies.
 */

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");
const dentalChartSync = require("../services/dentalChartSync");
const patientData = require("../services/patientData");

function createDatabase() {
  const users = [
    {
      user_id: "user-1",
      first_name: "Juan",
      last_name: "Dela Cruz",
      email: "juan@example.com",
      phone: "639123456789",
      patient_id: "A2026_01",
      user_patient_category: "regular",
      date_of_birth: "2005-01-10",
      gender: "Male",
      address: "Pateros, Metro Manila",
    },
  ];
  const records = [
    {
      id: 3,
      record_code: "CPR-1",
      first_name: "Juan",
      last_name: "Dela Cruz",
      email: "juan@example.com",
      phone: "639123456789",
      date_of_birth: "2005-01-10",
      gender: "Male",
      linked_user_id: "user-1",
      patient_id: "A2026_01",
      patient_category: "regular",
      next_appointment_date: null,
      next_appointment_time: null,
      is_archived: false,
    },
  ];
  const treatments = [];
  const chart = new Map();
  let nextTreatmentId = 1;

  const assignmentsFromUpdate = (sql, params) => {
    const row = {};
    const body = sql.slice(sql.indexOf("SET ") + 4, sql.indexOf("WHERE"));
    for (const assignment of body.split(",")) {
      const match = assignment.trim().match(/^([a-z_]+) = (?:COALESCE\()?\$(\d+)/);
      if (match) row[match[1]] = params[Number(match[2]) - 1];
    }
    return row;
  };

  return {
    users,
    records,
    treatments,
    chart,
    async query(sql, params = []) {
      const text = sql.replace(/\s+/g, " ").trim();
      if (/^(SAVEPOINT|RELEASE SAVEPOINT|ROLLBACK TO SAVEPOINT)/.test(text)) return { rows: [] };

      if (text.startsWith("SELECT") && text.includes("FROM users AS account")) {
        return { rows: users.filter((row) => params[0].includes(row.user_id)) };
      }

      if (text.startsWith("SELECT") && text.includes("FROM clinic_patient_records") && text.includes("record.id = $1")) {
        const row = records.find((record) => record.id === Number(params[0]));
        return { rows: row ? [{ ...row, age: null }] : [] };
      }
      if (text.startsWith("SELECT") && text.includes("FROM clinic_patient_records") && text.includes("WHERE id = $1")) {
        const row = records.find((record) => record.id === Number(params[0]));
        return { rows: row ? [row] : [] };
      }
      if (text.startsWith("UPDATE clinic_patient_records")) {
        const id = Number(params[Number(text.match(/WHERE id = \$(\d+)/)[1]) - 1]);
        const row = records.find((record) => record.id === id);
        Object.assign(row, assignmentsFromUpdate(text, params));
        return { rows: [row] };
      }

      if (text.startsWith("INSERT INTO clinic_patient_treatments")) {
        const row = {
          id: nextTreatmentId++,
          clinical_record_id: Number(params[0]),
          treatment: params[1],
          dentist_name: params[2],
          clinic_location: params[3],
          coverage_status: params[4],
          status: params[5],
          treatment_date: params[6],
          notes: params[7],
          duration_minutes: params[8],
          tooth_number: params[9],
          diagnosis_notes: params[10],
          procedure_details: params[11],
          amount_charged: params[12],
          amount_paid: params[13],
          appointment_id: params[14],
          created_by: params[15],
          created_by_role: params[16],
        };
        treatments.push(row);
        return { rows: [row] };
      }
      if (text.startsWith("SELECT") && text.includes("FROM clinic_patient_treatments") && text.includes("WHERE id = $1")) {
        const row = treatments.find((t) => t.id === Number(params[0]) && t.clinical_record_id === Number(params[1]));
        return { rows: row ? [row] : [] };
      }
      if (text.startsWith("SELECT") && text.includes("FROM clinic_patient_treatments") && text.includes("clinical_record_id = $1")) {
        return { rows: treatments.filter((t) => t.clinical_record_id === Number(params[0])) };
      }
      if (text.startsWith("DELETE FROM clinic_patient_treatments")) {
        const index = treatments.findIndex((t) => t.id === Number(params[0]));
        const [removed] = index >= 0 ? treatments.splice(index, 1) : [];
        return { rows: removed ? [removed] : [] };
      }
      if (text.startsWith("UPDATE clinic_patient_treatments")) {
        const row = treatments.find((t) => t.id === Number(params[Number(text.match(/WHERE id = \$(\d+)/)[1]) - 1]));
        Object.assign(row, assignmentsFromUpdate(text, params));
        return { rows: [row] };
      }

      if (text.startsWith("SELECT") && text.includes("FROM clinic_dental_chart_entries") && text.includes("tooth_number = $2")) {
        const row = chart.get(String(params[1]));
        return { rows: row ? [row] : [] };
      }
      if (text.startsWith("SELECT") && text.includes("FROM clinic_dental_chart_entries")) {
        return { rows: [...chart.values()] };
      }
      if (text.startsWith("INSERT INTO clinic_dental_chart_entries")) {
        const row = {
          tooth_number: String(params[1]),
          condition_label: params[2],
          notes: params[3],
          tooth_status: params[6],
          conditions_json: JSON.parse(params[7]),
          treatments_json: JSON.parse(params[8]),
        };
        chart.set(row.tooth_number, row);
        return { rows: [row] };
      }
      if (text.startsWith("DELETE FROM clinic_dental_chart_entries")) {
        const keep = new Set((params[1] || []).map(String));
        for (const tooth of [...chart.keys()]) if (!keep.has(tooth)) chart.delete(tooth);
        return { rows: [] };
      }
      throw new Error(`Unexpected query: ${text}`);
    },
  };
}

/** What Dentist and Staff portals both read: the shared record + treatments + derived chart. */
async function openPatientRecord(db, recordId) {
  const detail = await clinicalPatients.getClinicalRecord(db, recordId);
  const chart = await dentalChartSync.rebuildChartFromTreatments(db, recordId, { id: "viewer", role: "system" });
  return { ...detail, chart: new Map(chart.map((row) => [row.tooth_number, row.tooth_status])) };
}

test("one patient record stays synchronized across Admin profile, Dentist, and Staff", async () => {
  const db = createDatabase();
  const today = new Date();

  // Dentist opens the record: demographics come from the verified account profile.
  const dentistView = await openPatientRecord(db, 3);
  assert.equal(dentistView.record.patientId, "A2026_01");
  assert.equal(dentistView.record.fullName, "Juan Dela Cruz");
  assert.equal(dentistView.record.gender, "Male");
  assert.equal(dentistView.record.phone, "639123456789");
  assert.equal(dentistView.record.age, patientData.ageFromDateOfBirth("2005-01-10", today));
  assert.equal(dentistView.record.profileLocked, true, "basic info is read-only for account-linked patients");

  // Dentist adds a treatment (spelling variant → canonical taxonomy).
  const rootCanal = await clinicalPatients.addClinicalTreatment(
    db,
    3,
    {
      treatment: "root canal treatment",
      diagnosisNotes: "Irreversible pulpitis",
      toothNumber: "#36",
      treatmentDate: "2026-09-18",
      amountCharged: 5000,
      amountPaid: 0,
    },
    { id: "dentist-1", role: "dentist" }
  );
  assert.equal(rootCanal.treatment, "Root Canal");
  assert.equal(rootCanal.diagnosis, "Irreversible pulpitis");
  assert.equal(rootCanal.paymentStatus, "pending");

  // Staff opens the SAME record and sees the dentist's clinical data + derived chart.
  const staffView = await openPatientRecord(db, 3);
  assert.equal(staffView.record.fullName, "Juan Dela Cruz");
  assert.equal(staffView.treatments.length, 1);
  assert.equal(staffView.treatments[0].treatment, "Root Canal");
  assert.equal(staffView.treatments[0].diagnosis, "Irreversible pulpitis");
  assert.equal(staffView.chart.get("36"), "treated");
  assert.deepEqual(db.chart.get("36").conditions_json, ["root_canal"]);

  // Staff updates Amount Paid and Next Appointment (the only staff-owned fields).
  const paid = await clinicalPatients.updateTreatmentAmountPaid(db, 3, rootCanal.id, "1,500", {
    id: "staff-1",
    role: "staff",
  });
  assert.equal(paid.amountPaid, 1500);
  assert.equal(paid.balance, 3500);
  assert.equal(paid.paymentStatus, "partially_paid");

  await clinicalPatients.updateClinicalRecord(
    db,
    3,
    { nextAppointmentDate: "2026-10-05", nextAppointmentTime: "10:00" },
    { id: "staff-1", role: "staff" }
  );

  // Staff cannot touch profile-owned data on a linked record.
  await assert.rejects(
    () => clinicalPatients.updateClinicalRecord(db, 3, { phone: "0999" }, { id: "staff-1", role: "staff" }),
    (error) => error.status === 403
  );

  // Dentist reopens the record: payment + appointment reflect staff updates from the same rows.
  const dentistAgain = await openPatientRecord(db, 3);
  assert.equal(dentistAgain.treatments[0].amountPaid, 1500);
  assert.equal(dentistAgain.treatments[0].balance, 3500);
  assert.equal(dentistAgain.treatments[0].paymentStatus, "partially_paid");
  assert.equal(dentistAgain.record.nextAppointmentDate, "2026-10-05");
  assert.equal(dentistAgain.record.nextAppointmentTime, "10:00");

  // Editing the treatment recalculates the chart; history is not lost.
  const edited = await clinicalPatients.updateClinicalTreatment(
    db,
    3,
    rootCanal.id,
    { treatment: "Tooth Restoration", treatmentDate: "2026-09-18", toothNumber: "36", diagnosisNotes: "Dental caries" },
    { id: "dentist-1", role: "dentist" }
  );
  assert.equal(edited.treatment, "Dental Filling");
  assert.equal(edited.amountPaid, 1500, "staff-owned payment survives a clinical edit");
  assert.deepEqual(db.chart.get("36").conditions_json, ["filling"]);

  // Deleting the last treatment on #36 clears its derived status.
  await clinicalPatients.deleteClinicalTreatment(db, 3, rootCanal.id, { id: "dentist-1", role: "dentist" });
  assert.equal(db.chart.has("36"), false);
});
