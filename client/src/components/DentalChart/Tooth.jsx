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
  const hit = shape.hit || { rx: 18, ry: 26 };

  return (
    <g className={`fdi-tooth fdi-tooth--${status} fdi-tooth--${type} ${selected ? "is-selected" : ""}`}>
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

        {/* Invisible hit area — keeps larger crowns easy to click */}
        <ellipse className="fdi-tooth__hit" cx="0" cy="0" rx={hit.rx} ry={hit.ry} />

        {missing ? (
          <>
            <ellipse
              className="fdi-tooth__missing-slot"
              cx="0"
              cy="0"
              rx={hit.rx * 0.72}
              ry={hit.ry * 0.72}
              fill="none"
              strokeDasharray="4 3.5"
            />
            <path
              className="fdi-tooth__missing-mark"
              d="M -7 -7 L 7 7 M 7 -7 L -7 7"
              fill="none"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </>
        ) : (
          <>
            {/* Soft contact shadow under the crown */}
            <ellipse
              className="fdi-tooth__shadow"
              cx="1.8"
              cy="3.2"
              rx={hit.rx * 0.78}
              ry={hit.ry * 0.72}
            />

            {/* Ivory crown body */}
            <path className="fdi-tooth__shape" d={shape.outline} />

            {/* Soft inner shade for thickness / enamel rim */}
            {shape.shade ? <path className="fdi-tooth__shade" d={shape.shade} /> : null}

            {/* Raised cusp mounds */}
            {(shape.cusps || []).map((cusp, index) => (
              <ellipse
                key={`cusp-${index}`}
                className="fdi-tooth__cusp"
                cx={cusp.cx}
                cy={cusp.cy}
                rx={cusp.rx}
                ry={cusp.ry}
              />
            ))}

            {/* Occlusal grooves / fissures */}
            {shape.grooves ? (
              <path
                className="fdi-tooth__detail"
                d={shape.grooves}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}

            {/* Specular gloss wash */}
            <path className="fdi-tooth__highlight" d={shape.outline} />

            {/* Status markers — keep ivory body visible */}
            {status === "needs_attention" || status === "fractured" ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--attention" cx="11" cy="-18" r="4" />
            ) : null}
            {status === "treated" ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--treated" cx="11" cy="-18" r="4" />
            ) : null}
            {status === "under_treatment" ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--under" cx="11" cy="-18" r="4" />
            ) : null}
            {record?.treatments?.length ? (
              <circle className="fdi-tooth__marker fdi-tooth__marker--note" cx="-11" cy="-18" r="3.1" />
            ) : null}
          </>
        )}

        {selected ? (
          <ellipse className="fdi-tooth__selection" cx="0" cy="0" rx={hit.rx * 1.05} ry={hit.ry * 1.05} />
        ) : null}
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
