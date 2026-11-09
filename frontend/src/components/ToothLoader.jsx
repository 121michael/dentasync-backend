import { useEffect, useId, useState } from "react";

/** Same delay ladder as the pre-swap arch in a7880df. */
const TOOTH_DELAYS = ["0s", "0.12s", "0.24s", "0.36s", "0.48s", "0.6s", "0.72s", "0.84s", "0.96s", "1.08s"];

function delayForIndex(index, count) {
  const slot = Math.round((index / (count - 1)) * (TOOTH_DELAYS.length - 1));
  return TOOTH_DELAYS[slot];
}

const UPPER_TOOTH_PATHS = [
  ["upper-r1", "M200,40 Q219,48 238,40 L238,125.1 Q238,134.1 229,134.1 L209,135 Q200,135 200,126 Z"],
  ["upper-r2", "M238,40 Q253,47.5 268,40 L268,124.1 Q268,132.1 260,132.1 L246,134.1 Q238,134.1 238,126.1 Z"],
  ["upper-r3", "M268,40 Q282,47 296,40 L296,122.2 Q296,129.2 289,129.2 L275,132.1 Q268,132.1 268,125.1 Z"],
  ["upper-r4", "M296,40 Q308,46.5 320,40 L320,119.9 Q320,125.9 314,125.9 L302,129.2 Q296,129.2 296,123.2 Z"],
  ["upper-r5", "M320,40 Q331,46 342,40 L342,116.3 Q342,122.3 336,122.3 L326,125.9 Q320,125.9 320,119.9 Z"],
  ["upper-r6", "M342,40 Q352,45.5 362,40 L362,113.4 Q362,118.4 357,118.4 L347,122.3 Q342,122.3 342,117.3 Z"],
  ["upper-r7", "M362,40 Q370,45 378,40 L378,110 Q378,115 373,115 L367,118.4 Q362,118.4 362,113.4 Z"],
  ["upper-l1", "M200,40 Q181,48 162,40 L162,125.1 Q162,134.1 171,134.1 L191,135 Q200,135 200,126 Z"],
  ["upper-l2", "M162,40 Q147,47.5 132,40 L132,124.1 Q132,132.1 140,132.1 L154,134.1 Q162,134.1 162,126.1 Z"],
  ["upper-l3", "M132,40 Q118,47 104,40 L104,122.2 Q104,129.2 111,129.2 L125,132.1 Q132,132.1 132,125.1 Z"],
  ["upper-l4", "M104,40 Q92,46.5 80,40 L80,119.9 Q80,125.9 86,125.9 L98,129.2 Q104,129.2 104,123.2 Z"],
  ["upper-l5", "M80,40 Q69,46 58,40 L58,116.3 Q58,122.3 64,122.3 L74,125.9 Q80,125.9 80,119.9 Z"],
  ["upper-l6", "M58,40 Q48,45.5 38,40 L38,113.4 Q38,118.4 43,118.4 L53,122.3 Q58,122.3 58,117.3 Z"],
  ["upper-l7", "M38,40 Q30,45 22,40 L22,110 Q22,115 27,115 L33,118.4 Q38,118.4 38,113.4 Z"],
];

