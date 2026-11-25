import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, HeartPulse, ShieldCheck, UserRound } from "lucide-react";

export const PATIENT_RECORD_MENU = [
  {
    id: "personal",
    title: "Personal Information",
    description: "View and update your personal details",
    icon: UserRound,
  },
  {
    id: "emergency",
    title: "Emergency Contact",
    description: "Manage your emergency contact details",
    icon: ShieldCheck,
  },
  {
    id: "clinical",
    title: "Clinical Information",
    description: "Review your dental and clinical information",
    icon: HeartPulse,
  },
  {
    id: "coverage",
    title: "Coverage and Wellness",
    description: "View your coverage and wellness information",
    icon: CalendarDays,
  },
];

export function PatientRecordField({ label, children, warning = false }) {
  const value = children == null || children === "" ? "—" : children;
  return (
    <div className={`field${warning ? " field--warning" : ""}`}>
      <span>{label}</span>
      <p className="field-readonly">{value}</p>
    </div>
  );
}

export function PatientRecordIdentity({ onBack, name, patientId, eyebrow = "Shared patient record", children }) {
  return (
    <div className="dentist-record-identity">
      <button type="button" className="button button--secondary profile-back" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Patient Records
      </button>
      <span className="eyebrow">{eyebrow}</span>
      <h1>{name || "Patient record"}</h1>
      <p className="dentist-record-identity__id">Patient ID · {patientId || "—"}</p>
      {children}
    </div>
  );
}

export function PatientRecordSectionSelect({
  value,
  onChange,
  options = PATIENT_RECORD_MENU,
  label = "Record section",
}) {
  return (
    <label className="record-section-select">
      <span>{label}</span>
      <select
        value={value || ""}
        onChange={(event) => onChange(event.target.value || null)}
        aria-label={label}
      >
        <option value="">Overview</option>
        {options.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
    </label>
  );
}

export function PatientRecordSectionNav({ onSelect, selectedId, options = PATIENT_RECORD_MENU }) {
  return (
    <nav className="profile-menu" aria-label="Patient record sections">
      {options.map((item) => {
        const Icon = item.icon;
        return (
          <button
            key={item.id}
            type="button"
            className={`profile-menu__item${selectedId === item.id ? " is-selected" : ""}`}
            onClick={() => onSelect(item.id)}
          >
            <span className="profile-menu__icon" aria-hidden="true">
              <Icon size={18} />
            </span>
            <span className="profile-menu__copy">
              <strong>{item.title}</strong>
              <small>{item.description}</small>
            </span>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        );
      })}
    </nav>
  );
}

export function PatientRecordCardsBack({ onClick }) {
  return (
    <button type="button" className="button button--secondary profile-back" onClick={onClick}>
      <ChevronLeft size={16} /> Back to patient cards
    </button>
  );
}

export function hmoCoverageLabel(patient) {
  const status = String(patient?.hmoStatus || "not_enrolled").replaceAll("_", " ");
  if (patient?.hmoStatus === "verified") {
    return `HMO Verified${patient.hmoProvider ? ` · ${patient.hmoProvider}` : ""}`;
  }
  return status;
}
