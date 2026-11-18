import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBranchServerError,
  branchCheckLabel,
  branchContactLines,
  emptyBranchForm,
  formFromBranch,
  validateBranchForm,
} from "./adminBranchDisplay.js";

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

const syntheticBranch = {
  name: "Taguig City",
  address: "#23 guyabano st\npanam pinagsama",
  contactNumber: "09271945478",
  email: "mijaresmj44@gmail.com",
  rfidEnabled: false,
  qrEnabled: true,
};

test("edit form loads a synthetic branch including check-in settings", () => {
  const loaded = formFromBranch(syntheticBranch);
  assert.equal(loaded.name, "Taguig City");
  assert.equal(loaded.address, "#23 guyabano st\npanam pinagsama");
  assert.equal(loaded.contactNumber, "09271945478");
  assert.equal(loaded.email, "mijaresmj44@gmail.com");
  assert.equal(loaded.rfidEnabled, false);
  assert.equal(loaded.qrEnabled, true);
});

test("Cancel discards unsaved edits and restored values match the loaded branch", () => {
  const loaded = formFromBranch(syntheticBranch);
  const draft = {
    ...loaded,
    name: "Changed City",
    address: "Unsaved address",
    rfidEnabled: true,
    qrEnabled: false,
  };
  const afterCancel = formFromBranch(syntheticBranch);
  assert.deepEqual(afterCancel, loaded);
  assert.notDeepEqual(draft, afterCancel);
  assert.deepEqual(emptyBranchForm(), {
    name: "",
    address: "",
    contactNumber: "",
    email: "",
    rfidEnabled: false,
    qrEnabled: false,
  });
});

test("client validation sits on the field and allows a blank optional email", () => {
  assert.deepEqual(validateBranchForm({}), {
    name: "Branch name is required.",
    address: "Branch address is required.",
    contactNumber: "Branch contact number is required.",
  });
  assert.equal(validateBranchForm({ ...syntheticBranch, email: "not-an-email" }).email, "Enter a valid branch email address or leave it blank.");
  assert.deepEqual(validateBranchForm({ ...syntheticBranch, email: "  " }), {});
  assert.deepEqual(validateBranchForm(syntheticBranch), {});
});

test("save payload keeps edited details and check-in flags", () => {
  const payload = {
    ...formFromBranch(syntheticBranch),
    name: "Taguig City East",
    rfidEnabled: true,
    qrEnabled: false,
  };
  assert.equal(payload.name, "Taguig City East");
  assert.equal(payload.rfidEnabled, true);
  assert.equal(payload.qrEnabled, false);
  assert.deepEqual(applyBranchServerError("Branch address is required."), {
    address: "Branch address is required.",
  });
});
