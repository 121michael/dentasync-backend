import { useCallback, useEffect, useState } from "react";
import { Plus, Search, Eye } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { DentalChart } from "../components/DentalChart";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDate } from "../staffUtils";

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

function formatBirthdate(patient) {
  const value = patient?.dateOfBirth || patient?.profile?.date_of_birth;
  if (!value) return "—";
  return formatStaffDate(value);
}

function recordStatus(patient) {
  if (patient?.accountLinked || patient?.linkedUserId || patient?.accountStatus === "linked_account") {
    return "linked_account";
  }
  return "clinical_record";
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
        >
          <div className="staff-patient-record">
            <section className="staff-record-section staff-record-section--patient">
              <div className="staff-record-section__heading">
                <div>
                  <span className="eyebrow">Shared patient record</span>
                  <h2>Patient Information</h2>
                </div>
                <StaffStatusBadge status={recordStatus(detail)} />
              </div>
              <p className="muted-copy">
                {detail.profileLocked || detail.accountLinked || detail.linkedUserId
                  ? "Synced from the patient account profile. Basic information is read-only for Staff."
                  : "Walk-in clinical record. Basic information remains read-only for Staff."}
              </p>
              <div className="staff-record-info-grid">
                <p>
                  <small>Patient ID</small>
                  <strong>{detail.patientId || detail.recordCode || detail.id}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Patient Name</small>
                  <strong>{detail.fullName || detail.patientName}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Sex</small>
                  <strong>{detail.gender || detail.profile?.gender || "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Age</small>
                  <strong>{detail.age != null && detail.age !== "" ? detail.age : "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Birthdate</small>
                  <strong>{formatBirthdate(detail)}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Phone Number</small>
                  <strong>{detail.phone || "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Email</small>
                  <strong>{detail.email || "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Patient Category</small>
                  <strong>{detail.patientCategory || "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Address</small>
                  <strong>{detail.address || detail.profile?.address || "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Emergency Contact</small>
                  <strong>{detail.emergencyContact || "—"}</strong>
                  <span>Read only</span>
                </p>
                <p>
                  <small>Record Code</small>
                  <strong>{detail.recordCode || detail.id}</strong>
                  <span>Read only</span>
                </p>
              </div>
            </section>

            <section className="staff-record-section">
              <div className="staff-record-section__heading">
                <div>
                  <span className="eyebrow">Treatment-driven odontogram</span>
                  <h2>Dental Chart</h2>
                </div>
                <span className="staff-readonly-badge">Read only</span>
              </div>
              <p className="muted-copy">
                The same chart used by the Dentist Portal. Staff can inspect treatment status but
                cannot select teeth or modify clinical chart data.
              </p>
            <DentalChart
              patientId={detail.id}
              patientCategory={detail.patientCategory}
              patientAge={detail.age}
              readOnly
              loadChartApi={api.getStaffDentalChart}
            />
            </section>

            <section className="staff-record-section treatment-record treatment-record--readonly">
              <div className="staff-record-section__heading treatment-record__header">
                <div>
                  <span className="eyebrow">Shared patient dental record</span>
                  <h2>Dental Treatment History</h2>
                </div>
                <span className="staff-readonly-badge">Clinical fields read only</span>
              </div>
              <p className="muted-copy">
                Complete dentist-recorded history. Staff may view diagnosis, treatment and affected
                teeth but cannot add, edit or delete clinical entries.
              </p>
              <div className="treatment-record__table-wrap">
                {treatments.length ? (
                  <table className="treatment-record__table">
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Tooth</th>
                        <th>Treatment</th>
                        <th>Diagnosis</th>
                        <th>Dentist</th>
                        <th>Amount Charged</th>
                        <th>Amount Paid</th>
                        <th>Balance</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {treatments.map((treatment) => (
                        <tr key={treatment.id}>
                          <td>{formatStaffDate(treatment.date || treatment.treatmentDate)}</td>
                          <td>{treatment.toothNumber ? `#${treatment.toothNumber}` : "—"}</td>
                          <td>{treatment.treatment || treatment.name || "—"}</td>
                          <td>{treatment.diagnosis || treatment.diagnosisNotes || "—"}</td>
                          <td>{treatment.dentist || "—"}</td>
                          <td>{formatMoney(treatment.amountCharged)}</td>
                          <td>{formatMoney(treatment.amountPaid)}</td>
                          <td>{formatMoney(treatment.balance)}</td>
                          <td>
                            <StaffStatusBadge status={treatment.status || "completed"} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted-copy staff-record-empty">
                    No dental treatments on file yet.
                  </p>
                )}
              </div>
            </section>

            <div className="staff-record-operations">
              <section className="staff-record-section staff-record-section--editable">
                <div className="staff-record-section__heading">
                  <div>
                    <span className="eyebrow">Staff-managed</span>
                    <h2>Appointment</h2>
                  </div>
                  <span className="staff-editable-badge">Editable</span>
                </div>

                <div className="staff-operational-summary">
                  <div>
                    <small>Current Appointment</small>
                    <strong>
                      {appointmentDate(currentAppointment)
                        ? formatStaffDate(appointmentDate(currentAppointment))
                        : "No current appointment"}
                    </strong>
                    <span>{formatAppointmentTime(appointmentTime(currentAppointment))}</span>
                    {currentAppointment?.status ? (
                      <StaffStatusBadge status={currentAppointment.status} />
                    ) : null}
                  </div>
                  <div>
                    <small>Next Appointment</small>
                    <strong>
                      {detail.nextAppointmentDate
                        ? formatStaffDate(detail.nextAppointmentDate)
                        : "Not scheduled"}
                    </strong>
                    <span>{formatAppointmentTime(detail.nextAppointmentTime)}</span>
                  </div>
                </div>

                <form className="admin-form staff-record-form" onSubmit={saveAppointment}>
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
                  <button className="button button--primary" disabled={Boolean(busy)}>
                    {busy === "appointment" ? "Saving Appointment…" : "Save Appointment"}
                  </button>
                </form>
              </section>

              <section className="staff-record-section staff-record-section--editable">
                <div className="staff-record-section__heading">
                  <div>
                    <span className="eyebrow">Staff-managed</span>
                    <h2>Payment</h2>
                  </div>
                  <span className="staff-editable-badge">Amount paid editable</span>
                </div>

                <div className="staff-payment-summary">
                  <p>
                    <small>Treatment Cost</small>
                    <strong>{formatMoney(totalCharged)}</strong>
                  </p>
                  <p>
                    <small>Amount Paid</small>
                    <strong>{formatMoney(totalPaid)}</strong>
                  </p>
                  <p>
                    <small>Balance</small>
                    <strong>{formatMoney(totalBalance)}</strong>
                  </p>
                  <p>
                    <small>Payment Status</small>
                    <StaffStatusBadge status={paymentStatus(totalCharged, totalPaid)} />
                  </p>
                </div>

                <form className="admin-form staff-record-form" onSubmit={savePayments}>
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
                    <p className="muted-copy">
                      A dentist treatment is required before recording a payment.
                    </p>
                  )}
                  <button
                    className="button button--primary"
                    disabled={Boolean(busy) || !treatments.length}
                  >
                    {busy === "payment" ? "Saving Payment…" : "Save Payment"}
                  </button>
                </form>
              </section>
            </div>

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
          </div>
        </StaffModal>
      ) : null}
    </div>
  );
}
