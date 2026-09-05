/** Occlusal tooth paths matched to the clinical FDI reference chart.
 * Local coords centered at 0,0. Long axis follows arch tangent after rotation.
 * Sized so 16 teeth pack on the arch with near-contacts (no heavy overlap).
 */

export function toothTypeFromFdi(toothNumber) {
  const n = Number(String(toothNumber).slice(-1));
  if (n === 1) return "central_incisor";
  if (n === 2) return "lateral_incisor";
  if (n === 3) return "canine";
  if (n === 4 || n === 5) return "premolar";
  return "molar";
}

/** Compact scales — continuous row with tiny embrasures; slightly reduced for fit. */
export function toothScale(toothNumber) {
  const type = toothTypeFromFdi(toothNumber);
  const digit = Number(String(toothNumber).slice(-1));
  if (type === "molar") return digit === 8 ? 1.12 : digit === 7 ? 1.22 : 1.26;
  if (type === "premolar") return digit === 4 ? 1.06 : 1.02;
  if (type === "canine") return 1.08;
  if (type === "lateral_incisor") return 0.94;
  return 1.05;
}

/**
 * Reference-like anatomy:
 * - Incisors: short wide shovel / spade
 * - Canines: pointed single cusp
 * - Premolars: rounded oval, two cusps, central groove
 * - Molars: large rounded rectangles, cross/X fissures, 4 cusps
 */
