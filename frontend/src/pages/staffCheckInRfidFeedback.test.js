import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  isRfidReaderConnectionFailure,
  RFID_SCAN_HOLD_MS,
  RFID_UNASSIGNED_MESSAGE,
  staffReaderStatusLabel,
} from "../staffRfidFeedback.js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const page = fs.readFileSync(path.join(root, "pages", "StaffCheckInPage.jsx"), "utf8");

test("rejected RFID cards keep the reader connected and replace the previous scan message", () => {
  assert.equal(RFID_SCAN_HOLD_MS, 8000);
  assert.equal(
    RFID_UNASSIGNED_MESSAGE,
    "RFID card is not assigned to a patient. Please ask an administrator to register this card."
  );
  assert.equal(staffReaderStatusLabel({ readerOffline: false, scannerState: "error" }), "Connected");
  assert.equal(staffReaderStatusLabel({ readerOffline: true, scannerState: "error" }), "Error");
  assert.equal(isRfidReaderConnectionFailure("RFID_UNASSIGNED"), false);
  assert.equal(isRfidReaderConnectionFailure("RFID_NO_WALK_IN_SLOT"), false);
  assert.equal(isRfidReaderConnectionFailure("RFID_READER_CONNECTION"), true);
  assert.match(page, /staffReaderStatusLabel/);
  assert.match(page, /newest\.errorCode/);
  assert.match(page, /RFID_SCAN_HOLD_MS/);
  assert.doesNotMatch(page, /Reader status:[\s\S]*scannerState === "error"[\s\S]*\? "Error"/);
});
