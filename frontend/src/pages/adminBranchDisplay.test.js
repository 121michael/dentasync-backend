import assert from "node:assert/strict";
import test from "node:test";
import { branchCheckLabel, branchContactLines } from "./adminBranchDisplay.js";

test("branch contact groups address, phone, and email with the existing empty labels", () => {
  assert.deepEqual(
    branchContactLines({
      address: "Grand Central Residences",
      contactNumber: "09109207877",
      email: "amethystdental@gmail.com",
    }),
    ["Grand Central Residences", "09109207877", "amethystdental@gmail.com"]
  );
  assert.deepEqual(branchContactLines({}), ["Missing address", "Missing contact number", "No email"]);
});

test("RFID and QR labels stay distinct for on and off", () => {
  assert.equal(branchCheckLabel(true, "RFID"), "RFID on");
  assert.equal(branchCheckLabel(false, "RFID"), "RFID off");
  assert.equal(branchCheckLabel(true, "QR"), "QR on");
  assert.equal(branchCheckLabel(false, "QR"), "QR off");
});
