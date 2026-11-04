import { useEffect, useId, useState } from "react";

const TOOTH_SHAPES = {
  central: {
    crown:
      "M-16 12C-18.2-6-17.2-26-14.2-44C-12-54-8.4-61-4.2-64.2C-1.6-66 1.6-66 4.2-64.2C8.4-61 12-54 14.2-44C17.2-26 18.2-6 16 12C10 14.6-10 14.6-16 12Z",
    details: ["M-7.5-54Q-2.5-56.5 0-54Q2.5-56.5 7.5-54", "M-8-14Q0-9 8-14"],
    sheen: "M-8.2-48C-10.4-34-9.4-18-6.2-5",
  },
  lateral: {
    crown:
      "M-13.2 12C-15-5-14.2-23-11.4-40C-9.2-50-5.6-56-2.8-58.4C-1.1-59.6 1.1-59.6 2.8-58.4C5.6-56 9.2-50 11.4-40C14.2-23 15-5 13.2 12C8.2 14.4-8.2 14.4-13.2 12Z",
    details: ["M-6-51Q0-53.4 6-51", "M-6.4-14Q0-9.5 6.4-14"],
    sheen: "M-7-44C-8.8-30-8-16-5.2-4",
  },
  canine: {
    crown:
      "M-13.8 12C-16-6-14.8-26-10.2-44C-6.8-54-3.2-61 0-66.5C3.2-61 6.8-54 10.2-44C14.8-26 16-6 13.8 12C8.4 14.6-8.4 14.6-13.8 12Z",
    details: ["M0-56V-14", "M-7.2-14Q0-9 7.2-14"],
    sheen: "M-6.4-42C-8.4-28-7.2-15-4.6-4",
  },
  premolar: {
    crown:
      "M-18.8 12C-21.6-6-20.2-26-15.2-43C-12.2-51-8.4-55-4.6-52C-2.4-58.5 2.4-58.5 4.6-52C8.4-55 12.2-51 15.2-43C20.2-26 21.6-6 18.8 12C12 15.2-12 15.2-18.8 12Z",
    details: ["M-8.5-47Q0-40 8.5-47", "M-10.5-14Q0-8 10.5-14", "M0-44V-14"],
    sheen: "M-10.5-40C-12.6-26-11.2-13-8-3",
  },
  molar: {
    crown:
      "M-24.5 12C-27.4-6-26.2-25-20.2-42C-16.4-51-12-55-7.2-50C-4.4-57.5 0-59 0-50C0-59 4.4-57.5 7.2-50C12-55 16.4-51 20.2-42C26.2-25 27.4-6 24.5 12C15.6 16.2-15.6 16.2-24.5 12Z",
    details: ["M-12.5-46Q-6.5-38 0-46Q6.5-38 12.5-46", "M-14.5-14Q0-7.5 14.5-14", "M0-43V-13"],
    sheen: "M-13.5-38C-15.6-25-13.2-13-9.4-3",
  },
};

const ARCH_TEETH = [
  { kind: "molar", x: 48, y: 158, angle: -8, delay: "0s" },
  { kind: "premolar", x: 94, y: 144, angle: -5, delay: "0.1s" },
  { kind: "canine", x: 134, y: 130, angle: -2.5, delay: "0.2s" },
  { kind: "lateral", x: 172, y: 120, angle: -1, delay: "0.3s" },
  { kind: "central", x: 210, y: 114, angle: 0, delay: "0.4s" },
  { kind: "central", x: 254, y: 114, angle: 0, delay: "0.5s" },
  { kind: "lateral", x: 292, y: 120, angle: 1, delay: "0.6s" },
  { kind: "canine", x: 330, y: 130, angle: 2.5, delay: "0.7s" },
  { kind: "premolar", x: 370, y: 144, angle: 5, delay: "0.8s" },
  { kind: "molar", x: 416, y: 158, angle: 8, delay: "0.9s" },
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
            <stop offset="0%" stopColor="var(--tooth-enamel-deep)" />
            <stop offset="32%" stopColor="var(--tooth-enamel-mid)" />
            <stop offset="70%" stopColor="var(--tooth-enamel-hi)" />
            <stop offset="100%" stopColor="var(--tooth-enamel-tip)" />
          </linearGradient>
          <linearGradient id={gumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tooth-gum-hi)" />
            <stop offset="48%" stopColor="var(--tooth-gum-mid)" />
            <stop offset="100%" stopColor="var(--tooth-gum-deep)" />
          </linearGradient>
          <filter id={shadowId} x="-18%" y="-18%" width="136%" height="140%">
            <feDropShadow dx="0" dy="2" stdDeviation="1.6" floodColor="var(--tooth-shadow)" floodOpacity="0.35" />
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
                    stroke="var(--tooth-stroke)"
                    strokeWidth="1.15"
                    strokeLinejoin="round"
                    filter={`url(#${shadowId})`}
                  />
                  <path
                    d={shape.sheen}
                    className="tooth-loader__sheen"
                    fill="none"
                    stroke="var(--tooth-sheen)"
                    strokeWidth="1.45"
                    strokeLinecap="round"
                  />
                  {shape.details.map((detail) => (
                    <path
                      key={detail}
                      d={detail}
                      className="tooth-loader__detail"
                      fill="none"
                      stroke="var(--tooth-detail)"
                      strokeWidth="0.72"
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
          d="M18 158C40 145 58 142 78 148C96 153 108 140 122 134C136 126 148 129 162 134C176 124 190 116 208 118C222 110 228 108 232 114C236 108 242 110 256 118C274 116 288 124 302 134C316 129 328 126 342 134C356 140 368 153 386 148C406 142 424 145 446 158L446 188C402 206 62 206 18 188Z"
          fill={`url(#${gumId})`}
        />
        <path
          className="tooth-loader__gum-highlight"
          d="M28 160C50 150 66 148 82 154C100 159 110 144 124 138C138 130 150 133 164 138C178 128 192 120 210 122C224 114 228 112 232 118C236 112 240 114 254 122C272 120 286 128 300 138C314 133 326 130 340 138C354 144 364 159 382 154C398 148 414 150 436 160"
          fill="none"
          stroke="var(--tooth-gum-line)"
          strokeWidth="1.2"
          strokeLinecap="round"
          opacity="0.7"
        />
        <path
          className="tooth-loader__gum-shadow"
          d="M34 176C102 190 362 190 430 176"
          fill="none"
          stroke="var(--tooth-gum-shade)"
          strokeWidth="1.05"
          strokeLinecap="round"
          opacity="0.28"
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
