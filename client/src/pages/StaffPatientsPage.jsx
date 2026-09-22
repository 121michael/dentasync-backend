import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Eye } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DentalChart } from "../components/DentalChart";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDate } from "../staffUtils";
import { formatDentistDate } from "../dentistUtils";

const emptyForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  dateOfBirth: "",
  gender: "",
  address: "",
  emergencyContact: "",
  medicalDentalNotes: "",
};

function formatMoney(value) {
  return `₱${Number(value || 0).toFixed(2)}`;
}

function formatAgeSex(patient) {
  if (patient?.ageSex) return patient.ageSex;
  const age = patient?.age != null && patient.age !== "" ? patient.age : "—";
  const sex = patient?.gender || patient?.profile?.gender || "—";
  return `${age} / ${sex}`;
}

function isProfileLocked(patient) {
  return Boolean(patient?.profileLocked || patient?.accountLinked || patient?.linkedUserId);
}

function recordStatus(patient) {
  if (patient?.accountLinked || patient?.linkedUserId || patient?.accountStatus === "linked_account") {
    return "linked_account";
  }
  return "clinical_record";
}

function treatmentBalance(treatment) {
  if (treatment?.balance != null && Number.isFinite(Number(treatment.balance))) {
    return Number(treatment.balance);
  }
  return Math.round((Number(treatment?.amountCharged || 0) - Number(treatment?.amountPaid || 0)) * 100) / 100;
}

function nextAppointmentLabel(patient, fallbackAppointment) {
  const next =
    fallbackAppointment ||
    (patient?.nextAppointmentDate
      ? { date: patient.nextAppointmentDate, time: patient.nextAppointmentTime }
      : null);
  if (!next?.date) return "—";
  const dateLabel = formatDentistDate(next.date);
  const time = next.time || next.appointmentTime;
  return time ? `${dateLabel} ${String(time).slice(0, 5)}` : dateLabel;
}

function appointmentDate(appointment) {
  return appointment?.date || appointment?.appointmentDate || appointment?.appointment_date || null;
}

function appointmentTime(appointment) {
  return appointment?.time || appointment?.appointmentTime || appointment?.appointment_time || "";
}

function formatAppointmentTime(value) {
  if (!value) return "—";
  const match = String(value).match(/^(\d{1,2}):(\d{2})/);
  if (!match) return String(value);
  const hours = Number(match[1]);
  const minutes = match[2];
  return `${hours % 12 || 12}:${minutes} ${hours >= 12 ? "PM" : "AM"}`;
}

function paymentStatus(amountCharged, amountPaid) {
  if (amountPaid <= 0) return "pending";
  if (amountPaid >= amountCharged) return "paid";
  return "partially_paid";
}

