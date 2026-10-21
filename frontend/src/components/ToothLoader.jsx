import { useEffect, useId, useState } from "react";

const TOOTH_SHAPES = {
  central: {
    crown:
      "M-17 8C-19-6-19-25-14-43C-11-52-8-58-6-60H6C8-58 11-52 14-43C19-25 19-6 17 8C10 10-10 10-17 8Z",
    details: ["M-11-54Q0-57 11-54", "M-10-13Q0-8 10-13"],
  },
  lateral: {
    crown:
      "M-14 8C-16-5-16-23-12-39C-9-49-5-55-3-57H4C7-54 10-49 12-39C16-23 16-5 14 8C8 10-8 10-14 8Z",
    details: ["M-8-50Q0-53 8-50", "M-8-12Q0-8 8-12"],
  },
  canine: {
    crown:
      "M-14 8C-16-7-15-27-10-43L0-66L10-43C15-27 16-7 14 8C8 10-8 10-14 8Z",
    details: ["M0-60V-11", "M-9-12Q0-8 9-12"],
  },
  premolar: {
    crown:
      "M-20 8C-23-7-21-28-15-44C-10-54-6-57-2-51Q0-59 3-51C7-57 11-54 15-44C21-28 23-7 20 8C12 11-12 11-20 8Z",
    details: ["M-10-46Q0-38 10-46", "M-12-11Q0-6 12-11", "M0-42V-12"],
  },
  molar: {
    crown:
      "M-26 8C-29-7-28-27-21-43C-17-53-12-57-7-51Q-3-60 0-52Q3-60 7-51C12-57 17-53 21-43C28-27 29-7 26 8C16 12-16 12-26 8Z",
    details: ["M-14-45Q-7-36 0-45Q7-36 14-45", "M-16-11Q0-5 16-11", "M0-42V-10"],
  },
};

const ARCH_TEETH = [
  { kind: "molar", x: 50, y: 162, angle: -12, delay: "0s" },
  { kind: "premolar", x: 96, y: 150, angle: -8, delay: "0.12s" },
  { kind: "canine", x: 136, y: 136, angle: -4, delay: "0.24s" },
  { kind: "lateral", x: 174, y: 126, angle: -2, delay: "0.36s" },
  { kind: "central", x: 211, y: 120, angle: 0, delay: "0.48s" },
  { kind: "central", x: 253, y: 120, angle: 0, delay: "0.6s" },
  { kind: "lateral", x: 290, y: 126, angle: 2, delay: "0.72s" },
  { kind: "canine", x: 328, y: 136, angle: 4, delay: "0.84s" },
  { kind: "premolar", x: 368, y: 150, angle: 8, delay: "0.96s" },
  { kind: "molar", x: 414, y: 162, angle: 12, delay: "1.08s" },
];

function DentalArch() {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-loader-enamel-${uid}`;
  const gumId = `tooth-loader-gum-${uid}`;
  const shadowId = `tooth-loader-shadow-${uid}`;

  return (
    <div className="tooth-loader__arch" aria-hidden="true">
      <svg className="tooth-loader__svg" viewBox="0 0 464 210" focusable="false" aria-hidden="true">
        <defs>
          <linearGradient id={enamelId} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="#e9e1f3" />
            <stop offset="24%" stopColor="#fdfcff" />
            <stop offset="62%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#f0e8f8" />
          </linearGradient>
          <linearGradient id={gumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f5c9d8" />
            <stop offset="48%" stopColor="#e9a9c0" />
            <stop offset="100%" stopColor="#cc7f9e" />
          </linearGradient>
          <filter id={shadowId} x="-20%" y="-20%" width="140%" height="145%">
            <feDropShadow dx="0" dy="3" stdDeviation="2.4" floodColor="#72508f" floodOpacity="0.16" />
          </filter>
        </defs>

        <g className="tooth-loader__teeth">
          {ARCH_TEETH.map((tooth) => {
            const shape = TOOTH_SHAPES[tooth.kind];
            return (
              <g
                key={`${tooth.kind}-${tooth.x}`}
                transform={`translate(${tooth.x} ${tooth.y}) rotate(${tooth.angle})`}
              >
                <g className="tooth-loader__tooth" style={{ "--tooth-delay": tooth.delay }}>
                  <path
                    className="tooth-loader__crown"
                    d={shape.crown}
                    fill={`url(#${enamelId})`}
                    stroke="#9372bb"
                    strokeWidth="1.35"
                    strokeLinejoin="round"
                    filter={`url(#${shadowId})`}
                  />
                  {shape.details.map((detail) => (
                    <path
                      key={detail}
                      d={detail}
                      className="tooth-loader__detail"
                      fill="none"
                      stroke="#cbb9df"
                      strokeWidth="0.9"
                      strokeLinecap="round"
                    />
                  ))}
                </g>
              </g>
            );
          })}
        </g>

        <path
          className="tooth-loader__gumline"
          d="M22 159C40 149 57 145 76 148C90 151 101 141 112 136C126 128 137 130 148 132C159 123 171 118 185 119C198 112 211 109 232 116C253 109 266 112 279 119C293 118 305 123 316 132C328 130 339 128 352 136C363 141 374 151 388 148C407 145 424 149 442 159L442 184C402 202 62 202 22 184Z"
          fill={`url(#${gumId})`}
        />
        <path
          className="tooth-loader__gum-highlight"
          d="M28 160C47 153 62 152 77 155C93 157 103 147 115 142C128 136 138 138 149 140C162 131 173 127 186 128C200 121 212 119 232 125C252 119 264 121 278 128C291 127 302 131 315 140C326 138 337 136 349 142C361 147 372 157 388 155C403 152 418 153 436 160"
          fill="none"
          stroke="#f9d9e4"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.8"
        />
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
