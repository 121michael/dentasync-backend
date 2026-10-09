import { useEffect, useId, useState } from "react";
import { FRONT_TOOTH_SHAPES, TOOTH_VIEW } from "./DentalChart/toothShapes";

function ToothMark({ compact = false }) {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-enamel-${uid}`;
  const gumId = `tooth-gum-${uid}`;
  const width = compact ? 148 : 200;
  const height = compact ? 128 : 172;
  const shape = FRONT_TOOTH_SHAPES.central_incisor;
  const { width: vbW, height: vbH } = TOOTH_VIEW;
  const toothX = (160 - vbW) / 2;
  const toothY = 18;

  return (
    <div className="tooth-loader__scene" aria-hidden="true">
      <svg
        className="tooth-loader__svg"
        viewBox="0 0 160 140"
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
          <linearGradient id={gumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f3e6f8" />
            <stop offset="55%" stopColor="#e4d0ef" />
            <stop offset="100%" stopColor="#d4b8e4" />
          </linearGradient>
        </defs>

        <g transform={`translate(${toothX} ${toothY})`}>
          <g className="tooth-loader__erupt">
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
          </g>
        </g>

        <path
          className="tooth-loader__gums"
          d="M14 72c18-9 34-6 50-11 8-2.4 14-2.4 18 0 16 5 32 2 50 11v46c-22 12-80 12-118 0V72z"
          fill={`url(#${gumId})`}
          stroke="#c9b3e4"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path
          d="M28 78c20-6 36-3 52-7 8-2 12-2 16 0 16 4 32 1 44 7"
          fill="none"
          stroke="rgba(255,255,255,0.45)"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

/**
 * Full-screen and inline loading UI: a tooth erupting through the gum line.
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
      <ToothMark compact={compact} />

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
