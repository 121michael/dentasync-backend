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
  Eye,
  FileText,
  FileUp,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { ConfirmDialog } from "../components/ConfirmDialog";
import { RescheduleAppointmentModal } from "../components/RescheduleAppointmentModal";
import {
  canManageAppointment,
  clinicTodayYmd,
  displayAppointmentStatus,
  historySectionOf,
} from "../utils/appointmentStatus";
import { useAuth } from "../useAuth";
import { matchesNotificationFocus } from "../notificationFocus";
import { applyApprovedClinicPriceOverrides, getApprovedClinicPrice } from "../clinic/approvedClinicPrices";
import {
  hidePatientBookingPriceLines,
  hidePatientBookingPriceNotes,
  isPatientBookingPriceCopy,
} from "../clinic/patientBookingDisplay";
import { attachServiceVisual } from "../clinic/serviceVisuals";

const PERIOD_ORDER = ["Morning", "Afternoon", "Evening"];
const MAX_BOOKING_SERVICES = 3;

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
    label: "Other Dental Document",
    description: "Another relevant dental document not covered by the options above.",
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
  const listed = (appointment?.services || [])
    .map((service) => service?.name)
    .filter(Boolean);
  if (listed.length) return listed.join(" · ");
  const raw = appointment?.treatment || appointment?.service || "";
  return LEGACY_SERVICE_NAMES[raw] || raw || "Service not recorded";
}

