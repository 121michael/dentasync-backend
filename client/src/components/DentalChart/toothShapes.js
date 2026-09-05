/** Anatomical occlusal-view paths for the FDI dental chart.
 * Local coords: (0,0) center; +Y = gingival / toward soft tissue on the arch;
 * long axis aligns with the arch tangent after rotation.
 */

export function toothTypeFromFdi(toothNumber) {
  const n = Number(String(toothNumber).slice(-1));
  if (n === 1) return "central_incisor";
  if (n === 2) return "lateral_incisor";
  if (n === 3) return "canine";
  if (n === 4 || n === 5) return "premolar";
  return "molar";
}

/** Relative size so molars read largest and laterals stay narrower. */
export function toothScale(toothNumber) {
  const type = toothTypeFromFdi(toothNumber);
  const digit = Number(String(toothNumber).slice(-1));
  if (type === "molar") return digit === 8 ? 1.22 : digit === 7 ? 1.34 : 1.38;
  if (type === "premolar") return digit === 4 ? 1.12 : 1.08;
  if (type === "canine") return 1.16;
  if (type === "lateral_incisor") return 0.98;
  return 1.1;
}

/**
 * Each shape includes:
 * - outline: crown silhouette (scalloped for multi-cusp teeth)
 * - grooves: fissure / developmental lines
 * - cusps: raised occlusal mounds (ellipses)
 * - shade: soft inner rim darkening
 * - hit: oversized invisible hit target bounds (rx/ry)
 */
