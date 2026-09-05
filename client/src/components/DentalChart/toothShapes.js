/** Anatomical occlusal-view paths and helpers for the FDI dental chart. */

export function toothTypeFromFdi(toothNumber) {
  const n = Number(String(toothNumber).slice(-1));
  if (n === 1) return "central_incisor";
  if (n === 2) return "lateral_incisor";
  if (n === 3) return "canine";
  if (n === 4 || n === 5) return "premolar";
  return "molar";
}

export function toothScale(toothNumber) {
  const type = toothTypeFromFdi(toothNumber);
  if (type === "molar") return Number(String(toothNumber).slice(-1)) === 8 ? 1.05 : 1.12;
  if (type === "premolar") return 0.92;
  if (type === "canine") return 0.88;
  if (type === "lateral_incisor") return 0.78;
  return 0.84;
}

/**
 * Paths are drawn in local coords (0,0 center), elongated along Y (mesial–distal).
 * Occlusal surface details are included as nested path strings.
 */
export const TOOTH_SHAPES = {
  central_incisor: {
    outline:
      "M -7.2 -16 C -8.2 -12 -8.4 -4 -7.8 2 C -7 10 -5.2 15.5 -2.4 17.2 C -0.8 18 0.8 18 2.4 17.2 C 5.2 15.5 7 10 7.8 2 C 8.4 -4 8.2 -12 7.2 -16 C 5.5 -19.5 -5.5 -19.5 -7.2 -16 Z",
    detail:
      "M -3.5 -12 Q 0 -13.5 3.5 -12 M -4 0 Q 0 1.5 4 0 M -2.5 10 Q 0 11.5 2.5 10",
  },
  lateral_incisor: {
    outline:
      "M -6 -14.5 C -7 -11 -7.2 -4 -6.6 1 C -5.8 8 -4.2 13.5 -2 15 C -0.7 15.8 0.7 15.8 2 15 C 4.2 13.5 5.8 8 6.6 1 C 7.2 -4 7 -11 6 -14.5 C 4.6 -17.5 -4.6 -17.5 -6 -14.5 Z",
    detail: "M -2.8 -10 Q 0 -11 2.8 -10 M -3 1 Q 0 2 3 1",
  },
  canine: {
    outline:
      "M 0 -18.5 C -3.5 -17 -7 -11 -7.5 -3 C -8 5 -5.5 12 -2.2 16 C -0.8 17.5 0.8 17.5 2.2 16 C 5.5 12 8 5 7.5 -3 C 7 -11 3.5 -17 0 -18.5 Z",
    detail: "M 0 -14 L 0 12 M -3.5 -2 Q 0 -4 3.5 -2",
  },
  premolar: {
    outline:
      "M -9 -13 C -11 -8 -11.5 -1 -10 5 C -8.5 11 -5 15.5 -1.5 16.5 C 0 16.9 0 16.9 1.5 16.5 C 5 15.5 8.5 11 10 5 C 11.5 -1 11 -8 9 -13 C 6.5 -16.5 -6.5 -16.5 -9 -13 Z",
    detail:
      "M -5 -6 Q 0 -9 5 -6 M -6 2 Q 0 0 6 2 M -3.5 9 Q 0 7.5 3.5 9 M 0 -8 L 0 11",
  },
  molar: {
    outline:
      "M -12.5 -14 C -15 -8 -15.5 0 -13.5 6.5 C -11.5 13 -6.5 16.5 -1.8 17.2 C 0 17.5 0 17.5 1.8 17.2 C 6.5 16.5 11.5 13 13.5 6.5 C 15.5 0 15 -8 12.5 -14 C 9 -18 -9 -18 -12.5 -14 Z",
    detail:
      "M -7 -7 Q 0 -10 7 -7 M -8 1 Q 0 -1 8 1 M -6 9 Q 0 7 6 9 M 0 -10 L 0 12 M -9 0 L 9 0",
  },
};

/**
 * Place teeth on a natural horseshoe.
 * Upper = top half (∩ opening toward lower jaw).
 * Lower = bottom half (∪ opening toward upper jaw).
 * Labels sit outside the arch.
 */
export function toothPositions(teeth, { cx, cy, rx, ry, invert = false, labelPad = 34 }) {
  const count = teeth.length;
  return teeth.map((tooth, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    // Ease spacing slightly denser at the midline (incisors).
    const eased = t < 0.5 ? Math.pow(t * 2, 0.92) / 2 : 1 - Math.pow((1 - t) * 2, 0.92) / 2;

    // Upper: π → 2π via 3π/2 (SVG top). Lower: π → 0 via π/2 (SVG bottom).
    const angle = invert ? Math.PI - eased * Math.PI : Math.PI + eased * Math.PI;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);

    // Align tooth long-axis with the arch tangent.
    const rotate = (angle * 180) / Math.PI + 90;

    // Radial outward for FDI numbers (away from oral cavity).
    const labelRx = rx + labelPad;
    const labelRy = ry + labelPad;
    const labelX = cx + labelRx * Math.cos(angle);
    const labelY = cy + labelRy * Math.sin(angle);

    return {
      tooth,
      x,
      y,
      rotate,
      angle,
      labelX,
      labelY,
      type: toothTypeFromFdi(tooth),
      scale: toothScale(tooth),
    };
  });
}