function selectedBookingIds(form) {
  const fromArray = Array.isArray(form?.serviceIds) ? form.serviceIds : [];
  const ids = fromArray.map((id) => String(id || "").trim()).filter(Boolean);
  if (ids.length) return [...new Set(ids)];
  return form?.serviceId ? [form.serviceId] : [];
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
  const extraNotes = hidePatientBookingPriceNotes(
    selectedOption?.notes?.length ? selectedOption.notes : price.extraNotes || []
  );
  const detailLines = hidePatientBookingPriceLines(
    selectedOption?.lines?.length ? selectedOption.lines : price.lines || []
  );
  const compactNote = !selectedOption && !isPatientBookingPriceCopy(price.compactNote) ? price.compactNote : "";
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
        {price.description && !isPatientBookingPriceCopy(price.description) ? (
          <p className="treatment-price-panel__description">{price.description}</p>
        ) : null}
        {selectedOption ? (
          <p className="treatment-price-panel__note">{selectedOption.title}</p>
        ) : null}
        {compactNote ? <p className="treatment-price-panel__note">{compactNote}</p> : null}
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
                {option.description && !isPatientBookingPriceCopy(option.description) ? (
                  <p>{option.description}</p>
                ) : null}
                {hidePatientBookingPriceLines(option.lines).map((line) => (
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

function TreatmentServiceOption({ service, selected, onSelect, priceLabel, description, disabled }) {
  const visual = attachServiceVisual(service);
  const photoUrl = servicePhotoUrl(visual);

  return (
    <div className={`treatment-option-wrap ${selected ? "is-open" : ""}`}>
      <button
        type="button"
        role="checkbox"
        aria-checked={selected}
        aria-disabled={disabled && !selected}
        aria-haspopup="dialog"
        aria-expanded={selected}
        aria-label={`${service.name}${selected ? ", selected" : ""}`}
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
          <span className="treatment-option__check" aria-hidden="true">
            <Check size={12} />
          </span>
        ) : null}
        <span className="treatment-option__copy">
          <strong>{service.name}</strong>
          {description ? <small className="treatment-option__desc">{description}</small> : null}
          {priceLabel ? <span className="treatment-option__price">{priceLabel}</span> : null}
          <span className="treatment-option__select">{selected ? "Selected" : "Select"}</span>
        </span>
      </button>
    </div>
  );
}

function displayStatus(appointment) {
  if (appointment && typeof appointment === "object") {
    return displayAppointmentStatus(appointment.status, appointment.statusLabel);
  }
  return displayAppointmentStatus(appointment);
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

function coverageReady(form) {
  if (form.coverageType === "self_pay") return true;
  if (form.coverageType === "hmo") {
    return Boolean(
      String(form.hmoProvider || "").trim() &&
        String(form.hmoMemberNumber || "").trim() &&
        String(form.hmoCompanyName || "").trim() &&
        form.hmoBirthDate
    );
  }
  return false;
}

function branchReady(form, branchChoices) {
  if (!branchChoices || branchChoices.legacy) return true;
  if (!(branchChoices.branches || []).length) return false;
  return Boolean(form.branchId);
}

function validateBooking(form, { selectedServicePrice, availability, throughStep, branchChoices, availabilityLoading, availabilityError }) {
  if (throughStep >= 1) {
    if (branchChoices && !branchChoices.legacy && !(branchChoices.branches || []).length) {
      return {
        step: 1,
        message: "No clinic branches are currently available for appointment booking. Please contact the clinic.",
      };
    }
    if (!branchChoices?.legacy && !form.branchId) {
      return { step: 1, message: "Select a branch." };
    }
    if (form.coverageType !== "hmo" && form.coverageType !== "self_pay") {
      return { step: 1, message: "Choose Without HMO / Self-paying or With HMO." };
    }
    if (form.coverageType === "hmo") {
      if (!String(form.hmoProvider || "").trim()) {
        return { step: 1, message: "Select your HMO provider." };
      }
      if (!String(form.hmoMemberNumber || "").trim()) {
        return { step: 1, message: "Enter your HMO member number." };
      }
      if (!String(form.hmoCompanyName || "").trim()) {
        return { step: 1, message: "Enter the company name on your HMO." };
      }
      if (!form.hmoBirthDate) {
        return { step: 1, message: "Enter the birth date on your HMO record." };
      }
    }
  }
  if (throughStep >= 2) {
    if (!selectedBookingIds(form).length) {
      return { step: 2, message: "Select at least one dental service before continuing." };
    }
    if (selectedServicePrice?.options?.length && !form.bracesOption) {
      return {
        step: 2,
        message: "Choose Standard Metal Braces, Invisible Braces, or Ortho Adjustment before continuing.",
      };
    }
  }
  if (throughStep >= 3) {
    if (!form.appointmentDate) {
      return { step: 3, message: "Choose an appointment date." };
    }
    if (availabilityLoading) {
      return { step: 3, message: "Appointment availability is still loading." };
    }
    if (availabilityError) {
      return { step: 3, message: availabilityError };
    }
    if (availability?.closed) {
      return { step: 3, message: `The clinic is closed on ${displayDate(form.appointmentDate)}. Choose another date.` };
    }
    if (!form.appointmentTime) {
      return { step: 3, message: "Select an available appointment time." };
    }
    const bookable = availability?.availableTimes || [];
    if (availability && !bookable.includes(form.appointmentTime)) {
      return { step: 3, message: "That time is no longer available. Choose another appointment slot." };
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
  const [pendingMedicalFile, setPendingMedicalFile] = useState(null);
  const [availability, setAvailability] = useState(null);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [availabilityError, setAvailabilityError] = useState("");
  const [branchChoices, setBranchChoices] = useState(null);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [branchesError, setBranchesError] = useState("");
  const availabilityRequest = useRef(0);
  const [form, setForm] = useState({
    serviceId: "",
    serviceIds: [],
    bracesOption: "",
    branchId: "",
    appointmentDate: tomorrow(),
    appointmentTime: "",
    coverageType: "",
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
  const [bookingNotice, setBookingNotice] = useState("");
  const [savedProfileHmo, setSavedProfileHmo] = useState(null);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoading, setCatalogLoading] = useState(false);
  const errorAlertRef = useRef(null);
  const [focusKey, setFocusKey] = useState(() => searchParams.get("focus") || "");
  const focusedCardRef = useRef(null);

  const load = useCallback(async () => {
    setError("");
    setCatalogError("");
    setCatalogLoading(true);
    try {
      const [appointmentResponse, dependentsResponse, profileResponse] = await Promise.all([
        api.getAppointments(),
        api.getDependents().catch(() => ({ dependents: [] })),
        api.getProfile().catch(() => ({ profile: null })),
      ]);
      setAppointments(appointmentResponse.appointments || []);
      setDependents(
        (dependentsResponse.dependents || dependentsResponse.items || []).filter(
          (dependent) =>
            String(dependent.approvalStatus || "").toLowerCase() === "approved" &&
            String(dependent.dependentUserId || "").trim()
        )
      );
      const profile = profileResponse.profile || {};
      const savedProvider = String(profile.hmo_provider || profile.hmoProvider || "").trim();
      setSavedProfileHmo(
        savedProvider
          ? {
              hmoProvider: savedProvider,
              hmoMemberNumber: String(profile.hmo_member_number || profile.hmoMemberNumber || "").trim(),
              hmoBirthDate: String(profile.date_of_birth || profile.dateOfBirth || profile.birth_date || "").slice(0, 10),
            }
          : null
      );
    } catch (loadError) {
      setError(loadError.message);
    }
    try {
      const catalogResponse = await api.getCatalog();
      setCatalog(catalogResponse);
      applyApprovedClinicPriceOverrides(catalogResponse.clinicServices || []);
      setCatalogError("");
    } catch (catalogLoadError) {
      setCatalog(null);
      setCatalogError(catalogLoadError.message || "Unable to load clinic services.");
    } finally {
      setCatalogLoading(false);
      setLoaded(true);
    }
  }, [user?.id]);

  useEffect(() => {
    setAppointments([]);
    setLoaded(false);
    load();
  }, [load, user?.id]);

  useEffect(() => {
    if (!isBooking) return undefined;
    let active = true;
    setBranchesLoading(true);
    setBranchesError("");
    api
      .getBookingBranches()
      .then((response) => {
        if (!active) return;
        setBranchChoices(response);
      })
      .catch((loadError) => {
        if (!active) return;
        setBranchesError(loadError.message || "Unable to load clinic branches.");
      })
      .finally(() => {
        if (active) setBranchesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [isBooking]);

  useEffect(() => {
    if (!isBooking || !form.appointmentDate) {
      setAvailability(null);
      setAvailabilityLoading(false);
      return undefined;
    }
    const needsBranch = branchChoices?.requiresSelection && !form.branchId;
    const noBranches = branchChoices && !branchChoices.legacy && !(branchChoices.branches || []).length;
    if (!branchChoices || branchesLoading || needsBranch || noBranches) {
      setAvailability(null);
      setAvailabilityLoading(false);
      return undefined;
    }
    const requestId = availabilityRequest.current + 1;
    availabilityRequest.current = requestId;
    const durationMinutes = selectedBookingIds(form).reduce((sum, id) => {
      const service = (catalog?.services || []).find((item) => item.id === id);
      return sum + Math.max(Number(service?.durationMinutes) || 30, 1);
    }, 0);
    setAvailabilityLoading(true);
    setAvailabilityError("");
    setAvailability(null);
    api
      .getAppointmentAvailability(form.appointmentDate, form.branchId || undefined, durationMinutes)
      .then((response) => {
        if (requestId !== availabilityRequest.current) return;
        if (form.branchId && response.branch?.id && String(response.branch.id) !== String(form.branchId)) {
          return;
        }
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
      .catch((loadError) => {
        if (requestId !== availabilityRequest.current) return;
        setAvailability(null);
        setAvailabilityError(loadError.message || "Unable to load appointment availability.");
      })
      .finally(() => {
        if (requestId === availabilityRequest.current) setAvailabilityLoading(false);
      });
    return undefined;
  }, [form.appointmentDate, form.branchId, form.serviceIds, form.serviceId, isBooking, branchChoices, branchesLoading, catalog]);

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

  const selectedIds = selectedBookingIds(form);
  const selectedServices = useMemo(
    () =>
      selectedIds
        .map((id) => attachServiceVisual((catalog?.services || []).find((service) => service.id === id)))
        .filter(Boolean),
    [catalog, form.serviceId, form.serviceIds]
  );
  const selectedDurationMinutes = selectedServices.reduce(
    (sum, service) => sum + Math.max(Number(service.durationMinutes) || 30, 1),
    0
  );
  const bookableSlots = (availability?.slots || []).filter((slot) => slot.bookable);
  const periodSlots = bookableSlots.filter((slot) => slot.period === timePeriod);
  const schedulePeriods = PERIOD_ORDER.filter((period) =>
    bookableSlots.some((slot) => slot.period === period)
  );
  const canReviewSchedule = Boolean(
    form.appointmentDate &&
      form.appointmentTime &&
      !availabilityLoading &&
      !availabilityError &&
      availability &&
      !availability.closed &&
      (availability.availableTimes || []).includes(form.appointmentTime)
  );
  const slotsNeeded =
    availability?.slotsNeeded ||
    (selectedDurationMinutes ? Math.ceil(selectedDurationMinutes / 30) : 0);
  const selectedService = selectedServices[selectedServices.length - 1] || null;
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
      service.bookable !== false &&
      service.id !== "emergency-care" &&
      service.id !== "dental-crowns" &&
      service.id !== "oral-surgery"
  );
  const canViewServices = branchReady(form, branchChoices) && coverageReady(form);

  function toggleService(serviceId) {
    setError("");
    setForm((current) => {
      const ids = selectedBookingIds(current);
      const selected = ids.includes(serviceId);
      if (selected && ids.length === 1 && !detailsDismissed) {
        return { ...current, serviceId: "", serviceIds: [], bracesOption: "" };
      }
      let next = selected ? ids.filter((id) => id !== serviceId) : [...ids, serviceId];
      if (!selected && next.length > MAX_BOOKING_SERVICES) {
        setBookingNotice(`You can select up to ${MAX_BOOKING_SERVICES} services for one appointment.`);
        return current;
      }
      setBookingNotice("");
      return {
        ...current,
        serviceIds: next,
        serviceId: next[next.length - 1] || "",
        bracesOption: next.some((id) => id === current.serviceId) ? current.bracesOption : "",
      };
    });
    setDetailsDismissed(false);
  }

  function serviceCardMeta(service) {
    const priced = getApprovedClinicPrice(attachServiceVisual(service));
    const description = String(service.description || priced?.description || "").trim();
    const short = description.length > 120 ? `${description.slice(0, 117)}…` : description;
    const priceLabel =
      priced?.priceLabel && !isPatientBookingPriceCopy(priced.priceLabel) ? priced.priceLabel : "";
    return { description: short, priceLabel };
  }

  function changeBranch(branchId) {
    setError("");
    setAvailability(null);
    setForm((current) => {
      if (String(current.branchId) === String(branchId)) return current;
      if (current.appointmentTime) {
        setBookingNotice("Appointment time was cleared because available slots belong to the selected branch.");
      } else {
        setBookingNotice("");
      }
      return { ...current, branchId, appointmentTime: "" };
    });
  }

  function changeCoverage(coverageType) {
    setError("");
    setForm((current) => {
      const next = { ...current, coverageType };
      if (coverageType === "hmo" && savedProfileHmo) {
        if (!next.hmoProvider) next.hmoProvider = savedProfileHmo.hmoProvider;
        if (!next.hmoMemberNumber) next.hmoMemberNumber = savedProfileHmo.hmoMemberNumber;
        if (!next.hmoBirthDate && /^\d{4}-\d{2}-\d{2}$/.test(savedProfileHmo.hmoBirthDate || "")) {
          next.hmoBirthDate = savedProfileHmo.hmoBirthDate;
        }
      }
      return next;
    });
  }

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
        branchChoices,
        availabilityLoading,
        availabilityError,
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
      branchChoices,
      availabilityLoading,
      availabilityError,
    });
    if (issue) {
      showBookingIssue(issue);
      return;
    }
    setError("");
    if (bookingStep >= 3) {
      setVisitSummaryOpen(true);
      return;
    }
    setBookingStep((current) => Math.min(3, current + 1));
  }

  function openVisitSummary() {
    const issue = validateBooking(form, {
      selectedServicePrice,
      availability,
      throughStep: 3,
      branchChoices,
      availabilityLoading,
      availabilityError,
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
      setPendingMedicalFile(null);
      setMedicalDocumentDescription(response.document?.name || description);
      setMedicalUploadSuccess(response.message || "Dental document saved for your dentist to review.");
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
    setPendingMedicalFile(null);
    setMedicalUploadError("");
    setMedicalUploadSuccess("");
    if (medicalFileInputRef.current) medicalFileInputRef.current.value = "";
  }

  async function viewMedicalDocument() {
    if (!medicalDocument?.id) return;
    setMedicalUploadError("");
    try {
      await api.downloadPortalDocument({
        id: medicalDocument.id,
        name: medicalDocument.filename || medicalDocument.name,
      });
    } catch (viewError) {
      setMedicalUploadError(viewError.message || "Unable to open the document.");
    }
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
        branchChoices,
        availabilityLoading,
        availabilityError,
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
        serviceId: selectedIds[0],
        serviceIds: selectedIds,
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
        serviceIds: [],
        bracesOption: "",
        appointmentTime: "",
        coverageType: "",
        hmoProvider: "",
        hmoMemberNumber: "",
        hmoCompanyName: "",
        hmoBirthDate: "",
        notes: "",
      }));
      setDetailsDismissed(false);
      setAuthorizationFile(null);
      setMedicalDocument(null);
      setPendingMedicalFile(null);
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
    const grouped = appointments.reduce(
      (groups, row) => {
        const section = historySectionOf(row);
        if (groups[section]) groups[section].push(row);
        else groups.past.push(row);
        return groups;
      },
      { current: [], review: [], upcoming: [], past: [] }
    );
    const current = grouped.current;
    const review = grouped.review;
    const upcoming = grouped.upcoming;
    const past = grouped.past;
    const renderAppointmentCard = (appointment) => {
      const visitLabel =
        appointment.visitTypeLabel ||
        (appointment.visitType === "walk_in" ? "Walk-in visit" : "Booked appointment");
      const manage = canManageAppointment(appointment);
      const pillStatus =
        appointment.queueOutcome === "needs_review" || appointment.status === "needs_review"
          ? "needs_review"
          : appointment.status;
      return (
        <article
          key={appointment.id}
          ref={matchesNotificationFocus(appointment, focusKey, ["id"]) ? focusedCardRef : null}
          className={`appointment-history-card appointment-history-card--compact ${
            matchesNotificationFocus(appointment, focusKey, ["id"]) ? "is-notification-focus" : ""
          }`}
        >
          <header className="appointment-history-card__header">
            <strong>{displayServiceName(appointment)}</strong>
            <span className={`status-pill status-pill--${pillStatus}`}>{displayStatus(appointment)}</span>
          </header>
          <p className="appointment-history-card__summary">
            <span>
              {displayDate(appointment.date)}
              {appointment.time ? ` · ${displayTime(appointment.time)}` : ""}
            </span>
            <span>
              {appointment.branchName || "Clinic branch"}
              {appointment.branchStatus === "inactive" ? " (inactive)" : ""}
            </span>
            <span>{visitLabel}</span>
          </p>
          {manage.cancel || manage.reschedule ? (
            <div className="appointment-history-card__actions">
              {manage.reschedule ? (
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
              {manage.cancel ? (
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
          <details className="appointment-history-card__more">
            <summary>View details</summary>
            <dl className="appointment-history-card__details">
              <div>
                <dt>Date</dt>
                <dd>{displayDate(appointment.date)}</dd>
              </div>
              <div>
                <dt>Branch</dt>
                <dd>
                  {appointment.branchName || "Clinic branch"}
                  {appointment.branchStatus === "inactive" ? " (inactive)" : ""}
                </dd>
              </div>
              {appointment.time ? (
                <div>
                  <dt>Time</dt>
                  <dd>{displayTime(appointment.time)}</dd>
                </div>
              ) : null}
              <div className="appointment-history-card__service">
                <dt>Service</dt>
                <dd>{displayServiceName(appointment)}</dd>
              </div>
              <div>
                <dt>Visit type</dt>
                <dd>{visitLabel}</dd>
              </div>
            </dl>
          </details>
        </article>
      );
    };
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
            <div className="appointment-history__groups">
              {current.length ? (
                <details className="appointment-history__group" open>
                  <summary>
                    Current visit <span>{current.length}</span>
                  </summary>
                  <div className="appointment-history__cards">{current.map(renderAppointmentCard)}</div>
                </details>
              ) : null}
              {review.length ? (
                <details className="appointment-history__group" open>
                  <summary>
                    Needs Dentist review <span>{review.length}</span>
                  </summary>
                  <div className="appointment-history__cards">{review.map(renderAppointmentCard)}</div>
                </details>
              ) : null}
              {upcoming.length ? (
                <details className="appointment-history__group" open={!current.length && !review.length}>
                  <summary>
                    Upcoming <span>{upcoming.length}</span>
                  </summary>
                  <div className="appointment-history__cards">{upcoming.map(renderAppointmentCard)}</div>
                </details>
              ) : null}
              {past.length ? (
                <details
                  className="appointment-history__group"
                  open={!current.length && !review.length && !upcoming.length}
                >
                  <summary>
                    Past visits <span>{past.length}</span>
                  </summary>
                  <div className="appointment-history__cards">{past.map(renderAppointmentCard)}</div>
                </details>
              ) : null}
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

  if (!catalog && catalogLoading) return <LoadingState label="Preparing your booking experience" />;

  return (
    <div className="appointments-page">
      <SectionHeading
        eyebrow="Reserve a visit"
        title="Book an Appointment"
        detail="Choose a branch and coverage first. Your selected service will appear later in Appointment History."
      />

      <div className="admin-heading-actions" style={{ marginBottom: "1rem" }}>
        <button type="button" className="button button--secondary" onClick={() => navigate("/appointments")}>
          <ChevronLeft size={16} /> Back to Appointment
        </button>
      </div>

      <div className="booking-progress" aria-label="Appointment booking progress">
        {[
          { id: 1, label: "Branch and Coverage" },
          { id: 2, label: "Service" },
          { id: 3, label: "Schedule" },
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
      {bookingNotice ? (
        <p className="inline-alert" role="status">
          {bookingNotice}
        </p>
      ) : null}

      <form id="patient-booking-form" className="booking-layout" onSubmit={confirmAppointment} noValidate>
        <div className="booking-form">
          <section className={`glass-card booking-section${bookingStep === 1 ? "" : " is-hidden"}`} hidden={bookingStep !== 1}>
            <div className="card-heading">
              <div>
                <span className="eyebrow">01 — Branch and Coverage</span>
                <h2>Select your branch and coverage</h2>
              </div>
              <ShieldCheck className="card-heading__icon" size={21} />
            </div>
            {branchesLoading ? <p className="muted">Loading clinic branches…</p> : null}
            {branchesError ? (
              <p className="inline-alert inline-alert--error" role="alert">
                {branchesError}
              </p>
            ) : null}
            {branchChoices && !branchChoices.legacy && !(branchChoices.branches || []).length ? (
              <p className="inline-alert" role="status">
                No clinic branches are currently available for appointment booking. Please contact the clinic.
              </p>
            ) : null}
            {!branchChoices?.legacy ? (
              <label className="field booking-select-field" style={{ marginBottom: "1rem" }}>
                <span>Select a branch</span>
                <select
                  name="branchId"
                  value={form.branchId}
                  onChange={(event) => changeBranch(event.target.value)}
                  required
                  aria-label="Select a branch"
                >
                  <option value="">Select a branch</option>
                  {(branchChoices?.branches || []).map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.name}
                      {branch.isMain ? " (Main Branch)" : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <div className="coverage-options">
              <label className={`coverage-option ${form.coverageType === "self_pay" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="coverageType"
                  value="self_pay"
                  checked={form.coverageType === "self_pay"}
                  onChange={(event) => changeCoverage(event.target.value)}
                />
                <span>
                  <strong>Without HMO / Self-paying</strong>
                  <small>Continue without an HMO provider. Pay at the clinic after your visit.</small>
                </span>
              </label>
              <label className={`coverage-option ${form.coverageType === "hmo" ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="coverageType"
                  value="hmo"
                  checked={form.coverageType === "hmo"}
                  onChange={(event) => changeCoverage(event.target.value)}
                />
                <span>
                  <strong>With HMO</strong>
                  <small>Selecting an HMO does not verify coverage. Clinic staff still verify your plan and benefits.</small>
                </span>
              </label>
            </div>
            {form.coverageType === "hmo" ? (
              <div className="hmo-fields">
                {savedProfileHmo ? (
                  <p className="muted booking-hmo-note" role="status">
                    Using HMO details saved on your profile: {savedProfileHmo.hmoProvider}
                    {form.hmoProvider ? `. Current selection: ${form.hmoProvider}.` : "."} Staff still verify eligibility.
                  </p>
                ) : null}
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
                      <option value="">Select HMO provider</option>
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
            <div className="booking-step-actions">
              <button type="button" className="button button--primary" onClick={continueBooking}>
                Continue to services <ChevronRight size={18} />
              </button>
            </div>
          </section>

          <section className={`glass-card booking-section${bookingStep === 2 ? "" : " is-hidden"}`} hidden={bookingStep !== 2}>
            <div className="card-heading">
              <div>
                <span className="eyebrow">02 — Services</span>
                <h2>Select up to three services</h2>
                <p className="muted booking-service-count" role="status">
                  {selectedIds.length}/{MAX_BOOKING_SERVICES} selected
                  {selectedDurationMinutes ? ` · ${selectedDurationMinutes} minutes total` : ""}
                </p>
              </div>
              <button type="button" className="button button--secondary button--compact" onClick={load} disabled={catalogLoading}>
                {catalogLoading ? "Loading…" : "Retry"}
              </button>
            </div>
            {!canViewServices ? (
              <p className="muted booking-services-gate" role="status">
                Select your branch and coverage option to view services.
              </p>
            ) : catalogLoading ? (
              <p className="muted">Loading services…</p>
            ) : catalogError ? (
              <div className="booking-services-empty">
                <p className="inline-alert inline-alert--error" role="alert">
                  {catalogError}
                </p>
                <button type="button" className="button button--secondary" onClick={load}>
                  Retry
                </button>
              </div>
            ) : !bookableServices.length ? (
              <p className="muted" role="status">
                No bookable services are available for this selection.
              </p>
            ) : (
              <div className="treatment-grid" role="group" aria-label="Select up to three services">
                {bookableServices.map((service) => {
                  const meta = serviceCardMeta(service);
                  const selected = selectedIds.includes(service.id);
                  return (
                    <TreatmentServiceOption
                      key={service.id}
                      service={service}
                      selected={selected}
                      disabled={!selected && selectedIds.length >= MAX_BOOKING_SERVICES}
                      description={meta.description}
                      priceLabel={meta.priceLabel}
                      onSelect={() => toggleService(service.id)}
                    />
                  );
                })}
              </div>
            )}
            <ServicePriceDetails
              price={selectedServicePrice}
              open={detailsOpen && bookingStep === 2 && canViewServices}
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
              <button type="button" className="button button--secondary" onClick={() => goToBookingStep(1)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button type="button" className="button button--primary" onClick={continueBooking} disabled={!canViewServices}>
                Continue to schedule <ChevronRight size={18} />
              </button>
            </div>
          </section>

          <section
            className={`glass-card booking-section booking-section--schedule${bookingStep === 3 ? "" : " is-hidden"}`}
            hidden={bookingStep !== 3}
          >
            <div className="card-heading">
              <div>
                <span className="eyebrow">03 — Schedule</span>
                <h2>Choose your schedule</h2>
              </div>
              <CalendarDays className="card-heading__icon" size={21} />
            </div>
            {dependents.length && !actingAs ? (
              <label className="field booking-section__patient">
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
            <div className="schedule-cluster">
              <label className="field schedule-cluster__date">
                <span>Appointment date</span>
                <input
                  type="date"
                  name="appointmentDate"
                  min={tomorrow()}
                  value={form.appointmentDate}
                  onChange={updateForm}
                  required
                />
              </label>
              {availability && !availability.closed && availability.hours ? (
                <div className="schedule-info-badges" role="status">
                  <span className="schedule-info-badge">
                    Clinic hours {displayTime(availability.hours.open)} – {displayTime(availability.hours.close)}
                  </span>
                  {selectedDurationMinutes ? (
                    <span className="schedule-info-badge">
                      {selectedDurationMinutes} min
                      {slotsNeeded
                        ? ` · ${slotsNeeded} consecutive slot${slotsNeeded === 1 ? "" : "s"}`
                        : ""}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {availabilityLoading ? (
              <p className="schedule-status" role="status">
                Loading available times…
              </p>
            ) : null}
            {availabilityError ? (
              <p className="inline-alert inline-alert--error" role="alert">
                {availabilityError}
              </p>
            ) : null}
            {availability?.closed ? (
              <p className="inline-alert" role="status">
                This date is unavailable. The clinic is closed on {displayDate(form.appointmentDate)}.
              </p>
            ) : null}
            {!availabilityLoading && availability && !availability.closed ? (
              <div className="schedule-time-panel">
                <p className="schedule-time-label">Available times</p>
                {schedulePeriods.length ? (
                  <div className="time-filter-row">
                    {schedulePeriods.map((period) => (
                      <button
                        type="button"
                        key={period}
                        className={`filter-pill ${timePeriod === period ? "is-active" : ""}`}
                        aria-pressed={timePeriod === period}
                        onClick={() => setTimePeriod(period)}
                      >
                        {period}
                      </button>
                    ))}
                  </div>
                ) : null}
                {periodSlots.length ? (
                  <div className="time-slots" role="group" aria-label="Available appointment times">
                    {periodSlots.map((slot) => (
                      <button
                        type="button"
                        key={slot.time}
                        className={`time-slot ${form.appointmentTime === slot.time ? "is-selected" : ""}`}
                        aria-pressed={form.appointmentTime === slot.time}
                        onClick={() => setForm((current) => ({ ...current, appointmentTime: slot.time }))}
                      >
                        <Clock3 size={15} /> {displayTime(slot.time)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="schedule-status" role="status">
                    {bookableSlots.length
                      ? `No available ${timePeriod.toLowerCase()} slots on this date.`
                      : "No available slots on this date. Choose another date."}
                  </p>
                )}
                {bookableSlots.length && !form.appointmentTime ? (
                  <p className="schedule-status" role="status">
                    Select an available time to continue.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          <section
            className={`glass-card booking-section booking-section--notes${bookingStep === 3 ? "" : " is-hidden"}`}
            hidden={bookingStep !== 3}
          >
            <details className="booking-optional-panel" open>
              <summary>
                <span className="eyebrow">Optional</span>
                <strong>Notes for your care team</strong>
              </summary>
              <label className="field booking-section__notes">
                <span className="sr-only">Anything your care team should know?</span>
                <textarea
                  name="notes"
                  rows="3"
                  value={form.notes}
                  onChange={updateForm}
                  placeholder="Share accessibility needs, concerns, or preferences."
                />
              </label>
            </details>

            <details className="booking-optional-panel" open>
              <summary>
                <span className="eyebrow">Optional</span>
                <strong>Dental documents</strong>
              </summary>
              <section className="booking-medical-docs">
                <p>
                  Upload a supporting file for your dentist if you already have one. PDF, JPG, or PNG — up to 5 MB.
                </p>
                <div className="booking-medical-docs__fields">
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
                    >
                      <option value="">Select a document type</option>
                      {medicalDocumentTypes.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                    </select>
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
                  </label>
                </div>
                <input
                  ref={medicalFileInputRef}
                  className="booking-medical-docs__input"
                  type="file"
                  accept=".pdf,image/jpeg,image/png,.jpg,.jpeg,.png"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    setPendingMedicalFile(file);
                    setMedicalUploadError("");
                    setMedicalUploadSuccess("");
                  }}
                />
                <div className="booking-medical-docs__picker">
                  <button
                    type="button"
                    className="button button--secondary"
                    disabled={medicalUploading}
                    onClick={() => medicalFileInputRef.current?.click()}
                  >
                    <FileText size={16} /> {pendingMedicalFile ? "Change file" : "Choose file"}
                  </button>
                  <button
                    type="button"
                    className="button button--primary"
                    disabled={medicalUploading || !pendingMedicalFile}
                    onClick={() => uploadMedicalDocument(pendingMedicalFile)}
                  >
                    <FileUp size={16} /> {medicalUploading ? "Uploading…" : "Upload"}
                  </button>
                </div>
                {pendingMedicalFile ? (
                  <div className="booking-file-row" role="status">
                    <div>
                      <strong>{pendingMedicalFile.name}</strong>
                      <small>
                        Selected · {fileKindLabel(pendingMedicalFile.name, pendingMedicalFile.type)} ·{" "}
                        {formatFileSize(pendingMedicalFile.size)}
                      </small>
                    </div>
                  </div>
                ) : null}
                {medicalDocument ? (
                  <div className="booking-file-row" role="status">
                    <div>
                      <strong>{medicalDocument.filename || medicalDocument.name}</strong>
                      <small>
                        Uploaded
                        {medicalDocument.name ? ` · ${medicalDocument.name}` : ""} ·{" "}
                        {fileKindLabel(
                          medicalDocument.filename || medicalDocument.name,
                          medicalDocument.mimeType
                        )}{" "}
                        · {formatFileSize(medicalDocument.size)}
                      </small>
                    </div>
                    <div className="booking-file-row__actions">
                      <button type="button" className="button button--secondary button--compact" onClick={viewMedicalDocument}>
                        <Eye size={15} /> View
                      </button>
                      <button type="button" className="button button--secondary button--compact" onClick={removeMedicalDocument}>
                        <X size={15} /> Remove
                      </button>
                    </div>
                  </div>
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
            </details>

            <div className="booking-step-actions booking-step-actions--schedule">
              <button type="button" className="button button--secondary" onClick={() => goToBookingStep(2)}>
                <ChevronLeft size={16} /> Back
              </button>
              <button
                type="button"
                className="button button--primary booking-done"
                onClick={openVisitSummary}
                disabled={!canReviewSchedule}
              >
                Review confirmation <ChevronRight size={18} />
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
                      <span>Services</span>
                      <strong>
                        {selectedServices.length
                          ? `${selectedServices.map((service) => service.name).join(" · ")}${
                              selectedBracesOption ? ` — ${selectedBracesOption.title}` : ""
                            }`
                          : "Select a service"}
                      </strong>
                    </div>
                    {selectedBracesOption ? (
                      <div className="booking-summary__line">
                        <span>Option</span>
                        <strong>{selectedBracesOption.title}</strong>
                      </div>
                    ) : null}
                    <div className="booking-summary__line">
                      <span>Patient</span>
                      <strong>
                        {form.forPatientUserId
                          ? dependents.find((dependent) => String(dependent.dependentUserId) === String(form.forPatientUserId))
                              ?.fullName || "Approved dependent"
                          : user?.fullName || "Account holder"}
                      </strong>
                    </div>
                    <div className="booking-summary__line">
                      <span>Branch</span>
                      <strong>
                        {(branchChoices?.branches || []).find((branch) => String(branch.id) === String(form.branchId))
                          ?.name || availability?.branch?.name || "Clinic branch"}
                      </strong>
                    </div>
                    <div className="booking-summary__line">
                      <span>Date</span>
                      <strong>{form.appointmentDate ? displayDate(form.appointmentDate) : "Choose a date"}</strong>
                    </div>
                    <div className="booking-summary__line">
                      <span>Appointment time</span>
                      <strong>{form.appointmentTime ? displayTime(form.appointmentTime) : "Select a time"}</strong>
                    </div>
                    <div className="booking-summary__line">
                      <span>Status</span>
                      <strong>Pending</strong>
                    </div>
                    <div className="booking-summary__line">
                      <span>Coverage</span>
                      <strong>
                        {form.coverageType === "hmo"
                          ? form.hmoProvider
                            ? `HMO selected · ${form.hmoProvider} (not verified)`
                            : "HMO selected (not verified)"
                          : form.coverageType === "self_pay"
                            ? "Without HMO / Self-paying"
                            : "Select coverage"}
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
                  <p>All selected services are saved on one appointment and shown in Appointment History.</p>
                </aside>
              </div>,
              document.body
            )
          : null}
      </form>
    </div>
  );
}
