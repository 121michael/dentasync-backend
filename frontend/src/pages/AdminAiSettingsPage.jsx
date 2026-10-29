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

function linesToText(lines) {
  return (lines || [])
    .map((line) => `${line.label || ""}: ${line.value || ""}`.replace(/^: /, "").trim())
    .join("\n");
}

function textToLines(text) {
  return String(text || "")
    .split("\n")
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const index = row.indexOf(":");
      if (index < 0) return { label: row, value: "" };
      return {
        label: row.slice(0, index).trim(),
        value: row.slice(index + 1).trim(),
      };
    });
}

export function AdminAiSettingsPage() {
  const { pushToast, confirm } = useAdminUi();
  const [settings, setSettings] = useState(null);
  const [groups, setGroups] = useState([]);
  const [services, setServices] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [settingsResponse, catalogResponse] = await Promise.all([
        api.getAdminAiSettings(),
        api.getAdminClinicServices(),
      ]);
      setSettings(settingsResponse.settings);
      setGroups(catalogResponse.groups || []);
      setServices(catalogResponse.services || []);
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
    const ok = await confirm({
      title: "Save clinic services",
      message: "This updates Patient Portal prices and the AI chatbot from the same approved catalog.",
      confirmLabel: "Save catalog",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await api.updateAdminClinicServices({ services });
      setGroups(response.groups || groups);
      setServices(response.services || services);
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
              Official service names, prices, and chatbot answers. Changes here update the Patient Portal
              and chatbot from the same catalog.
            </p>
          </div>
        </div>
        <form className="admin-form admin-clinic-services__form" onSubmit={saveClinicServices}>
          {groupedServices.map((group) => (
            <div key={group.id} className="admin-clinic-services__group">
              <h3>{group.title}</h3>
              {group.services.map((service) => (
                <article key={service.id} className="admin-clinic-services__card">
                  <label>
                    Service name
                    <input
                      value={service.title || ""}
                      disabled={busy}
                      onChange={(event) => updateService(service.id, { title: event.target.value })}
                    />
                  </label>
                  <label>
                    Price label
                    <input
                      value={service.priceLabel || ""}
                      disabled={busy}
                      onChange={(event) => updateService(service.id, { priceLabel: event.target.value })}
                    />
                  </label>
                  <label className="admin-clinic-services__wide">
                    Official price / details
                    <textarea
                      rows={3}
                      value={service.details || ""}
                      disabled={busy}
                      onChange={(event) => updateService(service.id, { details: event.target.value })}
                    />
                  </label>
                  <label className="admin-clinic-services__wide">
                    Price units and terms
                    <textarea
                      rows={3}
                      value={linesToText(service.lines)}
                      disabled={busy}
                      onChange={(event) =>
                        updateService(service.id, { lines: textToLines(event.target.value) })
                      }
                    />
                  </label>
                  <label className="admin-clinic-services__wide">
                    Chatbot answer
                    <textarea
                      rows={4}
                      value={service.chatbotEn || ""}
                      disabled={busy}
                      onChange={(event) => updateService(service.id, { chatbotEn: event.target.value })}
                    />
                  </label>
                </article>
              ))}
            </div>
          ))}
          <div className="admin-modal__actions">
            <button className="button button--primary" disabled={busy}>
              {busy ? "Saving…" : "Save clinic services"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
