import { useEffect, useRef, useState } from "react";
import { CalendarDays, Clock3, X } from "lucide-react";
import { api } from "../api";
import { clinicTodayYmd } from "../utils/appointmentStatus";

const PERIOD_ORDER = ["Morning", "Afternoon", "Evening"];

function displayTime(value) {
  const text = String(value || "").trim();
  const [hours, minutes] = text.split(":");
  if (!/^\d{1,2}$/.test(hours || "") || !/^\d{2}$/.test(minutes || "")) return text;
  const date = new Date();
  date.setHours(Number(hours), Number(minutes), 0, 0);
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(date);
}

export function RescheduleAppointmentModal({ appointment, busy, error, onClose, onConfirm }) {
  const [date, setDate] = useState(clinicTodayYmd());
  const [time, setTime] = useState("");
  const [period, setPeriod] = useState("Morning");
  const [availability, setAvailability] = useState(null);
  const [loadError, setLoadError] = useState("");
  const confirmLock = useRef(false);
  const selectedTime = time;

  useEffect(() => {
    let cancelled = false;
    setLoadError("");
    setTime("");
    api
      .getAppointmentAvailability(date)
      .then((response) => {
        if (cancelled) return;
        setAvailability(response);
        const first = (response.slots || []).find((slot) => slot.bookable);
        if (first?.period) setPeriod(first.period);
      })
      .catch((requestError) => {
        if (!cancelled) setLoadError(requestError.message);
      });
    return () => {
      cancelled = true;
    };
  }, [date]);

  useEffect(() => {
    if (!error) return undefined;
    let cancelled = false;
    api
      .getAppointmentAvailability(date)
      .then((response) => {
        if (cancelled) return;
        setAvailability(response);
        const stillBookable = (response.slots || []).some(
          (slot) => slot.bookable && slot.time === selectedTime
        );
        if (!stillBookable) setTime("");
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [error, date, selectedTime]);

  if (!appointment) return null;
  const slots = (availability?.slots || []).filter((slot) => slot.bookable && slot.period === period);

  return (
    <div className="staff-modal-backdrop reschedule-modal-backdrop" role="presentation">
      <section className="staff-modal reschedule-modal" role="dialog" aria-modal="true" aria-labelledby="reschedule-title">
        <header className="staff-modal__header">
          <div>
            <span className="eyebrow">New visit time</span>
            <h2 id="reschedule-title">Reschedule Appointment</h2>
          </div>
          <button type="button" className="booking-summary__close" aria-label="Close" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </header>
        <p className="muted-copy">
          Service: <strong>{appointment.treatment || appointment.service}</strong>
        </p>
        <label className="field">
          <span>New date</span>
          <input
            type="date"
            min={clinicTodayYmd()}
            value={date}
            disabled={busy}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        {availability?.closed ? (
          <p className="inline-alert" role="status">
            The clinic is closed on that date. Choose another day.
          </p>
        ) : null}
        <div className="time-filter-row">
          {PERIOD_ORDER.filter((item) =>
            (availability?.slots || []).some((slot) => slot.bookable && slot.period === item)
          ).map((item) => (
            <button
              type="button"
              key={item}
              className={`filter-pill ${period === item ? "is-active" : ""}`}
              onClick={() => setPeriod(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <div className="time-slots">
          {slots.map((slot) => (
            <button
              type="button"
              key={slot.time}
              data-slot-time={slot.time}
              className={`time-slot ${time === slot.time ? "is-selected" : ""}`}
              onClick={() => setTime(slot.time)}
            >
              <Clock3 size={15} /> {displayTime(slot.time)}
            </button>
          ))}
        </div>
        {availability && !availability.closed && !slots.length ? (
          <p className="muted">No appointment slots are available in this period.</p>
        ) : null}
        {loadError || error ? (
          <p className="inline-alert inline-alert--error" role="alert">
            {loadError || error}
          </p>
        ) : null}
        <div className="staff-modal__actions">
          <button type="button" className="button button--secondary" onClick={onClose} disabled={busy}>
            Back
          </button>
          <button
            type="button"
            className="button button--primary"
            disabled={busy || !time}
            onClick={() => {
              if (busy || confirmLock.current || !time) return;
              confirmLock.current = true;
              Promise.resolve(onConfirm({ appointmentDate: date, appointmentTime: time })).finally(() => {
                confirmLock.current = false;
              });
            }}
          >
            <CalendarDays size={16} /> {busy ? "Saving…" : "Confirm Reschedule"}
          </button>
        </div>
      </section>
    </div>
  );
}