export function StaffPatientsPage() {
  const { pushToast, confirm } = useStaffUi();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [patients, setPatients] = useState(null);
  const [detail, setDetail] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [paymentDrafts, setPaymentDrafts] = useState({});
  const [nextApptDate, setNextApptDate] = useState("");
  const [nextApptTime, setNextApptTime] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffPatients(applied);
      setPatients(response.patients || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const focusId = searchParams.get("focus");
    if (!focusId) return;
    (async () => {
      try {
        const response = await api.getStaffPatient(focusId);
        if (response?.patient) {
          setDetail(response.patient);
          seedStaffManagedFields(response.patient);
        }
      } catch (viewError) {
        pushToast(viewError.message, "error");
      } finally {
        const next = new URLSearchParams(searchParams);
        next.delete("focus");
        setSearchParams(next, { replace: true });
      }
    })();
  }, [searchParams, setSearchParams, pushToast]);

  function seedStaffManagedFields(patient) {
    const drafts = {};
    for (const treatment of patient.treatments || []) {
      drafts[treatment.id] = String(treatment.amountPaid ?? "");
    }
    setPaymentDrafts(drafts);
    setNextApptDate(
      patient.nextAppointmentDate ? String(patient.nextAppointmentDate).slice(0, 10) : ""
    );
    setNextApptTime(
      patient.nextAppointmentTime ? String(patient.nextAppointmentTime).slice(0, 5) : ""
    );
  }

  async function openDetail(patientId) {
    setBusy(`view-${patientId}`);
    try {
      const response = await api.getStaffPatient(patientId);
      setDetail(response.patient);
      seedStaffManagedFields(response.patient);
    } catch (viewError) {
      pushToast(viewError.message, "error");
    } finally {
      setBusy("");
    }
  }

  function openCreate() {
    setForm(emptyForm);
    setFormOpen(true);
  }

  async function savePatient(event) {
    event.preventDefault();
    setBusy("save");
    try {
      await api.createStaffPatient(form);
      pushToast("Walk-in patient record created (no login account).");
      setFormOpen(false);
      setForm(emptyForm);
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function refreshDetail() {
    const refreshed = await api.getStaffPatient(detail.id);
    setDetail(refreshed.patient);
    seedStaffManagedFields(refreshed.patient);
    await load();
  }

  async function saveAppointment(event) {
    event.preventDefault();
    if (!detail?.id) return;
    setBusy("appointment");
    try {
      await api.updateStaffPatient(detail.id, {
        nextAppointmentDate: nextApptDate || null,
        nextAppointmentTime: nextApptTime || null,
      });
      pushToast("Appointment saved to the shared patient record.");
      await refreshDetail();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function savePayments(event) {
    event.preventDefault();
    if (!detail?.id) return;
    setBusy("payment");
    try {
      for (const treatment of detail.treatments || []) {
        const draft = paymentDrafts[treatment.id];
        if (draft === undefined || draft === "") continue;
        const nextPaid = Number(draft);
        if (!Number.isFinite(nextPaid) || nextPaid < 0) {
          throw new Error(`Amount paid for ${treatment.treatment || "treatment"} must be a valid amount.`);
        }
        if (Number(treatment.amountPaid || 0) === nextPaid) continue;
        await api.updateStaffPatientTreatmentPayment(detail.id, treatment.id, {
          amountPaid: nextPaid,
        });
      }
      pushToast("Amount paid saved to the shared patient record.");
      await refreshDetail();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function archivePatient(patient) {
    const ok = await confirm({
      title: "Archive patient record",
      message: `Archive clinical record for ${patient.fullName || patient.patientName}? This does not permanently delete protected system data.`,
      confirmLabel: "Archive",
    });
    if (!ok) return;
    setBusy(`archive-${patient.id}`);
    try {
      await api.deleteStaffPatient(patient.id);
      pushToast("Patient record archived.");
      setDetail(null);
      await load();
    } catch (archiveError) {
      pushToast(archiveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !patients) return <ErrorState message={error} onRetry={load} />;
  if (!patients) return <LoadingState label="Loading patient records…" />;

  const treatments = detail?.treatments || [];
  const totalCharged = treatments.reduce(
    (sum, treatment) => sum + Number(treatment.amountCharged || 0),
    0
  );
  const totalPaid = treatments.reduce(
    (sum, treatment) => sum + Number(treatment.amountPaid || 0),
    0
  );
  const totalBalance = Math.max(0, totalCharged - totalPaid);
  const currentAppointment =
    (detail?.appointments || []).find((appointment) =>
      ["confirmed", "scheduled", "checked_in", "waiting", "preparing", "dentist"].includes(
        String(appointment.status || "").toLowerCase()
      )
    ) ||
    detail?.appointments?.[0] ||
    null;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Clinical registry</span>
            <h2>Patient Records</h2>
            <p>
              View the same shared dental record the dentist updates. Staff may edit Amount Paid and
              Appointment only. Patient account verification is Admin-only.
            </p>
          </div>
          <button className="button button--primary" onClick={openCreate}>
            <Plus size={16} /> Register Walk-in Patient
          </button>
        </div>

        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search);
          }}
        >
          <label className="admin-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search patient by name, ID, phone, or keyword"
            />
          </label>
          <button className="button button--secondary button--compact">Search</button>
        </form>

        {patients.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Patient</th>
                  <th>Age / Sex</th>
                  <th>Treatment</th>
                  <th>Treatment Date</th>
                  <th>Amount Paid</th>
                  <th>Next Appointment</th>
                  <th>Record Type</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <strong>{patient.fullName || patient.patientName}</strong>
                      <small>
                        <code>{patient.patientId || patient.recordCode || patient.id}</code>
                      </small>
                    </td>
                    <td>{formatAgeSex(patient)}</td>
                    <td>{patient.lastTreatment || "—"}</td>
                    <td>
                      {patient.lastTreatmentDate || patient.lastVisit
                        ? formatStaffDate(patient.lastTreatmentDate || patient.lastVisit)
                        : "—"}
                    </td>
                    <td>
                      {patient.amountPaid != null && patient.amountPaid !== ""
                        ? formatMoney(patient.amountPaid)
                        : "—"}
                    </td>
                    <td>
                      {patient.nextAppointmentDate
                        ? `${formatStaffDate(patient.nextAppointmentDate)}${
                            patient.nextAppointmentTime
                              ? ` ${String(patient.nextAppointmentTime).slice(0, 5)}`
                              : ""
                          }`
                        : "—"}
                    </td>
                    <td>
                      <StaffStatusBadge status={recordStatus(patient)} />
                    </td>
                    <td>
                      <div className="staff-row-actions">
                        <button
                          className="button button--secondary button--compact"
                          onClick={() => openDetail(patient.id)}
                          disabled={Boolean(busy)}
                        >
                          <Eye size={14} /> View
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            title="No patient records found"
            detail="Add a walk-in clinical patient record or adjust your search."
          />
        )}
      </section>

      {formOpen ? (
        <StaffModal title="Register walk-in patient (no login account)" onClose={() => setFormOpen(false)} wide>
          <p className="muted-copy">
            Use this for patients without a portal account. Account-linked patients sync Name, Sex,
            Age, Birthdate, and Phone from their verified profile automatically.
          </p>
          <form className="admin-form" onSubmit={savePatient}>
            <div className="field-grid field-grid--two">
              <label className="field">
                <span>First name</span>
                <input
                  required
                  value={form.firstName}
                  onChange={(e) => setForm((c) => ({ ...c, firstName: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Last name</span>
                <input
                  required
                  value={form.lastName}
                  onChange={(e) => setForm((c) => ({ ...c, lastName: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Phone</span>
                <input
                  value={form.phone}
                  onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Date of birth</span>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => setForm((c) => ({ ...c, dateOfBirth: e.target.value }))}
                />
              </label>
              <label className="field">
                <span>Sex / Gender</span>
                <input
                  value={form.gender}
                  onChange={(e) => setForm((c) => ({ ...c, gender: e.target.value }))}
                />
              </label>
              <label className="field field--full">
                <span>Address</span>
                <input
                  value={form.address}
                  onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))}
                />
              </label>
              <label className="field field--full">
                <span>Notes</span>
                <textarea
                  rows="3"
                  value={form.medicalDentalNotes}
                  onChange={(e) => setForm((c) => ({ ...c, medicalDentalNotes: e.target.value }))}
                />
              </label>
            </div>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "save" ? "Saving…" : "Create patient record"}
            </button>
          </form>
        </StaffModal>
      ) : null}

      {detail ? (
        <StaffModal
          title={detail.fullName || detail.patientName || "Patient Record"}
          onClose={() => setDetail(null)}
          wide
          record
        >
          <section className="dentist-patient-info">
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Shared patient record</span>
                <h2>Patient Information</h2>
              </div>
              <StaffStatusBadge status={recordStatus(detail)} />
            </div>
            <div className="dentist-detail-grid">
              <p>
                <strong>Patient ID:</strong> {detail.patientId || detail.recordCode || detail.id}
              </p>
              <p>
                <strong>Name:</strong> {detail.fullName || detail.patientName}
              </p>
              <p>
                <strong>Age:</strong>{" "}
                {detail.age != null && detail.age !== "" ? detail.age : "—"}
              </p>
              <p>
                <strong>Sex:</strong> {detail.gender || detail.profile?.gender || "—"}
              </p>
              <p>
                <strong>Birthdate:</strong>{" "}
                {detail.dateOfBirth || detail.profile?.date_of_birth
                  ? formatDentistDate(detail.dateOfBirth || detail.profile?.date_of_birth)
                  : "—"}
              </p>
              <p>
                <strong>Phone Number:</strong> {detail.phone || "—"}
              </p>
              <p>
                <strong>Email:</strong> {detail.email || "—"}
              </p>
              <p>
                <strong>Category:</strong> {detail.patientCategory || "—"}
              </p>
              <p>
                <strong>Record type:</strong>{" "}
                {isProfileLocked(detail)
                  ? "Linked account (profile synced)"
                  : "Walk-in clinical record"}
              </p>
              <p>
                <strong>Next Appointment:</strong> {nextAppointmentLabel(detail)}
              </p>
            </div>
            <p className="muted-copy">
              {isProfileLocked(detail)
                ? "Patient ID, Name, Age, Sex, Birthdate, and Phone Number are synced from the patient account profile and are read-only here."
                : "Walk-in clinical record. Basic patient information remains read-only for Staff."}
            </p>
          </section>

          <DentalChart
            patientId={detail.id}
            patientCategory={detail.patientCategory}
            patientAge={detail.age}
            readOnly
            loadChartApi={api.getStaffDentalChart}
          />

          {detail.currentVisit?.procedures?.length ? (
            <section className="treatment-record" style={{ marginTop: "1.25rem" }}>
              <div className="treatment-record__header">
                <div>
                  <span className="eyebrow">Current visit</span>
                  <h2>Today&apos;s Procedures</h2>
                </div>
                <span className="staff-readonly-badge">View only</span>
              </div>
              <ol className="visit-procedure-list">
                {detail.currentVisit.procedures.map((procedure, index) => (
                  <li key={procedure.id || index}>
                    <strong>
                      {index + 1}. {procedure.treatment || procedure.name}
                    </strong>
                    <span>Tooth: {procedure.toothNumber ? `#${procedure.toothNumber}` : "—"}</span>
                    <span>
                      Status:{" "}
                      {String(procedure.status || "").toLowerCase() === "planned"
                        ? "Pending"
                        : String(procedure.status || "").replaceAll("_", " ")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}

          <section className="treatment-record" style={{ marginTop: "1.25rem" }}>
            <div className="treatment-record__header">
              <div>
                <span className="eyebrow">Shared patient dental record</span>
                <h2>Dental Treatment History</h2>
              </div>
              <span className="staff-readonly-badge">Clinical fields read only</span>
            </div>
            <p className="muted-copy">
              Amount Paid stays in this table. Staff update payments below; clinical rows are
              dentist-owned.
            </p>
            <div className="treatment-record__table-wrap">
              {treatments.length ? (
                <table className="treatment-record__table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Tooth</th>
                      <th>Procedure</th>
                      <th>Status</th>
                      <th>Diagnosis</th>
                      <th>Dentist</th>
                      <th>Amount Charged</th>
                      <th>Amount Paid</th>
                      <th>Balance</th>
                      <th>Next Appointment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {treatments.map((treatment) => (
                      <tr key={treatment.id}>
                        <td>{formatDentistDate(treatment.date || treatment.treatmentDate)}</td>
                        <td>{treatment.toothNumber ? `#${treatment.toothNumber}` : "—"}</td>
                        <td>{treatment.treatment || treatment.name || "—"}</td>
                        <td>
                          {String(treatment.status || "").toLowerCase() === "planned"
                            ? "Pending"
                            : treatment.status
                              ? String(treatment.status).replaceAll("_", " ")
                              : "—"}
                        </td>
                        <td>{treatment.diagnosis || treatment.diagnosisNotes || "—"}</td>
                        <td>{treatment.dentist || "—"}</td>
                        <td>{formatMoney(treatment.amountCharged)}</td>
                        <td>{formatMoney(treatment.amountPaid)}</td>
                        <td>{formatMoney(treatmentBalance(treatment))}</td>
                        <td>{nextAppointmentLabel(detail, treatment.nextAppointment)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="muted-copy">No treatments on file yet.</p>
              )}
            </div>
          </section>

          <section className="dentist-patient-info" style={{ marginTop: "1.25rem" }}>
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Staff-managed</span>
                <h2>Appointment</h2>
              </div>
              <span className="staff-editable-badge">Editable</span>
            </div>
            <div className="dentist-detail-grid">
              <p>
                <strong>Current Appointment:</strong>{" "}
                {appointmentDate(currentAppointment)
                  ? `${formatDentistDate(appointmentDate(currentAppointment))} ${formatAppointmentTime(appointmentTime(currentAppointment))}`
                  : "No current appointment"}
              </p>
              <p>
                <strong>Next Appointment:</strong> {nextAppointmentLabel(detail)}
              </p>
            </div>
            <form className="dentist-form" onSubmit={saveAppointment}>
              <div className="field-grid field-grid--two">
                <label className="field">
                  <span>Next appointment date</span>
                  <input
                    type="date"
                    value={nextApptDate}
                    onChange={(event) => setNextApptDate(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Next appointment time</span>
                  <input
                    type="time"
                    value={nextApptTime}
                    onChange={(event) => setNextApptTime(event.target.value)}
                  />
                </label>
              </div>
              <div className="dentist-form__actions">
                <button className="button button--primary" disabled={Boolean(busy)}>
                  {busy === "appointment" ? "Saving Appointment…" : "Save Appointment"}
                </button>
              </div>
            </form>
          </section>

          <section className="dentist-patient-info">
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">Staff-managed</span>
                <h2>Payment</h2>
              </div>
              <span className="staff-editable-badge">Amount paid editable</span>
            </div>
            <div className="dentist-detail-grid">
              <p>
                <strong>Treatment Cost:</strong> {formatMoney(totalCharged)}
              </p>
              <p>
                <strong>Amount Paid:</strong> {formatMoney(totalPaid)}
              </p>
              <p>
                <strong>Balance:</strong> {formatMoney(totalBalance)}
              </p>
              <p>
                <strong>Payment Status:</strong>{" "}
                <StaffStatusBadge status={paymentStatus(totalCharged, totalPaid)} />
              </p>
            </div>
            <form className="dentist-form" onSubmit={savePayments}>
              {treatments.length ? (
                <div className="staff-payment-list">
                  {treatments.map((treatment) => (
                    <label className="staff-payment-line" key={`pay-${treatment.id}`}>
                      <span>
                        <strong>{treatment.treatment || treatment.name || "Treatment"}</strong>
                        <small>
                          {treatment.toothNumber ? `Tooth #${treatment.toothNumber} · ` : ""}
                          Cost {formatMoney(treatment.amountCharged)}
                        </small>
                      </span>
                      <span className="staff-money-input">
                        <small>Amount paid</small>
                        <span>
                          ₱
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={paymentDrafts[treatment.id] ?? ""}
                            onChange={(event) =>
                              setPaymentDrafts((current) => ({
                                ...current,
                                [treatment.id]: event.target.value,
                              }))
                            }
                          />
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="muted-copy">A dentist treatment is required before recording a payment.</p>
              )}
              <div className="dentist-form__actions">
                <button
                  className="button button--primary"
                  disabled={Boolean(busy) || !treatments.length}
                >
                  {busy === "payment" ? "Saving Payment…" : "Save Payment"}
                </button>
              </div>
            </form>
          </section>

          <div className="staff-record-footer">
            <p className="muted-copy">
              Clinical data is read-only. Staff controls are limited to appointment and payment.
            </p>
            <button
              className="button button--danger"
              onClick={() => archivePatient(detail)}
              disabled={Boolean(busy)}
            >
              Archive record
            </button>
          </div>
        </StaffModal>
      ) : null}
    </div>
  );
}
