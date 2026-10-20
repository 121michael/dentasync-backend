import { useEffect, useId, useState } from "react";

const TOOTH_PATH =
  "M13 8c0-3.2 4.6-5 11-5s11 1.8 11 5c1.1 6.2 1.6 12.4.8 18.2L34.2 38c-.8 6.2-4.8 10.8-10.2 12.4C18.6 48.8 14.6 44.2 13.8 38L12.2 26.2C11.4 20.4 11.9 14.2 13 8Z";

const GROOVE_PATH = "M24 14.5v22.5";

const TEETH = [
  { delay: "0s", scale: 0.9 },
  { delay: "0.16s", scale: 0.98 },
  { delay: "0.32s", scale: 1 },
  { delay: "0.48s", scale: 0.98 },
  { delay: "0.64s", scale: 0.9 },
];

function GrowingTeeth() {
  const uid = useId().replace(/:/g, "");

  return (
    <div className="tooth-loader__arcade" aria-hidden="true">
      <div className="tooth-loader__row">
        {TEETH.map((tooth, index) => {
          const enamelId = `tooth-enamel-${uid}-${index}`;
          return (
            <div
              key={enamelId}
              className="tooth-loader__sprout-wrap"
              style={{ transform: `scale(${tooth.scale})` }}
            >
              <div
                className="tooth-loader__sprout"
                style={{ animationDelay: tooth.delay }}
              >
              <svg
                className="tooth-loader__svg"
                viewBox="0 0 48 56"
                width="52"
                height="62"
                focusable="false"
                aria-hidden="true"
              >
                <defs>
                  <linearGradient id={enamelId} x1="0" y1="1" x2="0" y2="0">
                    <stop offset="0%" stopColor="#ffffff" />
                    <stop offset="58%" stopColor="#f8f4fc" />
                    <stop offset="100%" stopColor="#ede3f8" />
                  </linearGradient>
                </defs>
                <path
                  className="tooth-loader__crown"
                  d={TOOTH_PATH}
                  fill={`url(#${enamelId})`}
                  stroke="#8d6bb8"
                  strokeWidth="1.35"
                  strokeLinejoin="round"
                />
                <path
                  d={GROOVE_PATH}
                  fill="none"
                  stroke="#c9b3e4"
                  strokeWidth="0.9"
                  strokeLinecap="round"
                  opacity="0.7"
                />
              </svg>
              </div>
            </div>
          );
        })}
      </div>
      <div className="tooth-loader__gums" />
    </div>
  );
}

/**
 * Shared Amethyst loading UI: a row of teeth growing up from the gum line.
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
    const timer = window.setTimeout(() => setMounted(false), 280);
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
      aria-label={labelText}
    >
      <GrowingTeeth />
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

export function LoadingScreen(props) {
  return <ToothLoader overlay label={props?.label || "Loading"} {...props} />;
}
