import { useCallback, useEffect, useMemo, useState } from "react";
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

export function AdminAiSettingsPage() {
  const { pushToast, confirm } = useAdminUi();
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [services, setServices] = useState([]);
  const [selectedServiceId, setSelectedServiceId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settingsResponse, catalogResponse] = await Promise.all([
        api.getAdminAiSettings(),
        api.getAdminClinicServices(),
      ]);
      setSettings(settingsResponse.settings);
      const nextServices = catalogResponse.services || [];
      setGroups(catalogResponse.groups || []);
      setServices(nextServices);
      setSelectedServiceId((current) =>
        current && nextServices.some((service) => service.id === current) ? current : ""
      );
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const groupedServices = useMemo(
    () =>
      groups.map((group) => ({
        ...group,
        services: services.filter((service) => service.group === group.id && service.adminVisible !== false),
      })).filter((group) => group.services.length),
    [groups, services]
  );
  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId && service.adminVisible !== false) || null,
    [services, selectedServiceId]
  );

  function updateService(id, patch) {
    setServices((current) =>
      current.map((service) => (service.id === id ? { ...service, ...patch } : service))
    );
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
    setBusy(true);
    try {
      const response = await api.updateAdminClinicServices({
        services: [
          {
            id: selectedService.id,
            priceLabel: selectedService.priceLabel,
            chatbotEn: selectedService.chatbotEn,
          },
        ],
      });
      setGroups(response.groups || groups);
      setServices(response.services || services);
      setSelectedServiceId(selectedService.id);
      pushToast(response.message || "Clinic services updated successfully.");
    } catch (saveError) {
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
          <label className="admin-clinic-services__picker">
            Select a service
            <select
              value={selectedServiceId}
              disabled={busy}
              onChange={(event) => setSelectedServiceId(event.target.value)}
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
          {selectedService ? (
            <article className="admin-clinic-services__card">
              <label className="admin-clinic-services__wide">
                Price label
                <input
                  value={selectedService.priceLabel || ""}
                  disabled={busy}
                  onChange={(event) => updateService(selectedService.id, { priceLabel: event.target.value })}
                />
              </label>
              <label className="admin-clinic-services__wide">
                Chatbot answer
                <textarea
                  rows={5}
                  value={selectedService.chatbotEn || ""}
                  disabled={busy}
                  onChange={(event) => updateService(selectedService.id, { chatbotEn: event.target.value })}
                />
              </label>
            </article>
          ) : (
            <p className="muted">Select a service to edit its price label and chatbot answer.</p>
          )}
          <div className="admin-modal__actions">
            <button className="button button--primary" disabled={busy || !selectedService}>
              {busy ? "Saving…" : "Save clinic service"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
