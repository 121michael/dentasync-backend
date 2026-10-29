import { attachServiceVisual } from "./serviceVisuals.js";

export const LANDING_HIDDEN_SERVICE_IDS = new Set(["emergency-care"]);
export const LANDING_MERGED_INTO_BRIDGE_IDS = new Set(["dental-crowns"]);

export const BRIDGE_CROWN_PUBLIC_NAME = "Fixed Bridge / Dental Crowns";
export const BRIDGE_CROWN_PUBLIC_DESCRIPTION =
  "A fixed bridge replaces one or more missing teeth by joining replacement teeth to neighboring teeth. A crown restores or covers an individual tooth. These are different treatments; the dentist recommends the right option after examining your smile.";

export function presentBridgeCrownService(service) {
  const visual = attachServiceVisual(service);
  return {
    ...visual,
    id: "fixed-bridge",
    name: BRIDGE_CROWN_PUBLIC_NAME,
    description: BRIDGE_CROWN_PUBLIC_DESCRIPTION,
  };
}

export function presentPublicLandingServices(services) {
  const list = (services || []).map(attachServiceVisual);
  const presented = [];
  let bridgeInserted = false;

  for (const service of list) {
    if (!service?.id) continue;
    if (LANDING_HIDDEN_SERVICE_IDS.has(service.id)) continue;
    if (LANDING_MERGED_INTO_BRIDGE_IDS.has(service.id)) continue;
    if (service.id === "fixed-bridge") {
      presented.push(presentBridgeCrownService(service));
      bridgeInserted = true;
      continue;
    }
    presented.push(service);
  }

  if (!bridgeInserted) {
    const crowns = list.find((service) => service.id === "dental-crowns");
    if (crowns) presented.push(presentBridgeCrownService(crowns));
  }

  return presented;
}

export function isCombinedBridgeCrownService(service) {
  return service?.id === "fixed-bridge" && /crown/i.test(service?.name || "");
}
