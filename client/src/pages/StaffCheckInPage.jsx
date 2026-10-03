import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDateTime, formatStaffLogDate, formatStaffLogTime, formatStaffTime } from "../staffUtils";

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

function clinicTodayYmd() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
}

function defaultLogFilter() {
  const today = clinicTodayYmd();
  return {
    range: "today",
    date: today,
    month: Number(today.slice(5, 7)),
    year: Number(today.slice(0, 4)),
  };
}

function yearOptions(selectedYear) {
  const current = Number(clinicTodayYmd().slice(0, 4));
  const years = new Set([current, current - 1, current - 2, current - 3, selectedYear]);
  return [...years].filter((year) => Number.isInteger(year) && year >= 2000).sort((a, b) => b - a);
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
  const [checkIns, setCheckIns] = useState(null);
  const [logMeta, setLogMeta] = useState({
    label: "Today's Check-In Log",
    subtitle: "",
    emptyDetail: "RFID taps and QR walk-ins will appear here.",
    range: "today",
  });
  const [logFilter, setLogFilter] = useState(defaultLogFilter);
  const [filterTab, setFilterTab] = useState("today");
  const [draftFilter, setDraftFilter] = useState(defaultLogFilter);
  const [viewing, setViewing] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const loadLog = useCallback(async (options = {}) => {
    const query = options.query || logFilter;
    try {
      const response = await api.getStaffCheckIns({ silent: true, ...options, query });
      const rows = response.checkIns || [];
      setCheckIns(rows);
      setLogMeta({
        label: response.label || "Check-In Log",
        subtitle: response.subtitle || "",
        emptyDetail: response.emptyDetail || "No check-in records found.",
        range: response.range || query.range || "today",
      });

      const viewingToday = (response.range || query.range || "today") === "today";
      if (!bootstrappedLogRef.current) {
        rows.forEach((row) => seenCheckInIdsRef.current.add(String(row.id)));
        bootstrappedLogRef.current = true;
        return;
      }

      rows.forEach((row) => {
        if (!viewingToday) seenCheckInIdsRef.current.add(String(row.id));
      });

      if (!viewingToday) return;

      const fresh = rows.find((row) => !seenCheckInIdsRef.current.has(String(row.id)));
      if (fresh) {
        rows.forEach((row) => seenCheckInIdsRef.current.add(String(row.id)));
        setVerified(checkInToVerified(fresh));
        setError("");
        pushToast(`${fresh.patientName} checked in · Queue ${fresh.token || fresh.queueNumber}`);
      }
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [logFilter, pushToast]);


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
        const today = defaultLogFilter();
        setFilterTab("today");
        setDraftFilter(today);
        setLogFilter(today);
        await loadLog({ query: today });
        return;
      }

      setError(newest.message || "RFID tap failed.");
      pushToast(newest.message || "RFID tap failed.", "error");
    } catch {
      // Keep listening even if the live feed briefly fails.
    }
  }, [loadLog, pushToast]);

  useEffect(() => {
    loadLog();
    const logTimer = window.setInterval(loadLog, 4000);
    const eventTimer = window.setInterval(pollRfidEvents, 1500);
    pollRfidEvents();
    return () => {
      window.clearInterval(logTimer);
      window.clearInterval(eventTimer);
    };
  }, [loadLog, pollRfidEvents]);

  useEffect(() => {
    window.setTimeout(() => rfidInputRef.current?.focus(), 50);
  }, [verified]);

  // Hidden capture for USB keyboard-wedge readers only (not for typing by staff).
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
      const today = defaultLogFilter();
      setFilterTab("today");
      setDraftFilter(today);
      setLogFilter(today);
      await loadLog({ query: today });
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

  function selectFilterTab(range) {
    if (range === "today") {
      const today = defaultLogFilter();
      setFilterTab("today");
      setDraftFilter(today);
      setLogFilter(today);
      return;
    }
    setFilterTab(range);
    setDraftFilter((current) => ({ ...current, range }));
  }

  function applyDraftFilter() {
    setLogFilter({ ...draftFilter, range: filterTab });
  }

  function clearLogFilter() {
    const today = defaultLogFilter();
    setFilterTab("today");
    setDraftFilter(today);
    setLogFilter(today);
  }

  const years = useMemo(() => yearOptions(draftFilter.year), [draftFilter.year]);

  if (error && !checkIns) return <ErrorState message={error} onRetry={loadLog} />;
  if (!checkIns) return <LoadingState label="Loading check-in center…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Walk-in arrival</span>
            <h2>Patient Check-In</h2>
          </div>
          <button className="button button--secondary" onClick={loadLog}>
            <RefreshCw size={16} /> Refresh Log
          </button>
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

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading staff-log-heading">
          <div>
            <span className="eyebrow">{logFilter.range === "today" ? "Today" : "History"}</span>
            <h2>Check-In Log</h2>
          </div>
          <div className="admin-tabs staff-log-tabs" role="tablist" aria-label="Check-in log range">
            <button
              type="button"
              className={`admin-tab ${filterTab === "today" ? "is-active" : ""}`}
              onClick={() => selectFilterTab("today")}
            >
              Today
            </button>
            <button
              type="button"
              className={`admin-tab ${filterTab === "date" ? "is-active" : ""}`}
              onClick={() => selectFilterTab("date")}
            >
              Date
            </button>
            <button
              type="button"
              className={`admin-tab ${filterTab === "month" ? "is-active" : ""}`}
              onClick={() => selectFilterTab("month")}
            >
              Month
            </button>
            <button
              type="button"
              className={`admin-tab ${filterTab === "year" ? "is-active" : ""}`}
              onClick={() => selectFilterTab("year")}
            >
              Year
            </button>
          </div>
        </div>

        {filterTab !== "today" ? (
          <div className="staff-log-filters">
            <div className="staff-log-filter-fields">
              {filterTab === "date" ? (
                <label className="field">
                  <span>Filter by Date</span>
                  <input
                    type="date"
                    value={draftFilter.date}
                    onChange={(event) =>
                      setDraftFilter((current) => ({ ...current, range: "date", date: event.target.value }))
                    }
                  />
                </label>
              ) : null}
              {filterTab === "month" ? (
                <>
                  <label className="field">
                    <span>Month</span>
                    <select
                      value={draftFilter.month}
                      onChange={(event) =>
                        setDraftFilter((current) => ({
                          ...current,
                          range: "month",
                          month: Number(event.target.value),
                        }))
                      }
                    >
                      {MONTHS.map((month) => (
                        <option key={month.value} value={month.value}>
                          {month.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Year</span>
                    <select
                      value={draftFilter.year}
                      onChange={(event) =>
                        setDraftFilter((current) => ({
                          ...current,
                          range: "month",
                          year: Number(event.target.value),
                        }))
                      }
                    >
                      {years.map((year) => (
                        <option key={year} value={year}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </label>
                </>
              ) : null}
              {filterTab === "year" ? (
                <label className="field">
                  <span>Year</span>
                  <select
                    value={draftFilter.year}
                    onChange={(event) =>
                      setDraftFilter((current) => ({
                        ...current,
                        range: "year",
                        year: Number(event.target.value),
                      }))
                    }
                  >
                    {years.map((year) => (
                      <option key={year} value={year}>
                        {year}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <div className="staff-log-filter-actions">
                <button type="button" className="button button--primary button--compact" onClick={applyDraftFilter} disabled={busy}>
                  Apply Filter
                </button>
                <button type="button" className="button button--secondary button--compact" onClick={clearLogFilter} disabled={busy}>
                  Clear
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {checkIns.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Queue No.</th>
                  <th>Patient</th>
                  <th>Patient ID</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {checkIns.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatStaffLogDate(entry.timestamp)}</td>
                    <td>{formatStaffLogTime(entry.timestamp)}</td>
                    <td>
                      <code>{entry.token || entry.queueNumber}</code>
                    </td>
                    <td>
                      <strong>{entry.patientName}</strong>
                    </td>
                    <td>
                      <code>{entry.clinicPatientId || entry.patientId || "—"}</code>
                    </td>
                    <td>
                      <StaffStatusBadge status={entry.status} />
                    </td>
                    <td>
                      <button type="button" className="button button--secondary button--compact" onClick={() => setViewing(entry)}>
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No check-in records found." detail={logMeta.emptyDetail} />
        )}
      </section>

      {viewing ? (
        <StaffModal title="Check-In Details" onClose={() => setViewing(null)}>
          <div className="staff-detail-grid">
            <p>
              <small>Patient</small>
              <strong>{viewing.patientName}</strong>
            </p>
            <p>
              <small>Patient ID</small>
              <strong>{viewing.clinicPatientId || viewing.patientId || "—"}</strong>
            </p>
            <p>
              <small>Queue Number</small>
              <strong>{viewing.token || viewing.queueNumber || "—"}</strong>
            </p>
            <p>
              <small>Check-In Date</small>
              <strong>{formatStaffLogDate(viewing.timestamp)}</strong>
            </p>
            <p>
              <small>Check-In Time</small>
              <strong>{formatStaffLogTime(viewing.timestamp)}</strong>
            </p>
            <p>
              <small>Status</small>
              <strong>
                <StaffStatusBadge status={viewing.status} />
              </strong>
            </p>
            <p>
              <small>Check-In ID</small>
              <strong>{viewing.checkInId || "—"}</strong>
            </p>
            <p>
              <small>Appointment</small>
              <strong>{viewing.appointment?.treatment || "Dental visit"}</strong>
            </p>
            <p>
              <small>Dentist</small>
              <strong>{viewing.appointment?.dentist || "—"}</strong>
            </p>
            <p>
              <small>Completion time</small>
              <strong>{viewing.completedAt ? formatStaffDateTime(viewing.completedAt) : "—"}</strong>
            </p>
          </div>
          <div className="staff-heading-actions" style={{ marginTop: "1rem" }}>
            <button type="button" className="button button--secondary" onClick={() => setViewing(null)}>
              Close
            </button>
          </div>
        </StaffModal>
      ) : null}
    </div>
  );
}

function VerifiedPanel({ verified, emptyHint }) {
  if (!verified?.verified) {
    return (
      <article className="staff-verified-card staff-verified-card--idle">
        <h3>Awaiting card tap</h3>
        <p>
          {emptyHint ||
            "When the patient taps the ESP32 reader, their appointment and queue number appear here. No typing."}
        </p>
      </article>
    );
  }

  return (
    <article className="staff-verified-card">
      <span className="eyebrow">Check-In Successful</span>
      <h3>{verified.patient?.fullName}</h3>
      <div className="staff-detail-grid">
        <p>
          <small>Method</small>
          <strong>{String(verified.method || "rfid").toUpperCase()}</strong>
        </p>
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
