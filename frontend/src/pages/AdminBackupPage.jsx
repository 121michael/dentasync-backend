import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  DatabaseBackup,
  Download,
  Eye,
  RefreshCw,
  RotateCcw,
  Trash2,
  Upload,
} from "lucide-react";
import { api } from "../api";
import { formatAdminDateTime } from "../adminUtils";
import { ErrorState, LoadingState } from "../components/UI";
import { AdminModal, AdminStatCard, AdminStatusBadge } from "../components/AdminUI";
import { useAdminUi } from "../components/AdminLayout";

function bytesLabel(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function statusTone(status) {
  if (status === "success") return "Successful";
  if (status === "failed") return "Failed";
  if (status === "in_progress") return "In Progress";
  if (status === "never_backed_up") return "Never Backed Up";
  return status || "Unknown";
}

export function AdminBackupPage() {
  const { pushToast, confirm } = useAdminUi();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState(null);
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restorePhrase, setRestorePhrase] = useState("");
  const [schedule, setSchedule] = useState("manual");
  const [retentionCount, setRetentionCount] = useState(12);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminBackups();
      setData(response);
      setSchedule(response.settings?.schedule || "manual");
      setRetentionCount(response.settings?.retentionCount || 12);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const backups = data?.backups || [];
  const storage = data?.storage;

  const overviewCards = useMemo(
    () => [
      {
        label: "Backup status",
        value: statusTone(data?.status),
        tone: data?.status === "success" ? "emerald" : data?.status === "failed" ? "danger" : "violet",
      },
      {
        label: "Available backups",
        value: data?.availableCount ?? 0,
        tone: "purple",
      },
      {
        label: "Latest successful backup",
        value: data?.latestSuccessfulBackup
          ? formatAdminDateTime(data.latestSuccessfulBackup.createdAt)
          : "None",
        tone: "violet",
      },
      {
        label: "Last restore",
        value: data?.lastRestore ? formatAdminDateTime(data.lastRestore.createdAt) : "None",
        detail: data?.lastRestore ? `${data.lastRestore.status} · ${data.lastRestore.actorName || "Admin"}` : "",
        tone: "amber",
      },
    ],
    [data]
  );

  async function createBackup() {
    const ok = await confirm({
      title: "Create a clinic backup?",
      message:
        "This copies supported DentaSync database records (accounts, appointments, queue, treatments, schedules, and clinic configuration) into a protected archive. Environment secrets and .env files are not included.",
      confirmLabel: "Create backup",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await api.createAdminBackup();
      pushToast(response.message || "Backup created.");
      await load();
    } catch (createError) {
      pushToast(createError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function downloadBackup(backup) {
    try {
      await api.downloadAdminBackup(backup.id, backup.fileName);
      pushToast("Backup download started.");
    } catch (downloadError) {
      pushToast(downloadError.message, "error");
    }
  }

  async function deleteBackup(backup) {
    const ok = await confirm({
      title: "Delete this backup?",
      message: `This removes backup ${backup.id} from protected storage. The last known-good backup cannot be deleted.`,
      confirmLabel: "Delete backup",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteAdminBackup(backup.id);
      pushToast("Backup deleted.");
      await load();
    } catch (deleteError) {
      pushToast(deleteError.message, "error");
    }
  }

  async function saveSettings() {
    setBusy(true);
    try {
      const response = await api.updateAdminBackupSettings({ schedule, retentionCount: Number(retentionCount) });
      pushToast(response.message || "Backup settings saved.");
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function uploadBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const ok = await confirm({
      title: "Store this backup file?",
      message:
        "The file will be validated and stored. It will not restore the database until you choose Restore and type RESTORE.",
      confirmLabel: "Upload backup",
      tone: "primary",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await api.uploadAdminBackup(file);
      pushToast(response.message || "Backup uploaded.");
      await load();
    } catch (uploadError) {
      pushToast(uploadError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  async function submitRestore() {
    if (!restoreTarget) return;
    if (restorePhrase.trim() !== "RESTORE") {
      pushToast("Type RESTORE to confirm recovery.", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await api.restoreAdminBackup(restoreTarget.id, { confirmation: "RESTORE" });
      pushToast(response.message || "Database restored.");
      setRestoreTarget(null);
      setRestorePhrase("");
      await load();
    } catch (restoreError) {
      pushToast(restoreError.message, "error");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading backup and recovery…" />;

  return (
    <div className="admin-page admin-backup-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Data protection</span>
            <h2>Backup overview</h2>
            <p>
              Protected PostgreSQL archives for DentaSync recovery. Storage is the clinic database, so copies
              survive Render deploys but not a destroyed database unless you download them.
            </p>
          </div>
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={load} type="button">
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={createBackup} type="button" disabled={busy || data.status === "in_progress"}>
              <DatabaseBackup size={16} /> Create Backup
            </button>
          </div>
        </div>
        <div className="admin-stats-grid">
          {overviewCards.map((card) => (
            <AdminStatCard key={card.label} {...card} />
          ))}
        </div>
        <dl className="admin-backup-meta">
          <div>
            <dt>Storage</dt>
            <dd>{storage?.location || "PostgreSQL"}</dd>
          </div>
          <div>
            <dt>Persistent across deploys</dt>
            <dd>{storage?.persistentAcrossDeploys ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Survives a destroyed database</dt>
            <dd>{storage?.survivesDestroyedDatabase ? "Yes" : "No — download off-site copies"}</dd>
          </div>
        </dl>
        {data.lastError ? (
          <p className="inline-alert inline-alert--error">
            <AlertTriangle size={16} /> Last backup error: {data.lastError}
          </p>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Create</span>
            <h2>Create backup</h2>
            <p>
              Manual backups include patient, staff, dentist, appointment, queue, treatment, dependent,
              schedule, service, HMO, and AI configuration records. Secrets from .env are never included.
            </p>
          </div>
        </div>
        <button className="button button--primary" onClick={createBackup} type="button" disabled={busy}>
          <DatabaseBackup size={16} /> {busy ? "Working…" : "Create Backup"}
        </button>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">History</span>
            <h2>Backup history</h2>
            <p>Newest archives first. Only completed backups can be downloaded or restored.</p>
          </div>
        </div>
        {backups.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Backup ID</th>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Created by</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.id}>
                    <td><code>{String(backup.id).slice(0, 8)}</code></td>
                    <td>{formatAdminDateTime(backup.createdAt)}</td>
                    <td>{backup.backupType}</td>
                    <td>{bytesLabel(backup.byteSize)}</td>
                    <td><AdminStatusBadge status={backup.status} /></td>
                    <td>{backup.createdByName || "System"}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button type="button" className="button button--secondary button--compact" onClick={() => setDetails(backup)}>
                          <Eye size={14} /> Details
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          disabled={!backup.downloadable}
                          onClick={() => downloadBackup(backup)}
                        >
                          <Download size={14} /> Download
                        </button>
                        <button
                          type="button"
                          className="button button--danger button--compact"
                          disabled={!backup.restorable || busy}
                          onClick={() => {
                            setRestorePhrase("");
                            setRestoreTarget(backup);
                          }}
                        >
                          <RotateCcw size={14} /> Restore
                        </button>
                        <button
                          type="button"
                          className="button button--secondary button--compact"
                          disabled={backup.status === "in_progress"}
                          onClick={() => deleteBackup(backup)}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted">No backups have been created yet.</p>
        )}
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Recovery</span>
            <h2>Restore</h2>
            <p>
              Restoring overwrites current clinic data. A safety backup is created first. Type RESTORE to
              continue. You can also store a previously downloaded .dsb file without restoring it immediately.
            </p>
          </div>
        </div>
        <label className="button button--secondary">
          <Upload size={16} /> Upload backup
          <input type="file" accept=".dsb,.gz" hidden onChange={uploadBackup} disabled={busy} />
        </label>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Settings</span>
            <h2>Backup settings</h2>
            <p>{data.settings?.scheduler}</p>
          </div>
        </div>
        <div className="admin-backup-settings">
          <label>
            <span>Schedule</span>
            <select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
              <option value="manual">Manual only</option>
              <option value="daily">Daily while API is awake</option>
              <option value="weekly">Weekly while API is awake</option>
            </select>
          </label>
          <label>
            <span>Retention (completed backups to keep)</span>
            <input
              type="number"
              min="1"
              max="50"
              value={retentionCount}
              onChange={(event) => setRetentionCount(event.target.value)}
            />
          </label>
          <button className="button button--primary" type="button" onClick={saveSettings} disabled={busy}>
            Save settings
          </button>
        </div>
      </section>

      {details ? (
        <AdminModal title="Backup details" onClose={() => setDetails(null)}>
          <dl className="admin-backup-details">
            <div><dt>ID</dt><dd>{details.id}</dd></div>
            <div><dt>Status</dt><dd>{details.status}</dd></div>
            <div><dt>Type</dt><dd>{details.backupType}</dd></div>
            <div><dt>Created</dt><dd>{formatAdminDateTime(details.createdAt)}</dd></div>
            <div><dt>Size</dt><dd>{bytesLabel(details.byteSize)}</dd></div>
            <div><dt>Checksum</dt><dd>{details.checksumSha256 || "—"}</dd></div>
            <div><dt>Tables</dt><dd>{details.tableCount} · {details.rowCount} rows</dd></div>
            <div><dt>Error</dt><dd>{details.errorDetail || "None"}</dd></div>
          </dl>
        </AdminModal>
      ) : null}

      {restoreTarget ? (
        <AdminModal title="Restore this backup?" onClose={() => setRestoreTarget(null)}>
          <p className="admin-confirm-copy">
            Restoring backup {restoreTarget.id} from {formatAdminDateTime(restoreTarget.createdAt)} will
            overwrite current DentaSync data. A safety backup is created first. This cannot be undone except
            by restoring another archive.
          </p>
          <label className="field">
            <span>Type RESTORE to confirm</span>
            <input value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} autoComplete="off" />
          </label>
          <div className="admin-modal__actions">
            <button className="button button--secondary" type="button" onClick={() => setRestoreTarget(null)}>
              Cancel
            </button>
            <button
              className="button button--danger"
              type="button"
              disabled={busy || restorePhrase.trim() !== "RESTORE"}
              onClick={submitRestore}
            >
              Restore database
            </button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
