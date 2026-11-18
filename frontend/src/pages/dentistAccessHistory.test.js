import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

function accessRecordHistorySource() {
  const page = fs.readFileSync(path.join(here, "DentistRecordsPage.jsx"), "utf8");
  const start = page.indexOf("function AccessRecordHistory");
  const end = page.indexOf("function formatMoney", start);
  assert.ok(start >= 0 && end > start, "AccessRecordHistory function should exist");
  return page.slice(start, end);
}

test("Access Record History does not render a numbered treatment-summary list", () => {
  const source = accessRecordHistorySource();
  assert.match(source, /Access Record History/);
  assert.match(source, /Cross-Branch Record Authorization/);
  assert.doesNotMatch(source, /<ol[\s>]/);
  assert.doesNotMatch(source, /No authorized history yet/);
  assert.doesNotMatch(source, /recorded \$\{formatDentistDate/);
  assert.doesNotMatch(source, /\btreatments\b/);
});

test("Dental Treatment History remains on the dentist patient record page", () => {
  const page = fs.readFileSync(path.join(here, "DentistRecordsPage.jsx"), "utf8");
  assert.match(page, /<h2>Dental Treatment History<\/h2>/);
  assert.match(page, /Cross-Branch Record Authorization/);
});
