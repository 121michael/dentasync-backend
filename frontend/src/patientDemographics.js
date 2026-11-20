export const PATIENT_SEX_OPTIONS = [
  { value: "Female", label: "Female" },
  { value: "Male", label: "Male" },
  { value: "Non-binary", label: "Non-binary" },
  { value: "Prefer to self-describe", label: "Prefer to self-describe" },
];

export function todayCalendarDate(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isIsoCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return (
    parsed.getFullYear() === year &&
    parsed.getMonth() === month - 1 &&
    parsed.getDate() === day
  );
}

export function registrationDemographicsError({ sex, dateOfBirth }, now = new Date()) {
  if (!String(sex || "").trim()) return "Please select sex.";
  if (!PATIENT_SEX_OPTIONS.some((option) => option.value === sex)) {
    return "Please select sex.";
  }
  if (!String(dateOfBirth || "").trim()) return "Date of birth is required.";
  if (!isIsoCalendarDate(dateOfBirth)) return "Enter a valid date of birth.";
  if (dateOfBirth > todayCalendarDate(now)) return "Date of birth cannot be in the future.";
  return "";
}

export function calendarDateInputValue(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  return "";
}

export const NOT_RECORDED = "Not recorded";

export function displaySex(value) {
  const text = value == null ? "" : String(value).trim();
  return text || NOT_RECORDED;
}

export function displayDateOfBirth(value) {
  const iso = calendarDateInputValue(value);
  if (!iso || !isIsoCalendarDate(iso)) return NOT_RECORDED;
  const [year, month, day] = iso.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date(year, month - 1, day));
}
