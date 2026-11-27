import { useCallback, useEffect, useRef, useState } from "react";
import { Bot } from "lucide-react";
import { ClinicAssistantChat } from "./ClinicAssistantChat";
import { usePatientAssistant } from "../patientAssistant";

const STORAGE_KEY = "dentasync.patientAssistant.bubblePos";
const BUBBLE_SIZE = 48;
const DRAG_THRESHOLD = 8;
const EDGE_PAD = 10;

function viewportBox() {
  const view = window.visualViewport;
  return {
    left: view?.offsetLeft ?? 0,
    top: view?.offsetTop ?? 0,
    width: view?.width ?? window.innerWidth,
    height: view?.height ?? window.innerHeight,
  };
}

function safeBottom() {
  return 12;
}

function defaultPosition() {
  const view = viewportBox();
  const mobile = window.matchMedia("(max-width: 980px)").matches;
  return {
    x: view.left + EDGE_PAD + (mobile ? 6 : view.width - BUBBLE_SIZE - EDGE_PAD * 2),
    y: view.top + view.height - BUBBLE_SIZE - EDGE_PAD - (mobile ? Math.max(12, safeBottom()) : 8),
  };
}

function clampPosition(x, y) {
  const view = viewportBox();
  const maxX = view.left + view.width - BUBBLE_SIZE - EDGE_PAD;
  const maxY = view.top + view.height - BUBBLE_SIZE - EDGE_PAD;
  const minX = view.left + EDGE_PAD;
  const minY = view.top + EDGE_PAD;
  let nextX = Math.min(Math.max(x, minX), Math.max(minX, maxX));
  let nextY = Math.min(Math.max(y, minY), Math.max(minY, maxY));

  if (window.matchMedia("(max-width: 980px)").matches) {
    const fabSize = 66;
    const fabLeft = view.left + view.width - fabSize - EDGE_PAD - 8;
    const fabTop = view.top + view.height - fabSize - EDGE_PAD - Math.max(8, safeBottom());
    const overlapsMenu =
      nextX + BUBBLE_SIZE > fabLeft - 12 && nextY + BUBBLE_SIZE > fabTop - 12;
    if (overlapsMenu) {
      const home = defaultPosition();
      nextX = home.x;
      nextY = home.y;
    }
  }

  return { x: Math.round(nextX), y: Math.round(nextY) };
}

function readStoredPosition() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.x) || !Number.isFinite(parsed?.y)) return null;
    return clampPosition(parsed.x, parsed.y);
  } catch {
    return null;
  }
}

function writeStoredPosition(position) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ x: position.x, y: position.y }));
  } catch {
    // Ignore quota / private-mode failures.
  }
}

function panelMetrics(bubble) {
  const view = viewportBox();
  const gap = 12;
  const width = Math.min(416, Math.max(280, view.width - 20));
  const maxHeight = Math.min(620, view.height - 24 - (window.matchMedia("(max-width: 980px)").matches ? 24 : 0));
  const height = Math.max(320, maxHeight);

  let left = bubble.x + BUBBLE_SIZE - width;
  if (left < view.left + EDGE_PAD) left = view.left + EDGE_PAD;
  if (left + width > view.left + view.width - EDGE_PAD) {
    left = view.left + view.width - EDGE_PAD - width;
  }

  let top = bubble.y - gap - height;
  const bubbleRect = { left: bubble.x, top: bubble.y, right: bubble.x + BUBBLE_SIZE, bottom: bubble.y + BUBBLE_SIZE };
  if (top < view.top + EDGE_PAD) {
    top = bubble.y + BUBBLE_SIZE + gap;
  }
  if (top + height > view.top + view.height - EDGE_PAD) {
    top = Math.max(view.top + EDGE_PAD, view.top + view.height - EDGE_PAD - height);
  }

  const panelBottom = top + height;
  const overlapsBubble =
    left < bubbleRect.right + 8 &&
    left + width > bubbleRect.left - 8 &&
    top < bubbleRect.bottom + 8 &&
    panelBottom > bubbleRect.top - 8;
  if (overlapsBubble) {
    const spaceAbove = bubble.y - (view.top + EDGE_PAD);
    const spaceBelow = view.top + view.height - EDGE_PAD - (bubble.y + BUBBLE_SIZE);
    if (spaceAbove >= spaceBelow) {
      top = Math.max(view.top + EDGE_PAD, bubble.y - gap - height);
    } else {
      top = Math.min(bubble.y + BUBBLE_SIZE + gap, view.top + view.height - EDGE_PAD - height);
    }
  }

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  };
}

