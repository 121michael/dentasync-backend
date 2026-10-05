import { useEffect, useId, useState } from "react";

const TEETH = [
  { kind: "molar", x: 18, y: 46 },
  { kind: "premolar", x: 44, y: 32 },
  { kind: "canine", x: 68, y: 20 },
  { kind: "incisor", x: 90, y: 14 },
  { kind: "incisor", x: 112, y: 14 },
  { kind: "canine", x: 134, y: 20 },
  { kind: "premolar", x: 158, y: 32 },
  { kind: "molar", x: 184, y: 46 },
];

function toothPath(kind) {
  if (kind === "molar") {
    return "M2 8c0-3 2-8 9-10 7 2 9 7 9 10v16.5c0 2.4-1.8 4.5-4.2 4.5H15c-1.4 0-2.2-1.2-2.8-2.4-.6 1.2-1.4 2.4-2.8 2.4H6.2C3.8 29 2 26.9 2 24.5V8z";
  }
  if (kind === "premolar") {
    return "M3 7c0-3 2.2-8 8-9.5C16.8-1 19 4 19 7v16c0 2.2-1.7 4-3.8 4h-2.6c-1.2 0-1.9-1-2.4-2.1-.5 1.1-1.2 2.1-2.4 2.1H6.8C4.7 27 3 25.2 3 23V7z";
  }
  if (kind === "canine") {
    return "M4 8c0-4 2.4-12 7.5-16C16.6-4 19 4 19 8v15c0 2.1-1.7 3.8-3.8 3.8H7.8C5.7 26.8 4 25.1 4 23V8z";
  }
  return "M5 6c0-3 2-12 6.5-15C16-6 18 3 18 6v16.5c0 2-1.6 3.6-3.6 3.6H8.6C6.6 26.1 5 24.5 5 22.5V6z";
}

function TeethMark({ compact = false }) {
  const uid = useId().replace(/:/g, "");
  const enamelId = `teeth-enamel-${uid}`;
  const width = compact ? 132 : 210;
  const height = compact ? 58 : 90;

  return (
    <svg
      className="tooth-loader__svg"
      viewBox="0 0 210 90"
      width={width}
      height={height}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={enamelId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="55%" stopColor="#f7f4fb" />
          <stop offset="100%" stopColor="#e8dcf6" />
        </linearGradient>
      </defs>
      <path
        className="tooth-loader__gumline"
        d="M8 58c28-28 56-42 97-42s69 14 97 42"
        fill="none"
        stroke="rgba(115,59,170,0.16)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      {TEETH.map((tooth, index) => (
        <g key={`${tooth.kind}-${index}`} transform={`translate(${tooth.x} ${tooth.y})`}>
          <g className="tooth-loader__unit" style={{ "--tooth-index": index }}>
            <path
              className="tooth-loader__crown"
              d={toothPath(tooth.kind)}
              fill={`url(#${enamelId})`}
              stroke="#c9b3e4"
              strokeWidth="1.15"
              strokeLinejoin="round"
            />
          </g>
        </g>
      ))}
    </svg>
  );
}

/**
 * Full-screen and inline loading UI: a smile of teeth on a white login-panel background.
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
      <div className="tooth-loader__smile" aria-hidden="true">
        <TeethMark compact={compact} />
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
