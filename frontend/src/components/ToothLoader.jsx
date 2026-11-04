import { useEffect, useId, useState } from "react";

const TOOTH_SHAPES = {
  central: {
    crown:
      "M-19.5 7C-21-8-20.6-30-18.8-48C-17.2-59-12.6-64-6.4-65.2C-2.2-66 2.2-66 6.4-65.2C12.6-64 17.2-59 18.8-48C20.6-30 21-8 19.5 7C12 13-12 13-19.5 7Z",
  },
  lateral: {
    crown:
      "M-14.8 7C-16.2-6-15.8-28-14.2-45C-12.8-55.5-9-60.4-4.6-61.6C-1.6-62.3 1.6-62.3 4.6-61.6C9-60.4 12.8-55.5 14.2-45C15.8-28 16.2-6 14.8 7C9 12.2-9 12.2-14.8 7Z",
  },
  canine: {
    crown:
      "M-13.6 7C-15-7-14.4-28-11.8-46C-9.8-56-6-62.5-2.2-65C-0.7-65.7 0.7-65.7 2.2-65C6-62.5 9.8-56 11.8-46C14.4-28 15-7 13.6 7C8.2 12.2-8.2 12.2-13.6 7Z",
  },
  premolar: {
    crown:
      "M-15.4 8C-16.8-5-16.4-24-14.4-41C-12.8-50.5-9.2-55.2-4.8-56.4C-1.7-57.1 1.7-57.1 4.8-56.4C9.2-55.2 12.8-50.5 14.4-41C16.4-24 16.8-5 15.4 8C9.6 13-9.6 13-15.4 8Z",
  },
  molar: {
    crown:
      "M-16.8 9C-18.2-3-17.8-20-15.8-36C-14.2-45.5-10.4-50-5.6-51.2C-2-51.9 2-51.9 5.6-51.2C10.4-50 14.2-45.5 15.8-36C17.8-20 18.2-3 16.8 9C10.4 13.6-10.4 13.6-16.8 9Z",
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

const CURVE = { molar: 10, premolar: 6, canine: 3, lateral: 1, central: 0 };
const ANGLE = { molar: 4, premolar: 2.4, canine: 1.4, lateral: 0.6, central: 0 };
const LOWER_BASE = 216;
const UPPER_BASE = 90;

const GUM_PAD =
  "M86 204C58 206 46 224 52 244C62 272 118 290 232 286C346 290 402 272 412 244C418 224 406 206 378 204C354 192 328 184 304 190C280 182 256 180 236 186C232 184 232 182 232 186C232 182 232 184 228 186C204 180 180 182 156 190C132 184 106 192 86 204Z";

const GUM_INNER =
  "M100 206C124 192 148 186 172 194C196 186 216 182 232 188C248 182 268 186 292 194C316 186 340 192 364 206";

function sideSign(tooth) {
  return tooth.x < 232 ? -1 : 1;
}

function smileX(tooth) {
  return 232 + (tooth.x - 232) * 0.72;
}

function placement(tooth, jaw) {
  const curve = CURVE[tooth.kind];
  const angle = ANGLE[tooth.kind] * sideSign(tooth);
  const x = smileX(tooth);
  if (jaw === "lower") {
    return { x, y: LOWER_BASE + curve, angle };
  }
  return { x, y: UPPER_BASE - curve, angle: -angle };
}

function ToothSlot({ tooth, enamelId, jaw }) {
  const shape = TOOTH_SHAPES[tooth.kind];
  const { x, y, angle } = placement(tooth, jaw);
  const crown = (
    <g className="tooth-loader__tooth" style={{ "--tooth-delay": tooth.delay }}>
      <path
        className="tooth-loader__crown"
        d={shape.crown}
        fill={`url(#${enamelId})`}
        stroke="var(--tooth-stroke)"
        strokeWidth="1.65"
        strokeLinejoin="round"
      />
    </g>
  );

  if (jaw === "lower") {
    return <g transform={`translate(${x} ${y}) rotate(${angle})`}>{crown}</g>;
  }

  return (
    <g transform={`translate(${x} ${y}) rotate(${angle})`}>
      <g transform="scale(1,-1)">{crown}</g>
    </g>
  );
}

function GumPad({ gumId, jaw }) {
  const pad = (
    <>
      <path className="tooth-loader__gumline" d={GUM_PAD} fill={`url(#${gumId})`} />
      <path
        className="tooth-loader__gum-highlight"
        d={GUM_INNER}
        fill="none"
        stroke="var(--tooth-gum-line)"
        strokeWidth="2.2"
        strokeLinecap="round"
        opacity="0.65"
      />
    </>
  );

  if (jaw === "lower") {
    return <g transform={`translate(0 ${LOWER_BASE - 214})`}>{pad}</g>;
  }
  return <g transform={`translate(0 ${UPPER_BASE + 214}) scale(1,-1)`}>{pad}</g>;
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
            <stop offset="55%" stopColor="var(--tooth-enamel-hi)" />
            <stop offset="100%" stopColor="var(--tooth-enamel-tip)" />
          </linearGradient>
          <linearGradient id={gumId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--tooth-gum-hi)" />
            <stop offset="45%" stopColor="var(--tooth-gum-mid)" />
            <stop offset="100%" stopColor="var(--tooth-gum-deep)" />
          </linearGradient>
        </defs>

        <GumPad gumId={gumId} jaw="upper" />
        <g className="tooth-loader__teeth tooth-loader__teeth--upper">
          {ARCH_TEETH.map((tooth) => (
            <ToothSlot key={`upper-${tooth.kind}-${tooth.x}`} tooth={tooth} enamelId={enamelId} jaw="upper" />
          ))}
        </g>

        <GumPad gumId={gumId} jaw="lower" />
        <g className="tooth-loader__teeth tooth-loader__teeth--lower">
          {ARCH_TEETH.map((tooth) => (
            <ToothSlot key={`lower-${tooth.kind}-${tooth.x}`} tooth={tooth} enamelId={enamelId} jaw="lower" />
          ))}
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