const LOWER_TOOTH_PATHS = [
  ["lower-r1", "M200,200 L200,148 Q200,141 207,141 L219,140.6 Q226,140.6 226,147.6 L226,200 Q213,193 200,200 Z"],
  ["lower-r2", "M226,200 L226,147.6 Q226,140.6 233,140.6 L245,139.3 Q252,139.3 252,146.3 L252,200 Q239,193.4 226,200 Z"],
  ["lower-r3", "M252,200 L252,146.3 Q252,139.3 259,139.3 L273,137 Q280,137 280,144 L280,200 Q266,193.6 252,200 Z"],
  ["lower-r4", "M280,200 L280,143 Q280,137 286,137 L300,133.9 Q306,133.9 306,139.9 L306,200 Q293,194 280,200 Z"],
  ["lower-r5", "M306,200 L306,139.9 Q306,133.9 312,133.9 L324,130.3 Q330,130.3 330,136.3 L330,200 Q318,194.4 306,200 Z"],
  ["lower-r6", "M330,200 L330,135.3 Q330,130.3 335,130.3 L347,126.4 Q352,126.4 352,131.4 L352,200 Q341,194.6 330,200 Z"],
  ["lower-r7", "M352,200 L352,131.4 Q352,126.4 357,126.4 L365,122.8 Q370,122.8 370,127.8 L370,200 Q361,195 352,200 Z"],
  ["lower-l1", "M200,200 L200,148 Q200,141 193,141 L181,140.6 Q174,140.6 174,147.6 L174,200 Q187,193 200,200 Z"],
  ["lower-l2", "M174,200 L174,147.6 Q174,140.6 167,140.6 L155,139.3 Q148,139.3 148,146.3 L148,200 Q161,193.4 174,200 Z"],
  ["lower-l3", "M148,200 L148,146.3 Q148,139.3 141,139.3 L127,137 Q120,137 120,144 L120,200 Q134,193.6 148,200 Z"],
  ["lower-l4", "M120,200 L120,143 Q120,137 114,137 L100,133.9 Q94,133.9 94,139.9 L94,200 Q107,194 120,200 Z"],
  ["lower-l5", "M94,200 L94,139.9 Q94,133.9 88,133.9 L76,130.3 Q70,130.3 70,136.3 L70,200 Q82,194.4 94,200 Z"],
  ["lower-l6", "M70,200 L70,135.3 Q70,130.3 65,130.3 L53,126.4 Q48,126.4 48,131.4 L48,200 Q59,194.6 70,200 Z"],
  ["lower-l7", "M48,200 L48,131.4 Q48,126.4 43,126.4 L35,122.8 Q30,122.8 30,127.8 L30,200 Q39,195 48,200 Z"],
];

const UPPER_SHADE_PATHS = [
  ["upper-r1", "M200,64 Q219,50.5 238,65 L238,76 Q219,61.5 200,75 Z"],
  ["upper-r2", "M238,65 Q253,52.1 268,67.2 L268,78.2 Q253,63.1 238,76 Z"],
  ["upper-r3", "M268,67.2 Q282,54.8 296,70.4 L296,81.4 Q282,65.8 268,78.2 Z"],
  ["upper-r4", "M296,70.4 Q308,58.2 320,74 L320,85 Q308,69.2 296,81.4 Z"],
  ["upper-r5", "M320,74 Q331,62 342,78 L342,89 Q331,73 320,85 Z"],
  ["upper-r6", "M342,78 Q352,66.1 362,82.2 L362,93.2 Q352,77.1 342,89 Z"],
  ["upper-r7", "M362,82.2 Q370,70.1 378,86 L378,97 Q370,81.1 362,93.2 Z"],
  ["upper-l1", "M200,64 Q181,50.5 162,65 L162,76 Q181,61.5 200,75 Z"],
  ["upper-l2", "M162,65 Q147,52.1 132,67.2 L132,78.2 Q147,63.1 162,76 Z"],
  ["upper-l3", "M132,67.2 Q118,54.8 104,70.4 L104,81.4 Q118,65.8 132,78.2 Z"],
  ["upper-l4", "M104,70.4 Q92,58.2 80,74 L80,85 Q92,69.2 104,81.4 Z"],
  ["upper-l5", "M80,74 Q69,62 58,78 L58,89 Q69,73 80,85 Z"],
  ["upper-l6", "M58,78 Q48,66.1 38,82.2 L38,93.2 Q48,77.1 58,89 Z"],
  ["upper-l7", "M38,82.2 Q30,70.1 22,86 L22,97 Q30,81.1 38,93.2 Z"],
];

