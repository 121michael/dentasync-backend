import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  beginRouteLoading,
  endRouteLoading,
  getLoadingSnapshot,
  subscribeLoading,
} from "../loadingStore";
import { ToothLoader } from "./ToothLoader";

const ROUTE_HOLD_MS = 280;

/**
 * Global tooth overlay for route changes and major GET data loads.
 * Hidden whenever a page-level LoadingState already owns the visual loader.
 */
export function GlobalLoadingOverlay() {
  const location = useLocation();
  const [snapshot, setSnapshot] = useState(getLoadingSnapshot);

  useEffect(() => subscribeLoading(setSnapshot), []);

  useEffect(() => {
    beginRouteLoading();
    const timer = window.setTimeout(() => {
      endRouteLoading();
    }, ROUTE_HOLD_MS);
    return () => {
      window.clearTimeout(timer);
      endRouteLoading();
    };
  }, [location.pathname, location.search]);

  if (snapshot.pageLoaderCount > 0 || !snapshot.visible) {
    return null;
  }

  return <ToothLoader overlay active label="Loading" />;
}
