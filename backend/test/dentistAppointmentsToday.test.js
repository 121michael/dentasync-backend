"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("dentist appointment lists use Manila clinic date, not UTC CURRENT_DATE", () => {
  const source = fs.readFileSync(path.join(__dirname, "../routes/dentistPortal.js"), "utf8");
  const appointmentsHandler = source.slice(
    source.indexOf('router.get("/appointments"'),
    source.indexOf('router.get("/patients"')
  );
  assert.match(source, /function clinicLocalDateSql/);
  assert.match(appointmentsHandler, /clinicLocalDateSql\("appointment\.appointment_date"\)/);
  assert.match(appointmentsHandler, /clinicLocalDateSql\("appointment\.appointment_date", ">"\)/);
  assert.equal(appointmentsHandler.includes("CURRENT_DATE"), false);
});
