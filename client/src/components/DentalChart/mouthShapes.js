/** Soft gingival glow helpers matching a clinical 2D occlusal chart. */

/** Open horseshoe path for a soft pink gum glow under the tooth row. */
export function gumGlowPath({
  cx,
  cy,
  rx,
  ry,
  invert = false,
  open = 0.08,
  thickness = 38,
}) {
  const outerRx = rx + thickness * 0.55;
  const outerRy = ry + thickness * 0.55;
  const innerRx = Math.max(24, rx - thickness * 0.85);
  const innerRy = Math.max(18, ry - thickness * 0.85);

  const leftOuter = polar(cx, cy, outerRx, outerRy, Math.PI + (invert ? -open : open));
  const rightOuter = polar(cx, cy, outerRx, outerRy, invert ? open : -open);
  const rightInner = polar(cx, cy, innerRx, innerRy, invert ? open : -open);
  const leftInner = polar(cx, cy, innerRx, innerRy, Math.PI + (invert ? -open : open));

  const outerSweep = invert ? 1 : 0;
  const innerSweep = invert ? 0 : 1;

  return [
    `M ${leftOuter.x} ${leftOuter.y}`,
    `A ${outerRx} ${outerRy} 0 1 ${outerSweep} ${rightOuter.x} ${rightOuter.y}`,
    `L ${rightInner.x} ${rightInner.y}`,
    `A ${innerRx} ${innerRy} 0 1 ${innerSweep} ${leftInner.x} ${leftInner.y}`,
    "Z",
  ].join(" ");
}

function polar(cx, cy, rx, ry, angle) {
  return {
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  };
}
