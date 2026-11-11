import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { getLoadingSnapshot, subscribeLoading } from "../loadingStore";
import { SkeletonScreen, skeletonKind, skeletonPortal } from "./SkeletonScreen";

const CONTENT_MAIN = "main.portal-content, main.admin-content, main.staff-content, main.dentist-content";

function contentFrame() {
  const main = document.querySelector(CONTENT_MAIN);
  if (!main) return null;
  const rect = main.getBoundingClientRect();
  const style = getComputedStyle(main);
  return {
    host: main,
    coverStyle: {
      position: "fixed",
      top: `${rect.top}px`,
      left: `${rect.left}px`,
      width: `${rect.width}px`,
      height: `${Math.max(rect.height, window.innerHeight - rect.top)}px`,
      padding: `${style.paddingTop} ${style.paddingRight} ${style.paddingBottom} ${style.paddingLeft}`,
      overflow: "auto",
      zIndex: 30,
    },
  };
}

/**
 * Content-area skeleton for tracked GET loads.
 * Hidden while a page LoadingState already owns the skeleton.
 */
export function GlobalLoadingOverlay() {
  const location = useLocation();
  const [snapshot, setSnapshot] = useState(getLoadingSnapshot);
  const [frame, setFrame] = useState(null);

  useEffect(() => subscribeLoading(setSnapshot), []);

  useEffect(() => {
    if (snapshot.pageLoaderCount > 0 || !snapshot.visible) {
      setFrame(null);
      return undefined;
    }
    const measure = () => setFrame(contentFrame());
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [snapshot.pageLoaderCount, snapshot.visible, location.pathname]);

  if (snapshot.pageLoaderCount > 0 || !snapshot.visible) return null;

  const screen = (
    <SkeletonScreen
      label={snapshot.pageLoaderLabel || "Loading"}
      kind={frame ? skeletonKind(location.pathname) : "simple"}
      portal={skeletonPortal(location.pathname)}
      history={Boolean(frame) && skeletonPortal(location.pathname) === "patient" && /\/appointments\/?$/.test(location.pathname)}
      session={!frame}
      cover={Boolean(frame)}
      coverStyle={frame?.coverStyle}
    />
  );

  return frame?.host ? createPortal(screen, frame.host) : screen;
}
