import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RescheduleAppointmentModal } from "../components/RescheduleAppointmentModal";
import { canManageAppointment, displayAppointmentStatus } from "../utils/appointmentStatus";
import { useAuth } from "../useAuth";
import { matchesNotificationFocus } from "../notificationFocus";
import { applyApprovedClinicPriceOverrides, getApprovedClinicPrice } from "../clinic/approvedClinicPrices";
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

const DEFAULT_MEDICAL_DOCUMENT_TYPES = [
  {
    id: "medical_clearance",
    label: "Medical Clearance / Authorization",
    description:
      "A physician's certificate or authorization related to whether the patient may undergo a dental procedure.",
  },
  {
    id: "dental_xray",
    label: "Dental X-ray / Radiograph",
    description: "An existing dental X-ray or radiographic image.",
  },
  {
    id: "referral",
    label: "Referral / Treatment Recommendation",
    description:
      "A referral or recommendation from another dentist, such as a recommendation to perform a restoration.",
  },
  {
    id: "procedure_request",
    label: "Procedure Request / Supporting Paperwork",
    description: "Other documents requesting or supporting a particular dental procedure.",
  },
  {
    id: "other",
    label: "Other Medical Document",
    description: "Another relevant medical document not covered by the options above.",
  },
];

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

function ServicePriceDetails({ price, open, selectedOptionId, onSelectOption, onClose, photoUrl, imageFit, imageAlt }) {
  const [more, setMore] = useState(false);
  const closeRef = useRef(null);

  useEffect(() => {
    if (!open) setMore(false);
  }, [open, price?.id]);

  useEffect(() => {
    if (!open) return undefined;
    closeRef.current?.focus();
    function onKey(event) {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !price || typeof document === "undefined") return null;

  const options = price.options || [];
  const selectedOption = options.find((option) => option.id === selectedOptionId);
  const extraNotes = selectedOption?.notes?.length ? selectedOption.notes : price.extraNotes || [];
  const detailLines = selectedOption?.lines?.length ? selectedOption.lines : price.lines || [];
  const hasMore = Boolean(detailLines.length || extraNotes.length);

  return createPortal(
    <div className="treatment-details-layer is-open">
      <button
        type="button"
        className="treatment-details-layer__backdrop"
        tabIndex={-1}
        aria-label="Close service details"
        onClick={onClose}
      />
      <aside
        className="treatment-price-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="selected-service-title"
        aria-live="polite"
      >
        <button
          ref={closeRef}
          type="button"
          className="treatment-price-panel__close"
          aria-label="Close service details"
          onClick={onClose}
        >
          <X size={16} />
        </button>
        <h3 id="selected-service-title">{price.title}</h3>
        {photoUrl ? (
          <figure className="treatment-price-panel__figure">
            <img
              src={photoUrl}
              alt={imageAlt || `${price.title} example`}
              className={`treatment-price-panel__photo${imageFit === "contain" ? " is-contain" : ""}`}
            />
          </figure>
        ) : null}
        {price.description ? (
          <p className="treatment-price-panel__description">{price.description}</p>
        ) : null}
        <p className="treatment-price-panel__price">{selectedOption?.priceLabel || price.priceLabel}</p>
        {selectedOption ? (
          <p className="treatment-price-panel__note">{selectedOption.title}</p>
        ) : null}
        {price.compactNote && !selectedOption ? (
          <p className="treatment-price-panel__note">{price.compactNote}</p>
        ) : null}
        {options.length ? (
          <div className="treatment-price-panel__options" role="radiogroup" aria-label="Orthodontic option">
            {options.map((option) => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={selectedOptionId === option.id}
                className={`treatment-price-panel__option ${selectedOptionId === option.id ? "is-selected" : ""}`}
                onClick={() => onSelectOption?.(option.id)}
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
              onClick={() => setMore((current) => !current)}
            >
              {more ? "Less details" : "More details"}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <div className={`treatment-price-panel__extra ${more ? "is-open" : ""}`}>
              <div className="treatment-price-panel__extra-inner">
                {detailLines.length ? (
                  <dl className="treatment-price-panel__lines">
                    {detailLines.map((line) => (
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
    </div>,
    document.body
  );
}

function TreatmentServiceOption({ service, selected, onSelect }) {
  const visual = attachServiceVisual(service);
  const photoUrl = servicePhotoUrl(visual);
  const price = getApprovedClinicPrice(visual);

  return (
    <div className={`treatment-option-wrap ${selected ? "is-open" : ""}`}>
      <button
        type="button"
        role="radio"
        aria-checked={selected}
        aria-haspopup="dialog"
        aria-expanded={selected}
        aria-label={`${service.name}, ${price.priceLabel}`}
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
        <small className="treatment-option__price">{price.priceLabel}</small>
      </button>
    </div>
  );
}

function displayStatus(status) {
  return displayAppointmentStatus(status);
}

function formatFileSize(bytes) {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function fileKindLabel(name, mime) {
  const lower = `${name || ""} ${mime || ""}`.toLowerCase();
  if (lower.includes("pdf")) return "PDF";
  if (lower.includes("png")) return "PNG";
  if (lower.includes("jpeg") || lower.includes("jpg")) return "JPG";
  return "Document";
}

function validateBooking(form, { selectedServicePrice, availability, throughStep }) {
  if (throughStep >= 1) {
    if (!form.serviceId) {
      return { step: 1, message: "Select a dental service before continuing." };
    }
    if (selectedServicePrice?.options?.length && !form.bracesOption) {
      return {
        step: 1,
        message: "Choose Standard Metal Braces, Invisible Braces, or Ortho Adjustment before continuing.",
      };
    }
  }
  if (throughStep >= 2) {
    if (!form.appointmentDate) {
      return { step: 2, message: "Choose an appointment date." };
    }
    if (availability?.closed) {
      return { step: 2, message: `The clinic is closed on ${displayDate(form.appointmentDate)}. Choose another date.` };
    }
    if (!form.appointmentTime) {
      return { step: 2, message: "Choose an available appointment time." };
    }
    const bookable = availability?.availableTimes || [];
    if (availability && bookable.length && !bookable.includes(form.appointmentTime)) {
      return { step: 2, message: "That time is no longer available. Choose another appointment slot." };
    }
  }
  if (throughStep >= 3) {
    if (form.coverageType !== "hmo" && form.coverageType !== "self_pay") {
      return { step: 3, message: "Choose HMO coverage or pay out of pocket." };
    }
    if (form.coverageType === "hmo") {
      if (!String(form.hmoProvider || "").trim()) {
        return { step: 3, message: "Select your HMO provider." };
      }
      if (!String(form.hmoMemberNumber || "").trim()) {
        return { step: 3, message: "Enter your HMO member number." };
      }
      if (!String(form.hmoCompanyName || "").trim()) {
        return { step: 3, message: "Enter the company name on your HMO." };
      }
      if (!form.hmoBirthDate) {
        return { step: 3, message: "Enter the birth date on your HMO record." };
      }
    }
  }
  return null;
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
  const [medicalDocument, setMedicalDocument] = useState(null);
  const [medicalDocumentType, setMedicalDocumentType] = useState("");
  const [medicalDocumentDescription, setMedicalDocumentDescription] = useState("");
  const [medicalUploadError, setMedicalUploadError] = useState("");
  const [medicalUploadSuccess, setMedicalUploadSuccess] = useState("");
  const [medicalUploading, setMedicalUploading] = useState(false);
  const medicalFileInputRef = useRef(null);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [rescheduleTarget, setRescheduleTarget] = useState(null);
  const [rescheduleBusy, setRescheduleBusy] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [visitSummaryOpen, setVisitSummaryOpen] = useState(false);
  const [bookingStep, setBookingStep] = useState(1);
  const [detailsDismissed, setDetailsDismissed] = useState(false);
  const errorAlertRef = useRef(null);
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
      applyApprovedClinicPriceOverrides(catalogResponse.clinicServices || []);
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

  useEffect(() => {
    document.body.classList.toggle("booking-summary-open", visitSummaryOpen);
    if (!visitSummaryOpen) return undefined;
    function onKey(event) {
      if (event.key === "Escape") closeVisitSummary();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("booking-summary-open");
      window.removeEventListener("keydown", onKey);
    };
  }, [visitSummaryOpen, isBusy]);

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
  const detailsOpen = Boolean(selectedServicePrice && !detailsDismissed);
  const closeServiceDetails = useCallback(() => setDetailsDismissed(true), []);
  const hmoProviders = catalog?.hmoProviders?.length ? catalog.hmoProviders : APPROVED_HMO_PROVIDERS;
  const selectedHmo = hmoProviders.find((provider) => provider.name === form.hmoProvider);
  const medicalDocumentTypes = catalog?.medicalDocumentTypes?.length
    ? catalog.medicalDocumentTypes
    : DEFAULT_MEDICAL_DOCUMENT_TYPES;
  const selectedMedicalType = medicalDocumentTypes.find((item) => item.id === medicalDocumentType);
  const bookableServices = (catalog?.services || []).filter(
    (service) =>
      service?.id &&
      service.id !== "emergency-care" &&
      service.id !== "dental-crowns" &&
      service.id !== "oral-surgery"
  );

  function updateForm(event) {
    setError("");
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function showBookingIssue(issue) {
    setVisitSummaryOpen(false);
    setBookingStep(issue.step);
    setError(issue.message);
    window.requestAnimationFrame(() => {
      errorAlertRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function goToBookingStep(step) {
    if (step < 1 || step > 3) return;
    if (step > bookingStep) {
      const issue = validateBooking(form, {
        selectedServicePrice,
        availability,
        throughStep: step - 1,
      });
      if (issue) {
        showBookingIssue(issue);
        return;
      }
    }
    setError("");
    setBookingStep(step);
  }

  function continueBooking() {
    const issue = validateBooking(form, {
      selectedServicePrice,
      availability,
      throughStep: bookingStep,
    });
    if (issue) {
      showBookingIssue(issue);
      return;
    }
    setError("");
    setBookingStep((current) => Math.min(3, current + 1));
  }

  function openVisitSummary() {
    const issue = validateBooking(form, {
      selectedServicePrice,
      availability,
      throughStep: 3,
    });
    if (issue) {
      showBookingIssue(issue);
      return;
    }
    setError("");
    setVisitSummaryOpen(true);
  }

  function closeVisitSummary() {
    if (isBusy) return;
    setVisitSummaryOpen(false);
  }

  async function uploadMedicalDocument(file) {
    if (!file) return;
    setMedicalUploadError("");
    setMedicalUploadSuccess("");
    if (!medicalDocumentType) {
      setMedicalUploadError("Select a document type before uploading.");
      if (medicalFileInputRef.current) medicalFileInputRef.current.value = "";
      return;
    }
    const description =
      medicalDocumentDescription.trim() || selectedMedicalType?.label || "";
    if (!description) {
      setMedicalUploadError("Enter a short description for this file, such as Medical Clearance.");
      if (medicalFileInputRef.current) medicalFileInputRef.current.value = "";
      return;
    }
    if (medicalDocument?.id) {
      await api.removeMedicalDocument(medicalDocument.id).catch(() => {});
    }
    setMedicalUploading(true);
    try {
      const response = await api.uploadMedicalDocument(file, medicalDocumentType, description);
      setMedicalDocument({
        ...response.document,
        name: response.document?.name || description,
        filename: response.document?.filename || file.name,
        mimeType: response.document?.mimeType || file.type,
        size: response.document?.size || file.size,
        category: response.document?.category || description,
        documentType: response.document?.documentType || medicalDocumentType,
      });
      setMedicalDocumentDescription(response.document?.name || description);
      setMedicalUploadSuccess(response.message || "Medical document saved for your dentist to review.");
    } catch (uploadError) {
      setMedicalDocument(null);
      setMedicalUploadError(uploadError.message || "Unable to save the medical document.");
    } finally {
      setMedicalUploading(false);
      if (medicalFileInputRef.current) medicalFileInputRef.current.value = "";
    }
  }

  async function removeMedicalDocument() {
    if (medicalDocument?.id) {
      await api.removeMedicalDocument(medicalDocument.id).catch(() => {});
    }
    setMedicalDocument(null);
    setMedicalUploadError("");
    setMedicalUploadSuccess("");
    if (medicalFileInputRef.current) medicalFileInputRef.current.value = "";
  }

  async function confirmAppointment(event) {
    event.preventDefault();
    if (!visitSummaryOpen || isBusy) return;
    setError("");
    setSuccess("");
    setIsBusy(true);
    try {
      const issue = validateBooking(form, {
        selectedServicePrice,
        availability,
        throughStep: 3,
      });
      if (issue) {
        showBookingIssue(issue);
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
        medicalDocumentId: medicalDocument?.id || undefined,
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
      setDetailsDismissed(false);
      setAuthorizationFile(null);
      setMedicalDocument(null);
      setMedicalDocumentType("");
      setMedicalUploadError("");
      setMedicalUploadSuccess("");
      setVisitSummaryOpen(false);
      setBookingStep(1);
      await load();
      navigate("/appointments");
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setIsBusy(false);
    }
  }

  async function confirmCancelAppointment() {
    if (!cancelTarget || cancelBusy) return;
    setError("");
    setCancelBusy(true);
    try {
      const response = await api.cancelAppointment(cancelTarget.id, { reason: "patient_cancelled" });
      const next = response.appointment || { ...cancelTarget, status: "cancelled" };
      setAppointments((current) =>
        current.map((appointment) => (appointment.id === next.id ? { ...appointment, ...next } : appointment))
      );
      setSuccess("Your appointment has been cancelled.");
      setCancelTarget(null);
    } catch (cancelError) {
      setError(cancelError.message);
    } finally {
      setCancelBusy(false);
    }
  }

  async function confirmReschedule({ appointmentDate, appointmentTime }) {
    if (!rescheduleTarget || rescheduleBusy) return;
    setRescheduleError("");
    setRescheduleBusy(true);
    try {
      const response = await api.rescheduleAppointment(rescheduleTarget.id, {
        appointmentDate,
        appointmentTime,
      });
      await load();
      setSuccess(response.message || "Your appointment was rescheduled.");
      setRescheduleTarget(null);
    } catch (rescheduleFailure) {
      setRescheduleError(rescheduleFailure.message);
    } finally {
      setRescheduleBusy(false);
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
          action={
            <div className="appointments-book-cta-wrap">
              <button
                type="button"
                className="button button--primary appointments-book-cta"
                onClick={() => navigate("/appointments/book")}
              >
                <CalendarDays size={16} aria-hidden="true" />
                Book Appointment
              </button>
            </div>
          }
        />

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
                  {canManageAppointment(appointment).cancel || canManageAppointment(appointment).reschedule ? (
                    <div className="appointment-history-card__actions">
                      {canManageAppointment(appointment).reschedule ? (
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          onClick={() => {
                            setRescheduleError("");
                            setRescheduleTarget(appointment);
                          }}
                        >
                          Reschedule
                        </button>
                      ) : null}
                      {canManageAppointment(appointment).cancel ? (
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          onClick={() => setCancelTarget(appointment)}
                        >
                          <X size={15} /> Cancel
                        </button>
                      ) : null}
                    </div>
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
        <ConfirmDialog
          open={Boolean(cancelTarget)}
          title="Are you sure you want to cancel this appointment?"
          message="Your appointment will be cancelled if you confirm. If you change your mind, you can keep your current appointment."
          busy={cancelBusy}
          onCancel={() => {
            if (!cancelBusy) setCancelTarget(null);
          }}
          onConfirm={confirmCancelAppointment}
        />
        {rescheduleTarget ? (
          <RescheduleAppointmentModal
            appointment={rescheduleTarget}
            busy={rescheduleBusy}
            error={rescheduleError}
            onClose={() => {
              if (!rescheduleBusy) {
                setRescheduleTarget(null);
                setRescheduleError("");
              }
            }}
            onConfirm={confirmReschedule}
          />
        ) : null}
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
        {[
          { id: 1, label: "Service" },
          { id: 2, label: "Schedule" },
          { id: 3, label: "Coverage" },
          { id: 4, label: "Confirmation" },
        ].map((step) => {
          const current = visitSummaryOpen ? 4 : bookingStep;
          const className = [
            current === step.id ? "is-current" : "",
            !visitSummaryOpen && step.id < bookingStep ? "is-complete" : "",
          ]
            .filter(Boolean)
            .join(" ");
          if (step.id === 4) {
            return (
              <span key={step.label} className={className}>
                <b>0{step.id}</b> {step.label}
              </span>
            );
          }
          return (
            <button
              key={step.label}
              type="button"
              className={className}
              onClick={() => goToBookingStep(step.id)}
            >
              <b>0{step.id}</b> {step.label}
            </button>
          );
        })}
      </div>

      {error ? (
        <p ref={errorAlertRef} className="inline-alert inline-alert--error" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="inline-alert inline-alert--success">
          <Check size={17} /> {success}
        </p>
      ) : null}

      <form id="patient-booking-form" className="booking-layout" onSubmit={confirmAppointment} noValidate>
        <div className="booking-form">
          <section className={`glass-card booking-section${bookingStep === 1 ? "" : " is-hidden"}`} hidden={bookingStep !== 1}>
            <div className="card-heading">
              <div>
                <span className="eyebrow">01 — Service</span>
                <h2>Select your service</h2>
              </div>
            </div>
            <div className="treatment-grid" role="radiogroup" aria-label="Select a service">
              {bookableServices.map((service) => (
                <TreatmentServiceOption
                  key={service.id}
                  service={service}
                  selected={form.serviceId === service.id}
                  onSelect={() => {
                    setError("");
                    setForm((current) => {
                      if (current.serviceId === service.id && !detailsDismissed) {
                        return { ...current, serviceId: "", bracesOption: "" };
                      }
                      return { ...current, serviceId: service.id, bracesOption: current.serviceId === service.id ? current.bracesOption : "" };
                    });
                    setDetailsDismissed(false);
                  }}
                />
              ))}
            </div>
            <ServicePriceDetails
              price={selectedServicePrice}
              open={detailsOpen && bookingStep === 1}
              selectedOptionId={form.bracesOption}
              photoUrl={servicePhotoUrl(selectedService)}
              imageFit={selectedService?.imageFit}
              imageAlt={selectedService?.imageAlt}
              onSelectOption={(optionId) =>
                setForm((current) => ({ ...current, bracesOption: optionId }))
              }
              onClose={closeServiceDetails}
            />
            <div className="booking-step-actions">
              <button type="button" className="button button--primary" onClick={continueBooking}>
                Continue to schedule <ChevronRight size={18} />
              </button>
            </div>
          </section>

          <section className={`glass-card booking-section${bookingStep === 2 ? "" : " is-hidden"}`} hidden={bookingStep !== 2}>
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
            <div className="booking-step-actions">
              <button type="button" className="button button--secondary" onClick={() => goToBookingStep(1)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" className="button button--primary" onClick={continueBooking}>
                Continue to coverage <ChevronRight size={18} />
              </button>
            </div>
          </section>

          <section className={`glass-card booking-section${bookingStep === 3 ? "" : " is-hidden"}`} hidden={bookingStep !== 3}>
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

            <label className="field booking-section__notes">
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

            <section className="booking-medical-docs">
              <div className="card-heading">
                <div>
                  <span className="eyebrow">Optional</span>
                  <h3>Medical Documents (Optional)</h3>
                </div>
              </div>
              <p>
                Do you have a medical clearance, physician&apos;s certificate, or other important document
                related to your dental treatment? You may upload it here for your dentist to review.
              </p>
              <p className="muted">
                Examples: medical clearance for dental treatment, physician&apos;s certificate, or other
                relevant medical documents. Uploading is optional. Your dentist may request additional
                documentation if clinically necessary.
              </p>
              <p className="muted">Accepted files: PDF, JPG, or PNG — up to 5 MB.</p>
              <label className="field booking-medical-docs__type">
                <span>Document Type</span>
                <select
                  value={medicalDocumentType}
                  onChange={(event) => {
                    const nextType = event.target.value;
                    const next = medicalDocumentTypes.find((item) => item.id === nextType);
                    const previous = medicalDocumentTypes.find((item) => item.id === medicalDocumentType);
                    setMedicalUploadError("");
                    setMedicalDocumentType(nextType);
                    setMedicalDocumentDescription((current) => {
                      if (!current.trim() || current.trim() === previous?.label) {
                        return next?.label || "";
                      }
                      return current;
                    });
                  }}
                  required
                >
                  <option value="">Select a document type</option>
                  {medicalDocumentTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <small>
                  {selectedMedicalType?.description ||
                    "Choose the option that best describes the file. Uploading remains optional."}
                </small>
              </label>
              <label className="field booking-medical-docs__type">
                <span>Document description</span>
                <input
                  value={medicalDocumentDescription}
                  onChange={(event) => {
                    setMedicalUploadError("");
                    setMedicalDocumentDescription(event.target.value);
                  }}
                  maxLength={160}
                  placeholder="e.g. Medical Clearance"
                />
                <small>Your dentist will see this name in Uploaded Files on the patient record.</small>
              </label>
              <input
                ref={medicalFileInputRef}
                className="booking-medical-docs__input"
                type="file"
                accept=".pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
                onChange={(event) => uploadMedicalDocument(event.target.files?.[0] || null)}
              />
              <div className="booking-medical-docs__actions">
                <button
                  type="button"
                  className="button button--secondary"
                  disabled={medicalUploading}
                  onClick={() => medicalFileInputRef.current?.click()}
                >
                  <FileUp size={16} /> {medicalUploading ? "Uploading…" : "Upload Document"}
                </button>
                {medicalDocument ? (
                  <button type="button" className="button button--secondary" onClick={removeMedicalDocument}>
                    <X size={16} /> Remove
                  </button>
                ) : null}
              </div>
              {medicalDocument ? (
                <p className="booking-medical-docs__file" role="status">
                  <strong>{medicalDocument.name}</strong>
                  <small>
                    {medicalDocument.filename || "File attached"} ·{" "}
                    {fileKindLabel(
                      medicalDocument.filename || medicalDocument.name,
                      medicalDocument.mimeType
                    )}{" "}
                    · {formatFileSize(medicalDocument.size)}
                  </small>
                </p>
              ) : null}
              {medicalUploadSuccess ? (
                <p className="inline-alert inline-alert--success">
                  <Check size={17} /> {medicalUploadSuccess}
                </p>
              ) : null}
              {medicalUploadError ? (
                <p className="inline-alert inline-alert--error" role="alert">
                  {medicalUploadError}
                </p>
              ) : null}
            </section>

            <div className="booking-step-actions booking-step-actions--coverage">
              <button type="button" className="button button--secondary" onClick={() => goToBookingStep(2)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" className="button button--primary booking-done" onClick={openVisitSummary}>
                Done
              </button>
            </div>
          </section>
        </div>

        {visitSummaryOpen && typeof document !== "undefined"
          ? createPortal(
              <div className="booking-summary-layer is-open">
                <button
                  type="button"
                  className="booking-summary-layer__backdrop"
                  tabIndex={-1}
                  aria-label="Close visit summary"
                  onClick={closeVisitSummary}
                />
                <aside
                  className="booking-summary is-open"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="visit-summary-title"
                >
                  <button
                    type="button"
                    className="booking-summary__close"
                    aria-label="Close visit summary"
                    onClick={closeVisitSummary}
                    disabled={isBusy}
                  >
                    <X size={16} />
                  </button>
                  <div className="booking-summary__intro">
                    <span className="booking-summary__mark" aria-hidden="true">
                      <CalendarDays size={18} />
                    </span>
                    <div>
                      <span className="eyebrow">04 — Confirmation</span>
                      <h2 id="visit-summary-title">Visit Summary</h2>
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
                      <strong>
                        {form.coverageType === "hmo"
                          ? form.hmoProvider
                            ? `HMO coverage · ${form.hmoProvider}`
                            : "HMO coverage"
                          : "Out of pocket"}
                      </strong>
                    </div>
                    <div className="booking-summary__line">
                      <span>Document</span>
                      <strong>
                        {medicalDocument
                          ? `Attached · ${medicalDocument.name}${
                              medicalDocument.filename ? ` · ${medicalDocument.filename}` : ""
                            }`
                          : "None attached"}
                      </strong>
                    </div>
                  </div>
                  {error ? (
                    <p className="inline-alert inline-alert--error" role="alert">
                      {error}
                    </p>
                  ) : null}
                  <button
                    type="submit"
                    form="patient-booking-form"
                    className="button button--primary button--wide"
                    disabled={isBusy}
                  >
                    {isBusy ? "Submitting your request…" : "Request appointment"} <ChevronRight size={18} />
                  </button>
                  <p>The service you select is saved with this appointment and shown in Appointment History.</p>
                </aside>
              </div>,
              document.body
            )
          : null}
      </form>
    </div>
  );
}
