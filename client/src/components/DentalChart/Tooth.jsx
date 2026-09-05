import { labelFor, STATUS_OPTIONS } from "./dentalChartData";
import { TOOTH_SHAPES, toothTypeFromFdi } from "./toothShapes";

function statusKey(record) {
  const status = record?.status || "healthy";
  const conditions = record?.condition || [];
  if (status === "missing" || conditions.includes("missing")) return "missing";
  if (status === "under_treatment") return "under_treatment";
  if (status === "treated") return "treated";
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

export function Tooth({
  toothNumber,
  record,
  selected,
  onSelect,
  x,
  y,
  rotate,
  labelX,
  labelY,
  scale = 1,
}) {
  const status = statusKey(record);
  const statusLabel = labelFor(record?.status || "healthy", STATUS_OPTIONS);
  const title = `Tooth ${toothNumber} — ${statusLabel}`;
  const type = toothTypeFromFdi(toothNumber);
  const shape = TOOTH_SHAPES[type] || TOOTH_SHAPES.premolar;
  const missing = status === "missing";

  return (
    <g className={`fdi-tooth fdi-tooth--${status} ${selected ? "is-selected" : ""}`}>
      <g
        transform={`translate(${x}, ${y}) rotate(${rotate}) scale(${scale})`}
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
        style={{ cursor: "pointer" }}
      >
        <title>{title}</title>

        {missing ? (
          <>
            <ellipse
              className="fdi-tooth__missing-slot"
              cx="0"
              cy="0"
              rx="11"
              ry="15"
              fill="none"
              strokeDasharray="3 3"
            />
            <path
              className="fdi-tooth__missing-mark"
              d="M -5 -5 L 5 5 M 5 -5 L -5 5"
              fill="none"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            {/* Soft contact shadow */}
            <ellipse className="fdi-tooth__shadow" cx="1.2" cy="2.2" rx="10" ry="14" />

            <path className="fdi-tooth__shape" d={shape.outline} />
            <path className="fdi-tooth__highlight" d={shape.outline} />
            <path
              className="fdi-tooth__detail"
              d={shape.detail}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* Status markers — keep ivory body visible */}
            {status === "needs_attention" || status === "fractured" ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--attention" cx="7" cy="-12" r="3.2" />
            ) : null}
            {status === "treated" ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--treated" cx="7" cy="-12" r="3.2" />
            ) : null}
            {status === "under_treatment" ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--under" cx="7" cy="-12" r="3.2" />
            ) : null}
            {record?.treatments?.length ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--note" cx="-7.5" cy="-12" r="2.4" />
            ) : null}
          </>
        )}

        {selected ? <ellipse className="fdi-tooth__selection" cx="0" cy="0" rx="13" ry="17.5" /> : null}
      </g>

      {/* FDI number stays upright around the arch */}
      <text
        className="fdi-tooth__number"
        x={labelX}
        y={labelY}
        textAnchor="middle"
        dominantBaseline="middle"
      >
        {toothNumber}
      </text>
    </g>
  );
}
