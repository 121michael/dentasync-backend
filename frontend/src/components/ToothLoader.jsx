import { useEffect, useId, useState } from "react";

const TOOTH_SHAPES = {
  central: {
    crown:
      "M-23 7C-24.2-6-23.6-26-21.2-42C-19.2-52-13.8-58.5-6.2-59.6H6.2C13.8-58.5 19.2-52 21.2-42C23.6-26 24.2-6 23 7C13.5 12.5-13.5 12.5-23 7Z",
  },
  lateral: {
    crown:
      "M-14.6 7C-15.6-5-15.2-24-13.6-40C-12.2-50-8.4-55.6-4.2-56.8C-1.5-57.4 1.5-57.4 4.2-56.8C8.4-55.6 12.2-50 13.6-40C15.2-24 15.6-5 14.6 7C8.8 12-8.8 12-14.6 7Z",
  },
  canine: {
    crown:
      "M-12.4 7C-13.6-6-13-25-10.4-42C-8.4-51.5-5-57.8-1.8-60.4C-0.6-61.2 0.6-61.2 1.8-60.4C5-57.8 8.4-51.5 10.4-42C13-25 13.6-6 12.4 7C7.6 12-7.6 12-12.4 7Z",
  },
  premolar: {
    crown:
      "M-12.8 8C-13.8-4-13.4-22-11.6-37C-10.2-46-7.2-50.8-3.8-51.8C-1.3-52.4 1.3-52.4 3.8-51.8C7.2-50.8 10.2-46 11.6-37C13.4-22 13.8-4 12.8 8C7.8 12.4-7.8 12.4-12.8 8Z",
  },
  molar: {
    crown:
      "M-13.2 9C-14.2-2-13.8-18-12-32C-10.6-40.5-7.6-44.8-4-45.6C-1.4-46.2 1.4-46.2 4-45.6C7.6-44.8 10.6-40.5 12-32C13.8-18 14.2-2 13.2 9C8 13-8 13-13.2 9Z",
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

const BITE_PLANE = 62;
const ART_OFFSET_Y = 58;

const GUM_PAD =
  "M20 166C12 148 28 140 50 148C70 134 84 132 96 146C114 132 126 128 136 142C154 128 166 124 174 138C192 124 204 120 211 134C224 122 232 120 232 128C232 120 240 122 253 134C262 120 272 124 290 138C304 124 316 128 328 142C342 128 354 132 368 146C382 132 396 134 414 148C436 140 452 148 444 166C436 188 400 206 320 214C280 220 248 216 232 222C216 216 184 220 144 214C64 206 28 188 20 166Z";

const GUM_INNER =
  "M50 152C68 140 82 138 96 150C114 138 126 134 136 146C152 134 164 130 174 142C190 130 202 126 211 138C222 128 230 126 232 134C234 126 242 128 253 138C264 126 274 130 290 142C304 130 316 134 328 146C342 134 354 138 368 150C384 138 398 140 414 152";

function ToothSlot({ tooth, enamelId, flipped }) {
  const shape = TOOTH_SHAPES[tooth.kind];
  const crown = (
    <g className="tooth-loader__tooth" style={{ "--tooth-delay": tooth.delay }}>
      <path
        className="tooth-loader__crown"
        d={shape.crown}
        fill={`url(#${enamelId})`}
        stroke="var(--tooth-stroke)"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </g>
  );

  if (!flipped) {
    return (
      <g transform={`translate(${tooth.x} ${tooth.y}) rotate(${tooth.angle})`}>
        {crown}
      </g>
    );
  }

  return (
    <g transform={`translate(${tooth.x} ${BITE_PLANE * 2 - tooth.y}) rotate(${-tooth.angle})`}>
      <g transform="scale(1,-1)">{crown}</g>
    </g>
  );
}

function GumPad({ gumId, flipped }) {
  const pad = <path className="tooth-loader__gumline" d={GUM_PAD} fill={`url(#${gumId})`} />;
  if (!flipped) return <g>{pad}</g>;
  return <g transform={`translate(0 ${BITE_PLANE * 2}) scale(1,-1)`}>{pad}</g>;
}

function DentalArch() {
  const uid = useId().replace(/:/g, "");
  const enamelId = `tooth-loader-enamel-${uid}`;
  const gumId = `tooth-loader-gum-${uid}`;

  return (
    <div className="tooth-loader__arch" aria-hidden="true">
      <svg className="tooth-loader__svg" viewBox="0 0 464 300" focusable="false" aria-hidden="true">
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

        <g transform={`translate(0 ${ART_OFFSET_Y})`}>
          <GumPad gumId={gumId} flipped />
          <g className="tooth-loader__teeth">
            {ARCH_TEETH.map((tooth) => (
              <ToothSlot key={`upper-${tooth.kind}-${tooth.x}`} tooth={tooth} enamelId={enamelId} flipped />
            ))}
          </g>
          <path
            className="tooth-loader__gum-highlight"
            d={GUM_INNER}
            fill="none"
            stroke="var(--tooth-gum-line)"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity="0.85"
            transform={`translate(0 ${BITE_PLANE * 2}) scale(1,-1)`}
          />

          <GumPad gumId={gumId} />
          <g className="tooth-loader__teeth">
            {ARCH_TEETH.map((tooth) => (
              <ToothSlot key={`lower-${tooth.kind}-${tooth.x}`} tooth={tooth} enamelId={enamelId} />
            ))}
          </g>
          <path
            className="tooth-loader__gum-highlight"
            d={GUM_INNER}
            fill="none"
            stroke="var(--tooth-gum-line)"
            strokeWidth="3.2"
            strokeLinecap="round"
            opacity="0.85"
          />
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
