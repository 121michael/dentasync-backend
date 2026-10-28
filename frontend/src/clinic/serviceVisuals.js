export const ORTHODONTICS_SERVICE_ID = "orthodontic-consultation";
export const ORTHODONTICS_IMAGE_URL = "/services/orthodontics-before-after.jpg";
export const ORTHODONTICS_IMAGE_ALT =
  "Before-and-after example of orthodontic treatment with braces. Individual results vary.";

export const DENTURES_SERVICE_ID = "dentures";
export const DENTURES_IMAGE_URL = "/services/dentures.jpg";
export const DENTURES_IMAGE_ALT =
  "Complete upper and lower denture model on a dental cast. The photo shows the full appliance, not a cropped close-up.";

export const DENTAL_IMPLANTS_SERVICE_ID = "dental-implants";
export const DENTAL_IMPLANTS_IMAGE_URL = "/services/dental-implants.jpg";
export const DENTAL_IMPLANTS_IMAGE_ALT =
  "Illustration of a dental implant in the jawbone supporting a replacement tooth beside natural teeth.";

export const VENEERS_SERVICE_ID = "veneers";
export const VENEERS_IMAGE_URL = "/services/veneers.jpg";
export const VENEERS_IMAGE_ALT =
  "Close-up of a smile showing the front surfaces of the teeth, used to illustrate dental veneers. Individual results vary.";

export const CLEANING_SERVICE_ID = "cleaning";
export const CLEANING_IMAGE_URL = "/services/dental-cleaning.jpg";
export const CLEANING_IMAGE_ALT =
  "Three-part example of dental cleaning, from stained teeth to cleaned teeth. Individual results vary and are not guaranteed.";

export const EXTRACTION_SERVICE_ID = "extraction";
export const EXTRACTION_IMAGE_URL = "/services/tooth-extraction.jpg";
export const EXTRACTION_IMAGE_ALT =
  "Illustration of a tooth being removed from the gum with dental forceps. Individual treatment needs vary.";

export const FILLING_SERVICE_ID = "filling";
export const FILLING_IMAGE_URL = "/services/dental-filling.jpg";
export const FILLING_IMAGE_ALT =
  "Before-and-after example of a permanent filling restoring a damaged tooth. Individual results vary and are not guaranteed.";

export const ROOT_CANAL_SERVICE_ID = "root-canal";
export const ROOT_CANAL_IMAGE_URL = "/services/root-canal.jpg";
export const ROOT_CANAL_IMAGE_ALT =
  "Illustration of a root canal file treating the inside of a tooth. Individual treatment needs vary.";

export const WHITENING_SERVICE_ID = "whitening";
export const WHITENING_IMAGE_URL = "/services/teeth-whitening.jpg";
export const WHITENING_IMAGE_ALT =
  "Patient receiving in-office teeth whitening with protective glasses and a bleaching light. Individual results vary.";

export const CONSULTATION_SERVICE_ID = "general-consultation";
export const CONSULTATION_IMAGE_URL = "/services/oral-examination.jpg";
export const CONSULTATION_IMAGE_ALT =
  "Dentist examining a patient's teeth with a dental mirror during an oral consultation.";

export const FIXED_BRIDGE_SERVICE_ID = "fixed-bridge";
export const FIXED_BRIDGE_IMAGE_URL = "/services/fixed-bridge.jpg";
export const FIXED_BRIDGE_IMAGE_ALT =
  "Before-and-after example of a fixed dental bridge restoring a smile. Individual results vary and are not guaranteed.";

export const GUM_CONTOURING_SERVICE_ID = "gum-contouring";
export const GUM_CONTOURING_IMAGE_URL = "/services/gum-contouring.jpg";
export const GUM_CONTOURING_IMAGE_ALT =
  "Split illustration of gum contouring, comparing uneven gum height with a more even gum line. Individual results vary.";

const SERVICE_VISUALS = {
  [ORTHODONTICS_SERVICE_ID]: {
    imageUrl: ORTHODONTICS_IMAGE_URL,
    imageFit: "contain",
    imageAlt: ORTHODONTICS_IMAGE_ALT,
  },
  [DENTURES_SERVICE_ID]: {
    imageUrl: DENTURES_IMAGE_URL,
    imageFit: "contain",
    imageAlt: DENTURES_IMAGE_ALT,
  },
  [DENTAL_IMPLANTS_SERVICE_ID]: {
    imageUrl: DENTAL_IMPLANTS_IMAGE_URL,
    imageFit: "contain",
    imageAlt: DENTAL_IMPLANTS_IMAGE_ALT,
  },
  [VENEERS_SERVICE_ID]: {
    imageUrl: VENEERS_IMAGE_URL,
    imageFit: "cover",
    imageAlt: VENEERS_IMAGE_ALT,
  },
  [CLEANING_SERVICE_ID]: {
    imageUrl: CLEANING_IMAGE_URL,
    imageFit: "contain",
    imageAlt: CLEANING_IMAGE_ALT,
  },
  [EXTRACTION_SERVICE_ID]: {
    imageUrl: EXTRACTION_IMAGE_URL,
    imageFit: "contain",
    imageAlt: EXTRACTION_IMAGE_ALT,
  },
  [FILLING_SERVICE_ID]: {
    imageUrl: FILLING_IMAGE_URL,
    imageFit: "contain",
    imageAlt: FILLING_IMAGE_ALT,
  },
  [ROOT_CANAL_SERVICE_ID]: {
    imageUrl: ROOT_CANAL_IMAGE_URL,
    imageFit: "contain",
    imageAlt: ROOT_CANAL_IMAGE_ALT,
  },
  [WHITENING_SERVICE_ID]: {
    imageUrl: WHITENING_IMAGE_URL,
    imageFit: "cover",
    imageAlt: WHITENING_IMAGE_ALT,
  },
  [CONSULTATION_SERVICE_ID]: {
    imageUrl: CONSULTATION_IMAGE_URL,
    imageFit: "cover",
    imageAlt: CONSULTATION_IMAGE_ALT,
  },
  [FIXED_BRIDGE_SERVICE_ID]: {
    imageUrl: FIXED_BRIDGE_IMAGE_URL,
    imageFit: "contain",
    imageAlt: FIXED_BRIDGE_IMAGE_ALT,
  },
  [GUM_CONTOURING_SERVICE_ID]: {
    imageUrl: GUM_CONTOURING_IMAGE_URL,
    imageFit: "contain",
    imageAlt: GUM_CONTOURING_IMAGE_ALT,
  },
};

export function attachServiceVisual(service) {
  if (!service) return service;
  const visual = SERVICE_VISUALS[service.id];
  if (!visual) return service;
  return {
    ...service,
    imageUrl: service.imageUrl || service.image || service.photoUrl || visual.imageUrl,
    imageFit: service.imageFit || visual.imageFit,
    imageAlt: service.imageAlt || visual.imageAlt,
  };
}
