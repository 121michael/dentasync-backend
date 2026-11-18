export function branchContactLines(branch = {}) {
  return [
    branch.address || "Missing address",
    branch.contactNumber || "Missing contact number",
    branch.email || "No email",
  ];
}

export function branchCheckLabel(enabled, name) {
  return `${name} ${enabled ? "on" : "off"}`;
}

export function emptyBranchForm() {
  return {
    name: "",
    address: "",
    contactNumber: "",
    email: "",
    rfidEnabled: false,
    qrEnabled: false,
  };
}

export function formFromBranch(branch) {
  if (!branch) return emptyBranchForm();
  return {
    name: branch.name || "",
    address: branch.address || "",
    contactNumber: branch.contactNumber || "",
    email: branch.email || "",
    rfidEnabled: Boolean(branch.rfidEnabled),
    qrEnabled: Boolean(branch.qrEnabled),
  };
}

export function validateBranchForm(form = {}) {
  const errors = {};
  if (!String(form.name || "").trim()) errors.name = "Branch name is required.";
  if (!String(form.address || "").trim()) errors.address = "Branch address is required.";
  if (!String(form.contactNumber || "").trim()) errors.contactNumber = "Branch contact number is required.";
  const email = String(form.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Enter a valid branch email address or leave it blank.";
  }
  return errors;
}

export function applyBranchServerError(message) {
  const text = String(message || "");
  if (/name is required/i.test(text)) return { name: text };
  if (/address is required/i.test(text)) return { address: text };
  if (/contact number is required/i.test(text)) return { contactNumber: text };
  if (/email/i.test(text)) return { email: text };
  return { form: text };
}
