import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { EmptyState, SectionHeading } from "../components/UI";
import { DentalDocumentPreview } from "../components/DentalDocumentPreview";

const emptyItem = {
  medicationName: "",
  strength: "",
  dosage: "",
  quantity: "",
  frequency: "",
  duration: "",
  route: "",
  sig: "",
  additionalInstructions: "",
};

function statusLabel(status) {
  return String(status || "").replace(/_/g, " ");
}

export function DentistPrescriptionsPage() {
  const [searchParams] = useSearchParams();
  const [list, setList] = useState([]);
  const [patients, setPatients] = useState([]);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [form, setForm] = useState({
    clinicalRecordId: searchParams.get("patientId") || "",
    clinicalNotes: "",
    includeExtractionAftercare: false,
    items: [{ ...emptyItem }],
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [preview, setPreview] = useState(null);

  const load = useCallback(async () => {
    try {
      const [rx, registry] = await Promise.all([
        api.getDentistPrescriptions(search ? { search } : {}),
        api.getDentistPatients(""),
      ]);
      setList(rx.prescriptions || []);
      setPatients(registry.patients || []);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  async function openDetail(id) {
    setSelectedId(id);
    const data = await api.getDentistPrescription(id);
    const prescription = data.prescription;
    setDetail(prescription);
    setForm({
      clinicalRecordId: String(prescription.clinicalRecordId),
      clinicalNotes: prescription.clinicalNotes || "",
      includeExtractionAftercare: Boolean(prescription.includeExtractionAftercare),
      items: prescription.items?.length
        ? prescription.items.map((item) => ({ ...emptyItem, ...item }))
        : [{ ...emptyItem }],
    });
  }

  function startNew() {
    setSelectedId("");
    setDetail(null);
    setForm({
      clinicalRecordId: searchParams.get("patientId") || "",
      clinicalNotes: "",
      includeExtractionAftercare: false,
      items: [{ ...emptyItem }],
    });
  }

  async function saveDraft(event) {
    event.preventDefault();
    setBusy("save");
    try {
      const body = {
        clinicalRecordId: form.clinicalRecordId,
        clinicalNotes: form.clinicalNotes,
        includeExtractionAftercare: form.includeExtractionAftercare,
        items: form.items,
      };
      const data = selectedId
        ? await api.updateDentistPrescription(selectedId, body)
        : await api.createDentistPrescription(body);
      setDetail(data.prescription);
      setSelectedId(data.prescription.id);
      await load();
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusy("");
    }
  }

  async function runAction(kind) {
    if (!selectedId) return;
    setBusy(kind);
    try {
      const data =
        kind === "submit"
          ? await api.submitDentistPrescription(selectedId)
          : kind === "authorize"
            ? await api.authorizeDentistPrescription(selectedId)
            : await api.cancelDentistPrescription(selectedId);
      setDetail(data.prescription);
      await load();
    } catch (actionError) {
      setError(actionError.message);
    } finally {
      setBusy("");
    }
  }

  async function openPdf() {
    if (!selectedId) return;
    try {
      const blob = await api.viewDentistPrescriptionPdf(selectedId);
      setPreview({
        document: { name: `${detail?.prescriptionNumber || "Prescription"}.pdf`, mimeType: "application/pdf" },
        objectUrl: URL.createObjectURL(blob),
      });
    } catch (pdfError) {
      setError(pdfError.message);
    }
  }

  const editable = !detail || ["draft", "returned_to_dentist"].includes(detail.workflowStatus);
  const patientOptions = useMemo(
    () =>
      patients.map((patient) => ({
        id: patient.id,
        label: `${patient.fullName || patient.patientName || "Patient"} (${patient.patientId || patient.id})`,
      })),
    [patients]
  );

  return (
    <div className="dentist-page prescription-page">
      <SectionHeading
        eyebrow="Clinical documents"
        title="Prescription Management"
        detail="Create, submit, and authorize prescriptions. Staff email only the version you authorize."
        action={
          <button type="button" className="button button--primary" onClick={startNew}>
            <Plus size={16} /> New prescription
          </button>
        }
      />
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <div className="prescription-layout">
        <section className="dentist-panel">
          <form
            className="dentist-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              load();
            }}
          >
            <label className="dentist-search">
              <Search size={17} />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search by prescription number or patient"
              />
            </label>
            <button className="button button--secondary button--compact" type="submit">
              Search
            </button>
          </form>
          {list.length ? (
            <div className="prescription-list">
              {list.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`prescription-list__item ${selectedId === row.id ? "is-active" : ""}`}
                  onClick={() => openDetail(row.id).catch((openError) => setError(openError.message))}
                >
                  <strong>{row.prescriptionNumber}</strong>
                  <span>{row.patient?.fullName || "Patient"}</span>
                  <small>
                    {statusLabel(row.workflowStatus)} · email {row.emailStatus} · v{row.currentVersion}
                  </small>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="No prescriptions yet" detail="Create a draft from a selected patient record." />
          )}
        </section>

        <section className="dentist-panel">
          <form className="dentist-form" onSubmit={saveDraft}>
            <div className="dentist-panel__heading">
              <div>
                <span className="eyebrow">{detail ? detail.prescriptionNumber : "New draft"}</span>
                <h2>{detail ? `Version ${detail.currentVersion}` : "Create prescription"}</h2>
              </div>
              {detail ? (
                <span className="prescription-status">{statusLabel(detail.workflowStatus)}</span>
              ) : null}
            </div>
            {detail?.returnReason ? (
              <p className="inline-alert">Returned: {detail.returnReason}</p>
            ) : null}
            <label className="field">
              <span>Patient</span>
              <select
                required
                disabled={!editable || Boolean(detail)}
                value={form.clinicalRecordId}
                onChange={(event) => setForm((current) => ({ ...current, clinicalRecordId: event.target.value }))}
              >
                <option value="">Select a patient</option>
                {patientOptions.map((patient) => (
                  <option key={patient.id} value={patient.id}>
                    {patient.label}
                  </option>
                ))}
              </select>
            </label>
            {form.items.map((item, index) => (
              <fieldset key={index} className="prescription-item">
                <legend>Medication {index + 1}</legend>
                <div className="field-grid field-grid--two">
                  <label className="field">
                    <span>Medication name</span>
                    <input
                      required
                      disabled={!editable}
                      value={item.medicationName}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], medicationName: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Strength</span>
                    <input
                      disabled={!editable}
                      value={item.strength}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], strength: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Dosage</span>
                    <input
                      required
                      disabled={!editable}
                      value={item.dosage}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], dosage: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Quantity</span>
                    <input
                      required
                      disabled={!editable}
                      value={item.quantity}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], quantity: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Frequency</span>
                    <input
                      required
                      disabled={!editable}
                      value={item.frequency}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], frequency: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Duration</span>
                    <input
                      required
                      disabled={!editable}
                      value={item.duration}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], duration: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field">
                    <span>Route</span>
                    <input
                      disabled={!editable}
                      value={item.route}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], route: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                  <label className="field field--full">
                    <span>Sig / patient-use instructions</span>
                    <textarea
                      required
                      rows="2"
                      disabled={!editable}
                      value={item.sig}
                      onChange={(event) =>
                        setForm((current) => {
                          const items = [...current.items];
                          items[index] = { ...items[index], sig: event.target.value };
                          return { ...current, items };
                        })
                      }
                    />
                  </label>
                </div>
                {editable && form.items.length > 1 ? (
                  <button
                    type="button"
                    className="button button--secondary button--compact"
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        items: current.items.filter((_, itemIndex) => itemIndex !== index),
                      }))
                    }
                  >
                    <Trash2 size={14} /> Remove item
                  </button>
                ) : null}
              </fieldset>
            ))}
            {editable ? (
              <button
                type="button"
                className="button button--secondary"
                onClick={() => setForm((current) => ({ ...current, items: [...current.items, { ...emptyItem }] }))}
              >
                Add medication
              </button>
            ) : null}
            <label className="field">
              <span>Clinical notes</span>
              <textarea
                rows="3"
                disabled={!editable}
                value={form.clinicalNotes}
                onChange={(event) => setForm((current) => ({ ...current, clinicalNotes: event.target.value }))}
              />
            </label>
            <label className="field field--check">
              <input
                type="checkbox"
                disabled={!editable}
                checked={form.includeExtractionAftercare}
                onChange={(event) =>
                  setForm((current) => ({ ...current, includeExtractionAftercare: event.target.checked }))
                }
              />
              <span>
                Flag extraction aftercare (printed only when clinic-approved wording exists and an extraction procedure
                is linked)
              </span>
            </label>
            {detail ? (
              <p className="muted-copy">
                Authorization: {detail.authorizedAt ? `${detail.authorizationMethod} at ${detail.authorizedAt}` : "not authorized"}
                {detail.contentHash ? ` · hash ${detail.contentHash.slice(0, 12)}` : ""}
              </p>
            ) : null}
            <div className="dentist-form__actions">
              {editable ? (
                <button className="button button--primary" disabled={Boolean(busy)}>
                  {busy === "save" ? "Saving…" : "Save draft"}
                </button>
              ) : null}
              {detail && editable ? (
                <button type="button" className="button button--secondary" onClick={() => runAction("submit")}>
                  Send to staff
                </button>
              ) : null}
              {detail && detail.workflowStatus !== "cancelled" && detail.workflowStatus !== "authorized" ? (
                <button type="button" className="button button--primary" onClick={() => runAction("authorize")}>
                  Authorize this version
                </button>
              ) : null}
              {detail?.workflowStatus === "authorized" ? (
                <button type="button" className="button button--secondary" onClick={openPdf}>
                  View authorized PDF
                </button>
              ) : null}
              {detail && detail.workflowStatus !== "cancelled" ? (
                <button type="button" className="button button--secondary" onClick={() => runAction("cancel")}>
                  Cancel
                </button>
              ) : null}
            </div>
          </form>
        </section>
      </div>
      {preview ? (
        <DentalDocumentPreview
          document={preview.document}
          objectUrl={preview.objectUrl}
          onClose={() => {
            URL.revokeObjectURL(preview.objectUrl);
            setPreview(null);
          }}
          onDownload={() => api.downloadDentistPrescriptionPdf(selectedId)}
        />
      ) : null}
    </div>
  );
}
