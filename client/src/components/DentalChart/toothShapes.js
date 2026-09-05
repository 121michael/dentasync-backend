/** Anatomical occlusal-view paths matched to a clinical 2D FDI chart reference.
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

/** Relative size — packed continuous row like the reference chart. */
export function toothScale(toothNumber) {
  const type = toothTypeFromFdi(toothNumber);
  const digit = Number(String(toothNumber).slice(-1));
  if (type === "molar") return digit === 8 ? 1.18 : digit === 7 ? 1.28 : 1.32;
  if (type === "premolar") return digit === 4 ? 1.08 : 1.04;
  if (type === "canine") return 1.12;
  if (type === "lateral_incisor") return 0.98;
  return 1.08;
}

/**
 * Clinical occlusal silhouettes:
 * - Incisors: shovel / rectangular
 * - Canines: pointed single cusp
 * - Premolars: rounded with two cusps + central groove
 * - Molars: bulky rounded rectangles with cross/X fissures
 */
export const TOOTH_SHAPES = {
  central_incisor: {
    outline:
      "M -13.5 -24.5 C -15.5 -20 -16 -8 -15.2 2 C -14.4 12 -11 22 -5.8 25.5 C -2.6 27.8 2.6 27.8 5.8 25.5 C 11 22 14.4 12 15.2 2 C 16 -8 15.5 -20 13.5 -24.5 C 9.5 -30.5 -9.5 -30.5 -13.5 -24.5 Z",
    shade:
      "M -10.5 -20.5 C -12 -16.5 -12.5 -7 -11.8 1.5 C -11 11 -8 19.5 -4.6 22.5 C -2.2 24.4 2.2 24.4 4.6 22.5 C 8 19.5 11 11 11.8 1.5 C 12.5 -7 12 -16.5 10.5 -20.5 C 7.5 -25.5 -7.5 -25.5 -10.5 -20.5 Z",
    grooves: "M -6.5 -16 Q 0 -18.5 6.5 -16 M -7.5 0 Q 0 2 7.5 0 M -5 14.5 Q 0 17 5 14.5 M 0 -20 L 0 20",
    cusps: [
      { cx: 0, cy: -8, rx: 8.5, ry: 10 },
      { cx: 0, cy: 8, rx: 7.5, ry: 8.5 },
    ],
    hit: { rx: 18, ry: 31 },
  },

  lateral_incisor: {
    outline:
      "M -11 -22.5 C -12.8 -18.5 -13.2 -7.5 -12.4 1.5 C -11.6 11 -8.8 19.5 -4.6 22.8 C -2.2 24.6 2.2 24.6 4.6 22.8 C 8.8 19.5 11.6 11 12.4 1.5 C 13.2 -7.5 12.8 -18.5 11 -22.5 C 7.8 -28 -7.8 -28 -11 -22.5 Z",
    shade:
      "M -8.5 -18.5 C -10 -15 -10.4 -6.5 -9.7 1 C -9 10 -6.6 17.5 -3.6 20.2 C -1.8 21.8 1.8 21.8 3.6 20.2 C 6.6 17.5 9 10 9.7 1 C 10.4 -6.5 10 -15 8.5 -18.5 C 6 -23.5 -6 -23.5 -8.5 -18.5 Z",
    grooves: "M -5 -14.5 Q 0 -16.5 5 -14.5 M -6 0 Q 0 2 6 0 M -3.8 13 Q 0 15 3.8 13 M 0 -17.5 L 0 17.5",
    cusps: [
      { cx: 0, cy: -7, rx: 6.8, ry: 8.5 },
      { cx: 0, cy: 7.5, rx: 5.8, ry: 7.2 },
    ],
    hit: { rx: 15, ry: 28 },
  },

  canine: {
    outline:
      "M 0 -30.5 C -3.2 -29 -9 -23.5 -11.8 -14.5 C -14 -7 -13.5 3.5 -10.8 12.5 C -8.5 19.5 -4.5 25 -1.5 27.2 C 0 28.2 0 28.2 1.5 27.2 C 4.5 25 8.5 19.5 10.8 12.5 C 13.5 3.5 14 -7 11.8 -14.5 C 9 -23.5 3.2 -29 0 -30.5 Z",
    shade:
      "M 0 -26 C -2.6 -24.8 -7.4 -20 -9.6 -12.5 C -11.5 -6 -11.2 2.5 -8.8 10.5 C -6.8 16.5 -3.6 21.2 -1.2 23 C 0 23.8 0 23.8 1.2 23 C 3.6 21.2 6.8 16.5 8.8 10.5 C 11.2 2.5 11.5 -6 9.6 -12.5 C 7.4 -20 2.6 -24.8 0 -26 Z",
    grooves: "M 0 -23 L 0 19 M -7 -6 Q 0 -11 7 -6 M -5.5 8 Q 0 4.5 5.5 8",
    cusps: [
      { cx: 0, cy: -11, rx: 5.6, ry: 10 },
      { cx: -4, cy: 4, rx: 4.5, ry: 5.8 },
      { cx: 4, cy: 4, rx: 4.5, ry: 5.8 },
    ],
    hit: { rx: 16, ry: 32 },
  },

  premolar: {
    outline:
      "M -1.5 -24.5 C -8.5 -24.5 -15.5 -20.5 -17.8 -13.5 C -19.5 -8 -19 1 -16.5 6 C -19 10.5 -19.2 17 -15.8 21.5 C -12 26.5 -5.5 28.5 0 28.5 C 5.5 28.5 12 26.5 15.8 21.5 C 19.2 17 19 10.5 16.5 6 C 19 1 19.5 -8 17.8 -13.5 C 15.5 -20.5 8.5 -24.5 1.5 -24.5 C 0.5 -24.7 -0.5 -24.7 -1.5 -24.5 Z",
    shade:
      "M -1 -20.5 C -7 -20.5 -13 -17 -15 -11.5 C -16.5 -7 -16 0.5 -13.8 5 C -16 9 -16 14.5 -13 18.5 C -9.5 23 -4.5 24.8 0 24.8 C 4.5 24.8 9.5 23 13 18.5 C 16 14.5 16 9 13.8 5 C 16 0.5 16.5 -7 15 -11.5 C 13 -17 7 -20.5 1 -20.5 C 0.3 -20.6 -0.3 -20.6 -1 -20.5 Z",
    grooves: "M 0 -16.5 L 0 18 M -12.5 0 L 12.5 0 M -8 -8 Q 0 -12 8 -8 M -8.5 9 Q 0 5 8.5 9",
    secondary: "M -6 -12 Q -2 -8 0 -1 M 6 -12 Q 2 -8 0 -1 M -5.5 13 Q -2 9 0 2 M 5.5 13 Q 2 9 0 2",
    cusps: [
      { cx: -6.5, cy: -6, rx: 8, ry: 8.8 },
      { cx: 6.5, cy: -6, rx: 8, ry: 8.8 },
      { cx: -5, cy: 8.5, rx: 6.2, ry: 6.5 },
      { cx: 5, cy: 8.5, rx: 6.2, ry: 6.5 },
    ],
    pits: [{ cx: 0, cy: 0, r: 1.25 }],
    hit: { rx: 21, ry: 27 },
  },

  molar: {
    outline:
      "M -4.5 -25.5 C -11.5 -26.5 -18.5 -23.5 -22 -17 C -25 -12 -25.5 -4.5 -23.8 1.5 C -26 6.5 -24.8 14 -20.5 19.5 C -15.5 25.5 -8 28 -0.8 28 C 6.5 28.5 15 25.5 20 20 C 24.5 15 26.5 7.5 25.2 1 C 26.8 -4.5 26 -12 22.2 -17.5 C 18 -24 10 -27 2.5 -26.5 C -0.2 -26.5 -2.2 -26 -4.5 -25.5 Z",
    shade:
      "M -3.5 -21.5 C -9.5 -22.5 -15.5 -20 -18.5 -14.5 C -21 -10 -21.5 -3.5 -20 1.5 C -21.8 6 -20.5 12.5 -16.8 17 C -12.5 22.5 -6 24.5 -0.2 24.5 C 5.5 25 13 22.5 17.2 17.5 C 21 13 22.5 6.5 21.5 1 C 22.8 -4 22 -10.5 18.8 -15 C 15 -20.5 8.5 -23 2 -22.5 C 0 -22.5 -1.5 -22 -3.5 -21.5 Z",
    grooves:
      "M 0 -17.5 L 0 19.5 M -17.5 0 L 17.5 0 M -11.5 -10 Q 0 -14 11.5 -10 M -12 10.5 Q 0 6.5 12 10.5",
    secondary:
      "M -10 -10 L 10 10 M 10 -10 L -10 10 M -7.5 -15 Q -3.5 -8 0 -1.5 M 7.5 -15 Q 3.5 -8 0 -1.5 M -7.5 15 Q -3.5 8 0 1.5 M 7.5 15 Q 3.5 8 0 1.5",
    cusps: [
      { cx: -8.8, cy: -8.5, rx: 8.6, ry: 8.2 },
      { cx: 8.8, cy: -8.5, rx: 8.6, ry: 8.2 },
      { cx: -8.8, cy: 8.8, rx: 8.4, ry: 7.8 },
      { cx: 8.8, cy: 8.8, rx: 8.4, ry: 7.8 },
    ],
    pits: [
      { cx: 0, cy: 0, r: 1.4 },
      { cx: -5, cy: -3.5, r: 1 },
      { cx: 5, cy: -3.5, r: 1 },
      { cx: -5, cy: 4, r: 1 },
      { cx: 5, cy: 4, r: 1 },
    ],
    hit: { rx: 27, ry: 28 },
  },
};

/**
 * Place teeth on a natural horseshoe with FDI labels outside the arch.
 */
export function toothPositions(teeth, { cx, cy, rx, ry, invert = false, labelPad = 58 }) {
  const count = teeth.length;
  return teeth.map((tooth, index) => {
    const t = count === 1 ? 0.5 : index / (count - 1);
    // Pack slightly denser near midline so contacts read continuous.
    const eased = t < 0.5 ? Math.pow(t * 2, 0.94) / 2 : 1 - Math.pow((1 - t) * 2, 0.94) / 2;

    const angle = invert ? Math.PI - eased * Math.PI : Math.PI + eased * Math.PI;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const rotate = (angle * 180) / Math.PI + 90;

    const scale = toothScale(tooth);
    const type = toothTypeFromFdi(tooth);
    const typePad = type === "molar" ? 18 : type === "premolar" ? 12 : type === "canine" ? 10 : 8;
    const pad = labelPad + typePad + (scale - 1) * 16;

    const labelX = cx + (rx + pad) * Math.cos(angle);
    const labelY = cy + (ry + pad) * Math.sin(angle);

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
