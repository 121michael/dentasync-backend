/** SVG path helpers for a realistic 2D occlusal mouth backdrop. */

/**
 * Thick horseshoe gingival ridge.
 * Uses open posterior ends (not a full oval) so each arch reads as a U / ∩.
 * `open` controls how far past the equator the ends extend (0 = equator, 0.2 = slightly past).
 */
export function horseshoeBandPath({
  cx,
  cy,
  outerRx,
  outerRy,
  innerRx,
  innerRy,
  invert = false,
  open = 0.12,
}) {
  // Angles from positive x-axis; SVG y grows downward.
  // Upper (invert=false): arc through TOP (∩). Lower (invert=true): arc through BOTTOM (∪).
  const leftOuter = polar(cx, cy, outerRx, outerRy, Math.PI + (invert ? -open : open));
  const rightOuter = polar(cx, cy, outerRx, outerRy, invert ? open : -open);
  const rightInner = polar(cx, cy, innerRx, innerRy, invert ? open : -open);
  const leftInner = polar(cx, cy, innerRx, innerRy, Math.PI + (invert ? -open : open));

  // In SVG screen coords: clockwise = sweep 1.
  // Upper needs CCW (through top); lower needs CW (through bottom).
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

/** Soft outer lip / vestibule rim following the horseshoe. */
export function vestibulePath({
  cx,
  cy,
  outerRx,
  outerRy,
  innerRx,
  innerRy,
  invert = false,
  open = 0.1,
}) {
  return horseshoeBandPath({
    cx,
    cy,
    outerRx,
    outerRy,
    innerRx,
    innerRy,
    invert,
    open,
  });
}

/** Soft palate for the upper inner cavity. */
export function palatePath({ cx, cy, rx, ry }) {
  return [
    `M ${cx} ${cy - ry}`,
    `C ${cx + rx * 0.9} ${cy - ry * 0.95} ${cx + rx} ${cy - ry * 0.15} ${cx + rx * 0.88} ${cy + ry * 0.45}`,
    `C ${cx + rx * 0.45} ${cy + ry * 0.95} ${cx - rx * 0.45} ${cy + ry * 0.95} ${cx - rx * 0.88} ${cy + ry * 0.45}`,
    `C ${cx - rx} ${cy - ry * 0.15} ${cx - rx * 0.9} ${cy - ry * 0.95} ${cx} ${cy - ry}`,
    "Z",
  ].join(" ");
}

/** Tongue shape for the lower inner cavity. */
export function tonguePath({ cx, cy, rx, ry }) {
  return [
    `M ${cx} ${cy + ry}`,
    `C ${cx + rx * 0.95} ${cy + ry * 0.8} ${cx + rx * 0.98} ${cy + ry * 0.05} ${cx + rx * 0.7} ${cy - ry * 0.5}`,
    `C ${cx + rx * 0.3} ${cy - ry * 0.95} ${cx - rx * 0.3} ${cy - ry * 0.95} ${cx - rx * 0.7} ${cy - ry * 0.5}`,
    `C ${cx - rx * 0.98} ${cy + ry * 0.05} ${cx - rx * 0.95} ${cy + ry * 0.8} ${cx} ${cy + ry}`,
    "Z",
  ].join(" ");
}
