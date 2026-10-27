import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileUp,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { useAuth } from "../useAuth";
import { matchesNotificationFocus } from "../notificationFocus";
import { getApprovedClinicPrice } from "../clinic/approvedClinicPrices";
import { attachServiceVisual } from "../clinic/serviceVisuals";

const PERIOD_ORDER = ["Morning", "Afternoon", "Evening"];

const APPROVED_HMO_PROVIDERS = [
  { id: "maxicare", name: "Maxicare", filipinoDoctors: false },
  { id: "icare", name: "iCare", filipinoDoctors: true },
  { id: "pacific-cross", name: "Pacific Cross", filipinoDoctors: true },
  { id: "etiqa", name: "Etiqa", filipinoDoctors: true },
  { id: "lacson", name: "Lacson & Lacson", filipinoDoctors: true },
  { id: "hppi", name: "HPPI", filipinoDoctors: true },
  { id: "flexicare", name: "Flexicare", filipinoDoctors: true },
  { id: "cocolife", name: "Cocolife", filipinoDoctors: false },
  { id: "valucare", name: "ValuCare", filipinoDoctors: false },
];

const LEGACY_SERVICE_NAMES = {
  "Dental Cleaning": "Dental Cleaning / Oral Prophylaxis",
  "Dental Filling": "Permanent Filling / Restoration",
  "Root Canal": "Root Canal Treatment",
  "General Consultation": "Oral Examination / Consultation",
  "Orthodontic Consultation": "Orthodontics / Braces",
};

