"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const clinicalPatients = require("../services/clinicalPatients");

test("ageFromDateOfBirth calculates current age from birthdate", () => {
  assert.equal(clinicalPatients.ageFromDateOfBirth("2005-01-10"), 21);
  assert.equal(clinicalPatients.ageFromDateOfBirth("2010-12-31"), 15);
  assert.equal(clinicalPatients.ageFromDateOfBirth(null), null);
  assert.equal(clinicalPatients.ageFromDateOfBirth("not-a-date"), null);
});

test("updateClinicalRecord rejects profile fields when linked_user_id is set", async () => {
  const db = {
    async query(sql) {
      if (sql.includes("FROM clinic_patient_records") && sql.includes("WHERE id = $1")) {
        return {
          rows: [
            {
              id: 7,
              first_name: "Juan",
              last_name: "Dela Cruz",
              email: "juan@example.com",
              phone: "09123456789",
              date_of_birth: "2005-01-10",
              gender: "Male",
              linked_user_id: "user-1",
              is_archived: false,
            },
          ],
        };
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  };

  await assert.rejects(
    () =>
      clinicalPatients.updateClinicalRecord(
        db,
        7,
        { firstName: "Changed", gender: "Female" },
        { id: "dentist-1", role: "dentist" }
      ),
    (error) => error.status === 403 && /patient account profile/i.test(error.message)
  );
});

test("enrichRecordsFromLinkedProfiles overlays account profile basics", async () => {
  const db = {
    async query(_sql, params) {
      assert.deepEqual(params[0], ["user-1"]);
      return {
        rows: [
          {
            user_id: "user-1",
            first_name: "Juan",
            last_name: "Dela Cruz",
            email: "juan@example.com",
            phone: "09123456789",
            date_of_birth: "2005-01-10",
            gender: "Male",
            address: "Quezon City",
          },
        ],
      };
    },
  };

  const [enriched] = await clinicalPatients.enrichRecordsFromLinkedProfiles(db, [
    {
      id: 3,
      linkedUserId: "user-1",
      firstName: "Stale",
      lastName: "Name",
      fullName: "Stale Name",
      email: "old@example.com",
      phone: "000",
      dateOfBirth: "1990-01-01",
      gender: "Other",
      age: 99,
      ageSex: "99 / Other",
      address: "Old",
    },
  ]);

  assert.equal(enriched.firstName, "Juan");
  assert.equal(enriched.lastName, "Dela Cruz");
  assert.equal(enriched.fullName, "Juan Dela Cruz");
  assert.match(String(enriched.phone), /9123456789/);
  assert.equal(enriched.gender, "Male");
  assert.equal(String(enriched.dateOfBirth).slice(0, 10), "2005-01-10");
  assert.equal(enriched.age, 21);
  assert.equal(enriched.profileLocked, true);
  assert.equal(enriched.accountLinked, true);
});
