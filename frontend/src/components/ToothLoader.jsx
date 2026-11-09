import { useEffect, useId, useState } from "react";

/** Same delay ladder as the pre-swap arch in a7880df. */
const TOOTH_DELAYS = ["0s", "0.12s", "0.24s", "0.36s", "0.48s", "0.6s", "0.72s", "0.84s", "0.96s", "1.08s"];

function delayForIndex(index, count) {
  const slot = Math.round((index / (count - 1)) * (TOOTH_DELAYS.length - 1));
  return TOOTH_DELAYS[slot];
}

const UPPER_TOOTH_PATHS = [
  ["upper-r1", "M201.4,40 Q219,51 236.6,40 Q238.2,64 237.2,96 Q236.6,120 237.2,125.1 Q237.2,134.1 228.4,134.1 L210.4,135 Q201.4,135 201.4,126 Q200.6,96 201.4,40 Z"],
  ["upper-r2", "M239.4,40 Q253,50 266.6,40 Q268.2,64 267.2,96 Q266.6,118 267.2,124.1 Q267.2,132.1 259.4,132.1 L246.2,134.1 Q239.4,134.1 239.4,126.1 Q238.6,96 239.4,40 Z"],
  ["upper-r3", "M269.4,40 Q282,49.5 294.6,40 Q296.2,62 295.2,94 Q294.6,116 295.2,122.2 Q295.2,129.2 288.4,129.2 L275.6,132.1 Q269.4,132.1 269.4,125.1 Q268.6,94 269.4,40 Z"],
  ["upper-r4", "M297.4,40 Q308,48.5 318.6,40 Q320.2,60 319.2,92 Q318.6,114 319.2,119.9 Q319.2,125.9 313.4,125.9 L302.6,129.2 Q297.4,129.2 297.4,123.2 Q296.6,92 297.4,40 Z"],
  ["upper-r5", "M321.3,40 Q331,48 340.7,40 Q342.2,58 341.3,88 Q340.8,110 341.3,116.3 Q341.3,122.3 335.4,122.3 L326.6,125.9 Q321.3,125.9 321.3,119.9 Q320.6,88 321.3,40 Z"],
  ["upper-r6", "M343.2,40 Q352,47 360.8,40 Q362.2,56 361.3,86 Q360.8,106 361.3,113.4 Q361.3,118.4 356.4,118.4 L347.6,122.3 Q343.2,122.3 343.2,117.3 Q342.6,86 343.2,40 Z"],
  ["upper-r7", "M363.2,40 Q370,46 376.8,40 Q378.1,54 377.3,82 Q376.9,102 377.3,110 Q377.3,115 372.5,115 L367.4,118.4 Q363.2,118.4 363.2,113.4 Q362.6,82 363.2,40 Z"],
  ["upper-l1", "M198.6,40 Q181,51 163.4,40 Q161.8,64 162.8,96 Q163.4,120 162.8,125.1 Q162.8,134.1 171.6,134.1 L189.6,135 Q198.6,135 198.6,126 Q199.4,96 198.6,40 Z"],
  ["upper-l2", "M160.6,40 Q147,50 133.4,40 Q131.8,64 132.8,96 Q133.4,118 132.8,124.1 Q132.8,132.1 140.6,132.1 L153.8,134.1 Q160.6,134.1 160.6,126.1 Q161.4,96 160.6,40 Z"],
  ["upper-l3", "M130.6,40 Q118,49.5 105.4,40 Q103.8,62 104.8,94 Q105.4,116 104.8,122.2 Q104.8,129.2 111.6,129.2 L124.4,132.1 Q130.6,132.1 130.6,125.1 Q131.4,94 130.6,40 Z"],
  ["upper-l4", "M102.6,40 Q92,48.5 81.4,40 Q79.8,60 80.8,92 Q81.4,114 80.8,119.9 Q80.8,125.9 86.6,125.9 L97.4,129.2 Q102.6,129.2 102.6,123.2 Q103.4,92 102.6,40 Z"],
  ["upper-l5", "M78.7,40 Q69,48 59.3,40 Q57.8,58 58.7,88 Q59.2,110 58.7,116.3 Q58.7,122.3 64.6,122.3 L73.4,125.9 Q78.7,125.9 78.7,119.9 Q79.4,88 78.7,40 Z"],
  ["upper-l6", "M56.8,40 Q48,47 39.2,40 Q37.8,56 38.7,86 Q39.2,106 38.7,113.4 Q38.7,118.4 43.6,118.4 L52.4,122.3 Q56.8,122.3 56.8,117.3 Q57.4,86 56.8,40 Z"],
  ["upper-l7", "M36.8,40 Q30,46 23.2,40 Q21.9,54 22.7,82 Q23.1,102 22.7,110 Q22.7,115 27.5,115 L32.6,118.4 Q36.8,118.4 36.8,113.4 Q37.4,82 36.8,40 Z"],
];