export const TOOTH_SHAPES = {
  /** Flat shovel crown — central incisor */
  central_incisor: {
    outline:
      "M -11.5 -24.5 C -13.2 -20 -13.8 -8 -13 2 C -12.2 12 -9.5 21 -5.2 24.2 C -2.4 26.2 2.4 26.2 5.2 24.2 C 9.5 21 12.2 12 13 2 C 13.8 -8 13.2 -20 11.5 -24.5 C 8.2 -29.5 -8.2 -29.5 -11.5 -24.5 Z",
    shade:
      "M -9.2 -21 C -10.5 -17 -11 -7 -10.4 1 C -9.7 10 -7.5 18 -4.2 20.8 C -2 22.4 2 22.4 4.2 20.8 C 7.5 18 9.7 10 10.4 1 C 11 -7 10.5 -17 9.2 -21 C 6.8 -25 -6.8 -25 -9.2 -21 Z",
    grooves:
      "M -5.5 -16 Q 0 -18.5 5.5 -16 M -6.5 -2 Q 0 0.8 6.5 -2 M -4.5 14 Q 0 16.2 4.5 14 M 0 -20 L 0 20",
    cusps: [
      { cx: 0, cy: -8, rx: 7.5, ry: 9.5 },
      { cx: 0, cy: 8, rx: 6.5, ry: 8 },
    ],
    hit: { rx: 16, ry: 30 },
  },

  /** Narrower shovel — lateral incisor */
  lateral_incisor: {
    outline:
      "M -9.5 -22 C -11 -18 -11.5 -7 -10.8 1.5 C -10 10 -7.8 18.5 -4.2 21.5 C -2 23.2 2 23.2 4.2 21.5 C 7.8 18.5 10 10 10.8 1.5 C 11.5 -7 11 -18 9.5 -22 C 6.8 -26.5 -6.8 -26.5 -9.5 -22 Z",
    shade:
      "M -7.5 -18.5 C -8.8 -15 -9.2 -6 -8.6 1 C -7.9 9 -6 16 -3.4 18.5 C -1.7 20 1.7 20 3.4 18.5 C 6 16 7.9 9 8.6 1 C 9.2 -6 8.8 -15 7.5 -18.5 C 5.4 -22.5 -5.4 -22.5 -7.5 -18.5 Z",
    grooves:
      "M -4.2 -14 Q 0 -16 4.2 -14 M -5 0 Q 0 2 5 0 M -3.2 12 Q 0 13.8 3.2 12 M 0 -17 L 0 17",
    cusps: [
      { cx: 0, cy: -6, rx: 6, ry: 8 },
      { cx: 0, cy: 7, rx: 5.2, ry: 7 },
    ],
    hit: { rx: 14, ry: 27 },
  },

  /** Pointed diamond crown — canine */
  canine: {
    outline:
      "M 0 -28.5 C -5.5 -26.5 -11.5 -18 -12.5 -6 C -13.5 6 -10 16.5 -4.5 22.5 C -2 25.5 2 25.5 4.5 22.5 C 10 16.5 13.5 6 12.5 -6 C 11.5 -18 5.5 -26.5 0 -28.5 Z",
    shade:
      "M 0 -24 C -4.2 -22.5 -9 -15.5 -9.8 -5 C -10.6 5.5 -7.5 14 -3.5 18.8 C -1.6 21.2 1.6 21.2 3.5 18.8 C 7.5 14 10.6 5.5 9.8 -5 C 9 -15.5 4.2 -22.5 0 -24 Z",
    grooves:
      "M 0 -22 L 0 18 M -6.5 -4 Q 0 -8 6.5 -4 M -5 8 Q 0 5.5 5 8",
    cusps: [
      { cx: 0, cy: -10, rx: 5.5, ry: 9 },
      { cx: -4, cy: 4, rx: 4.2, ry: 5.5 },
      { cx: 4, cy: 4, rx: 4.2, ry: 5.5 },
    ],
    hit: { rx: 15, ry: 30 },
  },

  /** Two-cusp bicuspid — premolar (clear buccal + lingual lobes) */
  premolar: {
    outline:
      "M 0 -25 C -7 -25.5 -14 -22 -17 -16 C -19.5 -11 -19.5 -5 -17.5 0 C -19.5 4 -20 10 -17 15 C -13.5 21 -7 25 0 25.5 C 7 25 13.5 21 17 15 C 20 10 19.5 4 17.5 0 C 19.5 -5 19.5 -11 17 -16 C 14 -22 7 -25.5 0 -25 Z",
    shade:
      "M 0 -21 C -6 -21.5 -12 -18.5 -14.5 -13.5 C -16.5 -9 -16.5 -4 -14.8 0 C -16.5 3.5 -17 9 -14.5 13 C -11.5 18 -6 21.5 0 22 C 6 21.5 11.5 18 14.5 13 C 17 9 16.5 3.5 14.8 0 C 16.5 -4 16.5 -9 14.5 -13.5 C 12 -18.5 6 -21.5 0 -21 Z",
    grooves:
      "M -9 -10 Q 0 -14 9 -10 M -11 0 Q 0 -3 11 0 M -8 11 Q 0 8 8 11 M 0 -17 L 0 18 M -14 0 L 14 0",
    cusps: [
      { cx: -6.8, cy: -6.5, rx: 8.2, ry: 9.5 },
      { cx: 6.8, cy: -6.5, rx: 8.2, ry: 9.5 },
      { cx: 0, cy: 9.5, rx: 7.2, ry: 7 },
    ],
    hit: { rx: 22, ry: 27 },
  },

  /** Four-cusp crown with lobed silhouette — molar */
  molar: {
    outline:
      "M -4 -25.5 C -10 -26.5 -17.5 -24 -21.5 -18.5 C -25 -13.5 -26 -7 -24.5 -1 C -26.5 4 -25.5 11 -21.5 16.5 C -17 22.5 -9.5 26.5 -1.5 26.5 C 6.5 27 15 24 20 18.5 C 24.5 13.5 26.5 6.5 25.5 0 C 27 -6 26 -13 22 -18.5 C 17.5 -24.5 9.5 -27 2 -26.5 C -0.5 -26.5 -2 -26 -4 -25.5 Z",
    shade:
      "M -3.5 -21.5 C -8.5 -22.5 -15 -20.5 -18.5 -16 C -21.5 -11.5 -22 -6 -20.8 -0.5 C -22.5 4 -21.5 10 -18 14.5 C -14 19.5 -7.5 22.5 -0.5 22.5 C 6 23 13 20.5 17.5 15.5 C 21.5 11 23 5 22.2 -0.5 C 23.5 -5.5 22.5 -11.5 19 -16 C 15 -21 8.5 -23 2 -22.5 C 0 -22.5 -1.5 -22 -3.5 -21.5 Z",
    grooves:
      "M -13 -10 Q 0 -14.5 13 -10 M -15 -0.5 Q 0 -4 15 -0.5 M -12 11 Q 0 7.5 12 11 M 0 -18 L 0 20 M -18 -1 L 18 -1 M -12 -12 L 12 12 M 12 -12 L -12 12",
    cusps: [
      { cx: -9.5, cy: -9, rx: 9, ry: 8.5 },
      { cx: 9.5, cy: -9, rx: 9, ry: 8.5 },
      { cx: -9.5, cy: 9, rx: 8.8, ry: 8 },
      { cx: 9.5, cy: 9, rx: 8.8, ry: 8 },
    ],
    hit: { rx: 28, ry: 29 },
  },
};

/**
 * Place teeth on a natural horseshoe.
 * Upper = top half (∩). Lower = bottom half (∪).
 * Labels sit outside the arch.
 */
export function toothPositions(teeth, { cx, cy, rx, ry, invert = false, labelPad = 42 }) {
  const count = teeth.length;
  return teeth.map((tooth, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    // Slightly denser spacing near midline (incisors), more room at molar ends.
    const eased = t < 0.5 ? Math.pow(t * 2, 0.88) / 2 : 1 - Math.pow((1 - t) * 2, 0.88) / 2;

    const angle = invert ? Math.PI - eased * Math.PI : Math.PI + eased * Math.PI;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);

    // Align tooth long-axis with the arch tangent.
    const rotate = (angle * 180) / Math.PI + 90;

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
