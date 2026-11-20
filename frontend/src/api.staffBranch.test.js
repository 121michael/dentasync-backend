import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)));
const api = fs.readFileSync(path.join(root, "api.js"), "utf8");
const layout = fs.readFileSync(path.join(root, "components", "StaffLayout.jsx"), "utf8");
const booking = fs.readFileSync(path.join(root, "pages", "AppointmentsPage.jsx"), "utf8");

test("Staff API calls do not send a client-chosen branch header", () => {
  assert.match(api, /path\.startsWith\("\/dentist"\)/);
  assert.doesNotMatch(api, /path\.startsWith\("\/staff"\) \|\| path\.startsWith\("\/dentist"\)/);
});

test("Staff navigation stays without HMO Verification while patient booking keeps HMO", () => {
  assert.doesNotMatch(layout, /to: "\/staff\/hmo-verification"/);
  assert.match(booking, /value="hmo"/);
});
