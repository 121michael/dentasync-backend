import { useEffect, useState } from "react";
import { getLoadingSnapshot, subscribeLoading } from "../loadingStore";
import { ToothLoader } from "./ToothLoader";

/**
 * Global tooth overlay for major GET data loads.
 * Hidden whenever a page-level LoadingState already owns the visual loader
 * so route changes never stack a second "Loading" screen.
 */
export function GlobalLoadingOverlay() {
  const [snapshot, setSnapshot] = useState(getLoadingSnapshot);

  useEffect(() => subscribeLoading(setSnapshot), []);

  if (snapshot.pageLoaderCount > 0 || !snapshot.visible) {
    return null;
  }

  return <ToothLoader overlay active label={snapshot.pageLoaderLabel || "Loading"} />;
}
