import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { ErrorState, LoadingState } from "../components/UI";
import { useAdminUi } from "../components/AdminLayout";

const TOGGLES = [
  {
    key: "amethystAiEnabled",
    title: "Amethyst AI Configuration",
    detail: "Enable or disable all Amethyst AI-assisted clinic services.",
  },
  {
    key: "predictiveDiagnostics",
    title: "Predictive Diagnostics",
    detail: "Configure AI-assisted diagnostic support for clinical workflows.",
  },
  {
    key: "automatedReminders",
    title: "Automated Reminders",
    detail: "Enable or disable automated appointment and queue reminder functions.",
  },
  {
    key: "waitingTimePrediction",
    title: "Waiting Time Prediction",
    detail: "Configure AI-based patient waiting-time prediction for the queue.",
  },
  {
    key: "aiChatbot",
    title: "AI Chatbot",
    detail: "Configure chatbot availability for patient and staff knowledge support.",
  },
  {
    key: "scheduledSystemUpdates",
    title: "Scheduled System Updates",
    detail: "Manage automated system update settings for the Amethyst AI core.",
  },
];

function visibleServices(list) {
  return (list || []).filter((service) => service.adminVisible !== false);
}

function draftFromService(service) {
  return {
    priceLabel: service?.priceLabel || "",
    chatbotEn: service?.chatbotEn || "",
  };
}

