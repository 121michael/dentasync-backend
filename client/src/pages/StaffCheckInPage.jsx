import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/UI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime, formatStaffTime } from "../staffUtils";

function clinicTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function checkInToVerified(entry) {
  if (!entry) return null;
  return {
    verified: true,
    method: "rfid",
    message: "Patient checked in successfully.",
    patient: {
      id: entry.patientId,
      fullName: entry.patientName,
    },
    appointment: {
      id: entry.appointment?.id,
      service: entry.appointment?.treatment,
      dentist: entry.appointment?.dentist,
      date: entry.appointment?.date,
      time: entry.appointment?.time,
    },
    queue: {
      id: entry.id,
      token: entry.token,
      queueNumber: entry.token || entry.queueNumber,
      status: entry.status,
      waitMinutes: entry.waitMinutes,
      checkedInAt: entry.timestamp,
    },
  };
}

function eventToVerified(event) {
  if (!event || event.status !== "success") return null;
  return {
    verified: true,
    method: "rfid",
    message: event.message || "Patient checked in successfully.",
    patient: event.patient,
    appointment: event.appointment,
    queue: event.queue,
  };
}

export function StaffCheckInPage() {
  const { pushToast } = useStaffUi();
  const rfidInputRef = useRef(null);
  const seenCheckInIdsRef = useRef(new Set());
  const bootstrappedLogRef = useRef(false);
  const lastEventIdRef = useRef(0);
  const [rfidCode, setRfidCode] = useState("");
  const [verified, setVerified] = useState(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadRecentCheckIns = useCallback(async () => {
    try {
      const response = await api.getStaffCheckIns({
        silent: true,
        query: { range: "today", date: clinicTodayYmd() },
      });
      const rows = response.checkIns || [];
      setReady(true);

      if (!bootstrappedLogRef.current) {
        rows.forEach((row) => seenCheckInIdsRef.current.add(String(row.id)));
        bootstrappedLogRef.current = true;
        return;
      }

      const fresh = rows.find((row) => !seenCheckInIdsRef.current.has(String(row.id)));
      if (fresh) {
        rows.forEach((row) => seenCheckInIdsRef.current.add(String(row.id)));
        setVerified(checkInToVerified(fresh));
        setError("");
        pushToast(`${fresh.patientName} checked in · Queue ${fresh.token || fresh.queueNumber}`);
      }
    } catch (loadError) {
      setError(loadError.message);
      setReady(true);
    }
  }, [pushToast]);

  const pollRfidEvents = useCallback(async () => {
    try {
      const response = await api.getStaffRfidEvents(lastEventIdRef.current);
      const events = response.events || [];
      if (!events.length) return;

      const newest = events[0];
      lastEventIdRef.current = Math.max(lastEventIdRef.current, ...events.map((event) => Number(event.id) || 0));

      if (newest.status === "success") {
        setVerified(eventToVerified(newest));
        setError("");
        pushToast(newest.message || "Patient checked in from RFID tap.");
        await loadRecentCheckIns();
        return;
      }

      setError(newest.message || "RFID tap failed.");
      pushToast(newest.message || "RFID tap failed.", "error");
    } catch {
      // Keep listening even if the live feed briefly fails.
    }
  }, [loadRecentCheckIns, pushToast]);

  useEffect(() => {
    loadRecentCheckIns();
    const logTimer = window.setInterval(loadRecentCheckIns, 4000);
    const eventTimer = window.setInterval(pollRfidEvents, 1500);
    pollRfidEvents();
    return () => {
      window.clearInterval(logTimer);
      window.clearInterval(eventTimer);
    };
  }, [loadRecentCheckIns, pollRfidEvents]);

  useEffect(() => {
    window.setTimeout(() => rfidInputRef.current?.focus(), 50);
  }, [verified]);

  useEffect(() => {
    const tag = String(rfidCode || "").trim();
    if (busy) return undefined;
    if (!/^[A-Fa-f0-9]{6,20}$/.test(tag)) return undefined;
    const timer = window.setTimeout(() => {
      runRfidCheckIn(tag);
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rfidCode, busy]);

  async function runRfidCheckIn(rawTag) {
    const tag = String(rawTag || "").trim();
    if (!tag) return;
    setBusy(true);
    setError("");
    try {
      const response = await api.staffCheckIn({ method: "rfid", rfidTag: tag });
      setVerified({ ...response, method: "rfid" });
      pushToast(response.message || "Patient checked in successfully.");
      setRfidCode("");
      await loadRecentCheckIns();
    } catch (checkInError) {
      const detail = checkInError?.data?.detail || checkInError?.data?.diagnosis?.hint;
      const message = detail
        ? `${checkInError.message}${checkInError.message.includes(detail) ? "" : ` (${detail})`}`
        : checkInError.message;
      setError(message);
      pushToast(message, "error");
      setRfidCode("");
    } finally {
      setBusy(false);
      window.setTimeout(() => rfidInputRef.current?.focus(), 1600);
    }
  }

  if (error && !ready) return <ErrorState message={error} onRetry={loadRecentCheckIns} />;
  if (!ready) return <LoadingState label="Loading check-in center…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Walk-in arrival</span>
            <h2>Patient Check-In</h2>
          </div>
        </div>

        <input
          ref={rfidInputRef}
          className="sr-only"
          value={rfidCode}
          onChange={(event) => setRfidCode(event.target.value)}
          autoComplete="off"
          autoFocus
          aria-label="Hidden RFID capture"
        />

        <VerifiedPanel verified={verified} />
      </section>
    </div>
  );
}

function VerifiedPanel({ verified }) {
  if (!verified?.verified) {
    return (
      <article className="staff-verified-card staff-verified-card--idle">
        <h3>Awaiting check-in</h3>
        <p>When a patient is checked in, their appointment and queue number appear here.</p>
      </article>
    );
  }

  return (
    <article className="staff-verified-card">
      <span className="eyebrow">Check-In Successful</span>
      <h3>{verified.patient?.fullName}</h3>
      <div className="staff-detail-grid">
        <p>
          <small>Queue Number</small>
          <strong>{verified.queue?.queueNumber || verified.queue?.token}</strong>
        </p>
        <p>
          <small>Appointment</small>
          <strong>
            {formatStaffTime(String(verified.appointment?.time || "").slice(0, 5))} ·{" "}
            {verified.appointment?.service}
          </strong>
        </p>
        <p>
          <small>Dentist</small>
          <strong>{verified.appointment?.dentist || "—"}</strong>
        </p>
        <p>
          <small>Check-In Time</small>
          <strong>{formatStaffDateTime(verified.queue?.checkedInAt)}</strong>
        </p>
        <p>
          <small>Status</small>
          <strong>{verified.message}</strong>
        </p>
      </div>
    </article>
  );
}
