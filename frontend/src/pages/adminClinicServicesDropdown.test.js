import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const page = fs.readFileSync(path.join(here, "AdminAiSettingsPage.jsx"), "utf8");

test("Admin Clinic Services uses one catalog dropdown and only price plus chatbot fields", () => {
  assert.match(page, /Select a service/);
  assert.match(page, /htmlFor="admin-clinic-service-select"/);
  assert.match(page, /option value=""/);
  assert.match(page, /disabled=\{busy \|\| catalogLoading \|\| !selectedService\}/);
  assert.match(page, /Price label/);
  assert.match(page, /Chatbot answer/);
  assert.doesNotMatch(page, /Official price \/ details/);
  assert.doesNotMatch(page, /Price units and terms/);
  assert.match(page, /priceLabel: draft\.priceLabel/);
  assert.match(page, /chatbotEn: draft\.chatbotEn/);
  assert.match(page, /Discard unsaved edits/);
  assert.match(page, /seq !== loadGen\.current/);
});