export const TOOTH_SHAPES = {
  central_incisor: {
    // Wider than tall-oval — spade / shovel crown
    outline:
      "M -11 -18 C -12.5 -14 -13 -6 -12.5 2 C -12 9 -9.5 15.5 -5.5 18 C -2.5 20 2.5 20 5.5 18 C 9.5 15.5 12 9 12.5 2 C 13 -6 12.5 -14 11 -18 C 8 -22.5 -8 -22.5 -11 -18 Z",
    shade:
      "M -8.5 -14.5 C -9.8 -11 -10.2 -5 -9.8 1.5 C -9.4 8 -7.2 13.5 -4.2 15.5 C -2 17 2 17 4.2 15.5 C 7.2 13.5 9.4 8 9.8 1.5 C 10.2 -5 9.8 -11 8.5 -14.5 C 6.2 -18.5 -6.2 -18.5 -8.5 -14.5 Z",
    grooves: "M -5 -12 Q 0 -14 5 -12 M -6 0 Q 0 1.5 6 0 M -4 11 Q 0 13 4 11 M 0 -14.5 L 0 14.5",
    cusps: [
      { cx: 0, cy: -6, rx: 7, ry: 7.5 },
      { cx: 0, cy: 6, rx: 6, ry: 6.5 },
    ],
    hit: { rx: 14, ry: 23 },
  },

  lateral_incisor: {
    outline:
      "M -8.5 -16 C -10 -12.5 -10.5 -5.5 -10 1.5 C -9.5 8 -7.5 14 -4.2 16.2 C -2 17.8 2 17.8 4.2 16.2 C 7.5 14 9.5 8 10 1.5 C 10.5 -5.5 10 -12.5 8.5 -16 C 6 -20 -6 -20 -8.5 -16 Z",
    shade:
      "M -6.5 -12.5 C -7.8 -10 -8.2 -4.5 -7.8 1 C -7.4 7 -5.6 12 -3.2 13.8 C -1.6 15 1.6 15 3.2 13.8 C 5.6 12 7.4 7 7.8 1 C 8.2 -4.5 7.8 -10 6.5 -12.5 C 4.8 -16 -4.8 -16 -6.5 -12.5 Z",
    grooves: "M -4 -10.5 Q 0 -12 4 -10.5 M -4.5 0 Q 0 1.2 4.5 0 M -3 10 Q 0 11.5 3 10 M 0 -12.5 L 0 12.5",
    cusps: [
      { cx: 0, cy: -5, rx: 5.5, ry: 6.5 },
      { cx: 0, cy: 5.5, rx: 4.8, ry: 5.5 },
    ],
    hit: { rx: 12, ry: 20 },
  },

  canine: {
    outline:
      "M 0 -22 C -2.5 -21 -7.5 -16.5 -9.5 -10 C -11.2 -4.5 -11 2.5 -8.8 9 C -7 14.5 -3.8 18.5 -1.3 20.2 C 0 21 0 21 1.3 20.2 C 3.8 18.5 7 14.5 8.8 9 C 11 2.5 11.2 -4.5 9.5 -10 C 7.5 -16.5 2.5 -21 0 -22 Z",
    shade:
      "M 0 -18 C -2 -17.2 -6 -13.5 -7.8 -8 C -9.2 -3.5 -9 2 -7.2 7.5 C -5.8 12 -3.2 15.5 -1.1 16.8 C 0 17.4 0 17.4 1.1 16.8 C 3.2 15.5 5.8 12 7.2 7.5 C 9 2 9.2 -3.5 7.8 -8 C 6 -13.5 2 -17.2 0 -18 Z",
    grooves: "M 0 -16 L 0 14 M -5.5 -4 Q 0 -7.5 5.5 -4 M -4.5 6 Q 0 3.5 4.5 6",
    cusps: [
      { cx: 0, cy: -8, rx: 4.5, ry: 7.5 },
      { cx: -3.2, cy: 3.5, rx: 3.5, ry: 4.5 },
      { cx: 3.2, cy: 3.5, rx: 3.5, ry: 4.5 },
    ],
    hit: { rx: 12, ry: 23 },
  },

  premolar: {
    outline:
      "M -1 -18.5 C -6.5 -18.5 -12 -15.5 -13.8 -10 C -15.2 -5.5 -14.8 1 -12.5 5 C -14.5 8.5 -14.5 13.5 -11.5 16.5 C -8.5 20 -4 21.5 0 21.5 C 4 21.5 8.5 20 11.5 16.5 C 14.5 13.5 14.5 8.5 12.5 5 C 14.8 1 15.2 -5.5 13.8 -10 C 12 -15.5 6.5 -18.5 1 -18.5 C 0.3 -18.6 -0.3 -18.6 -1 -18.5 Z",
    shade:
      "M -0.8 -15 C -5.5 -15 -10.2 -12.5 -11.6 -8 C -12.8 -4.5 -12.5 0.5 -10.5 4 C -12 7 -12 11.5 -9.5 14 C -7 17 -3.5 18.2 0 18.2 C 3.5 18.2 7 17 9.5 14 C 12 11.5 12 7 10.5 4 C 12.5 0.5 12.8 -4.5 11.6 -8 C 10.2 -12.5 5.5 -15 0.8 -15 C 0.3 -15.1 -0.3 -15.1 -0.8 -15 Z",
    grooves: "M 0 -12.5 L 0 14 M -10 0 L 10 0 M -6.5 -6 Q 0 -9 6.5 -6 M -6.5 7 Q 0 4 6.5 7",
    secondary: "M -4.5 -9 Q -1.5 -5 0 0 M 4.5 -9 Q 1.5 -5 0 0 M -4 10 Q -1.5 6 0 1 M 4 10 Q 1.5 6 0 1",
    cusps: [
      { cx: -5, cy: -4.5, rx: 6, ry: 6.5 },
      { cx: 5, cy: -4.5, rx: 6, ry: 6.5 },
      { cx: -4, cy: 6.5, rx: 4.8, ry: 5 },
      { cx: 4, cy: 6.5, rx: 4.8, ry: 5 },
    ],
    pits: [{ cx: 0, cy: 0, r: 1.1 }],
    hit: { rx: 16, ry: 21 },
  },

  molar: {
    // Rounded rectangle — largest, blockiest crown
    outline:
      "M -3.5 -19.5 C -9 -20.5 -14.5 -18 -17 -13 C -19.2 -9 -19.5 -3.5 -18 1 C -19.8 4.5 -18.8 10.5 -15.5 14.5 C -12 19 -6 21 -0.5 21 C 5 21.2 11.5 19 15.2 14.8 C 18.5 11 19.8 5 18.8 0.5 C 20 -3.5 19.5 -9 17.2 -13 C 14.5 -18 9 -20.5 2.5 -20 C 0.5 -20 -1.5 -19.8 -3.5 -19.5 Z",
    shade:
      "M -2.8 -16 C -7.5 -16.8 -12 -14.8 -14.2 -10.5 C -16 -7 -16.2 -2.5 -15 1 C -16.5 4 -15.5 9 -12.8 12.5 C -9.8 16.5 -5 18 -0.2 18 C 4.5 18.2 10 16.2 13 12.5 C 15.5 9.5 16.5 4.5 15.8 0.5 C 16.8 -3 16.5 -7.2 14.5 -10.8 C 12.2 -15 7.5 -16.8 2 -16.5 C 0.5 -16.5 -1 -16.2 -2.8 -16 Z",
    grooves: "M 0 -13.5 L 0 15 M -13.5 0 L 13.5 0 M -9 -7.5 Q 0 -11 9 -7.5 M -9.5 8 Q 0 4.5 9.5 8",
    secondary:
      "M -8 -8 L 8 8 M 8 -8 L -8 8 M -6 -12 Q -2.5 -6 0 -1 M 6 -12 Q 2.5 -6 0 -1 M -6 12 Q -2.5 6 0 1 M 6 12 Q 2.5 6 0 1",
    cusps: [
      { cx: -6.5, cy: -6.5, rx: 6.5, ry: 6.2 },
      { cx: 6.5, cy: -6.5, rx: 6.5, ry: 6.2 },
      { cx: -6.5, cy: 6.8, rx: 6.2, ry: 5.8 },
      { cx: 6.5, cy: 6.8, rx: 6.2, ry: 5.8 },
    ],
    pits: [
      { cx: 0, cy: 0, r: 1.2 },
      { cx: -4, cy: -2.8, r: 0.85 },
      { cx: 4, cy: -2.8, r: 0.85 },
      { cx: -4, cy: 3.2, r: 0.85 },
      { cx: 4, cy: 3.2, r: 0.85 },
    ],
    hit: { rx: 20, ry: 22 },
  },
};