const LOWER_SHADE_PATHS = [
  ["lower-r1", "M200,189 Q213,202.75 226,188.5 L226,177.5 Q213,191.75 200,178 Z"],
  ["lower-r2", "M226,188.5 Q239,201.8 252,187.1 L252,176.1 Q239,190.8 226,177.5 Z"],
  ["lower-r3", "M252,187.1 Q266,199.85 280,184.6 L280,173.6 Q266,188.85 252,176.1 Z"],
  ["lower-r4", "M280,184.6 Q293,196.9 306,181.2 L306,170.2 Q293,185.9 280,173.6 Z"],
  ["lower-r5", "M306,181.2 Q318,193.25 330,177.3 L330,166.3 Q318,182.25 306,170.2 Z"],
  ["lower-r6", "M330,177.3 Q341,189.15 352,173 L352,162 Q341,178.15 330,166.3 Z"],
  ["lower-r7", "M352,173 Q361,185 370,169 L370,158 Q361,174 352,162 Z"],
  ["lower-l1", "M200,189 Q187,202.75 174,188.5 L174,177.5 Q187,191.75 200,178 Z"],
  ["lower-l2", "M174,188.5 Q161,201.8 148,187.1 L148,176.1 Q161,190.8 174,177.5 Z"],
  ["lower-l3", "M148,187.1 Q134,199.85 120,184.6 L120,173.6 Q134,188.85 148,176.1 Z"],
  ["lower-l4", "M120,184.6 Q107,196.9 94,181.2 L94,170.2 Q107,185.9 120,173.6 Z"],
  ["lower-l5", "M94,181.2 Q82,193.25 70,177.3 L70,166.3 Q82,182.25 94,170.2 Z"],
  ["lower-l6", "M70,177.3 Q59,189.15 48,173 L48,162 Q59,178.15 70,166.3 Z"],
  ["lower-l7", "M48,173 Q39,185 30,169 L30,158 Q39,174 48,162 Z"],
];

const LEFT_TO_RIGHT = ["l7", "l6", "l5", "l4", "l3", "l2", "l1", "r1", "r2", "r3", "r4", "r5", "r6", "r7"];

function delayForTooth(id) {
  const side = id.endsWith("l7") || id.includes("-l") || id.includes("-r") ? id.split("-").pop() : id;
  const index = LEFT_TO_RIGHT.indexOf(side);
  return delayForIndex(index === -1 ? 0 : index, LEFT_TO_RIGHT.length);
}

function AnimatedTooth({ id, d, shade }) {
  return (
    <g className="tooth-loader__tooth" style={{ "--tooth-delay": delayForTooth(id) }}>
      <path id={id} d={d} />
      {shade ? <path className="tooth-loader__sheen" d={shade} /> : null}
    </g>
  );
}

function shadeFor(shades, id) {
  return shades.find(([toothId]) => toothId === id)?.[1];
}

