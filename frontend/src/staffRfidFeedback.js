export const RFID_SCAN_HOLD_MS = 8000;

export const RFID_UNASSIGNED_MESSAGE =
  "RFID card is not assigned to a patient. Please ask an administrator to register this card.";

export function isRfidReaderConnectionFailure(errorCode) {
  return (
    errorCode === "RFID_READER_CONNECTION" ||
    errorCode === "RFID_READER_UNCONFIGURED" ||
    errorCode === "RFID_READER_DISABLED"
  );
}

export function staffReaderStatusLabel({ readerOffline, scannerState }) {
  if (readerOffline) return "Error";
  if (scannerState === "scanning") return "Reading";
  if (scannerState === "success") return "Success";
  return "Connected";
}
