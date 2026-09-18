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

  async function saveStaffManaged(event) {
    event.preventDefault();
    if (!detail?.id) return;
    setBusy("staff-managed");
    try {
      await api.updateStaffPatient(detail.id, {
        nextAppointmentDate: nextApptDate || null,
        nextAppointmentTime: nextApptTime || null,
      });

      const treatments = detail.treatments || [];
      for (const treatment of treatments) {
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

      pushToast("Amount paid and next appointment saved to the shared dental record.");
      const refreshed = await api.getStaffPatient(detail.id);
      setDetail(refreshed.patient);
      seedStaffManagedFields(refreshed.patient);
      await load();
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

  const latestTreatment = detail?.treatments?.[0] || null;

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
        <StaffModal title="Shared patient dental record" onClose={() => setDetail(null)} wide>
          <div className="staff-detail-grid">
            <p>
              <small>Record type</small>
              <strong>
                <StaffStatusBadge status={recordStatus(detail)} />
              </strong>
            </p>
            <p>
              <small>Record code</small>
              <strong>{detail.recordCode || detail.id}</strong>
            </p>
            <p>
              <small>Patient ID</small>
              <strong>{detail.patientId || detail.recordCode || detail.id}</strong>
            </p>
          </div>

          <h3 className="admin-subheading">Patient Information</h3>
          <p className="muted-copy">
            {detail.profileLocked || detail.accountLinked || detail.linkedUserId
              ? "Synced from the patient account profile (read-only). Admin verifies accounts."
              : "Walk-in clinical record (no login account). Profile fields are not editable by Staff."}
          </p>
          <div className="staff-detail-grid">
            <p>
              <small>Name</small>
              <strong>{detail.fullName || detail.patientName}</strong>
            </p>
            <p>
              <small>Sex</small>
              <strong>{detail.gender || detail.profile?.gender || "—"}</strong>
            </p>
            <p>
              <small>Age</small>
              <strong>{detail.age != null && detail.age !== "" ? detail.age : "—"}</strong>
            </p>
            <p>
              <small>Birthdate</small>
              <strong>{formatBirthdate(detail)}</strong>
            </p>
            <p>
              <small>Phone</small>
              <strong>{detail.phone || "—"}</strong>
            </p>
            <p>
              <small>Email</small>
              <strong>{detail.email || "—"}</strong>
            </p>
          </div>

          <h3 className="admin-subheading">Dental Record</h3>
          <p className="muted-copy">
            Read-only clinical fields from the dentist. Staff cannot edit diagnosis, treatment, or
            chart status.
          </p>
          {latestTreatment ? (
            <div className="staff-detail-grid">
              <p>
                <small>Diagnosis</small>
                <strong>
                  {latestTreatment.diagnosis || latestTreatment.diagnosisNotes || "—"}
                </strong>
              </p>
              <p>
                <small>Treatment</small>
                <strong>{latestTreatment.treatment || latestTreatment.name || "—"}</strong>
              </p>
              <p>
                <small>Affected Tooth</small>
                <strong>{latestTreatment.toothNumber || "—"}</strong>
              </p>
              <p>
                <small>Treatment Date</small>
                <strong>
                  {formatStaffDate(latestTreatment.date || latestTreatment.treatmentDate)}
                </strong>
              </p>
            </div>
          ) : (
            <p className="muted-copy">No dental treatments on file yet.</p>
          )}

          <div style={{ marginTop: "1rem" }}>
            <DentalChart
              patientId={detail.id}
              patientCategory={detail.patientCategory}
              patientAge={detail.age}
              readOnly
              loadChartApi={api.getStaffDentalChart}
            />
          </div>

          {(detail.treatments || []).length > 1 ? (
            <div className="staff-table-wrap" style={{ marginTop: "1rem" }}>
              <table className="staff-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Tooth</th>
                    <th>Procedure</th>
                    <th>Diagnosis</th>
                    <th>Dentist</th>
                    <th>Cost</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.treatments.map((treatment) => (
                    <tr key={treatment.id}>
                      <td>{formatStaffDate(treatment.date || treatment.treatmentDate)}</td>
                      <td>{treatment.toothNumber ? `#${treatment.toothNumber}` : "—"}</td>
                      <td>{treatment.treatment || treatment.name || "—"}</td>
                      <td>{treatment.diagnosis || treatment.diagnosisNotes || "—"}</td>
                      <td>{treatment.dentist || "—"}</td>
                      <td>{formatMoney(treatment.amountCharged)}</td>
                      <td>{treatment.paymentStatus || treatment.status || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <form className="admin-form" onSubmit={saveStaffManaged} style={{ marginTop: "1.25rem" }}>
            <h3 className="admin-subheading">Staff Information</h3>
            <p className="muted-copy">Only Amount Paid and Appointment are editable by Staff.</p>

            {(detail.treatments || []).length ? (
              <div className="staff-table-wrap" style={{ marginBottom: "1rem" }}>
                <table className="staff-table">
                  <thead>
                    <tr>
                      <th>Treatment</th>
                      <th>Cost</th>
                      <th>Amount Paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.treatments.map((treatment) => (
                      <tr key={`pay-${treatment.id}`}>
                        <td>{treatment.treatment || treatment.name || "—"}</td>
                        <td>{formatMoney(treatment.amountCharged)}</td>
                        <td>
                          <label className="field" style={{ margin: 0 }}>
                            <span className="sr-only">Amount paid</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.35rem" }}>
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
                                style={{ width: "7rem" }}
                              />
                            </span>
                          </label>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="muted-copy">Add a dentist treatment first before recording amount paid.</p>
            )}

            <div className="field-grid field-grid--two">
              <label className="field">
                <span>Appointment date</span>
                <input
                  type="date"
                  value={nextApptDate}
                  onChange={(event) => setNextApptDate(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Appointment time</span>
                <input
                  type="time"
                  value={nextApptTime}
                  onChange={(event) => setNextApptTime(event.target.value)}
                />
              </label>
            </div>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "staff-managed" ? "Saving…" : "Save Changes"}
            </button>
          </form>

          <div className="staff-heading-actions" style={{ marginTop: "1rem" }}>
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
