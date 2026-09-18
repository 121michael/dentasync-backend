/**
 * Tiny global loading store for API + route overlays.
 * Kept framework-agnostic so api.js can update it without React imports.
 */

const listeners = new Set();

let apiCount = 0;
let routeCount = 0;
let visible = false;
let showTimer = null;
let hideTimer = null;
let shownAt = 0;

const API_SHOW_DELAY_MS = 220;
const ROUTE_SHOW_DELAY_MS = 0;
const MIN_VISIBLE_MS = 240;

function notify() {
  const snapshot = getLoadingSnapshot();
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch {
      // Ignore subscriber errors.
    }
  });
}

function clearShowTimer() {
  if (showTimer) {
    window.clearTimeout(showTimer);
    showTimer = null;
  }
}

function clearHideTimer() {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
}

function scheduleVisibility() {
  const shouldShow = apiCount > 0 || routeCount > 0;

  if (shouldShow) {
    clearHideTimer();
    if (visible) {
      notify();
      return;
    }
    if (showTimer) return;
    const delay = routeCount > 0 ? ROUTE_SHOW_DELAY_MS : API_SHOW_DELAY_MS;
    showTimer = window.setTimeout(() => {
      showTimer = null;
      visible = true;
      shownAt = Date.now();
      notify();
    }, delay);
    notify();
    return;
  }

  clearShowTimer();
  if (!visible) {
    notify();
    return;
  }

  const elapsed = Date.now() - shownAt;
  const wait = Math.max(0, MIN_VISIBLE_MS - elapsed);
  clearHideTimer();
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    visible = false;
    notify();
  }, wait);
}

export function getLoadingSnapshot() {
  return {
    apiCount,
    routeCount,
    busy: apiCount > 0 || routeCount > 0,
    visible,
  };
}

export function subscribeLoading(listener) {
  listeners.add(listener);
  listener(getLoadingSnapshot());
  return () => listeners.delete(listener);
}

export function beginApiLoading() {
  apiCount += 1;
  scheduleVisibility();
}

export function endApiLoading() {
  apiCount = Math.max(0, apiCount - 1);
  scheduleVisibility();
}

export function beginRouteLoading() {
  routeCount += 1;
  scheduleVisibility();
}

export function endRouteLoading() {
  routeCount = Math.max(0, routeCount - 1);
  scheduleVisibility();
}
