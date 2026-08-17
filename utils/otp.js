/**
 * Normalize Philippine-style phone numbers so OTP store/verify use the same key.
 * Strips non-digits, converts +63 / 63 prefixes to local 0XXXXXXXXXX form.
 */
function normalizePhone(phone) {
  if (phone == null) return "";
  let digits = String(phone).replace(/\D/g, "");
  if (digits.startsWith("63") && digits.length >= 12) {
    digits = "0" + digits.slice(2);
  }
  return digits;
}

/**
 * Digit-only variants for matching legacy rows stored as 09… or 63…
 */
function phoneMatchVariants(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return [];
  const variants = new Set([normalized, String(phone).replace(/\D/g, "")]);
  if (normalized.startsWith("0") && normalized.length === 11) {
    variants.add("63" + normalized.slice(1));
  }
  return [...variants].filter(Boolean);
}

/**
 * Coerce OTP from number, string, or digit-array inputs and strip whitespace.
 */
function normalizeOtp(otp) {
  if (Array.isArray(otp)) {
    return otp.map((d) => String(d).trim()).join("");
  }
  return String(otp ?? "").replace(/\s+/g, "").trim();
}

module.exports = { normalizePhone, normalizeOtp, phoneMatchVariants };
