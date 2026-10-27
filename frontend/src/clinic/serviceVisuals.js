export const ORTHODONTICS_SERVICE_ID = "orthodontic-consultation";
export const ORTHODONTICS_IMAGE_URL = "/services/orthodontics-before-after.jpg";
export const ORTHODONTICS_IMAGE_ALT =
  "Before-and-after example of orthodontic treatment with braces. Individual results vary.";

export function attachServiceVisual(service) {
  if (!service) return service;
  if (service.id !== ORTHODONTICS_SERVICE_ID) return service;
  return {
    ...service,
    imageUrl: service.imageUrl || service.image || service.photoUrl || ORTHODONTICS_IMAGE_URL,
    imageFit: "contain",
    imageAlt: service.imageAlt || ORTHODONTICS_IMAGE_ALT,
  };
}