function tomorrow() {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function displayDate(value) {
  if (!value) return "Date to be confirmed";

  const rawValue = value instanceof Date ? value : String(value).trim();
  const date =
    rawValue instanceof Date
      ? rawValue
      : /^\d{4}-\d{2}-\d{2}$/.test(rawValue)
        ? new Date(`${rawValue}T00:00:00`)
        : new Date(rawValue);

  if (Number.isNaN(date.getTime())) {
    return "Date to be confirmed";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function displayTime(value) {
  if (value == null) return "Time to be confirmed";
  const text = String(value).trim();
  const [hours, minutes] = text.split(":");
  if (
    !/^\d{1,2}$/.test(hours || "") ||
    !/^\d{2}$/.test(minutes || "") ||
    Number(hours) > 23 ||
    Number(minutes) > 59
  ) {
    return "Time to be confirmed";
  }

  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2026, 0, 1, Number(hours), Number(minutes)));
}

function displayServiceName(appointment) {
  const raw = appointment?.treatment || appointment?.service || "";
  return LEGACY_SERVICE_NAMES[raw] || raw || "Service not recorded";
}

function servicePhotoUrl(service) {
  return service?.imageUrl || service?.image || service?.photoUrl || "";
}

function ServicePriceDetails({ price, open, panelRef, selectedOptionId, onSelectOption }) {
  const [more, setMore] = useState(false);

  useEffect(() => {
    if (!open) setMore(false);
  }, [open]);

  if (!price) return null;

  const extraNotes = price.extraNotes || [];
  const options = price.options || [];
  const hasMore = Boolean(price.lines?.length || extraNotes.length);

  return (
    <div
      ref={panelRef}
      className="treatment-option__details"
      aria-hidden={!open}
      inert={open ? undefined : true}
    >
      <div className="treatment-option__details-inner">
        <aside className="treatment-price-panel" aria-live={open ? "polite" : "off"}>
          <h3>{price.title}</h3>
          {price.description ? (
            <p className="treatment-price-panel__description">{price.description}</p>
          ) : null}
          <p className="treatment-price-panel__price">{price.priceLabel}</p>
          {price.compactNote ? (
            <p className="treatment-price-panel__note">{price.compactNote}</p>
          ) : null}
          {options.length ? (
            <div className="treatment-price-panel__options" role="radiogroup" aria-label="Braces option">
              {options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={selectedOptionId === option.id}
                  className={`treatment-price-panel__option ${selectedOptionId === option.id ? "is-selected" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onSelectOption?.(option.id);
                  }}
                >
                  <strong>{option.title}</strong>
                  {option.description ? <p>{option.description}</p> : null}
                  <span>{option.priceLabel}</span>
                  {option.lines?.map((line) => (
                    <small key={line.label}>
                      {line.label}: {line.value}
                    </small>
                  ))}
                </button>
              ))}
            </div>
          ) : null}
          {hasMore ? (
            <>
              <button
                type="button"
                className="treatment-price-panel__more"
                aria-expanded={more}
                onClick={(event) => {
                  event.stopPropagation();
                  setMore((current) => !current);
                }}
              >
                {more ? "Less details" : "More details"}
                <ChevronDown size={14} aria-hidden="true" />
              </button>
              <div className={`treatment-price-panel__extra ${more ? "is-open" : ""}`}>
                <div className="treatment-price-panel__extra-inner">
                  {price.lines?.length ? (
                    <dl className="treatment-price-panel__lines">
                      {price.lines.map((line) => (
                        <div key={line.label}>
                          <dt>{line.label}</dt>
                          <dd>{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                  ) : null}
                  {extraNotes.map((note) => (
                    <p key={note} className="treatment-price-panel__note">
                      {note}
                    </p>
                  ))}
                </div>
              </div>
            </>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function TreatmentServiceOption({ service, selected, onSelect, selectedOptionId, onSelectOption }) {
  const wrapRef = useRef(null);
  const panelRef = useRef(null);
  const visual = attachServiceVisual(service);
  const photoUrl = servicePhotoUrl(visual);
  const price = getApprovedClinicPrice(visual);

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const panel = panelRef.current;
    const grid = wrap?.closest(".treatment-grid");
    if (!selected) {
      grid?.style.removeProperty("--open-pad");
      return undefined;
    }
    if (!wrap || !panel) return undefined;

    const place = () => {
      const wrapBox = wrap.getBoundingClientRect();
      const gridBox = grid?.getBoundingClientRect();
      const mobile = window.matchMedia("(max-width: 980px)").matches;
      const navClearance = mobile ? 112 : 28;
      const viewPad = 12;
      const spaceBelow = Math.max(140, window.innerHeight - wrapBox.bottom - navClearance);
      const gridRight = gridBox ? gridBox.right - 6 : window.innerWidth - viewPad;
      const gridLeft = gridBox ? gridBox.left + 6 : viewPad;
      const maxWidth = Math.max(wrapBox.width, Math.min(gridRight, window.innerWidth - viewPad) - wrapBox.left);
      const preferred = Math.min(328, Math.max(wrapBox.width, Math.min(268, maxWidth)));
      let width = Math.min(preferred, maxWidth, window.innerWidth - viewPad * 2);
      let left = 0;
      const overflowRight = wrapBox.left + left + width - Math.min(gridRight, window.innerWidth - viewPad);
      if (overflowRight > 0) left -= overflowRight;
      const overflowLeft = Math.max(gridLeft, viewPad) - (wrapBox.left + left);
      if (overflowLeft > 0) left += overflowLeft;

      panel.style.setProperty("--float-left", `${Math.round(left)}px`);
      panel.style.setProperty("--float-width", `${Math.round(width)}px`);
      panel.style.setProperty("--float-max-height", `${Math.round(spaceBelow)}px`);

      const panelBox = panel.getBoundingClientRect();
      const cardBottoms = grid
        ? [...grid.querySelectorAll(".treatment-option")].map((card) => card.getBoundingClientRect().bottom)
        : [];
      const gridContentBottom = cardBottoms.length ? Math.max(...cardBottoms) : wrapBox.bottom;
      const overflowBottom = panelBox.bottom - gridContentBottom + 8;
      grid?.style.setProperty("--open-pad", `${Math.max(0, Math.ceil(overflowBottom))}px`);
    };

    place();
    const observer = new ResizeObserver(place);
    observer.observe(panel);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      if (grid?.querySelector(".treatment-option-wrap.is-open") === wrap) {
        grid.style.removeProperty("--open-pad");
      }
    };
  }, [selected, service.id, selectedOptionId]);

  return (
    <div
      ref={wrapRef}
      className={`treatment-option-wrap ${selected ? "is-open" : ""}`}
    >
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-expanded={selected}
        aria-label={selected ? `${service.name}, ${price.priceLabel}` : service.name}
        className={`treatment-option ${selected ? "is-selected" : ""}`}
        onClick={onSelect}
      >
        <span className="treatment-option__media" aria-hidden="true">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              className={`treatment-option__photo${visual.imageFit === "contain" ? " is-contain" : ""}`}
            />
          ) : (
            <span className="treatment-option__placeholder" />
          )}
        </span>
        {selected ? (
          <span className="treatment-option__check">
            <Check size={12} aria-hidden="true" />
          </span>
        ) : null}
        <strong>{service.name}</strong>
      </button>
      <ServicePriceDetails
        price={price}
        open={selected}
        panelRef={panelRef}
        selectedOptionId={selectedOptionId}
        onSelectOption={onSelectOption}
      />
    </div>
  );
}

function displayStatus(status) {
  return String(status || "pending").replaceAll("_", " ");
}

export function AppointmentsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { actingAs, user } = useAuth();
  const isBooking = location.pathname.endsWith("/book");

  const [catalog, setCatalog] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [dependents, setDependents] = useState([]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [timePeriod, setTimePeriod] = useState("Morning");
  const [availability, setAvailability] = useState(null);
  const [form, setForm] = useState({
    serviceId: "",
    bracesOption: "",
    appointmentDate: tomorrow(),
    appointmentTime: "",
    coverageType: "self_pay",
    hmoProvider: "",
    hmoMemberNumber: "",
    hmoCompanyName: "",
    hmoBirthDate: "",
    notes: "",
    forPatientUserId: "",
  });
  const [authorizationFile, setAuthorizationFile] = useState(null);
  const [visitSummaryOpen, setVisitSummaryOpen] = useState(false);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedCardRef = useRef(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const [catalogResponse, appointmentResponse, dependentsResponse] = await Promise.all([
        api.getCatalog(),
        api.getAppointments(),
        api.getDependents().catch(() => ({ dependents: [] })),
      ]);
      setCatalog(catalogResponse);
      setAppointments(appointmentResponse.appointments || []);
      setDependents(
        (dependentsResponse.dependents || dependentsResponse.items || []).filter(
          (dependent) =>
            String(dependent.approvalStatus || "").toLowerCase() === "approved" &&
            String(dependent.dependentUserId || "").trim()
        )
      );
      setLoaded(true);
    } catch (loadError) {
      setError(loadError.message);
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isBooking || !form.appointmentDate) {
      setAvailability(null);
      return undefined;
    }
    let active = true;
    api
      .getAppointmentAvailability(form.appointmentDate)
      .then((response) => {
        if (!active) return;
        setAvailability(response);
        const bookable = new Set(response.availableTimes || []);
        setForm((current) =>
          current.appointmentTime && bookable.has(current.appointmentTime)
            ? current
            : { ...current, appointmentTime: "" }
        );
        const periods = PERIOD_ORDER.filter((period) =>
          (response.slots || []).some((slot) => slot.bookable && slot.period === period)
        );
        setTimePeriod((current) => (periods.includes(current) ? current : periods[0] || current));
      })
      .catch(() => {
        if (active) setAvailability(null);
      });
    return () => {
      active = false;
    };
  }, [form.appointmentDate, isBooking]);

  useEffect(() => {
    const focus = searchParams.get("focus");
    if (focus) setFocusKey(focus);
  }, [searchParams]);

  useEffect(() => {
    if (!focusKey || !appointments.length) return;
    const match = appointments.find((appointment) =>
      matchesNotificationFocus(appointment, focusKey, ["id"])
    );
    if (!match) return;
    const timer = window.setTimeout(() => {
      focusedCardRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
    const clearTimer = window.setTimeout(() => {
      const next = new URLSearchParams(searchParams);
      if (next.has("focus")) {
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    }, 4000);
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(clearTimer);
    };
  }, [focusKey, appointments, searchParams, setSearchParams]);

  const selectedService = useMemo(
    () =>
      attachServiceVisual((catalog?.services || []).find((service) => service.id === form.serviceId)),
    [catalog, form.serviceId]
  );
  const selectedServicePrice = useMemo(
    () => getApprovedClinicPrice(selectedService),
    [selectedService]
  );
  const selectedBracesOption = selectedServicePrice?.options?.find((option) => option.id === form.bracesOption);
  const hmoProviders = catalog?.hmoProviders?.length ? catalog.hmoProviders : APPROVED_HMO_PROVIDERS;
  const selectedHmo = hmoProviders.find((provider) => provider.name === form.hmoProvider);

  function updateForm(event) {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function confirmAppointment(event) {
    event.preventDefault();
    setError("");
    setSuccess("");
    setIsBusy(true);
    try {
      if (selectedServicePrice?.options?.length && !form.bracesOption) {
        setError("Choose Standard Metal Braces or Invisible Braces before requesting an appointment.");
        setIsBusy(false);
        return;
      }
      let authorizationDocumentId;
      if (form.coverageType === "hmo" && authorizationFile) {
        const upload = await api.uploadHmoAuthorization(authorizationFile);
        authorizationDocumentId = upload.document.id;
      }
      const optionNote = selectedBracesOption ? `Orthodontic option: ${selectedBracesOption.title}` : "";
      const { bracesOption: _bracesOption, ...appointmentFields } = form;
      const response = await api.createAppointment({
        ...appointmentFields,
        notes: [form.notes, optionNote].filter(Boolean).join("\n"),
        forPatientUserId: form.forPatientUserId || undefined,
        authorizationDocumentId,
      });
      setSuccess(
        `${response.appointment.treatment} was submitted for ${displayDate(response.appointment.date)}.`
      );
      setForm((current) => ({
        ...current,
        serviceId: "",
        bracesOption: "",
        appointmentTime: "",
        hmoProvider: "",
        hmoMemberNumber: "",
        hmoCompanyName: "",
        hmoBirthDate: "",
        notes: "",
      }));
      setAuthorizationFile(null);
      await load();
      navigate("/appointments");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function cancelAppointment(appointmentId) {
    if (!window.confirm("Cancel this appointment?")) return;
    setError("");
    try {
      await api.cancelAppointment(appointmentId);
      setAppointments((current) =>
        current.map((appointment) =>
          appointment.id === appointmentId ? { ...appointment, status: "cancelled" } : appointment
        )
      );
    } catch (cancelError) {
      setError(cancelError.message);
    }
  }

  if (error && !loaded) return <ErrorState message={error} onRetry={load} />;
  if (!loaded) return <LoadingState label="Loading appointment history…" />;

  if (!isBooking) {
    return (
      <div className="appointments-page appointments-page--list">
        <SectionHeading
          eyebrow="Your bookings"
          title="Appointment"
          detail="Only appointments you booked appear here — not the service catalog or clinical treatment records."
        />

        <div className="admin-heading-actions appointments-book-cta-wrap">
          <button
            type="button"
            className="button button--primary appointments-book-cta"
            onClick={() => navigate("/appointments/book")}
          >
            <CalendarDays size={16} aria-hidden="true" />
            Book Appointment
          </button>
        </div>

        {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
        {success ? (
          <p className="inline-alert inline-alert--success">
            <Check size={17} /> {success}
          </p>
        ) : null}

        <section className="appointment-history">
          {appointments.length ? (
            <div className="appointment-history__cards">
              {appointments.map((appointment) => (
                <article
                  key={appointment.id}
                  ref={matchesNotificationFocus(appointment, focusKey, ["id"]) ? focusedCardRef : null}
                  className={`appointment-history-card ${
                    matchesNotificationFocus(appointment, focusKey, ["id"]) ? "is-notification-focus" : ""
                  }`}
                >
                  <header className="appointment-history-card__header">
                    <strong>Appointment</strong>
                    <span className={`status-pill status-pill--${appointment.status}`}>
                      {displayStatus(appointment.status)}
                    </span>
                  </header>
                  <dl className="appointment-history-card__details">
                    <div>
                      <dt>Date</dt>
                      <dd>{displayDate(appointment.date)}</dd>
                    </div>
                    <div>
                      <dt>Time</dt>
                      <dd>{displayTime(appointment.time)}</dd>
                    </div>
                    <div className="appointment-history-card__service">
                      <dt>Service</dt>
                      <dd>{displayServiceName(appointment)}</dd>
                    </div>
                    <div>
                      <dt>Status</dt>
                      <dd>{displayStatus(appointment.status)}</dd>
                    </div>
                  </dl>
                  {["confirmed", "pending"].includes(appointment.status) ? (
                    <button
                      type="button"
                      className="button button--secondary button--compact"
                      onClick={() => cancelAppointment(appointment.id)}
                    >
                      <X size={15} /> Cancel appointment
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          ) : (
            <EmptyState
              title="No appointment history yet."
              detail="Book an appointment to see it listed here with the service you selected."
            />
          )}
        </section>
      </div>
    );
  }

  if (!catalog) return <LoadingState label="Preparing your booking experience" />;

  return (
    <div className="appointments-page">
      <SectionHeading
        eyebrow="Reserve a visit"
        title="Book an Appointment"
        detail="Choose a service and schedule. Your selected service will appear later in Appointment History."
      />

      <div className="admin-heading-actions" style={{ marginBottom: "1rem" }}>
        <button type="button" className="button button--secondary" onClick={() => navigate("/appointments")}>
          <ChevronLeft size={16} /> Back to Appointment
        </button>
      </div>

      <div className="booking-progress" aria-label="Appointment booking progress">
        {["Service", "Schedule", "Coverage", "Confirmation"].map((step, index) => (
          <span key={step} className={index === 0 ? "is-current" : ""}>
            <b>0{index + 1}</b> {step}
          </span>
        ))}
      </div>

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {success ? (
        <p className="inline-alert inline-alert--success">
          <Check size={17} /> {success}
        </p>
      ) : null}

      <form className="booking-layout" onSubmit={confirmAppointment}>
        <div className="booking-form">
          <section className="glass-card booking-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">01 — Service</span>
                <h2>Select your service</h2>
              </div>
            </div>
            <div className="treatment-grid" role="radiogroup" aria-label="Select a service">
              {(catalog.services || []).map((service) => (
                <TreatmentServiceOption
                  key={service.id}
                  service={service}
                  selected={form.serviceId === service.id}
                  selectedOptionId={form.serviceId === service.id ? form.bracesOption : ""}
                  onSelectOption={(optionId) =>
                    setForm((current) => ({ ...current, bracesOption: optionId }))
                  }
                  onSelect={() =>
                    setForm((current) => ({
                      ...current,
                      serviceId: current.serviceId === service.id ? "" : service.id,
                      bracesOption: "",
                    }))
                  }
                />
              ))}
            </div>
          </section>

          <section className="glass-card booking-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">02 — Schedule</span>
                <h2>Choose date and time</h2>
              </div>
              <CalendarDays className="card-heading__icon" size={21} />
            </div>
            {dependents.length && !actingAs ? (
              <label className="field" style={{ marginBottom: "1rem" }}>
                <span>Patient</span>
                <select name="forPatientUserId" value={form.forPatientUserId} onChange={updateForm}>
                  <option value="">
                    {user?.fullName || "Account holder"} (Account Holder)
                  </option>
                  {dependents.map((dependent) => (
                    <option
                      key={dependent.id || dependent.dependentUserId}
                      value={dependent.dependentUserId}
                    >
                      {dependent.fullName || dependent.name || "Dependent"} (Approved Dependent)
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="schedule-fields">
              <label className="field">
                <span>Preferred date</span>
                <input
                  type="date"
                  name="appointmentDate"
                  min={tomorrow()}
                  value={form.appointmentDate}
                  onChange={updateForm}
                  required
                />
              </label>
            </div>
            {availability?.closed ? (
              <p className="inline-alert" role="status">
                The clinic is closed on {displayDate(form.appointmentDate)}. Choose another date.
              </p>
            ) : null}
            {availability && !availability.closed && availability.hours ? (
              <p className="muted">
                Clinic hours: {displayTime(availability.hours.open)} – {displayTime(availability.hours.close)}
              </p>
            ) : null}
            <div className="time-filter-row">
              {PERIOD_ORDER.filter((period) =>
                (availability?.slots || []).some((slot) => slot.bookable && slot.period === period)
              ).map((period) => (
                <button
                  type="button"
                  key={period}
                  className={`filter-pill ${timePeriod === period ? "is-active" : ""}`}
                  onClick={() => setTimePeriod(period)}
                >
                  {period}
                </button>
              ))}
            </div>
            <div className="time-slots">
              {(availability?.slots || [])
                .filter((slot) => slot.bookable && slot.period === timePeriod)
                .map((slot) => (
                  <button
                    type="button"
                    key={slot.time}
                    className={`time-slot ${form.appointmentTime === slot.time ? "is-selected" : ""}`}
                    onClick={() => setForm((current) => ({ ...current, appointmentTime: slot.time }))}
                  >
                    <Clock3 size={15} /> {displayTime(slot.time)}
                  </button>
                ))}
            </div>
            {availability && !availability.closed && !(availability.availableTimes || []).length ? (
              <p className="muted">No appointment slots are available on this date.</p>
            ) : null}
          </section>

          <section className="glass-card booking-section">
            <div className="card-heading">
              <div>
                <span className="eyebrow">03 — Coverage</span>
                <h2>Will you be using an HMO?</h2>
              </div>
              <ShieldCheck className="card-heading__icon" size={21} />
            </div>
            <div className="coverage-options">
              <label className={`coverage-option ${form.coverageType === "hmo" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="coverageType"
                  value="hmo"
                  checked={form.coverageType === "hmo"}
                  onChange={updateForm}
                />
                <span>
                  <strong>Yes, I have HMO coverage</strong>
                  <small>We’ll securely validate your benefits before your visit.</small>
                </span>
              </label>
              <label className={`coverage-option ${form.coverageType === "self_pay" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="coverageType"
                  value="self_pay"
                  checked={form.coverageType === "self_pay"}
                  onChange={updateForm}
                />
                <span>
                  <strong>No, I’ll pay out of pocket</strong>
                  <small>Pay at the clinic after your visit.</small>
                </span>
              </label>
            </div>

            {form.coverageType === "hmo" ? (
              <div className="hmo-fields">
                <div className="field-row">
                  <label className="field booking-select-field">
                    <span>HMO provider</span>
                    <select
                      name="hmoProvider"
                      value={form.hmoProvider}
                      onChange={updateForm}
                      required
                      aria-label="Select HMO provider"
                    >
                      <option value="" disabled>
                        Select HMO provider
                      </option>
                      {hmoProviders.map((provider) => (
                        <option key={provider.id || provider.name} value={provider.name}>
                          {provider.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Member number</span>
                    <input name="hmoMemberNumber" value={form.hmoMemberNumber} onChange={updateForm} required />
                  </label>
                </div>
                <div className="field-row">
                  <label className="field">
                    <span>Company name</span>
                    <input name="hmoCompanyName" value={form.hmoCompanyName} onChange={updateForm} required />
                  </label>
                  <label className="field">
                    <span>Birth date</span>
                    <input
                      type="date"
                      name="hmoBirthDate"
                      value={form.hmoBirthDate}
                      onChange={updateForm}
                      required
                    />
                  </label>
                </div>
                {form.hmoProvider ? (
                  <p className="muted booking-hmo-note">
                    {selectedHmo?.filipinoDoctors
                      ? `${form.hmoProvider} is listed under Filipino Doctors, subject to the clinic's applicable accreditation and verification arrangements. `
                      : ""}
                    Being listed does not guarantee eligibility or coverage for a particular dental service. Clinic staff
                    must verify your account, plan benefits, and the requested service.
                  </p>
                ) : null}
                <label className="file-drop">
                  <FileUp size={21} />
                  <span>
                    <strong>Upload authorization document</strong>
                    <small>{authorizationFile ? authorizationFile.name : "PDF, JPG, or PNG — up to 5 MB"}</small>
                  </span>
                  <input
                    type="file"
                    accept=".pdf,image/jpeg,image/png"
                    onChange={(event) => setAuthorizationFile(event.target.files?.[0] || null)}
                  />
                </label>
              </div>
            ) : null}
          </section>

          <section className="glass-card booking-section booking-section--notes">
            <label className="field">
              <span>
                Anything your care team should know? <small>(optional)</small>
              </span>
              <textarea
                name="notes"
                rows="3"
                value={form.notes}
                onChange={updateForm}
                placeholder="Share accessibility needs, concerns, or preferences."
              />
            </label>
          </section>
        </div>

        <aside className={`booking-summary ${visitSummaryOpen ? "is-open" : ""}`}>
          <button
            type="button"
            className="booking-summary__toggle"
            aria-expanded={visitSummaryOpen}
            onClick={() => setVisitSummaryOpen((current) => !current)}
          >
            <span className="booking-summary__mark" aria-hidden="true">
              <CalendarDays size={16} />
            </span>
            <span>
              <span className="eyebrow">04 — Confirmation</span>
              <strong>Visit Summary</strong>
              <small>
                {selectedService
                  ? `${selectedService.name}${selectedBracesOption ? ` · ${selectedBracesOption.title}` : ""} · ${selectedBracesOption?.priceLabel || selectedServicePrice?.priceLabel || "Price to confirm"}`
                  : "Select a service to review your visit"}
              </small>
            </span>
            <ChevronDown size={18} aria-hidden="true" />
          </button>
          <div className="booking-summary__intro">
            <span className="booking-summary__mark" aria-hidden="true">
              <CalendarDays size={18} />
            </span>
            <div>
              <span className="eyebrow">04 — Confirmation</span>
              <h2>Your visit summary</h2>
            </div>
          </div>
          <div className="booking-summary__body">
            <div className="booking-summary__line">
              <span>Service</span>
              <strong>
                {selectedService
                  ? `${selectedService.name}${selectedBracesOption ? ` — ${selectedBracesOption.title}` : ""}`
                  : "Select a service"}
              </strong>
            </div>
            {selectedBracesOption || selectedServicePrice ? (
              <div className="booking-summary__line">
                <span>Price</span>
                <strong>{selectedBracesOption?.details || selectedServicePrice?.details}</strong>
              </div>
            ) : null}
            <div className="booking-summary__line">
              <span>Date</span>
              <strong>{form.appointmentDate ? displayDate(form.appointmentDate) : "Choose a date"}</strong>
            </div>
            <div className="booking-summary__line">
              <span>Time</span>
              <strong>{form.appointmentTime ? displayTime(form.appointmentTime) : "Choose a time"}</strong>
            </div>
            <div className="booking-summary__line">
              <span>Coverage</span>
              <strong>{form.coverageType === "hmo" ? "HMO coverage" : "Out of pocket"}</strong>
            </div>
          </div>
          <button
            className="button button--primary button--wide"
            disabled={
              isBusy ||
              !form.serviceId ||
              !form.appointmentTime ||
              (Boolean(selectedServicePrice?.options?.length) && !form.bracesOption)
            }
          >
            {isBusy ? "Submitting your request…" : "Request appointment"} <ChevronRight size={18} />
          </button>
          <p>The service you select is saved with this appointment and shown in Appointment History.</p>
        </aside>
      </form>
    </div>
  );
}
