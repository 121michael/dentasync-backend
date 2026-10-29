import { useEffect, useId, useRef } from "react";

export function ConfirmDialog({
  open,
  title,
  message,
  cancelLabel = "Keep Appointment",
  confirmLabel = "Yes, Cancel Appointment",
  busy = false,
  busyLabel = "Cancelling…",
  onCancel,
  onConfirm,
}) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();
    function onKeyDown(event) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onCancel();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="staff-modal-backdrop logout-confirm-backdrop" role="presentation">
      <section
        ref={dialogRef}
        className="staff-modal staff-modal--confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
      >
        <header className="staff-modal__header">
          <h2 id={titleId}>{title}</h2>
        </header>
        <p id={messageId} className="staff-confirm-copy">
          {message}
        </p>
        <div className="staff-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            {cancelLabel}
          </button>
          <button type="button" className="button button--primary" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