const LOWER_TOOTH_PATHS = [
  ["lower-r1", "M201.4,200 Q213,192 224.6,200 L225.2,156 Q225.2,141.6 218.2,141.4 L208.2,141.6 Q201.4,141.8 201.4,150 Q200.6,170 201.4,200 Z"],
  ["lower-r2", "M227.4,200 Q239,192.6 250.6,200 L251.2,156 Q251.2,140.6 244.4,140.2 L234.2,141.2 Q227.4,141.4 227.4,148.4 Q226.6,170 227.4,200 Z"],
  ["lower-r3", "M253.4,200 Q266,193 278.6,200 L279.2,154 Q279.2,138.2 272.2,137.6 L260.4,139.8 Q253.4,140.2 253.4,147.2 Q252.6,168 253.4,200 Z"],
  ["lower-r4", "M281.4,200 Q293,194 304.6,200 L305.2,150 Q305.2,135 299.2,134.6 L287.4,137.4 Q281.4,138 281.4,144 Q280.6,166 281.4,200 Z"],
  ["lower-r5", "M307.3,200 Q318,194.4 328.7,200 L329.2,148 Q329.2,132.2 323.4,131.6 L313.2,134.4 Q307.3,135 307.3,141 Q306.6,164 307.3,200 Z"],
  ["lower-r6", "M331.2,200 Q341,194.8 350.8,200 L351.2,144 Q351.2,128.4 346.4,127.6 L336.4,130.8 Q331.2,131.4 331.2,136.4 Q330.6,160 331.2,200 Z"],
  ["lower-r7", "M353.2,200 Q361,195 368.8,200 L369.2,140 Q369.2,125 364.6,124 L358,126.8 Q353.2,127.4 353.2,132.4 Q352.6,158 353.2,200 Z"],
  ["lower-l1", "M198.6,200 Q187,192 175.4,200 L174.8,156 Q174.8,141.6 181.8,141.4 L191.8,141.6 Q198.6,141.8 198.6,150 Q199.4,170 198.6,200 Z"],
  ["lower-l2", "M172.6,200 Q161,192.6 149.4,200 L148.8,156 Q148.8,140.6 155.6,140.2 L165.8,141.2 Q172.6,141.4 172.6,148.4 Q173.4,170 172.6,200 Z"],
  ["lower-l3", "M146.6,200 Q134,193 121.4,200 L120.8,154 Q120.8,138.2 127.8,137.6 L139.6,139.8 Q146.6,140.2 146.6,147.2 Q147.4,168 146.6,200 Z"],
  ["lower-l4", "M118.6,200 Q107,194 95.4,200 L94.8,150 Q94.8,135 100.8,134.6 L112.6,137.4 Q118.6,138 118.6,144 Q119.4,166 118.6,200 Z"],
  ["lower-l5", "M92.7,200 Q82,194.4 71.3,200 L70.8,148 Q70.8,132.2 76.6,131.6 L86.8,134.4 Q92.7,135 92.7,141 Q93.4,164 92.7,200 Z"],
  ["lower-l6", "M68.8,200 Q59,194.8 49.2,200 L48.8,144 Q48.8,128.4 53.6,127.6 L63.6,130.8 Q68.8,131.4 68.8,136.4 Q69.4,160 68.8,200 Z"],
  ["lower-l7", "M46.8,200 Q39,195 31.2,200 L30.8,140 Q30.8,125 35.4,124 L42,126.8 Q46.8,127.4 46.8,132.4 Q47.4,158 46.8,200 Z"],
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

function AnimatedTooth({ id, d, shade, clipId }) {
  return (
    <g className="tooth-loader__tooth" style={{ "--tooth-delay": delayForTooth(id) }}>
      <clipPath id={clipId}>
        <path d={d} />
      </clipPath>
      <g clipPath={`url(#${clipId})`}>
        <path id={id} d={d} />
        {shade ? <path className="tooth-loader__sheen" d={shade} /> : null}
      </g>
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
            <stop offset="0" stopColor="#fffefb" />
            <stop offset="0.42" stopColor="#f7f1e4" />
            <stop offset="1" stopColor="#e4d8c6" />
          </linearGradient>
          <linearGradient id={upperGum} x1="200" y1="2" x2="200" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#f8d0d8" />
            <stop offset="0.48" stopColor="#f0a3b4" />
            <stop offset="1" stopColor="#e07f94" />
          </linearGradient>
          <linearGradient id={lowerGum} x1="200" y1="150" x2="200" y2="242" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#e3869b" />
            <stop offset="0.46" stopColor="#f3aebc" />
            <stop offset="1" stopColor="#f8d5dc" />
          </linearGradient>
        </defs>
        <ellipse className="tooth-loader__depth" cx="200" cy="78" rx="168" ry="36" />
        <ellipse className="tooth-loader__depth" cx="200" cy="196" rx="162" ry="30" />
        <g id="upper-jaw">
          <g id="upper-teeth" fill={`url(#${enamel})`} stroke="#b7afa4" strokeWidth="1.15" strokeLinejoin="round">
            {UPPER_TOOTH_PATHS.map(([id, d]) => (
              <AnimatedTooth key={id} id={id} d={d} shade={shadeFor(UPPER_SHADE_PATHS, id)} clipId={`${rawId}-${id}`} />
            ))}
          </g>
          <path
            id="upper-gum"
            className="tooth-loader__gum"
            fill={`url(#${upperGum})`}
            d="M22,89 Q8,84 8,64 C8,34 20,10 48,8 Q82,1 118,8 Q156,2 200,6 Q244,2 282,8 Q318,1 352,8 C380,10 392,34 392,64 Q392,84 378,89 Q370,73.1 362,85.2 Q352,69.1 342,81 Q331,65 320,77 Q308,61.2 296,73.4 Q282,57.8 268,70.2 Q253,55.1 238,68 Q219,53.5 200,67 Q181,53.5 162,68 Q147,55.1 132,70.2 Q118,57.8 104,73.4 Q92,61.2 80,77 Q69,65 58,81 Q48,69.1 38,85.2 Q30,73.1 22,89 Z"
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
          <g id="lower-teeth" fill={`url(#${enamel})`} stroke="#b7afa4" strokeWidth="1.15" strokeLinejoin="round">
            {LOWER_TOOTH_PATHS.map(([id, d]) => (
              <AnimatedTooth key={id} id={id} d={d} shade={shadeFor(LOWER_SHADE_PATHS, id)} clipId={`${rawId}-${id}`} />
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

  const labelText = String(label).replace(/[.…\s]+$/u, "") || "Loading";

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
