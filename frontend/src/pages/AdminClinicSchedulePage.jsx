import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { AdminModal } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";
import { formatAdminDate, formatAdminTime } from "../adminUtils";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function branchOptionLabel(branch) {
  const tags = [];
  if (branch.isMain) tags.push("Main Branch");
  if (branch.inactive || String(branch.status || "").toLowerCase() === "inactive") tags.push("Inactive");
  return tags.length ? `${branch.name} (${tags.join(" · ")})` : branch.name;
}

function appointmentTimeLabel(appointment) {
  return appointment?.time ? formatAdminTime(appointment.time) : "Date only";
}

function appointmentStatusLabel(status) {
  const value = String(status || "pending").replaceAll("_", " ").trim();
  if (!value) return "Pending";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function ClinicBranchSelector({ branches, branchId, onChange }) {
  if (!branches?.length) return null;
  return (
    <label className="field clinic-calendar-branch">
      <span>Clinic Branch</span>
      <select
        value={branchId}
        onChange={(event) => onChange(event.target.value)}
        aria-label="Clinic Branch"
      >
        {branches.map((branch) => (
          <option key={branch.id} value={String(branch.id)}>
            {branchOptionLabel(branch)}
          </option>
        ))}
      </select>
    </label>
  );
}

function padMonthGrid(days) {
  if (!days.length) return [];
  const first = days[0];
  const mondayIndex = (first.weekday + 6) % 7;
  const leading = Array.from({ length: mondayIndex }, (_, index) => ({ key: `pad-${index}`, empty: true }));
  return [...leading, ...days];
}

function hoursSummary(hours, defaults) {
  if (!hours) return "—";
  if (hours.closed) return "Closed";
  const open = formatAdminTime(hours.open || defaults?.weekdayOpen);
  const close = formatAdminTime(hours.close || defaults?.weekdayClose);
  if (hours.isHoliday) return `${open} – ${close} (Holiday)`;
  return `${open} – ${close}`;
}

function AdminClinicCalendarPanel({ branchId, onBranchChange, onBranchLoaded, onOpenSlots }) {
  const { pushToast, confirm } = useAdminUi();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [searchParams] = useSearchParams();
  const [selectedDate, setSelectedDate] = useState(searchParams.get("date") || "");
  const [dayDetail, setDayDetail] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    mode: "default",
    isHoliday: false,
    openTime: "09:00",
    closeTime: "16:00",
    applyRecurring: false,
  });
  const selectedBranch = data?.branch || dayDetail?.branch || null;
  const branchName = selectedBranch?.name || "this branch";

  const load = useCallback(async () => {
    try {
      const next = await api.getAdminClinicSchedule({
        year,
        month,
        ...(branchId ? { branchId } : {}),
      });
      setData(next);
      onBranchLoaded?.(next.branches || [], next.branch || null);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [branchId, month, onBranchLoaded, year]);

  useEffect(() => {
    setEditorOpen(false);
    const date = searchParams.get("date");
    if (!date) {
      setSelectedDate("");
      setDayDetail(null);
    }
  }, [branchId, searchParams]);

  useEffect(() => {
    load();
  }, [load]);

  const cells = useMemo(() => padMonthGrid(data?.days || []), [data]);
  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
        new Date(year, month - 1, 1)
      ),
    [month, year]
  );

  function shiftMonth(delta) {
    const next = new Date(year, month - 1 + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth() + 1);
    setEditorOpen(false);
    setSelectedDate("");
    setDayDetail(null);
  }

  async function openDate(date) {
    setSelectedDate(date);
    setBusy(true);
    try {
      const detail = await api.getAdminClinicScheduleDay(date, branchId ? { branchId } : {});
      setDayDetail(detail);
      setForm({
        mode: detail.saved?.mode || "default",
        isHoliday: Boolean(detail.saved?.isHoliday || detail.hours?.isHoliday),
        openTime: detail.hours?.open || detail.defaults?.weekdayOpen || "09:00",
        closeTime: detail.hours?.close || detail.defaults?.weekdayClose || "16:00",
        applyRecurring: false,
      });
    } catch (loadError) {
      pushToast(loadError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  const requestedDate = searchParams.get("date") || "";
  useEffect(() => {
    if (!requestedDate) return;
    const [yearPart, monthPart] = requestedDate.split("-").map(Number);
    if (yearPart && monthPart) {
      setYear(yearPart);
      setMonth(monthPart);
    }
    openDate(requestedDate);
    // openDate is recreated each render; date + branch are the inputs that should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedDate, branchId]);

  async function saveDay(event) {
    event.preventDefault();
    if (!selectedDate) return;
    const appointments = dayDetail?.appointments || [];
    if (form.mode === "closed" && appointments.length) {
      const list = appointments
        .map((item) => `${item.patientName} (${appointmentTimeLabel(item)})`)
        .join("; ");
      const ok = await confirm({
        title: "Existing appointments on this date",
        message: `${appointments.length} existing appointment(s) at ${branchName} will not be cancelled: ${list}. Continue marking ${branchName} closed for new bookings?`,
        confirmLabel: "Save closed day",
        tone: "danger",
      });
      if (!ok) return;
    } else {
      const ok = await confirm({
        title: "Save clinic schedule",
        message: form.applyRecurring
          ? `Save hours for ${branchName} on ${formatAdminDate(selectedDate)} and update the matching default weekly hours?`
          : `Save the operating hours for ${branchName} on ${formatAdminDate(selectedDate)} only? This does not change other branches.`,
        confirmLabel: "Save Schedule",
        tone: "primary",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      if (form.applyRecurring && form.mode === "custom") {
        const weekday = new Date(`${selectedDate}T00:00:00`).getDay();
        const payload =
          weekday === 0 || weekday === 6
            ? { weekendOpen: form.openTime, weekendClose: form.closeTime }
            : { weekdayOpen: form.openTime, weekdayClose: form.closeTime };
        if (form.isHoliday) {
          payload.holidayOpen = form.openTime;
          payload.holidayClose = form.closeTime;
        }
        await api.saveAdminClinicScheduleDefaults(payload);
      }
      const response = await api.saveAdminClinicScheduleDay({
        date: selectedDate,
        branchId: branchId || undefined,
        mode: form.mode,
        isHoliday: form.isHoliday,
        openTime: form.openTime,
        closeTime: form.closeTime,
      });
      pushToast(response.existingAppointmentsWarning || response.message || "Schedule saved.");
      setEditorOpen(false);
      const detail = await api.getAdminClinicScheduleDay(selectedDate, branchId ? { branchId } : {});
      setDayDetail(detail);
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading clinic calendar…" />;

  return (
    <>
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Clinic Schedule</span>
            <h2>View Calendar</h2>
            <p>
              Default hours are 9:00 AM–4:00 PM on weekdays and 11:00 AM–4:00 PM on weekends and holidays.
              Click a date to view, add, or edit that day for the selected branch only.
            </p>
            <ClinicBranchSelector
              branches={data.branches || []}
              branchId={branchId || (data.branch ? String(data.branch.id) : "")}
              onChange={onBranchChange}
            />
          </div>
          <div className="admin-row-actions">
            <button className="button button--secondary button--compact" onClick={() => shiftMonth(-1)}>
              <ChevronLeft size={16} /> Previous
            </button>
            <button className="button button--secondary button--compact" onClick={() => shiftMonth(1)}>
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>

        <h3 className="clinic-calendar__month">{monthLabel}</h3>
        <div className="clinic-calendar">
          {WEEKDAYS.map((label) => (
            <div key={label} className="clinic-calendar__weekday">{label}</div>
          ))}
          {cells.map((cell) =>
            cell.empty ? (
              <div key={cell.key} className="clinic-calendar__cell is-empty" />
            ) : (
              <button
                key={cell.date}
                type="button"
                className={`clinic-calendar__cell is-${cell.source} ${cell.hasBookings ? "has-bookings" : ""} ${cell.hasUnavailableSlots ? "has-unavailable" : ""} ${selectedDate === cell.date ? "is-selected" : ""}`}
                onClick={() => openDate(cell.date)}
              >
                <strong>{Number(cell.date.slice(-2))}</strong>
                <span>{cell.compact}</span>
                {cell.isHoliday && cell.source !== "closed" ? <small>Holiday</small> : null}
                {cell.hasUnavailableSlots ? <small>Slots off</small> : null}
                {cell.hasBookings ? (
                  <small>{cell.bookedCount > 1 ? `${cell.bookedCount} booked` : "Booked"}</small>
                ) : null}
              </button>
            )
          )}
        </div>
        <div className="clinic-calendar__legend">
          <span className="is-weekday">Weekday 9–4</span>
          <span className="is-weekend">Weekend 11–4</span>
          <span className="is-holiday">Holiday 11–4</span>
          <span className="is-custom">Modified</span>
          <span className="is-closed">Closed</span>
          <span className="is-unavailable">Unavailable slots</span>
        </div>
      </section>

      {selectedDate && dayDetail ? (
        <section className="admin-panel">
          <div className="admin-panel__heading">
            <div>
              <span className="eyebrow">Selected date</span>
              <h2>{formatAdminDate(selectedDate)}</h2>
              <p>
                {hoursSummary(dayDetail.hours, dayDetail.defaults)}
                {selectedBranch?.name ? ` · ${selectedBranch.name}` : ""}
              </p>
            </div>
            <div className="admin-row-actions">
              <button className="button button--secondary button--compact" type="button" onClick={() => setEditorOpen(true)}>
                {dayDetail.saved ? "Edit Schedule" : "Add Schedule"}
              </button>
              <button
                className="button button--primary button--compact"
                type="button"
                onClick={() => onOpenSlots(selectedDate)}
              >
                Set Slot
              </button>
            </div>
          </div>
          {dayDetail.appointments?.length ? (
            <div className="clinic-calendar-appointments">
              <p className="inline-alert" role="status">
                {dayDetail.appointments.length} appointment{dayDetail.appointments.length === 1 ? "" : "s"} at{" "}
                {branchName}. Closing or changing hours does not cancel them.
              </p>
              <ul>
                {dayDetail.appointments.map((item) => (
                  <li key={item.id}>
                    <strong>{item.patientName}</strong>
                    {" · "}
                    {appointmentTimeLabel(item)}
                    {" · "}
                    {item.service || "Appointment"}
                    {" · "}
                    {appointmentStatusLabel(item.status)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="muted">No existing appointments on this date at {branchName}.</p>
          )}
        </section>
      ) : null}

      {editorOpen && dayDetail ? (
        <AdminModal title="Edit Clinic Schedule" onClose={() => setEditorOpen(false)} wide>
          <form className="admin-form" onSubmit={saveDay}>
            <p><small>Date</small><strong>{formatAdminDate(selectedDate)}</strong></p>
            {selectedBranch?.name ? (
              <p><small>Clinic branch</small><strong>{branchOptionLabel(selectedBranch)}</strong></p>
            ) : null}
            <p>Current hours: {hoursSummary(dayDetail.hours, dayDetail.defaults)}</p>
            <fieldset className="clinic-schedule-modes">
              <legend>Select action</legend>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={form.mode === "default" && !form.isHoliday}
                  onChange={() => setForm({ ...form, mode: "default", isHoliday: false, applyRecurring: false })}
                />
                Regular hours
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={form.mode === "default" && form.isHoliday}
                  onChange={() =>
                    setForm({
                      ...form,
                      mode: "default",
                      isHoliday: true,
                      openTime: dayDetail.defaults.holidayOpen,
                      closeTime: dayDetail.defaults.holidayClose,
                      applyRecurring: false,
                    })
                  }
                />
                Holiday hours (11:00 AM–4:00 PM)
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={form.mode === "custom"}
                  onChange={() => setForm({ ...form, mode: "custom" })}
                />
                Custom hours
              </label>
              <label>
                <input
                  type="radio"
                  name="mode"
                  checked={form.mode === "closed"}
                  onChange={() => setForm({ ...form, mode: "closed", applyRecurring: false })}
                />
                Closed
              </label>
            </fieldset>
            {form.mode === "custom" ? (
              <>
                <div className="schedule-fields">
                  <label>Opening time<input type="time" value={form.openTime} onChange={(event) => setForm({ ...form, openTime: event.target.value })} required /></label>
                  <label>Closing time<input type="time" value={form.closeTime} onChange={(event) => setForm({ ...form, closeTime: event.target.value })} required /></label>
                </div>
                <label className="clinic-schedule-recurring">
                  <input
                    type="checkbox"
                    checked={form.applyRecurring}
                    onChange={(event) => setForm({ ...form, applyRecurring: event.target.checked })}
                  />
                  Also update the default weekly hours for this kind of day
                </label>
              </>
            ) : null}
            {dayDetail.appointments?.length ? (
              <p className="inline-alert" role="status">
                {dayDetail.appointments.length} existing appointment(s) will stay booked if you close or change hours.
              </p>
            ) : null}
            <div className="admin-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setEditorOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={busy}>{busy ? "Saving…" : "Save Schedule"}</button>
            </div>
          </form>
        </AdminModal>
      ) : null}

      {busy && !dayDetail ? <LoadingState inline label="Loading date…" /> : null}
    </>
  );
}

function AdminClinicSlotsPanel({ branchId, onBranchChange, onBranchLoaded }) {
  const { pushToast, confirm } = useAdminUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const todayIso = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(searchParams.get("date") || todayIso);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [slotMinutes, setSlotMinutes] = useState(30);
  const branchName = detail?.branch?.name || "this branch";
  const branchQuery = branchId ? { branchId } : {};

  const load = useCallback(async () => {
    try {
      const next = await api.getAdminClinicScheduleDay(date, branchQuery);
      setDetail(next);
      setSlotMinutes(next.defaults?.slotMinutes || 30);
      onBranchLoaded?.(next.branches || [], next.branch || null);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [branchId, date, onBranchLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  function changeDate(nextDate) {
    setDate(nextDate);
    const next = new URLSearchParams(searchParams);
    next.set("tab", "slots");
    if (nextDate) next.set("date", nextDate);
    else next.delete("date");
    setSearchParams(next, { replace: true });
  }

  function toggleSlot(slot) {
    if (slot.status === "booked") return;
    setDetail((current) => ({
      ...current,
      slots: current.slots.map((item) =>
        item.time === slot.time
          ? {
              ...item,
              status: item.status === "unavailable" ? "available" : "unavailable",
              bookable: item.status === "unavailable",
            }
          : item
      ),
    }));
  }

  async function saveSlots(event) {
    event.preventDefault();
    const ok = await confirm({
      title: "Save slots",
      message: `Save available appointment slots for ${branchName} on ${formatAdminDate(date)}? This does not change other branches. Booked appointments will not be changed.`,
      confirmLabel: "Save Slots",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const previousUnavailable = new Set(
        (detail?.slots || []).filter((slot) => slot.status === "unavailable").map((slot) => slot.time)
      );
      if (Number(detail?.defaults?.slotMinutes) !== Number(slotMinutes)) {
        await api.saveAdminClinicScheduleDefaults({ slotMinutes: Number(slotMinutes) });
        const refreshed = await api.getAdminClinicScheduleDay(date, branchQuery);
        refreshed.slots = (refreshed.slots || []).map((slot) =>
          previousUnavailable.has(slot.time) && slot.status !== "booked"
            ? { ...slot, status: "unavailable", bookable: false }
            : slot
        );
        setDetail(refreshed);
        const response = await api.saveAdminClinicScheduleSlots({
          date,
          branchId: branchId || undefined,
          slots: refreshed.slots.map((slot) => ({
            time: slot.time,
            status: slot.status === "unavailable" ? "unavailable" : "available",
          })),
        });
        setDetail((current) => ({ ...current, hours: response.hours, slots: response.slots, defaults: refreshed.defaults }));
        pushToast(response.message || "Slots saved.");
        return;
      }
      const response = await api.saveAdminClinicScheduleSlots({
        date,
        branchId: branchId || undefined,
        slots: (detail?.slots || []).map((slot) => ({
          time: slot.time,
          status: slot.status === "unavailable" ? "unavailable" : "available",
        })),
      });
      setDetail((current) => ({ ...current, hours: response.hours, slots: response.slots }));
      pushToast(response.message || "Slots saved.");
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (error && !detail) return <ErrorState message={error} onRetry={load} />;
  if (!detail) return <LoadingState label="Loading appointment slots…" />;

  const counts = (detail.slots || []).reduce(
    (summary, slot) => {
      summary[slot.status] = (summary[slot.status] || 0) + 1;
      return summary;
    },
    { available: 0, booked: 0, unavailable: 0 }
  );

  return (
    <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Clinic Schedule</span>
            <h2>Set Slot</h2>
            <p>Configure bookable times for the selected branch within this date’s operating hours. Booked appointments stay in place.</p>
            <ClinicBranchSelector
              branches={detail.branches || []}
              branchId={branchId || (detail.branch ? String(detail.branch.id) : "")}
              onChange={onBranchChange}
            />
          </div>
        </div>
        <form className="admin-form" onSubmit={saveSlots}>
          <label>
            Select date
            <input type="date" value={date} onChange={(event) => changeDate(event.target.value)} required />
          </label>
          <p>
            <small>Clinic hours · {branchName}</small>
            <strong>{hoursSummary(detail.hours, detail.defaults)}</strong>
          </p>
          <label>
            Slot duration (minutes)
            <input
              type="number"
              min="5"
              max="240"
              step="5"
              value={slotMinutes}
              onChange={(event) => setSlotMinutes(event.target.value)}
            />
          </label>
          {detail.hours.closed ? (
            <EmptyState title="Clinic is closed" detail="Open this date in View Calendar before setting slots." />
          ) : (
            <>
              <p className="muted">
                Available {counts.available} · Booked {counts.booked} · Unavailable {counts.unavailable}
              </p>
              <div className="clinic-slot-grid">
                {(detail.slots || []).map((slot) => (
                  <button
                    type="button"
                    key={slot.time}
                    className={`clinic-slot clinic-slot--${slot.status}`}
                    disabled={slot.status === "booked"}
                    onClick={() => toggleSlot(slot)}
                  >
                    {formatAdminTime(slot.time)}
                    <small>{slot.status}</small>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="clinic-calendar__legend">
            <span className="is-weekday">Available</span>
            <span className="is-custom">Unavailable</span>
            <span className="is-closed">Booked</span>
          </div>
          <div className="admin-modal__actions">
            <button className="button button--primary" disabled={busy || detail.hours.closed}>
              {busy ? "Saving…" : "Save Slots"}
            </button>
          </div>
        </form>
      </section>
    );
}

const SCHEDULE_TABS = [
  { id: "calendar", label: "View Calendar" },
  { id: "slots", label: "Set Slot" },
];

export function AdminClinicSchedulePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get("tab") === "slots" ? "slots" : "calendar";
  const branchId = searchParams.get("branchId") || "";

  function writeParams(mutate) {
    const next = new URLSearchParams(searchParams);
    mutate(next);
    setSearchParams(next, { replace: true });
  }

  function changeBranch(nextId) {
    writeParams((next) => {
      if (nextId) next.set("branchId", String(nextId));
      else next.delete("branchId");
    });
  }

  const handleBranchLoaded = useCallback(
    (_branches, branch) => {
      if (!searchParams.get("branchId") && branch?.id) {
        const next = new URLSearchParams(searchParams);
        next.set("branchId", String(branch.id));
        setSearchParams(next, { replace: true });
      }
    },
    [searchParams, setSearchParams]
  );

  function selectTab(nextTab, extra = {}) {
    writeParams((next) => {
      if (nextTab === "slots") next.set("tab", "slots");
      else next.delete("tab");
      if (extra.date) next.set("date", extra.date);
      if (nextTab === "calendar") next.delete("date");
    });
  }

  const branchProps = {
    branchId,
    onBranchChange: changeBranch,
    onBranchLoaded: handleBranchLoaded,
  };

  return (
    <div className="admin-page">
      <div className="admin-tabs" role="tablist" aria-label="Clinic schedule sections">
        {SCHEDULE_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={`admin-tab ${tab === item.id ? "is-active" : ""}`}
            onClick={() => selectTab(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {tab === "slots" ? (
        <AdminClinicSlotsPanel {...branchProps} />
      ) : (
        <AdminClinicCalendarPanel {...branchProps} onOpenSlots={(date) => selectTab("slots", { date })} />
      )}
    </div>
  );
}

export function AdminClinicSlotsRedirect() {
  const [params] = useSearchParams();
  const next = new URLSearchParams({ tab: "slots" });
  const date = params.get("date");
  const branchId = params.get("branchId");
  if (date) next.set("date", date);
  if (branchId) next.set("branchId", branchId);
  return <Navigate to={`/admin/schedule?${next}`} replace />;
}
