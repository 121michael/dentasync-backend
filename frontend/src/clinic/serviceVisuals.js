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
