import { useEffect, useId, useState } from "react";

function ToothMark({ compact = false }) {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-enamel-${uid}`;
  const width = compact ? 72 : 120;
  const height = compact ? 96 : 160;

  return (
    <div className="tooth-loader__grow" aria-hidden="true">
      <svg
        className="tooth-loader__svg"
        viewBox="0 0 80 112"
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
          className="tooth-loader__crown"
          d="M40 6c-12.5 0-22 10.2-22 24.5 0 7.4 2.2 13.8 5.6 19.2 2.6 4.2 4.8 8.8 5.6 14.2.6 4.2 1.4 10.6 2.6 18.4.4 2.4 1.6 4.2 3.4 4.2h9.6c1.8 0 3-1.8 3.4-4.2 1.2-7.8 2-14.2 2.6-18.4.8-5.4 3-10 5.6-14.2 3.4-5.4 5.6-11.8 5.6-19.2C62 16.2 52.5 6 40 6z"
          fill={`url(#${enamelId})`}
          stroke="#c9b3e4"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
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
