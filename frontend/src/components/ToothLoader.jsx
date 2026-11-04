import { useEffect, useId, useState } from "react";

const TOOTH_SHAPES = {
  central: {
    crown:
      "M-23 8C-24.2-4-23.8-24-21.6-44C-19.6-56-13.2-62-5.6-63.2H5.6C13.2-62 19.6-56 21.6-44C23.8-24 24.2-4 23 8C13.2 13.2-13.2 13.2-23 8Z",
  },
  lateral: {
    crown:
      "M-18.5 8C-19.6-4-19.2-22-17.4-40C-15.6-52-10.2-57.4-4.8-58.6H4.8C10.2-57.4 15.6-52 17.4-40C19.2-22 19.6-4 18.5 8C11.2 12.8-11.2 12.8-18.5 8Z",
  },
  canine: {
    crown:
      "M-17.4 8C-18.6-5-18-24-14.4-42C-11.6-54-6.6-60.5-2.2-63C-0.7-63.8 0.7-63.8 2.2-63C6.6-60.5 11.6-54 14.4-42C18-24 18.6-5 17.4 8C10.4 12.8-10.4 12.8-17.4 8Z",
  },
  premolar: {
    crown:
      "M-21 8C-22.2-3-21.8-20-19.2-36C-17.2-47-11.8-52-5.8-53.2H5.8C11.8-52 17.2-47 19.2-36C21.8-20 22.2-3 21 8C12.4 13.2-12.4 13.2-21 8Z",
  },
  molar: {
    crown:
      "M-23.5 9C-24.8-1-24.4-16-21.4-31C-19-41-13.2-46-6.6-47.2H6.6C13.2-46 19-41 21.4-31C24.4-16 24.8-1 23.5 9C14 14.4-14 14.4-23.5 9Z",
  },
};

const ARCH_TEETH = [
  { kind: "molar", x: 50, y: 162, angle: -7, delay: "0s" },
  { kind: "premolar", x: 96, y: 150, angle: -4, delay: "0.12s" },
  { kind: "canine", x: 136, y: 136, angle: -2, delay: "0.24s" },
  { kind: "lateral", x: 174, y: 126, angle: -1, delay: "0.36s" },
  { kind: "central", x: 211, y: 120, angle: 0, delay: "0.48s" },
  { kind: "central", x: 253, y: 120, angle: 0, delay: "0.6s" },
  { kind: "lateral", x: 290, y: 126, angle: 1, delay: "0.72s" },
  { kind: "canine", x: 328, y: 136, angle: 2, delay: "0.84s" },
  { kind: "premolar", x: 368, y: 150, angle: 4, delay: "0.96s" },
  { kind: "molar", x: 414, y: 162, angle: 7, delay: "1.08s" },
];

const GUM_PAD =
  "M16 180Q32 162 50 174Q72 150 96 168Q114 142 136 158Q154 132 174 148Q190 124 211 140Q232 116 253 140Q274 124 290 148Q310 132 328 158Q350 142 368 168Q392 150 414 174Q432 162 448 180L450 204C418 232 332 244 232 240C132 244 46 232 14 204Z";

function ToothRow({ enamelId, flipped }) {
  return (
    <g className="tooth-loader__teeth">
      {ARCH_TEETH.map((tooth) => {
        const shape = TOOTH_SHAPES[tooth.kind];
        const anchor = flipped
          ? `translate(${tooth.x} ${124 - tooth.y}) rotate(${-tooth.angle}) scale(1,-1)`
          : `translate(${tooth.x} ${tooth.y}) rotate(${tooth.angle})`;
        return (
          <g key={`${flipped ? "u" : "l"}-${tooth.kind}-${tooth.x}`} transform={anchor}>
            <g className="tooth-loader__tooth" style={{ "--tooth-delay": tooth.delay }}>
              <path
                className="tooth-loader__crown"
                d={shape.crown}
                fill={`url(#${enamelId})`}
                stroke="var(--tooth-stroke)"
                strokeWidth="1.35"
                strokeLinejoin="round"
              />
            </g>
          </g>
        );
      })}
    </g>
  );
}

function GumPad({ gumId, flipped }) {
  const pad = <path className="tooth-loader__gumline" d={GUM_PAD} fill={`url(#${gumId})`} />;
  if (!flipped) return pad;
  return <g transform="translate(0 124) scale(1,-1)">{pad}</g>;
}

function DentalArch() {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-loader-enamel-${uid}`;
  const gumId = `tooth-loader-gum-${uid}`;

  return (
    <div className="tooth-loader__arch" aria-hidden="true">
      <svg className="tooth-loader__svg" viewBox="0 0 464 340" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={enamelId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="var(--tooth-enamel-deep)" />
            <stop offset="100%" stopColor="var(--tooth-enamel-tip)" />
          </linearGradient>
          <linearGradient id={gumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tooth-gum-hi)" />
            <stop offset="38%" stopColor="var(--tooth-gum-mid)" />
            <stop offset="100%" stopColor="var(--tooth-gum-deep)" />
          </linearGradient>
        </defs>

        <g transform="translate(0 8)">
          <GumPad gumId={gumId} flipped />
          <ToothRow enamelId={enamelId} flipped />
          <GumPad gumId={gumId} />
          <ToothRow enamelId={enamelId} />
        </g>
      </svg>
    </div>
  );
}

/**
 * Shared Amethyst loading UI: a natural dental arch emerging from one gumline.
 */
export function ToothLoader({
  label = "Loading",
  overlay = false,
  compact = false,
  className = "",
  active = true,
}) {
  const [mounted, setMounted] = useState(active);
  const [shown, setShown] = useState(active);

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
      <DentalArch />
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
