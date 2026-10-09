import { useEffect, useId, useState } from "react";

function ToothMark({ compact = false }) {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-enamel-${uid}`;
  const gumId = `tooth-gum-${uid}`;
  const clipId = `tooth-erupt-clip-${uid}`;
  const width = compact ? 156 : 210;
  const height = compact ? 132 : 176;

  return (
    <div className="tooth-loader__scene" aria-hidden="true">
      <svg
        className="tooth-loader__svg"
        viewBox="0 0 200 150"
        width={width}
        height={height}
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={enamelId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="62%" stopColor="#f7f4fb" />
            <stop offset="100%" stopColor="#eadff4" />
          </linearGradient>
          <linearGradient id={gumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f4e8f9" />
            <stop offset="55%" stopColor="#e6d2f0" />
            <stop offset="100%" stopColor="#d7bee6" />
          </linearGradient>
          <clipPath id={clipId}>
            <path d="M0 0 H200 V92 C150 84 138 74 128 76 C118 92 110 100 100 100 C90 100 82 92 72 76 C62 74 50 84 0 92 Z" />
          </clipPath>
        </defs>

        <g clipPath={`url(#${clipId})`}>
          <g className="tooth-loader__erupt">
            <path
              className="tooth-loader__crown"
              d="M72 16 H128 C136 16 140 22 138 30 L118 90 C116 98 108 102 100 102 C92 102 84 98 82 90 L62 30 C60 22 64 16 72 16 Z"
              fill={`url(#${enamelId})`}
              stroke="#c9b3e4"
              strokeWidth="1.55"
              strokeLinejoin="round"
            />
            <path
              d="M88 30 v50 M112 30 v50"
              fill="none"
              stroke="#d4c0e8"
              strokeWidth="1.1"
              strokeLinecap="round"
            />
          </g>
        </g>

        <path
          className="tooth-loader__gums"
          d="M44 94 C56 84 64 74 72 76 C82 92 90 101 100 101 C110 101 118 92 128 76 C136 74 144 84 156 94 C168 106 168 122 154 132 C128 146 72 146 46 132 C32 122 32 106 44 94 Z"
          fill={`url(#${gumId})`}
          stroke="#c9b3e4"
          strokeWidth="1.4"
          strokeLinejoin="round"
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
