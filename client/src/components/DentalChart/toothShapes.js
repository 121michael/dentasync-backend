/** Anatomical occlusal-view paths for the FDI dental chart.
 * Local coords: (0,0) center; long axis aligns with the arch tangent after rotation.
 */

export function toothTypeFromFdi(toothNumber) {
  const n = Number(String(toothNumber).slice(-1));
  if (n === 1) return "central_incisor";
  if (n === 2) return "lateral_incisor";
  if (n === 3) return "canine";
  if (n === 4 || n === 5) return "premolar";
  return "molar";
}

/** Relative size — molars largest; laterals narrower. Slightly enlarged for clinical chart. */
export function toothScale(toothNumber) {
  const type = toothTypeFromFdi(toothNumber);
  const digit = Number(String(toothNumber).slice(-1));
  if (type === "molar") return digit === 8 ? 1.22 : digit === 7 ? 1.34 : 1.38;
  if (type === "premolar") return digit === 4 ? 1.16 : 1.12;
  if (type === "canine") return 1.22;
  if (type === "lateral_incisor") return 1.08;
  return 1.18;
}

/**
 * Each shape includes:
 * - outline: crown silhouette (scalloped for multi-cusp teeth)
 * - grooves: primary fissures
 * - secondary: finer developmental grooves (premolars/molars)
 * - cusps: raised occlusal mounds
 * - pits: tiny occlusal pits (molars/premolars)
 * - shade: soft inner rim darkening
 * - hit: oversized invisible hit target bounds (rx/ry)
 */
