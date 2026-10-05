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
    roots: ["M 20 5 C 21.5 3.2 26.5 3.2 28 5 L 30 25.5 L 18 25.5 Z"],
    crown:
      "M 10 26 Q 10 23 13 23 L 35 23 Q 38 23 38 26 L 38 47 Q 38 55 24 57.5 Q 10 55 10 47 Z",
    details: ["M 17 29 L 17 49", "M 31 29 L 31 49", "M 12.5 51 Q 24 55 35.5 51"],
  },

  lateral_incisor: {
    roots: ["M 20.6 6 C 22 4.4 26 4.4 27.4 6 L 29.4 25.5 L 18.6 25.5 Z"],
    crown:
      "M 12 27 Q 12 24 15 24 L 33 24 Q 36 24 36 27 L 36 46 Q 36 54 24 56.5 Q 12 54 12 46 Z",
    details: ["M 18.5 30 L 18.5 48", "M 29.5 30 L 29.5 48", "M 14.5 50 Q 24 54 33.5 50"],
  },

  canine: {
    roots: ["M 20 3 C 21.5 1.5 26.5 1.5 28 3 L 30 26 L 18 26 Z"],
    crown:
      "M 12 27 Q 12 24 15 24 L 33 24 Q 36 24 36 27 L 36 45 Q 36 51 24 61 Q 12 51 12 45 Z",
    details: ["M 24 30 L 24 56", "M 15 45 Q 24 49 33 45"],
  },

  premolar: {
    roots: ["M 19 5 C 20.6 3 27.4 3 29 5 L 30.5 26 L 17.5 26 Z"],
    crown:
      "M 8 27 Q 8 24 11 24 L 37 24 Q 40 24 40 27 L 40 47 Q 40 55 24 57.5 Q 8 55 8 47 Z",
    details: ["M 24 30 L 24 50", "M 10 49 Q 17 54 24 50 Q 31 54 38 49"],
  },

  molar: {
    roots: [
      "M 12.5 5 C 14.2 2.8 18.8 3.2 19.6 6 L 20.6 26 L 10 26 Z",
      "M 35.5 5 C 33.8 2.8 29.2 3.2 28.4 6 L 27.4 26 L 38 26 Z",
    ],
    crown:
      "M 5 27 Q 5 24 8 24 L 40 24 Q 43 24 43 27 L 43 47 Q 43 56 24 58.5 Q 5 56 5 47 Z",
    details: ["M 24 30 L 24 51", "M 7 49 Q 15.5 55 24 50.5 Q 32.5 55 41 49"],
  },

  primary_molar: {
    roots: [
      "M 13.5 7 C 15.2 5 19 5.4 19.6 8 L 20.4 26 L 11.5 26 Z",
      "M 34.5 7 C 32.8 5 29 5.4 28.4 8 L 27.6 26 L 36.5 26 Z",
    ],
    crown:
      "M 7 27 Q 7 24.2 10 24.2 L 38 24.2 Q 41 24.2 41 27 L 41 45 Q 41 53 24 55.5 Q 7 53 7 45 Z",
    details: ["M 24 30 L 24 48", "M 9 47 Q 16.5 52 24 48.5 Q 31.5 52 39 47"],
  },
};

export function frontToothShape(toothNumber) {
  return FRONT_TOOTH_SHAPES[toothTypeFromFdi(toothNumber)] || FRONT_TOOTH_SHAPES.premolar;
}
