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
