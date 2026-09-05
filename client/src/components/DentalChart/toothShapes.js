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
  if (type === "molar") return digit === 8 ? 1.08 : digit === 7 ? 1.18 : 1.22;
  if (type === "premolar") return digit === 4 ? 0.98 : 0.94;
  if (type === "canine") return 1.02;
  if (type === "lateral_incisor") return 0.86;
  return 0.96;
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

  /** Two-cusp bicuspid — premolar */
  premolar: {
    outline:
      "M -8 -22 C -14 -20 -18 -12 -18.5 -2 C -19 8 -15 17 -8.5 21.5 C -4 24.5 4 24.5 8.5 21.5 C 15 17 19 8 18.5 -2 C 18 -12 14 -20 8 -22 C 4 -24.5 -4 -24.5 -8 -22 Z",
    shade:
      "M -6.5 -18.5 C -11.5 -17 -15 -10.5 -15.5 -1.5 C -16 7.5 -12.5 15 -7 18.8 C -3.5 21.2 3.5 21.2 7 18.8 C 12.5 15 16 7.5 15.5 -1.5 C 15 -10.5 11.5 -17 6.5 -18.5 C 3.5 -20.5 -3.5 -20.5 -6.5 -18.5 Z",
    grooves:
      "M -8 -8 Q 0 -12 8 -8 M -10 2 Q 0 -1.5 10 2 M -7 12 Q 0 9.5 7 12 M 0 -14 L 0 16 M -12 0 L 12 0",
    cusps: [
      { cx: -6.5, cy: -4, rx: 7.2, ry: 8.5 },
      { cx: 6.5, cy: -4, rx: 7.2, ry: 8.5 },
      { cx: 0, cy: 9, rx: 6.5, ry: 6.5 },
    ],
    hit: { rx: 21, ry: 26 },
  },

  /** Four-cusp crown with clear occlusal table — molar */
  molar: {
    outline:
      "M -10 -22 C -16 -22 -22 -16 -23.5 -8 C -25 -1 -24 8 -20 14 C -16 20 -9 24 -2.5 24.5 C 2.5 25 9 23 14.5 18.5 C 20 14 24 6 23.5 -2 C 23 -10 19 -18 12.5 -21.5 C 7 -24.5 -3 -24.5 -10 -22 Z",
    shade:
      "M -8.5 -18.5 C -13.5 -18.5 -18.5 -13.5 -19.8 -6.5 C -21 0.5 -20 8 -16.5 13 C -13 18 -7 21 -1.5 21.5 C 3.5 22 9 20 13.5 16 C 18 12 20.5 5 20 -1.5 C 19.5 -8 16.5 -15 11 -18 C 6 -20.5 -2.5 -20.5 -8.5 -18.5 Z",
    grooves:
      "M -12 -8 Q 0 -12.5 12 -8 M -14 1 Q 0 -2.5 14 1 M -11 11 Q 0 8 11 11 M 0 -16 L 0 18 M -16 0 L 16 0 M -10 -10 L 10 10 M 10 -10 L -10 10",
    cusps: [
      { cx: -8.5, cy: -8, rx: 8, ry: 7.5 },
      { cx: 8.5, cy: -8, rx: 8, ry: 7.5 },
      { cx: -8.5, cy: 8.5, rx: 7.8, ry: 7.2 },
      { cx: 8.5, cy: 8.5, rx: 7.8, ry: 7.2 },
    ],
    hit: { rx: 26, ry: 27 },
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