export const TOOTH_SHAPES = {
  /** Flat shovel crown — central incisor (wider, thicker crown) */
  central_incisor: {
    outline:
      "M -14.5 -26.5 C -16.5 -21 -17 -9 -16 1.5 C -15 13 -11.5 23 -6.2 26.5 C -2.8 29 2.8 29 6.2 26.5 C 11.5 23 15 13 16 1.5 C 17 -9 16.5 -21 14.5 -26.5 C 10.5 -32.5 -10.5 -32.5 -14.5 -26.5 Z",
    shade:
      "M -11.5 -22.5 C -13.2 -18 -13.6 -8 -12.8 1 C -12 11 -9 20 -5 23.2 C -2.4 25.2 2.4 25.2 5 23.2 C 9 20 12 11 12.8 1 C 13.6 -8 13.2 -18 11.5 -22.5 C 8.2 -27.5 -8.2 -27.5 -11.5 -22.5 Z",
    grooves:
      "M -7 -17.5 Q 0 -20.5 7 -17.5 M -8 -1 Q 0 1.5 8 -1 M -5.5 15.5 Q 0 18.5 5.5 15.5 M 0 -22 L 0 22",
    cusps: [
      { cx: 0, cy: -9, rx: 9, ry: 10.5 },
      { cx: 0, cy: 9, rx: 8, ry: 9 },
    ],
    hit: { rx: 19, ry: 33 },
  },

  /** Narrower shovel — lateral incisor (still substantial, not wire-thin) */
  lateral_incisor: {
    outline:
      "M -12 -24.5 C -13.8 -19.5 -14.2 -8 -13.2 1.5 C -12.2 12 -9.2 21 -5 24.2 C -2.4 26.2 2.4 26.2 5 24.2 C 9.2 21 12.2 12 13.2 1.5 C 14.2 -8 13.8 -19.5 12 -24.5 C 8.5 -30 -8.5 -30 -12 -24.5 Z",
    shade:
      "M -9.5 -20.5 C -11 -16.5 -11.4 -7 -10.6 1 C -9.8 10.5 -7.2 18.5 -4 21.5 C -2 23.2 2 23.2 4 21.5 C 7.2 18.5 9.8 10.5 10.6 1 C 11.4 -7 11 -16.5 9.5 -20.5 C 6.8 -25.5 -6.8 -25.5 -9.5 -20.5 Z",
    grooves:
      "M -5.5 -16 Q 0 -18.5 5.5 -16 M -6.5 0 Q 0 2.5 6.5 0 M -4 14 Q 0 16.5 4 14 M 0 -19 L 0 19",
    cusps: [
      { cx: 0, cy: -7.5, rx: 7.2, ry: 9 },
      { cx: 0, cy: 8, rx: 6.2, ry: 7.8 },
    ],
    hit: { rx: 16, ry: 30 },
  },

  /** Pointed diamond crown — canine */
  canine: {
    outline:
      "M 0 -33 C -3.5 -31.5 -9.5 -25.5 -12.5 -16 C -15 -8 -14.5 3 -11.5 13 C -9 20.5 -4.8 26.5 -1.6 29 C 0 30.2 0 30.2 1.6 29 C 4.8 26.5 9 20.5 11.5 13 C 14.5 3 15 -8 12.5 -16 C 9.5 -25.5 3.5 -31.5 0 -33 Z",
    shade:
      "M 0 -28 C -2.8 -26.8 -7.8 -21.5 -10.2 -13.5 C -12.2 -6.5 -11.8 2.5 -9.2 11 C -7 17.5 -3.8 22.5 -1.3 24.5 C 0 25.4 0 25.4 1.3 24.5 C 3.8 22.5 7 17.5 9.2 11 C 11.8 2.5 12.2 -6.5 10.2 -13.5 C 7.8 -21.5 2.8 -26.8 0 -28 Z",
    grooves:
      "M 0 -25 L 0 21 M -7.5 -7 Q 0 -12.5 7.5 -7 M -6 9 Q 0 5 6 9",
    cusps: [
      { cx: 0, cy: -13, rx: 6, ry: 11 },
      { cx: -4.5, cy: 4.5, rx: 4.8, ry: 6.2 },
      { cx: 4.5, cy: 4.5, rx: 4.8, ry: 6.2 },
    ],
    hit: { rx: 17, ry: 34 },
  },

  /** Two-cusp bicuspid — premolar */
  premolar: {
    outline:
      "M -2 -26.5 C -9 -26.5 -16.5 -22.5 -19 -15.5 C -21 -10 -20.5 -3 -18 2 C -20.5 6.5 -21 13.5 -17.5 18.5 C -13.5 24.5 -6.5 27.5 0 27.5 C 6.5 27.5 13.5 24.5 17.5 18.5 C 21 13.5 20.5 6.5 18 2 C 20.5 -3 21 -10 19 -15.5 C 16.5 -22.5 9 -26.5 2 -26.5 C 0.5 -26.8 -0.5 -26.8 -2 -26.5 Z",
    shade:
      "M -1.5 -22.5 C -7.5 -22.5 -14 -19 -16 -13.5 C -17.5 -9 -17 -3 -14.8 1.5 C -17 5.5 -17.5 11.5 -14.5 16 C -11 21 -5.5 23.5 0 23.5 C 5.5 23.5 11 21 14.5 16 C 17.5 11.5 17 5.5 14.8 1.5 C 17 -3 17.5 -9 16 -13.5 C 14 -19 7.5 -22.5 1.5 -22.5 C 0.5 -22.7 -0.5 -22.7 -1.5 -22.5 Z",
    grooves:
      "M 0 -18 L 0 19 M -14 0 L 14 0 M -9 -9 Q 0 -13.5 9 -9 M -10 9 Q 0 5.5 10 9",
    secondary:
      "M -7 -14 Q -2 -10 0 -2 M 7 -14 Q 2 -10 0 -2 M -6 14 Q -2 10 0 2 M 6 14 Q 2 10 0 2",
    cusps: [
      { cx: -7, cy: -7, rx: 8.5, ry: 9.5 },
      { cx: 7, cy: -7, rx: 8.5, ry: 9.5 },
      { cx: -5.5, cy: 9, rx: 6.5, ry: 6.8 },
      { cx: 5.5, cy: 9, rx: 6.5, ry: 6.8 },
    ],
    pits: [{ cx: 0, cy: 0, r: 1.35 }],
    hit: { rx: 23, ry: 28 },
  },

  /** Four-cusp crown with lobed silhouette — molar */
  molar: {
    outline:
      "M -5 -27 C -12 -28 -19.5 -25 -23.5 -18.5 C -27 -12.5 -27.5 -5 -25.5 1.5 C -28 7 -26.5 14.5 -22 20 C -17 26 -9 28.5 -1 28.5 C 7 29 16 26.5 21.5 20.5 C 26.5 15 28.5 7.5 27 1 C 28.5 -5.5 27.5 -13 23.5 -19 C 19 -25.5 10.5 -28.5 3 -28 C -0.5 -28 -2.5 -27.5 -5 -27 Z",
    shade:
      "M -4 -23 C -10 -24 -16.5 -21.5 -20 -16 C -23 -10.5 -23.5 -4 -21.8 1.5 C -23.8 6.5 -22.5 13 -18.5 17.5 C -14 23 -7 25 -0.5 25 C 6 25.5 13.5 23 18 18 C 22.5 13 24 6.5 22.8 1 C 24 -4.5 23 -11 19.5 -16 C 15.5 -21.5 8.5 -24.5 2.5 -24 C 0 -24 -1.5 -23.5 -4 -23 Z",
    grooves:
      "M 0 -19 L 0 21 M -19 0 L 19 0 M -13 -11 Q 0 -15.5 13 -11 M -14 11 Q 0 7 14 11",
    secondary:
      "M -11 -11 L 11 11 M 11 -11 L -11 11 M -8 -16 Q -4 -8 0 -2 M 8 -16 Q 4 -8 0 -2 M -8 16 Q -4 8 0 2 M 8 16 Q 4 8 0 2 M -15 -5 Q -8 -2 -2 0 M 15 -5 Q 8 -2 2 0",
    cusps: [
      { cx: -9.5, cy: -9.5, rx: 9.2, ry: 8.8 },
      { cx: 9.5, cy: -9.5, rx: 9.2, ry: 8.8 },
      { cx: -9.5, cy: 9.5, rx: 9, ry: 8.4 },
      { cx: 9.5, cy: 9.5, rx: 9, ry: 8.4 },
    ],
    pits: [
      { cx: 0, cy: 0, r: 1.5 },
      { cx: -5.5, cy: -4, r: 1.05 },
      { cx: 5.5, cy: -4, r: 1.05 },
      { cx: -5.5, cy: 4.5, r: 1.05 },
      { cx: 5.5, cy: 4.5, r: 1.05 },
    ],
    hit: { rx: 29, ry: 30 },
  },
};

/**
 * Place teeth on a natural horseshoe.
 * Labels sit outside the arch with extra clearance so FDI numbers never overlap crowns.
 */
export function toothPositions(teeth, { cx, cy, rx, ry, invert = false, labelPad = 78 }) {
  const count = teeth.length;
  return teeth.map((tooth, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    // Slightly denser near midline (incisors), more room at molar ends.
    const eased = t < 0.5 ? Math.pow(t * 2, 0.88) / 2 : 1 - Math.pow((1 - t) * 2, 0.88) / 2;

    const angle = invert ? Math.PI - eased * Math.PI : Math.PI + eased * Math.PI;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const rotate = (angle * 180) / Math.PI + 90;

    const scale = toothScale(tooth);
    const type = toothTypeFromFdi(tooth);
    // Extra radial pad for larger crowns so FDI numbers clear the enamel edge.
    const typePad = type === "molar" ? 26 : type === "premolar" ? 18 : type === "canine" ? 12 : 10;
    const pad = labelPad + typePad + (scale - 1) * 24;

    const labelRx = rx + pad;
    const labelRy = ry + pad;
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
      type,
      scale,
    };
  });
}
