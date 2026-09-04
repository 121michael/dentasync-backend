import { labelFor, STATUS_OPTIONS } from "./dentalChartData";

function toothClassName(record, selected) {
  const status = record?.status || "healthy";
  const conditions = record?.condition || [];
  const primary =
    status === "missing" || conditions.includes("missing")
      ? "missing"
      : status === "under_treatment"
        ? "under_treatment"
        : status === "treated" ||
            conditions.includes("decay") ||
            conditions.includes("caries") ||
            conditions.includes("fractured")
          ? status === "treated"
            ? "treated"
            : conditions.includes("fractured")
              ? "fractured"
              : "decay"
          : status === "needs_attention" || conditions.includes("sensitive")
            ? "needs_attention"
            : "healthy";

  return [
    "fdi-tooth",
    `fdi-tooth--${primary}`,
    selected ? "is-selected" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

export function Tooth({ toothNumber, record, selected, onSelect, x, y, rotate, labelOffset }) {
  const statusLabel = labelFor(record?.status || "healthy", STATUS_OPTIONS);
  const title = `Tooth ${toothNumber} — ${statusLabel}`;

  return (
    <g
      className={toothClassName(record, selected)}
      transform={`translate(${x}, ${y}) rotate(${rotate})`}
      role="button"
      tabIndex={0}
      aria-label={title}
      aria-pressed={selected}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(toothNumber);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(toothNumber);
        }
      }}
    >
      <title>{title}</title>
      {/* Crown + root silhouette */}
      <path
        className="fdi-tooth__shape"
        d="M -11 -18
           C -14 -10, -13 -2, -10 4
           L -6 20
           C -4 26, 4 26, 6 20
           L 10 4
           C 13 -2, 14 -10, 11 -18
           C 7 -24, -7 -24, -11 -18 Z"
      />
      <text
        className="fdi-tooth__number"
        x="0"
        y={labelOffset}
        textAnchor="middle"
        dominantBaseline="middle"
        transform={`rotate(${-rotate})`}
      >
        {toothNumber}
      </text>
      {record?.treatments?.length ? <circle className="fdi-tooth__dot" cx="8" cy="-16" r="3.2" /> : null}
    </g>
  );
}
