const HMO_STATUS_LABELS = {
  pending_verification: "Pending verification",
  verified: "Verified",
  rejected: "Rejected",
  not_applicable: "Not applicable",
  no_hmo_on_file: "No HMO on file",
};

export function hmoDisplayStatus(patient) {
  if (patient?.hmoVerificationDisplay) return patient.hmoVerificationDisplay;
  if (patient?.hasHmoOnFile === false) return "no_hmo_on_file";
  return patient?.hmoVerificationStatus || "not_applicable";
}

export function hmoStatusLabel(patient) {
  const status = hmoDisplayStatus(patient);
  return HMO_STATUS_LABELS[status] || String(status || "not_applicable").replaceAll("_", " ");
}
