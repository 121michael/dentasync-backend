import { useEffect, useState } from "react";

/**
 * Premium SVG tooth for Amethyst Dental Clinic loading states.
 * Clean molar silhouette — bright enamel with soft amethyst accents.
 */
function ToothMark({ size = 72 }) {
  return (
    <svg
      className="tooth-loader__icon"
      viewBox="0 0 64 72"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="toothEnamel" x1="18" y1="4" x2="48" y2="68" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="45%" stopColor="#f7f2fc" />
          <stop offset="100%" stopColor="#e9dff7" />
        </linearGradient>
        <linearGradient id="toothShade" x1="32" y1="10" x2="32" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#d4c0eb" stopOpacity="0.55" />
        </linearGradient>
        <linearGradient id="toothShine" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="45%" stopColor="#ffffff" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id="toothSoftShadow" x="-30%" y="-30%" width="160%" height="160%">
          <feDropShadow dx="0" dy="4" stdDeviation="3.5" floodColor="#733baa" floodOpacity="0.28" />
        </filter>
      </defs>

      {/* Soft outer glow disc */}
      <ellipse className="tooth-loader__aura" cx="32" cy="36" rx="26" ry="30" />

      <g className="tooth-loader__body" filter="url(#toothSoftShadow)">
        {/* Rounded clinical molar silhouette */}
        <path
          className="tooth-loader__outline"
          fill="url(#toothEnamel)"
          d="M32 6c8.6 0 15.2 5.2 17.4 12.6 1.4 4.6 1.1 9.4-.4 13.8-.7 2.1-1.1 4.1-.8 6.3.5 3.6 2.4 6.8 4.6 9.8 2.3 3.1 2.8 7.1.8 10.2-1.7 2.6-4.8 3.8-7.9 3.2-2.4-.5-4.4-2-5.8-3.9-1.5 2.4-3.5 4.4-6.1 5.1-3 .8-6.1-.4-7.9-2.9-1.9-2.6-1.7-6.1.1-9.1 1.9-3.1 3.8-6.4 4.2-10 .3-2.3-.1-4.4-.9-6.5C27.2 22.4 26.4 17.6 27.6 13 29.4 8.2 32.9 6 32 6z"
        />
        <path
          className="tooth-loader__shade"
          fill="url(#toothShade)"
          d="M32 12c6.2 0 10.8 3.6 12.4 8.8 1.1 3.5.8 7.2-.4 10.6-.7 2-.9 3.8-.6 5.8.4 3 1.8 5.7 3.5 8.3 1.4 2.1 1.6 4.7.3 6.7-1 1.5-2.8 2.2-4.6 1.8-1.7-.4-3.1-1.6-4-3.1-.9 1.9-2.4 3.5-4.4 4-2.1.5-4.2-.3-5.4-2-1.3-1.8-1.2-4.3.1-6.4 1.5-2.5 3-5.2 3.3-8.1.2-2-.2-3.8-.9-5.6C30.5 24.8 29.9 21.2 30.8 18 31.6 14.6 33.2 12.4 32 12z"
          opacity="0.55"
        />
        {/* Subtle anatomy lines */}
        <path
          className="tooth-loader__grooves"
          d="M32 16v28M24.5 30.5h15"
          fill="none"
          stroke="rgba(115,59,170,0.22)"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* Traveling shine highlight */}
        <path
          className="tooth-loader__shine"
          fill="none"
          stroke="url(#toothShine)"
          strokeWidth="3.2"
          strokeLinecap="round"
          d="M32 6c8.6 0 15.2 5.2 17.4 12.6 1.4 4.6 1.1 9.4-.4 13.8-.7 2.1-1.1 4.1-.8 6.3.5 3.6 2.4 6.8 4.6 9.8 2.3 3.1 2.8 7.1.8 10.2-1.7 2.6-4.8 3.8-7.9 3.2-2.4-.5-4.4-2-5.8-3.9-1.5 2.4-3.5 4.4-6.1 5.1-3 .8-6.1-.4-7.9-2.9-1.9-2.6-1.7-6.1.1-9.1 1.9-3.1 3.8-6.4 4.2-10 .3-2.3-.1-4.4-.9-6.5C27.2 22.4 26.4 17.6 27.6 13 29.4 8.2 32.9 6 32 6z"
        />
      </g>
    </svg>
  );
}

/**
 * Reusable tooth-shaped loader for Amethyst Dental Clinic.
 * Use as a full-screen overlay (`overlay`) or an inline status (`inline`).
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
      const frame = window.requestAnimationFrame(() => setShown(true));
      return () => window.cancelAnimationFrame(frame);
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
    shown ? "is-visible" : "is-hidden",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <div
      className="tooth-loader__content"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label === "Loading" || label === "Loading..." ? "Loading" : label}
    >
      <span className="tooth-loader__glow" aria-hidden="true" />
      <div className="tooth-loader__stage" aria-hidden="true">
        <ToothMark size={compact ? 44 : 76} />
      </div>
      {label ? (
        <p className="tooth-loader__label">
          <span className="tooth-loader__label-text">
            {String(label).replace(/\.+$/, "") || "Loading"}
          </span>
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