/**
 * Place teeth on a horseshoe with width-aware packing (near-contacts like the reference).
 */
export function toothPositions(teeth, { cx, cy, rx, ry, invert = false, labelPad = 44 }) {
  const contactGap = 0.9;
  const items = teeth.map((tooth) => {
    const type = toothTypeFromFdi(tooth);
    const scale = toothScale(tooth);
    const shape = TOOTH_SHAPES[type];
    // Use outline-ish width (slightly under hit box) for tighter visual contacts.
    const halfWidth = shape.hit.rx * scale * 0.86;
    return { tooth, type, scale, halfWidth };
  });

  const totalWidth =
    items.reduce((sum, item) => sum + item.halfWidth * 2, 0) + contactGap * Math.max(0, items.length - 1);

  let cursor = 0;
  return items.map((item, index) => {
    cursor += item.halfWidth;
    const t = cursor / totalWidth;
    cursor += item.halfWidth + (index < items.length - 1 ? contactGap : 0);

    const angle = invert ? Math.PI - t * Math.PI : Math.PI + t * Math.PI;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const rotate = (angle * 180) / Math.PI + 90;

    // Keep FDI numbers just outside enamel — clear of crowns, inside the card.
    const typePad = item.type === "molar" ? 16 : item.type === "premolar" ? 12 : 10;
    const pad = labelPad + typePad;

    return {
      tooth: item.tooth,
      x,
      y,
      rotate,
      angle,
      labelX: cx + (rx + pad) * Math.cos(angle),
      labelY: cy + (ry + pad) * Math.sin(angle),
      type: item.type,
      scale: item.scale,
    };
  });
}
