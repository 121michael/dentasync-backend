/** Copy that would show a patient a clinic price during booking. */
const PATIENT_BOOKING_PRICE_COPY =
  /₱|starting at|per session|per unit|down payment|monthly adjustment|price unavailable|available upon consultation|price available|final price|final cost|listed amount|\bpayment\b/i;

export function isPatientBookingPriceCopy(value) {
  return PATIENT_BOOKING_PRICE_COPY.test(String(value || ""));
}

export function hidePatientBookingPriceLines(lines) {
  return (lines || []).filter((line) => {
    const label = line?.label;
    const value = line?.value;
    return !isPatientBookingPriceCopy(label) && !isPatientBookingPriceCopy(value);
  });
}

export function hidePatientBookingPriceNotes(notes) {
  return (notes || []).filter((note) => !isPatientBookingPriceCopy(note));
}
