import { useCallback, useEffect, useState } from "react";
import { Eye, Plus, Search, UserPlus } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState, SectionHeading } from "../components/UI";
import { formatStaffDate, formatStaffTime } from "../staffUtils";
import {
  StaffDataTable,
  StaffModal,
  StaffStatusBadge,
} from "../components/StaffUI";

const emptyRegistration = {
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  phone: "",
  email: "",
  address: "",
  emergencyContact: "",
  medicalDentalNotes: "",
};

function ProfileLine({ label, value }) {
  return (
    <div className="staff-profile-line">
      <span>{label}</span>
      <strong>{value || "Not recorded"}</strong>
    </div>
  );
}

export function StaffPatientsPage() {
  const [patientData, setPatientData] = useState(null);
  const [search, setSearch] = useState("");
  const [submittedSearch, setSubmittedSearch] = useState("");
  const [isRegistrationOpen, setIsRegistrationOpen] = useState(false);
  const [registration, setRegistration] = useState(emptyRegistration);
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [isLoadingPatient, setIsLoadingPatient] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await api.getStaffPatients(submittedSearch);
      setPatientData(response);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [submittedSearch]);

  useEffect(() => {
    load();
  }, [load]);

  async function viewPatient(patientId) {
    setIsLoadingPatient(true);
    setSelectedPatient(null);
    setError("");
    try {
      const response = await api.getStaffPatient(patientId);
      setSelectedPatient(response.patient);
    } catch (viewError) {
      setError(viewError.message);
    } finally {
      setIsLoadingPatient(false);
    }
  }

  async function registerPatient(event) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSuccess("");
    try {
      const response = await api.createStaffPatient(registration);
      setSuccess(response.message);
      setRegistration(emptyRegistration);
      setIsRegistrationOpen(false);
      await load();
    } catch (registrationError) {
      setError(registrationError.message);
    } finally {
      setIsSaving(false);
    }
  }

  function updateRegistration(event) {
    setRegistration((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  function closePatientDetails() {
    setSelectedPatient(null);
    setIsLoadingPatient(false);
  }

  if (error && !patientData) return <ErrorState message={error} onRetry={load} />;
  if (!patientData) return <LoadingState label="Loading patient records…" />;

  const patients = patientData.patients || [];

  return (
    <div className="staff-page">
      <SectionHeading
        eyebrow="Clinical records"
        title="Patient Record"
        detail="Search, register, and review patient information with staff-authorized access."
        action={
          <button className="button button--primary" onClick={() => setIsRegistrationOpen(true)}>
            <UserPlus size={17} /> Register Patient
          </button>
        }
      />

      {error && <p className="inline-alert inline-alert--error">{error}</p>}
      {success && <p className="inline-alert inline-alert--success">{success}</p>}

      <section className="staff-panel staff-panel--table">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Authorized patient data</span>
            <h2>Patient Database</h2>
            <p>Search the clinic database by name, email address, or mobile number.</p>
          </div>
        </div>
        <form
          className="staff-search"
          onSubmit={(event) => {
            event.preventDefault();
            setSubmittedSearch(search);
          }}
        >
          <Search size={18} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search patients"
            aria-label="Search patients"
          />
          <button className="button button--secondary button--compact">Search</button>
        </form>

        {patients.length ? (
          <StaffDataTable>
            <table className="staff-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Patient Name</th>
                  <th>Phone</th>
                  <th>Last Visit</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {patients.map((patient) => (
                  <tr key={patient.id}>
                    <td data-label="ID"><code>{patient.id}</code></td>
                    <td data-label="Patient Name">
                      <strong>{patient.fullName}</strong>
                      <small>{patient.email}</small>
                    </td>
                    <td data-label="Phone">{patient.phone || "Not recorded"}</td>
                    <td data-label="Last Visit">{formatStaffDate(patient.lastVisit, "No visits yet")}</td>
                    <td data-label="Status"><StaffStatusBadge status={patient.status} /></td>
                    <td data-label="Action">
                      <button className="button button--secondary button--compact" onClick={() => viewPatient(patient.id)}>
                        <Eye size={15} /> View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </StaffDataTable>
        ) : (
          <EmptyState
            title={submittedSearch ? "No patients found" : "No patient records available"}
            detail={submittedSearch ? "Try a different name, email address, or mobile number." : "Registered patients will appear here."}
          />
        )}
      </section>

      {isRegistrationOpen && (
        <StaffModal title="Register Patient" onClose={() => setIsRegistrationOpen(false)} wide>
          <form className="staff-register-form" onSubmit={registerPatient}>
            <div className="field-grid field-grid--two">
              <label className="field"><span>First Name</span><input name="firstName" value={registration.firstName} onChange={updateRegistration} required /></label>
              <label className="field"><span>Last Name</span><input name="lastName" value={registration.lastName} onChange={updateRegistration} required /></label>
              <label className="field"><span>Date of Birth</span><input type="date" name="dateOfBirth" value={registration.dateOfBirth} onChange={updateRegistration} required /></label>
              <label className="field">
                <span>Gender</span>
                <select name="gender" value={registration.gender} onChange={updateRegistration} required>
                  <option value="">Choose an option</option>
                  <option value="Female">Female</option>
                  <option value="Male">Male</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </label>
              <label className="field"><span>Phone</span><input name="phone" value={registration.phone} onChange={updateRegistration} required /></label>
              <label className="field"><span>Email</span><input type="email" name="email" value={registration.email} onChange={updateRegistration} required /></label>
              <label className="field field--full"><span>Address</span><input name="address" value={registration.address} onChange={updateRegistration} required /></label>
              <label className="field field--full"><span>Emergency Contact</span><input name="emergencyContact" value={registration.emergencyContact} onChange={updateRegistration} required /></label>
              <label className="field field--full">
                <span>Medical / Dental Notes</span>
                <textarea name="medicalDentalNotes" rows="4" value={registration.medicalDentalNotes} onChange={updateRegistration} />
              </label>
            </div>
            <p className="staff-form-note">A secure account-setup email is sent when clinic email delivery is configured.</p>
            <div className="staff-modal__actions">
              <button type="button" className="button button--secondary" onClick={() => setIsRegistrationOpen(false)}>Cancel</button>
              <button className="button button--primary" disabled={isSaving}>
                <Plus size={16} /> {isSaving ? "Registering…" : "Register Patient"}
              </button>
            </div>
          </form>
        </StaffModal>
      )}

      {(isLoadingPatient || selectedPatient) && (
        <StaffModal title={isLoadingPatient ? "Loading Patient Record" : selectedPatient.fullName} onClose={closePatientDetails} wide>
          {isLoadingPatient ? (
            <LoadingState label="Loading authorized patient details…" />
          ) : (
            <div className="staff-patient-detail">
              <section className="staff-detail-section">
                <h3>Patient Information</h3>
                <div className="staff-profile-grid">
                  <ProfileLine label="Patient ID" value={selectedPatient.id} />
                  <ProfileLine label="Status" value={selectedPatient.status} />
                  <ProfileLine label="Email" value={selectedPatient.email} />
                  <ProfileLine label="Phone" value={selectedPatient.phone} />
                  <ProfileLine label="Date of Birth" value={formatStaffDate(selectedPatient.profile?.date_of_birth)} />
                  <ProfileLine label="Gender" value={selectedPatient.profile?.gender} />
                  <ProfileLine label="Address" value={selectedPatient.profile?.address} />
                  <ProfileLine label="Emergency Contact" value={selectedPatient.profile?.emergency_contact_name} />
                  <ProfileLine label="Emergency Phone" value={selectedPatient.profile?.emergency_contact_phone} />
                </div>
              </section>

              <section className="staff-detail-section">
                <h3>Clinical Notes</h3>
                <p className="staff-detail-copy">{selectedPatient.profile?.dental_concerns || "No medical or dental notes have been recorded."}</p>
              </section>

              <section className="staff-detail-section">
                <h3>Appointment History</h3>
                {selectedPatient.appointments.length ? (
                  <div className="staff-history-list">
                    {selectedPatient.appointments.map((appointment) => (
                      <article key={appointment.id}>
                        <div>
                          <strong>{appointment.treatment}</strong>
                          <small>{appointment.dentist} · {formatStaffDate(appointment.date)} · {formatStaffTime(appointment.time)}</small>
                        </div>
                        <StaffStatusBadge status={appointment.status} />
                      </article>
                    ))}
                  </div>
                ) : <p className="muted-copy">No appointments are recorded for this patient.</p>}
              </section>

              <section className="staff-detail-section">
                <h3>Treatment History</h3>
                {selectedPatient.treatments.length ? (
                  <div className="staff-history-list">
                    {selectedPatient.treatments.map((treatment) => (
                      <article key={treatment.id}>
                        <div>
                          <strong>{treatment.treatment}</strong>
                          <small>{treatment.dentist || "Amethyst Dental"} · {formatStaffDate(treatment.date)}</small>
                          {treatment.notes && <small>{treatment.notes}</small>}
                        </div>
                        <StaffStatusBadge status={treatment.status} />
                      </article>
                    ))}
                  </div>
                ) : <p className="muted-copy">No treatment history is recorded for this patient.</p>}
              </section>
            </div>
          )}
        </StaffModal>
      )}
    </div>
  );
}