export function AdminAiSettingsPage() {
  const { pushToast, confirm } = useAdminUi();
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [draft, setDraft] = useState({ priceLabel: "", chatbotEn: "" });
  const [baseline, setBaseline] = useState({ priceLabel: "", chatbotEn: "" });
  const [error, setError] = useState("");
  const [catalogError, setCatalogError] = useState("");
  const [busy, setBusy] = useState(false);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [serviceStatus, setServiceStatus] = useState("");
  const loadGen = useRef(0);
  const selectedServiceIdRef = useRef("");
  selectedServiceIdRef.current = selectedServiceId;

  const applyCatalog = useCallback((catalogResponse, keepId) => {
    const nextServices = catalogResponse.services || [];
    const nextGroups = catalogResponse.groups || [];
    setGroups(nextGroups);
    setServices(nextServices);
    const nextId =
      keepId && visibleServices(nextServices).some((service) => service.id === keepId) ? keepId : "";
    const selected = nextServices.find((service) => service.id === nextId) || null;
    const nextDraft = draftFromService(selected);
    setSelectedServiceId(nextId);
    setDraft(nextDraft);
    setBaseline(nextDraft);
  }, []);

  const load = useCallback(async () => {
    const seq = ++loadGen.current;
    setCatalogLoading(true);
    try {
      const [settingsResponse, catalogResponse] = await Promise.all([
        api.getAdminAiSettings(),
        api.getAdminClinicServices(),
      ]);
      if (seq !== loadGen.current) return;
      setSettings(settingsResponse.settings);
      applyCatalog(catalogResponse, selectedServiceIdRef.current);
      setError("");
      setCatalogError("");
    } catch (loadError) {
      if (seq !== loadGen.current) return;
      setError(loadError.message);
      setCatalogError(loadError.message);
    } finally {
      if (seq === loadGen.current) setCatalogLoading(false);
    }
  }, [applyCatalog]);

  useEffect(() => {
    load();
  }, [load]);

  const groupedServices = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          services: visibleServices(services).filter((service) => service.group === group.id),
        }))
        .filter((group) => group.services.length),
    [groups, services]
  );
  const selectedService = useMemo(
    () => visibleServices(services).find((service) => service.id === selectedServiceId) || null,
    [services, selectedServiceId]
  );
  const dirty =
    Boolean(selectedServiceId) &&
    (draft.priceLabel !== baseline.priceLabel || draft.chatbotEn !== baseline.chatbotEn);

  async function chooseService(nextId) {
    if (nextId === selectedServiceId) return;
    if (dirty) {
      const ok = await confirm({
        title: "Discard unsaved edits?",
        message: "You have unsaved price label or chatbot answer changes. Switch services and lose those edits?",
        confirmLabel: "Discard edits",
        tone: "danger",
      });
      if (!ok) return;
    }
    const selected = services.find((service) => service.id === nextId) || null;
    const nextDraft = draftFromService(selected);
    setSelectedServiceId(selected ? selected.id : "");
    setDraft(nextDraft);
    setBaseline(nextDraft);
    setServiceStatus("");
    setCatalogError("");
  }

  async function toggleSetting(key) {
    if (!settings) return;
    const nextValue = !settings[key];
    const ok = await confirm({
      title: "Confirm AI configuration change",
      message: `Are you sure you want to ${nextValue ? "enable" : "disable"} ${key.replace(/([A-Z])/g, " $1").toLowerCase()}?`,
      confirmLabel: "Save change",
      tone: "primary",
    });
    if (!ok) return;

    const next = { ...settings, [key]: nextValue };
    setBusy(true);
    try {
      const response = await api.updateAdminAiSettings({ settings: next });
      setSettings(response.settings);
      pushToast(response.message || "AI settings updated successfully.");
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveMeta(event) {
    event.preventDefault();
    const ok = await confirm({
      title: "Save AI knowledge settings",
      message: "Confirm updating chatbot knowledge mode and diagnostics sensitivity?",
      confirmLabel: "Save",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await api.updateAdminAiSettings({ settings });
      setSettings(response.settings);
      pushToast(response.message || "AI settings updated successfully.");
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function saveClinicServices(event) {
    event.preventDefault();
    if (!selectedService) {
      pushToast("Select a service before saving.", "error");
      return;
    }
    const ok = await confirm({
      title: "Save clinic service",
      message: `This updates the Patient Portal price label and chatbot answer for ${selectedService.title}. Other catalog fields stay as stored.`,
      confirmLabel: "Save service",
      tone: "primary",
    });
    if (!ok) return;
    const savingId = selectedService.id;
    const savingDraft = { priceLabel: draft.priceLabel, chatbotEn: draft.chatbotEn };
    setBusy(true);
    setServiceStatus("Saving…");
    setCatalogError("");
    try {
      const response = await api.updateAdminClinicServices({
        services: [
          {
            id: savingId,
            priceLabel: savingDraft.priceLabel,
            chatbotEn: savingDraft.chatbotEn,
          },
        ],
      });
      const nextServices = response.services || [];
      const nextGroups = response.groups || [];
      setGroups(nextGroups);
      setServices(nextServices);
      if (selectedServiceIdRef.current === savingId) {
        const selected = nextServices.find((service) => service.id === savingId) || null;
        const nextDraft = draftFromService(selected);
        setDraft(nextDraft);
        setBaseline(nextDraft);
        setServiceStatus("Saved.");
      }
      pushToast(response.message || "Clinic service updated successfully.");
    } catch (saveError) {
      if (selectedServiceIdRef.current === savingId) {
        setServiceStatus("");
        setCatalogError(saveError.message);
      }
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (error && !settings) return <ErrorState message={error} onRetry={load} />;
  if (!settings) return <LoadingState label="Loading AI core settings…" />;

  return (
    <div className="admin-page">
      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Intelligence control</span>
            <h2>Amethyst AI Core Settings</h2>
            <p>Every toggle persists to PostgreSQL. Important changes require confirmation.</p>
          </div>
        </div>

        <div className="admin-ai-grid">
          {TOGGLES.map((item) => (
            <article key={item.key} className="admin-ai-card">
              <div>
                <h3>{item.title}</h3>
                <p>{item.detail}</p>
              </div>
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(settings[item.key])}
                  disabled={busy}
                  onChange={() => toggleSetting(item.key)}
                />
                <i />
                <span>{settings[item.key] ? "Enabled" : "Disabled"}</span>
              </label>
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel admin-ai-knowledge">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Approved knowledge</span>
            <h2>Patient AI clinic prices</h2>
          </div>
        </div>
        <form className="admin-form admin-ai-knowledge__form" onSubmit={saveMeta}>
          <label>
            Chatbot knowledge mode
            <select
              value={settings.chatbotKnowledgeMode || "clinic"}
              onChange={(event) => setSettings({ ...settings, chatbotKnowledgeMode: event.target.value })}
            >
              <option value="clinic">Clinic knowledge base</option>
              <option value="general">General dental guidance</option>
              <option value="restricted">Restricted / staff only</option>
            </select>
          </label>
          <label>
            Diagnostics sensitivity
            <select
              value={settings.diagnosticsSensitivity || "balanced"}
              onChange={(event) => setSettings({ ...settings, diagnosticsSensitivity: event.target.value })}
            >
              <option value="conservative">Conservative</option>
              <option value="balanced">Balanced</option>
              <option value="aggressive">Aggressive</option>
            </select>
          </label>
          <div className="admin-modal__actions">
            <button className="button button--primary" disabled={busy}>
              {busy ? "Saving…" : "Save knowledge settings"}
            </button>
          </div>
        </form>
      </section>

      <section className="admin-panel admin-ai-knowledge admin-clinic-services">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">AI Knowledge</span>
            <h2>Clinic Services</h2>
            <p>
              Choose a clinic service, then update its price label and chatbot answer. Patient Portal and
              chatbot still read this same catalog. Official price details stay stored and are not shown here.
            </p>
          </div>
        </div>
        <form className="admin-form admin-clinic-services__form" onSubmit={saveClinicServices}>
          <label className="admin-clinic-services__picker" htmlFor="admin-clinic-service-select">
            Select a service
            <select
              id="admin-clinic-service-select"
              value={selectedServiceId}
              disabled={busy || catalogLoading}
              aria-busy={catalogLoading ? "true" : "false"}
              onChange={(event) => chooseService(event.target.value)}
            >
              <option value="">Select a service</option>
              {groupedServices.map((group) => (
                <optgroup key={group.id} label={group.title}>
                  {group.services.map((service) => (
                    <option key={service.id} value={service.id}>
                      {service.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {catalogLoading ? <p className="muted">Loading clinic services…</p> : null}
          {selectedService ? (
            <article className="admin-clinic-services__card">
              <label className="admin-clinic-services__wide" htmlFor="admin-clinic-service-price">
                Price label
                <input
                  id="admin-clinic-service-price"
                  value={draft.priceLabel}
                  disabled={busy}
                  onChange={(event) => {
                    setServiceStatus("");
                    setDraft((current) => ({ ...current, priceLabel: event.target.value }));
                  }}
                />
              </label>
              <label className="admin-clinic-services__wide" htmlFor="admin-clinic-service-chatbot">
                Chatbot answer
                <textarea
                  id="admin-clinic-service-chatbot"
                  rows={5}
                  value={draft.chatbotEn}
                  disabled={busy}
                  onChange={(event) => {
                    setServiceStatus("");
                    setDraft((current) => ({ ...current, chatbotEn: event.target.value }));
                  }}
                />
              </label>
            </article>
          ) : (
            <p className="muted">Select a service to edit its price label and chatbot answer.</p>
          )}
          {catalogError ? (
            <p className="admin-form--manage-user__error" role="alert">
              {catalogError}
            </p>
          ) : null}
          {serviceStatus ? <p className="admin-clinic-services__status">{serviceStatus}</p> : null}
          <div className="admin-modal__actions">
            <button className="button button--primary" disabled={busy || catalogLoading || !selectedService}>
              {busy ? "Saving…" : "Save clinic service"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
