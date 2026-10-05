import { useCallback, useEffect, useState } from "react";
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminAiSettings();
      setSettings(response.settings);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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

      <section className="admin-panel">
        <form className="admin-form" onSubmit={saveMeta}>
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
    </div>
  );
}
