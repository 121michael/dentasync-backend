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
