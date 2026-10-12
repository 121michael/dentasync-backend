import { useEffect, useMemo } from "react";
import { X } from "lucide-react";
import {
  publicQueueNumber,
  remainingRangeFromEntry,
  waitRangeFromEntry,
} from "../utils/queueWaitEstimate";

const SERVING_STATUSES = new Set(["dentist", "in_chair", "in_treatment"]);
const WAITING_STATUSES = new Set(["checked_in", "waiting", "preparing", "called"]);
const INELIGIBLE_STATUSES = new Set(["completed", "no_show", "skipped", "cancelled"]);

function statusOf(entry) {
  return String(entry?.status || "").toLowerCase();
}

function publicStatusLabel(status) {
  const value = String(status || "").toLowerCase();
  if (SERVING_STATUSES.has(value)) return "In treatment";
  if (value === "preparing" || value === "called") return "Called";
  if (value === "waiting" || value === "checked_in") return "Waiting";
  return "In queue";
}

function toWaitingRow(entry) {
  const wait = waitRangeFromEntry(entry);
  return {
    id: entry.id,
    queueNumber: publicQueueNumber(entry),
    waitLabel: wait === "Currently unavailable" ? "Estimate unavailable" : wait,
  };
}

export function buildQueueDisplayModel(queue = []) {
  const active = (Array.isArray(queue) ? queue : []).filter(
    (entry) => !INELIGIBLE_STATUSES.has(statusOf(entry))
  );
  const serving = active.find((entry) => SERVING_STATUSES.has(statusOf(entry))) || null;
  const waiting = active
    .filter((entry) => {
      if (serving && entry.id === serving.id) return false;
      if (SERVING_STATUSES.has(statusOf(entry))) return false;
      return WAITING_STATUSES.has(statusOf(entry));
    })
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0))
    .map(toWaitingRow)
    .filter((row) => row.queueNumber);

  return {
    serving: serving
      ? {
          queueNumber: publicQueueNumber(serving),
          statusLabel: publicStatusLabel(serving.status),
          remainingLabel: remainingRangeFromEntry(serving),
        }
      : null,
    waiting,
  };
}

export function StaffQueueDisplay({ queue, onExit }) {
  const model = useMemo(() => buildQueueDisplayModel(queue), [queue]);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onExit?.();
    }
    document.body.classList.add("is-queue-display");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("is-queue-display");
      window.removeEventListener("keydown", onKey);
    };
  }, [onExit]);

  return (
    <div className="staff-queue-board" role="dialog" aria-modal="true" aria-label="Live queue status">
      <header className="staff-queue-board__header">
        <div>
          <p className="staff-queue-board__eyebrow">Amethyst Dental Clinic</p>
          <h2>Live Queue Status</h2>
        </div>
        <button type="button" className="button button--secondary" onClick={onExit}>
          <X size={16} aria-hidden="true" /> Exit Display
        </button>
      </header>

      <div className="staff-queue-board__grid">
        <section className="staff-queue-board__serving" aria-label="Now serving">
          <p className="staff-queue-board__eyebrow">Now Serving</p>
          {model.serving?.queueNumber ? (
            <>
              <p className="staff-queue-board__ticket">{model.serving.queueNumber}</p>
              <p className="staff-queue-board__status">{model.serving.statusLabel}</p>
              <p className="staff-queue-board__remaining-label">Estimated remaining time</p>
              <p className="staff-queue-board__remaining">{model.serving.remainingLabel}</p>
            </>
          ) : (
            <p className="staff-queue-board__empty">No patient currently being served.</p>
          )}
        </section>

        <section className="staff-queue-board__waiting" aria-label="Waiting patients and estimates">
          <div className="staff-queue-board__waiting-head">
            <h3>Next Patient</h3>
            <h3>Estimated Waiting Time</h3>
          </div>
          {model.waiting.length ? (
            <ol className="staff-queue-board__waiting-list">
              {model.waiting.map((row) => (
                <li key={row.id} className="staff-queue-board__waiting-row">
                  <strong>{row.queueNumber}</strong>
                  <span>{row.waitLabel}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="staff-queue-board__empty">No patients waiting in queue.</p>
          )}
          <p className="staff-queue-board__note">Waiting times are estimates and may change.</p>
        </section>
      </div>
    </div>
  );
}
