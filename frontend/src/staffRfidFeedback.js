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

export function sanitizeStaffCheckInMessage(text, fallback = "Unable to complete patient check-in. Try again.") {
  const message = String(text || "").trim();
  if (!message) return fallback;
  if (
    /current transaction is aborted/i.test(message) ||
    /commands ignored until end of transaction/i.test(message) ||
    /column "[^"]+" does not exist/i.test(message) ||
    /relation "[^"]+" does not exist/i.test(message) ||
    /duplicate key value/i.test(message) ||
    /violates .+ constraint/i.test(message)
  ) {
    return fallback;
  }
  return message;
}

export function shouldSkipDuplicateToast(previous, message, tone, now = Date.now()) {
  if (!previous || !message) return false;
  return previous.key === `${tone}:${message}` && now - previous.at < 4000;
}
