/** Soft gingival glow matching the clinical reference chart. */

/** Open horseshoe centerline for a stroked + blurred gum halo. */
export function gumArchStrokePath({
  cx,
  cy,
  rx,
  ry,
  invert = false,
  open = 0.06,
}) {
  const left = polar(cx, cy, rx, ry, Math.PI + (invert ? -open : open));
  const right = polar(cx, cy, rx, ry, invert ? open : -open);
  // SVG y-down: CW (1) through top; CCW (0) through bottom.
  const sweep = invert ? 0 : 1;
  return `M ${left.x} ${left.y} A ${rx} ${ry} 0 0 ${sweep} ${right.x} ${right.y}`;
}

function polar(cx, cy, rx, ry, angle) {
  return {
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  };
}
