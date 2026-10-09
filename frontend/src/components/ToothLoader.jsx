import { useEffect, useId, useState } from "react";
import { FRONT_TOOTH_SHAPES, TOOTH_VIEW } from "./DentalChart/toothShapes";

function ToothMark({ compact = false }) {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-enamel-${uid}`;
  const width = compact ? 78 : 118;
  const height = compact ? 104 : 158;
  const shape = FRONT_TOOTH_SHAPES.central_incisor;
  const { width: vbW, height: vbH } = TOOTH_VIEW;

  return (
    <div className="tooth-loader__grow" aria-hidden="true">
      <svg
        className="tooth-loader__svg"
        viewBox={`-4 -4 ${vbW + 8} ${vbH + 8}`}
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={enamelId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="55%" stopColor="#f7f4fb" />
            <stop offset="100%" stopColor="#e8dcf6" />
          </linearGradient>
        </defs>
        {/* Chart geometry is root-up; flip so the crown is on top like a tooth icon. */}
        <g transform={`translate(0 ${vbH}) scale(1 -1)`}>
          {shape.roots.map((d) => (
            <path
              key={d}
              className="tooth-loader__crown"
              d={d}
              fill={`url(#${enamelId})`}
              stroke="#c9b3e4"
              strokeWidth="1.15"
              strokeLinejoin="round"
            />
          ))}
          <path
            className="tooth-loader__crown"
            d={shape.crown}
            fill={`url(#${enamelId})`}
            stroke="#c9b3e4"
            strokeWidth="1.15"
            strokeLinejoin="round"
          />
          {shape.details.map((d) => (
            <path
              key={d}
              d={d}
              fill="none"
              stroke="#c9b3e4"
              strokeWidth="0.85"
              strokeLinecap="round"
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/**
 * Full-screen and inline loading UI: a single growing tooth on a white panel background.
 */
export function ToothLoader({
  label = "Loading",
  overlay = false,
  compact = false,
  className = "",
  active = true,
}) {
  const [mounted, setMounted] = useState(active);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (active) {
      setMounted(true);
      let frame2 = 0;
      const frame1 = window.requestAnimationFrame(() => {
        frame2 = window.requestAnimationFrame(() => setShown(true));
      });
      return () => {
        window.cancelAnimationFrame(frame1);
        window.cancelAnimationFrame(frame2);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), 360);
    return () => window.clearTimeout(timer);
  }, [active]);

  if (!mounted) return null;

  const classes = [
    "tooth-loader",
    overlay ? "tooth-loader--overlay" : "tooth-loader--inline",
    compact ? "tooth-loader--compact" : "",
    shown ? "is-visible" : "is-hiding",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const labelText = String(label).replace(/\.+$/, "") || "Loading";

  const content = (
    <div
      className="tooth-loader__content"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={labelText === "Loading" ? "Loading" : labelText}
    >
      <div className="tooth-loader__smile">
        <ToothMark compact={compact} />
      </div>

      {label ? (
        <p className="tooth-loader__label">
          <span className="tooth-loader__label-text">{labelText}</span>
          <span className="tooth-loader__ellipsis" aria-hidden="true">
            <span>.</span>
            <span>.</span>
            <span>.</span>
          </span>
        </p>
      ) : null}
    </div>
  );

  if (overlay) {
    return (
      <div className={classes}>
        <div className="tooth-loader__backdrop" />
        {content}
      </div>
    );
  }

  return <div className={classes}>{content}</div>;
}

/** Alias matching the requested LoadingScreen name. */
export function LoadingScreen(props) {
  return <ToothLoader overlay label={props?.label || "Loading"} {...props} />;
}
