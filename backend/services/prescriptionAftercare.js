"use strict";

// Exact aftercare copy from the clinic's official Amethyst Dental Clinic Rx pad.
// Print only when the prescription is linked to a confirmed extraction procedure.

const EXTRACTION_AFTERCARE = {
  title: "DO'S AND DONT'S AFTER A TOOTH EXTRACTION",
  dosHeading: "Do's after extraction",
  dontsHeading: "Don'ts after extraction",
  dos: [
    "Bite firmly on gauze for at least 20 minutes.",
    "Apply cold compress to reduce bleeding and pain for 3 to 6 hours.",
    "Take soft diet for 2 days and cold food.",
    "Rinse mouth with 1/2 sal in a glass of warm water after 24 hours.",
    "Take all the prescribed medication to control pain and prevent infecion.",
    "Maintain oral hygiene.",
    "If you have prolonged and/or severe pain, swelling, bleeding or fever call us immediately.",
  ],
  donts: [
    "Avoid constantly spitting within 24 hours",
    "Don't meddling the extraction site to prevent bleeding",
    "Avoid brushing your teeth nearly healing socket within 24 hours",
    "Avoind sytrenuos activities",
    "Avoid smoking and drinking alcohol",
    "Avoid taking hot foods/drinks",
  ],
};

const RX_PAD_HEADER = {
  name: "AMETHYST",
  bar: "DENTAL CLINIC",
  address1: "102 Grand central Residences Cityland EDSA cor. Sultan st",
  address2: "Brgy Highway Hills Mandaluyong City",
  phones: "09658045988 / 0275030553",
};

module.exports = {
  EXTRACTION_AFTERCARE,
  RX_PAD_HEADER,
};