export function PatientAssistantWidget() {
  const { open, toggleAssistant, closeAssistant } = usePatientAssistant();
  const [position, setPosition] = useState(() =>
    typeof window === "undefined" ? { x: 0, y: 0 } : readStoredPosition() || defaultPosition()
  );
  const [dragging, setDragging] = useState(false);
  const [panelBox, setPanelBox] = useState(() =>
    typeof window === "undefined" ? { left: 0, top: 0, width: 360, height: 520 } : panelMetrics(readStoredPosition() || defaultPosition())
  );
  const dragRef = useRef({
    active: false,
    moved: false,
    allowDrag: true,
    originX: 0,
    originY: 0,
    startX: 0,
    startY: 0,
    pointerId: null,
  });
  const positionRef = useRef(position);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  const reclamp = useCallback(() => {
    setPosition((current) => {
      const next = clampPosition(current.x, current.y);
      if (next.x !== current.x || next.y !== current.y) writeStoredPosition(next);
      return next;
    });
  }, []);

  useEffect(() => {
    reclamp();
    const view = window.visualViewport;
    window.addEventListener("resize", reclamp);
    window.addEventListener("orientationchange", reclamp);
    view?.addEventListener("resize", reclamp);
    view?.addEventListener("scroll", reclamp);
    return () => {
      window.removeEventListener("resize", reclamp);
      window.removeEventListener("orientationchange", reclamp);
      view?.removeEventListener("resize", reclamp);
      view?.removeEventListener("scroll", reclamp);
    };
  }, [reclamp]);

  useEffect(() => {
    setPanelBox(panelMetrics(position));
  }, [position, open]);

  function onPointerDown(event) {
    if (event.button != null && event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      moved: false,
      allowDrag: !open,
      originX: positionRef.current.x,
      originY: positionRef.current.y,
      startX: event.clientX,
      startY: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function onPointerMove(event) {
    const drag = dragRef.current;
    if (!drag.active || !drag.allowDrag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && dx * dx + dy * dy < DRAG_THRESHOLD * DRAG_THRESHOLD) return;
    drag.moved = true;
    setDragging(true);
    event.preventDefault();
    const next = clampPosition(drag.originX + dx, drag.originY + dy);
    positionRef.current = next;
    setPosition(next);
  }

  function endDrag(event) {
    const drag = dragRef.current;
    if (!drag.active || (event.pointerId != null && drag.pointerId !== event.pointerId)) return;
    drag.active = false;
    setDragging(false);
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // Capture may already be released.
    }
    if (drag.moved) {
      writeStoredPosition(positionRef.current);
      return;
    }
    toggleAssistant();
  }

  return (
    <>
      <div
        id="patient-assistant-panel"
        className={`patient-assistant__panel${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="false"
        aria-labelledby="patient-assistant-title"
        aria-hidden={!open}
        style={{
          left: `${panelBox.left}px`,
          top: `${panelBox.top}px`,
          width: `${panelBox.width}px`,
          height: `${panelBox.height}px`,
        }}
      >
        <h2 id="patient-assistant-title" className="sr-only">
          AI Clinic Assistant
        </h2>
        <ClinicAssistantChat compact visible={open} onMinimize={closeAssistant} />
      </div>

      <button
        type="button"
        className={`patient-assistant__bubble${open ? " is-open" : ""}${dragging ? " is-dragging" : ""}`}
        style={{ left: `${position.x}px`, top: `${position.y}px` }}
        aria-label={open ? "Close AI Assistant" : "Open AI Assistant"}
        aria-expanded={open}
        aria-controls="patient-assistant-panel"
        title="Chat with AI Assistant"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <span className="patient-assistant__bubble-core" aria-hidden="true">
          <Bot size={22} strokeWidth={2} />
        </span>
      </button>
    </>
  );
}
