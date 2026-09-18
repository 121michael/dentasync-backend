/**
 * Flat, front-facing 2D tooth geometry for the odontogram.
 *
 * Every tooth is drawn inside the same 48 x 64 viewBox with the root at the top and
 * the crown at the bottom, so all teeth share one size and one baseline. Lower-arch
 * teeth are mirrored vertically (crown up) by CSS — no rotation, no perspective.
 */

export const TOOTH_VIEW = { width: 48, height: 64 };

export function isPrimaryToothNumber(toothNumber) {
  const value = Number(String(toothNumber).trim());
  if (!Number.isInteger(value)) return false;
  const quadrant = Math.floor(value / 10);
  const position = value % 10;
  return quadrant >= 5 && quadrant <= 8 && position >= 1 && position <= 5;
}

export function toothTypeFromFdi(toothNumber) {
  const value = String(toothNumber).trim();
  const position = Number(value.slice(-1));
  if (isPrimaryToothNumber(value)) {
    if (position === 1) return "central_incisor";
    if (position === 2) return "lateral_incisor";
    if (position === 3) return "canine";
    return "primary_molar";
  }
  if (position === 1) return "central_incisor";
  if (position === 2) return "lateral_incisor";
  if (position === 3) return "canine";
  if (position === 4 || position === 5) return "premolar";
  return "molar";
}

/**
 * Front-view outlines. `roots` sit above the crown; `details` are hairline grooves and
 * the incisal/occlusal edge. Nothing here uses gradients, shadows or depth cues.
 */
export const FRONT_TOOTH_SHAPES = {
  central_incisor: {
    roots: ["M 21 6 C 22.4 4.4 25.6 4.4 27 6 L 30 26.5 L 18 26.5 Z"],
    crown:
      "M 12 25 Q 12 22 14.8 22 L 33.2 22 Q 36 22 36 25 L 36 48 Q 36 56.5 24 58.5 Q 12 56.5 12 48 Z",
    details: ["M 19 28.5 L 19 49", "M 29 28.5 L 29 49", "M 14.5 52.5 Q 24 55.5 33.5 52.5"],
  },

  lateral_incisor: {
    roots: ["M 21.6 7 C 22.8 5.5 25.2 5.5 26.4 7 L 29 26.5 L 19 26.5 Z"],
    crown:
      "M 14 25 Q 14 22.2 16.6 22.2 L 31.4 22.2 Q 34 22.2 34 25 L 34 47 Q 34 55.5 24 57.5 Q 14 55.5 14 47 Z",
    details: ["M 20 28.5 L 20 48", "M 28 28.5 L 28 48", "M 16.5 51.5 Q 24 54.5 31.5 51.5"],
  },

  canine: {
    roots: ["M 21 4 C 22.4 2.4 25.6 2.4 27 4 L 30 27 L 18 27 Z"],
    crown:
      "M 14 25.5 Q 14 22.8 16.6 22.8 L 31.4 22.8 Q 34 22.8 34 25.5 L 34 45 Q 34 51.5 24 60.5 Q 14 51.5 14 45 Z",
    details: ["M 24 29 L 24 55", "M 17 46 Q 24 50 31 46"],
  },

  premolar: {
    roots: ["M 20 7 C 21.6 4.8 26.4 4.8 28 7 L 30 27 L 18 27 Z"],
    crown:
      "M 11 26 Q 11 23 14 23 L 34 23 Q 37 23 37 26 L 37 47 Q 37 55.5 24 57.5 Q 11 55.5 11 47 Z",
    details: ["M 24 29.5 L 24 50", "M 13 49.5 Q 18.5 54 24 50.5 Q 29.5 54 35 49.5"],
  },

  molar: {
    roots: [
      "M 15 7 C 16.4 5 19.8 5.4 20.4 7.8 L 21 27 L 13 27 Z",
      "M 33 7 C 31.6 5 28.2 5.4 27.6 7.8 L 27 27 L 35 27 Z",
    ],
    crown:
      "M 8 26 Q 8 23 11 23 L 37 23 Q 40 23 40 26 L 40 48 Q 40 56.5 24 58.5 Q 8 56.5 8 48 Z",
    details: ["M 24 29.5 L 24 50", "M 10 48.5 Q 17 54 24 50 Q 31 54 38 48.5"],
  },

  primary_molar: {
    roots: [
      "M 16 9 C 17.3 7.2 20.3 7.6 20.8 9.8 L 21.4 27 L 14 27 Z",
      "M 32 9 C 30.7 7.2 27.7 7.6 27.2 9.8 L 26.6 27 L 34 27 Z",
    ],
    crown:
      "M 10 26 Q 10 23.2 12.8 23.2 L 35.2 23.2 Q 38 23.2 38 26 L 38 46.5 Q 38 54.5 24 56.5 Q 10 54.5 10 46.5 Z",
    details: ["M 24 29.5 L 24 48.5", "M 12 47 Q 18 52 24 48.5 Q 30 52 36 47"],
  },
};

export function frontToothShape(toothNumber) {
  return FRONT_TOOTH_SHAPES[toothTypeFromFdi(toothNumber)] || FRONT_TOOTH_SHAPES.premolar;
}
