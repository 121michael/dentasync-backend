import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Search, Eye } from "lucide-react";
import { api } from "../api";
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

export function StaffPatientsPage() {
  const { pushToast, confirm } = useStaffUi();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [patients, setPatients] = useState(null);
  const [detail, setDetail] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

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

  async function openDetail(patientId) {
    setBusy(`view-${patientId}`);
    try {
      const response = await api.getStaffPatient(patientId);
      setDetail(response.patient);
    } catch (viewError) {
      pushToast(viewError.message, "error");
    } finally {
      setBusy("");
    }
  }

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(patient) {
    setEditingId(patient.id);
    setForm({
      firstName: patient.firstName || "",
      lastName: patient.lastName || "",
      email: patient.email || "",
      phone: patient.phone || "",
      dateOfBirth: patient.dateOfBirth ? String(patient.dateOfBirth).slice(0, 10) : "",
      gender: patient.gender || "",
      address: patient.address || "",
      emergencyContact: "",
      medicalDentalNotes: patient.notes || "",
    });
    setFormOpen(true);
  }

  async function savePatient(event) {
    event.preventDefault();
    setBusy("save");
    try {
      if (editingId) {
        await api.updateStaffPatient(editingId, form);
        pushToast("Patient information updated.");
      } else {
        await api.createStaffPatient(form);
        pushToast("Patient record created.");
      }
      setFormOpen(false);
      setForm(emptyForm);
      setEditingId(null);
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

  async function verifyPatient(patient, status = "verified") {
    setBusy(`verify-${patient.id}`);
    try {
      const response = await api.verifyStaffPatient(patient.id, { status });
      pushToast(response.message || "Patient verification updated.");
      setDetail(response.patient);
      await load();
    } catch (verifyError) {
      pushToast(verifyError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !patients) return <ErrorState message={error} onRetry={load} />;
  if (!patients) return <LoadingState label="Loading patient records…" />;

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Clinical registry</span>
            <h2>Patient Records</h2>
            <p>Maintain patient information and assist with registration. Permanent system deletion remains admin-only.</p>
          </div>
          <button className="button button--primary" onClick={openCreate}>
            <Plus size={16} /> Register Patient
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
                  <th>Patient ID</th>
                  <th>Full Name</th>
                  <th>Contact</th>
                  <th>Age / Sex</th>
                  <th>Last Appointment</th>
                  <th>Assigned Dentist</th>
                  <th>Record Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td>
                      <code>{patient.recordCode || patient.id}</code>
                    </td>
                    <td>
                      <strong>{patient.fullName || patient.patientName}</strong>
                    </td>
                    <td>{patient.phone || patient.email || "—"}</td>
                    <td>{[patient.age ?? "—", patient.gender || "—"].join(" / ")}</td>
                    <td>{patient.lastVisit ? formatStaffDate(patient.lastVisit) : "—"}</td>
                    <td>—</td>
                    <td>
                      <StaffStatusBadge
                        status={patient.staffVerificationStatus || patient.accountStatus || "clinical_record"}
                      />
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
                        <button
                          className="button button--secondary button--compact"
                          onClick={() => openEdit(patient)}
                          disabled={Boolean(busy)}
                        >
                          <Pencil size={14} /> Edit
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No patient records found" detail="Add a clinical patient record or adjust your search." />
        )}
      </section>

      {formOpen ? (
        <StaffModal title={editingId ? "Edit patient information" : "Add new patient"} onClose={() => setFormOpen(false)} wide>
          <form className="admin-form" onSubmit={savePatient}>
            <div className="field-grid field-grid--two">
              <label className="field"><span>First name</span><input required value={form.firstName} onChange={(e) => setForm((c) => ({ ...c, firstName: e.target.value }))} /></label>
              <label className="field"><span>Last name</span><input required value={form.lastName} onChange={(e) => setForm((c) => ({ ...c, lastName: e.target.value }))} /></label>
              <label className="field"><span>Email</span><input type="email" value={form.email} onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))} /></label>
              <label className="field"><span>Phone</span><input value={form.phone} onChange={(e) => setForm((c) => ({ ...c, phone: e.target.value }))} /></label>
              <label className="field"><span>Date of birth</span><input type="date" value={form.dateOfBirth} onChange={(e) => setForm((c) => ({ ...c, dateOfBirth: e.target.value }))} /></label>
              <label className="field"><span>Sex / Gender</span><input value={form.gender} onChange={(e) => setForm((c) => ({ ...c, gender: e.target.value }))} /></label>
              <label className="field field--full"><span>Address</span><input value={form.address} onChange={(e) => setForm((c) => ({ ...c, address: e.target.value }))} /></label>
              <label className="field field--full"><span>Notes</span><textarea rows="3" value={form.medicalDentalNotes} onChange={(e) => setForm((c) => ({ ...c, medicalDentalNotes: e.target.value }))} /></label>
            </div>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "save" ? "Saving…" : "Save patient"}
            </button>
          </form>
        </StaffModal>
      ) : null}

      {detail ? (
        <StaffModal title="Patient profile" onClose={() => setDetail(null)} wide>
          <div className="staff-detail-grid">
            <p><small>Name</small><strong>{detail.fullName || detail.patientName}</strong></p>
            <p><small>Record code</small><strong>{detail.recordCode || detail.id}</strong></p>
            <p><small>Contact</small><strong>{detail.phone || detail.email || "—"}</strong></p>
            <p><small>Gender</small><strong>{detail.gender || detail.profile?.gender || "—"}</strong></p>
            <p><small>Birth date</small><strong>{detail.dateOfBirth || detail.profile?.date_of_birth || "—"}</strong></p>
            <p><small>Status</small><strong>{detail.accountStatus}</strong></p>
            <p>
              <small>Verification</small>
              <strong>
                <StaffStatusBadge status={detail.staffVerificationStatus || "pending"} />
              </strong>
            </p>
          </div>
          <h3 className="admin-subheading">Treatment history</h3>
          <div className="admin-history-list">
            {(detail.treatments || []).length ? (
              detail.treatments.map((treatment) => (
                <article key={treatment.id}>
                  <div>
                    <strong>{treatment.treatment}</strong>
                    <small>
                      {formatStaffDate(treatment.date)} · {treatment.dentist || "—"} · {treatment.status}
                    </small>
                  </div>
                </article>
              ))
            ) : (
              <p className="muted-copy">No treatments on file.</p>
            )}
          </div>
          <div className="staff-heading-actions">
            {detail.staffVerificationStatus !== "verified" ? (
              <button
                className="button button--primary"
                onClick={() => verifyPatient(detail, "verified")}
                disabled={Boolean(busy)}
              >
                Verify Patient
              </button>
            ) : null}
            {detail.staffVerificationStatus !== "rejected" ? (
              <button
                className="button button--secondary"
                onClick={() => verifyPatient(detail, "rejected")}
                disabled={Boolean(busy)}
              >
                Reject verification
              </button>
            ) : null}
            <button className="button button--secondary" onClick={() => openEdit(detail)}>
              Edit information
            </button>
            <button className="button button--danger" onClick={() => archivePatient(detail)} disabled={Boolean(busy)}>
              Archive record
            </button>
          </div>
        </StaffModal>
      ) : null}
    </div>
  );
}