function DentalArch() {
  const rawId = useId().replace(/:/g, "");
  const enamel = `${rawId}-enamel`;
  const upperGum = `${rawId}-upper-gum`;
  const lowerGum = `${rawId}-lower-gum`;
  return (
    <div className="tooth-loader__arch">
      <svg
        className="tooth-loader__svg"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="3 0 394 243"
        role="img"
        aria-label="Upper and lower teeth with gums"
        focusable="false"
      >
        <defs>
          <linearGradient id={enamel} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fffdf8" />
            <stop offset="0.58" stopColor="#f6f1e6" />
            <stop offset="1" stopColor="#e6ddd0" />
          </linearGradient>
          <linearGradient id={upperGum} x1="200" y1="4" x2="200" y2="96" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f8d5dc" />
            <stop offset="0.55" stopColor="#f3aebc" />
            <stop offset="1" stopColor="#e48b9d" />
          </linearGradient>
          <linearGradient id={lowerGum} x1="200" y1="150" x2="200" y2="240" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#e992a4" />
            <stop offset="0.5" stopColor="#f3b0be" />
            <stop offset="1" stopColor="#f7d0d8" />
          </linearGradient>
        </defs>
        <ellipse className="tooth-loader__depth" cx="200" cy="78" rx="168" ry="36" />
        <ellipse className="tooth-loader__depth" cx="200" cy="196" rx="162" ry="30" />
        <g id="upper-jaw">
          <g id="upper-teeth" fill={`url(#${enamel})`} stroke="#c5bfb6" strokeWidth="1.05" strokeLinejoin="round">
            {UPPER_TOOTH_PATHS.map(([id, d]) => (
              <AnimatedTooth key={id} id={id} d={d} shade={shadeFor(UPPER_SHADE_PATHS, id)} />
            ))}
          </g>
          <path
            id="upper-gum"
            className="tooth-loader__gum"
            fill={`url(#${upperGum})`}
            d="M22,89 Q6,86 6,66 C6,30 14,12 40,9 Q70,3 100,7 Q130,11 160,6 Q180,2 200,5 Q220,2 240,6 Q270,11 300,7 Q330,3 360,9 C386,12 394,30 394,66 Q394,86 378,89 Q370,73.1 362,85.2 Q352,69.1 342,81 Q331,65 320,77 Q308,61.2 296,73.4 Q282,57.8 268,70.2 Q253,55.1 238,68 Q219,53.5 200,67 Q181,53.5 162,68 Q147,55.1 132,70.2 Q118,57.8 104,73.4 Q92,61.2 80,77 Q69,65 58,81 Q48,69.1 38,85.2 Q30,73.1 22,89 Z"
          />
          <path
            className="tooth-loader__gum-highlight"
            d="M48,28 Q100,12 160,18 Q186,14 200,16 Q214,14 240,18 Q300,12 352,28 Q300,20 240,24 Q214,20 200,22 Q186,20 160,24 Q100,20 48,28 Z"
          />
          <path
            className="tooth-loader__gumline"
            d="M378,89 Q370,73.1 362,85.2 Q352,69.1 342,81 Q331,65 320,77 Q308,61.2 296,73.4 Q282,57.8 268,70.2 Q253,55.1 238,68 Q219,53.5 200,67 Q181,53.5 162,68 Q147,55.1 132,70.2 Q118,57.8 104,73.4 Q92,61.2 80,77 Q69,65 58,81 Q48,69.1 38,85.2 Q30,73.1 22,89"
          />
        </g>
        <g id="lower-jaw">
          <g id="lower-teeth" fill={`url(#${enamel})`} stroke="#c5bfb6" strokeWidth="1.05" strokeLinejoin="round">
            {LOWER_TOOTH_PATHS.map(([id, d]) => (
              <AnimatedTooth key={id} id={id} d={d} shade={shadeFor(LOWER_SHADE_PATHS, id)} />
            ))}
          </g>
          <path
            id="lower-gum"
            className="tooth-loader__gum"
            fill={`url(#${lowerGum})`}
            d="M370,166 Q386,166 387,182 C386,214 310,240 200,240 C90,240 14,214 13,182 Q14,166 30,166 Q39,182 48,170 Q59,186.15 70,174.3 Q82,190.25 94,178.2 Q107,193.9 120,181.6 Q134,196.85 148,184.1 Q161,198.8 174,185.5 Q187,199.75 200,186 Q213,199.75 226,185.5 Q239,198.8 252,184.1 Q266,196.85 280,181.6 Q293,193.9 306,178.2 Q318,190.25 330,174.3 Q341,186.15 352,170 Q361,182 370,166 Z"
          />
          <path
            className="tooth-loader__gum-highlight"
            d="M70,214 Q130,228 200,226 Q270,228 330,214 Q270,222 200,220 Q130,222 70,214 Z"
          />
          <path
            className="tooth-loader__gumline"
            d="M30,166 Q39,182 48,170 Q59,186.15 70,174.3 Q82,190.25 94,178.2 Q107,193.9 120,181.6 Q134,196.85 148,184.1 Q161,198.8 174,185.5 Q187,199.75 200,186 Q213,199.75 226,185.5 Q239,198.8 252,184.1 Q266,196.85 280,181.6 Q293,193.9 306,178.2 Q318,190.25 330,174.3 Q341,186.15 352,170 Q361,182 370,166"
          />
        </g>
      </svg>
    </div>
  );
}

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
            <span />
            <span />
            <span />
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
