import { labelFor, STATUS_OPTIONS, TREATMENT_OPTIONS } from "./dentalChartData";
import { TOOTH_VIEW, frontToothShape, toothTypeFromFdi } from "./toothShapes";

function statusKey(record) {
  const status = record?.status || "healthy";
  const conditions = record?.condition || [];
  const treatments = record?.treatments || [];
  if (status === "missing" || conditions.includes("missing") || treatments.includes("extraction")) {
    return "missing";
  }
  if (status === "under_treatment" || treatments.includes("braces")) return "under_treatment";
  if (
    status === "treated" ||
    treatments.includes("root_canal") ||
    treatments.includes("filling") ||
    treatments.includes("crown") ||
    treatments.includes("bridge") ||
    treatments.includes("sealant")
  ) {
    return "treated";
  }
  if (
    status === "needs_attention" ||
    conditions.includes("decay") ||
    conditions.includes("caries") ||
    conditions.includes("fractured") ||
    conditions.includes("sensitive")
  ) {
    return conditions.includes("fractured") ? "fractured" : "needs_attention";
  }
  return "healthy";
}

/** Order decides which flat indicator is drawn when a tooth carries several treatments. */
const MARK_PRIORITY = ["extraction", "root_canal", "crown", "bridge", "filling", "sealant", "denture", "braces"];

function markKey(record, status) {
  if (status === "missing") return "extraction";
  const treatments = record?.treatments || [];
  return MARK_PRIORITY.find((key) => treatments.includes(key)) || "";
}

function ToothMark({ mark }) {
  if (mark === "root_canal") {
    return (
      <g className="odo-tooth__mark odo-tooth__mark--root_canal">
        <path d="M 24 8 L 24 44" />
        <circle cx="24" cy="44" r="3.4" />
      </g>
    );
  }
  if (mark === "filling") {
    return (
      <g className="odo-tooth__mark odo-tooth__mark--filling">
        <rect x="18" y="34" width="12" height="12" rx="2.5" />
      </g>
    );
  }
  if (mark === "crown" || mark === "denture") {
    return (
      <g className="odo-tooth__mark odo-tooth__mark--crown">
        <rect x="12" y="28" width="24" height="24" rx="5" />
      </g>
    );
  }
  if (mark === "bridge") {
    return (
      <g className="odo-tooth__mark odo-tooth__mark--bridge">
        <path d="M 6 32 L 42 32" />
        <rect x="14" y="36" width="20" height="14" rx="4" />
      </g>
    );
  }
  if (mark === "sealant") {
    return (
      <g className="odo-tooth__mark odo-tooth__mark--sealant">
        <circle cx="18" cy="44" r="2.2" />
        <circle cx="24" cy="46" r="2.2" />
        <circle cx="30" cy="44" r="2.2" />
      </g>
    );
  }
  if (mark === "braces") {
    return (
      <g className="odo-tooth__mark odo-tooth__mark--braces">
        <path d="M 7 40 L 41 40" />
        <rect x="17" y="34" width="14" height="12" rx="2.5" />
      </g>
    );
  }
  return null;
}

export function Tooth({ toothNumber, record, selected, onSelect, arch = "upper" }) {
  const status = statusKey(record);
  const type = toothTypeFromFdi(toothNumber);
  const shape = frontToothShape(toothNumber);
  const missing = status === "missing";
  const mark = markKey(record, status);
  const treatmentLabels = (record?.treatments || []).map((value) =>
    labelFor(value, TREATMENT_OPTIONS)
  );
  const statusLabel = labelFor(record?.status || "healthy", STATUS_OPTIONS);
  const title = treatmentLabels.length
    ? `Tooth ${toothNumber} — ${statusLabel} (${treatmentLabels.join(", ")})`
    : `Tooth ${toothNumber} — ${statusLabel}`;

  return (
    <div
      className={[
        "odo-tooth",
        `odo-tooth--${status}`,
        `odo-tooth--${type}`,
        `odo-tooth--${arch}`,
        selected ? "is-selected" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className="odo-tooth__number">{toothNumber}</span>
      <button
        type="button"
        className="odo-tooth__button"
        onClick={() => onSelect(toothNumber)}
        aria-pressed={selected}
        aria-label={title}
        title={title}
      >
        <svg
          className="odo-tooth__svg"
          viewBox={`0 0 ${TOOTH_VIEW.width} ${TOOTH_VIEW.height}`}
          focusable="false"
          aria-hidden="true"
        >
          {shape.roots.map((root, index) => (
            <path key={`root-${index}`} className="odo-tooth__root" d={root} />
          ))}
          <path className="odo-tooth__crown" d={shape.crown} />
          {shape.details.map((detail, index) => (
            <path key={`detail-${index}`} className="odo-tooth__detail" d={detail} fill="none" />
          ))}
          {missing ? (
            <path className="odo-tooth__missing" d="M 11 14 L 37 54 M 37 14 L 11 54" fill="none" />
          ) : (
            <ToothMark mark={mark} />
          )}
        </svg>
      </button>
      <span className="odo-tooth__flag" aria-hidden="true" />
    </div>
  );
}
