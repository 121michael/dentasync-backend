/** Classic molar outline reused from the clinical dental chart shapes. */
const TOOTH_OUTLINE =
  "M -3.5 -19.5 C -9 -20.5 -14.5 -18 -17 -13 C -19.2 -9 -19.5 -3.5 -18 1 C -19.8 4.5 -18.8 10.5 -15.5 14.5 C -12 19 -6 21 -0.5 21 C 5 21.2 11.5 19 15.2 14.8 C 18.5 11 19.8 5 18.8 0.5 C 20 -3.5 19.5 -9 17.2 -13 C 14.5 -18 9 -20.5 2.5 -20 C 0.5 -20 -1.5 -19.8 -3.5 -19.5 Z";

const TOOTH_SHADE =
  "M -2.8 -16 C -7.5 -16.8 -12 -14.8 -14.2 -10.5 C -16 -7 -16.2 -2.5 -15 1 C -16.5 4 -15.5 9 -12.8 12.5 C -9.8 16.5 -5 18 -0.2 18 C 4.5 18.2 10 16.2 13 12.5 C 15.5 9.5 16.5 4.5 15.8 0.5 C 16.8 -3 16.5 -7.2 14.5 -10.8 C 12.2 -15 7.5 -16.8 2 -16.5 C 0.5 -16.5 -1 -16.2 -2.8 -16 Z";

const TOOTH_GROOVES = "M 0 -13.5 L 0 15 M -13.5 0 L 13.5 0 M -9 -7.5 Q 0 -11 9 -7.5 M -9.5 8 Q 0 4.5 9.5 8";

/**
 * Reusable tooth-shaped loader for Amethyst Dental Clinic.
 * Use as a full-screen overlay (`overlay`) or an inline status (`inline`).
 */
export function ToothLoader({
  label = "Loading...",
  overlay = false,
  compact = false,
  className = "",
}) {
  const classes = [
    "tooth-loader",
    overlay ? "tooth-loader--overlay" : "tooth-loader--inline",
    compact ? "tooth-loader--compact" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <div className="tooth-loader__content" role="status" aria-live="polite" aria-busy="true">
      <span className="tooth-loader__glow" aria-hidden="true" />
      <svg
        className="tooth-loader__icon"
        viewBox="-24 -26 48 52"
        width={compact ? 42 : 72}
        height={compact ? 42 : 72}
        aria-hidden="true"
      >
        <path className="tooth-loader__outline" d={TOOTH_OUTLINE} />
        <path className="tooth-loader__shade" d={TOOTH_SHADE} />
        <path className="tooth-loader__grooves" d={TOOTH_GROOVES} fill="none" />
      </svg>
      {label ? <p className="tooth-loader__label">{label}</p> : null}
      <span className="tooth-loader__dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
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
  return <ToothLoader overlay label={props?.label || "Loading..."} {...props} />;
}
