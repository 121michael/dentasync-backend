import { useEffect, useId, useRef } from "react";

export function LogoutConfirmDialog({ open, busy = false, onCancel, onConfirm }) {
  const titleId = useId();
  const messageId = useId();
  const dialogRef = useRef(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    cancelRef.current?.focus();

    function onKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        if (!busy) onCancel();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll("button:not(:disabled)")];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
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
          <h2 id={titleId}>Log Out?</h2>
        </header>
        <p id={messageId} className="staff-confirm-copy">
          Are you sure you want to log out of your account?
        </p>
        <div className="staff-modal__actions">
          <button
            ref={cancelRef}
            type="button"
            className="button button--secondary"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button type="button" className="button button--primary" onClick={onConfirm} disabled={busy}>
            {busy ? "Logging out…" : "Log Out"}
          </button>
        </div>
      </section>
    </div>
  );
}
