import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  DatabaseBackup,
  Download,
  Eye,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
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
  if (status === "success" || status === "completed") return "Successful";
  if (status === "failed") return "Failed";
  if (status === "in_progress" || status === "running" || status === "uploading" || status === "verifying" || status === "queued") {
    return String(status).replaceAll("_", " ");
  }
  if (status === "never_backed_up") return "Never Backed Up";
  return status || "Unknown";
}

function storageLabel(backup) {
  if (backup?.offsiteProtected) return "Verified off-site";
  if (backup?.storageClass === "both") return "Database + independent copy";
  if (backup?.storageClass === "legacy_database" || !backup?.storageClass) return "Legacy database payload";
  return backup.storageClass;
}

export function AdminBackupPage() {
  const { pushToast, confirm } = useAdminUi();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [details, setDetails] = useState(null);
  const [recovery, setRecovery] = useState(null);
  const [restorePhrase, setRestorePhrase] = useState("");
  const [schedule, setSchedule] = useState("manual");
  const [retentionDaily, setRetentionDaily] = useState(30);
  const [retentionWeekly, setRetentionWeekly] = useState(8);
  const [retentionMonthly, setRetentionMonthly] = useState(12);
  const [retentionManual, setRetentionManual] = useState(12);
  const [alertsEnabled, setAlertsEnabled] = useState(true);

  const load = useCallback(async () => {
    try {
      const response = await api.getAdminBackups();
      setData(response);
      setSchedule(response.settings?.schedule || "manual");
      setRetentionDaily(response.settings?.retentionDaily || 30);
      setRetentionWeekly(response.settings?.retentionWeekly || 8);
      setRetentionMonthly(response.settings?.retentionMonthly || 12);
      setRetentionManual(response.settings?.retentionManual || response.settings?.retentionCount || 12);
      setAlertsEnabled(response.settings?.alertsEnabled !== false);
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
  const offsite = data?.offsite;
  const jobRunning = Boolean(busy) || data?.status === "in_progress";

  const overviewCards = useMemo(
    () => [
      {
        label: "Latest attempt",
        value: data?.latestAttemptedBackup ? statusTone(data.latestAttemptedBackup.status) : statusTone(data?.status),
        detail: data?.latestAttemptedBackup ? formatAdminDateTime(data.latestAttemptedBackup.createdAt) : "None",
        tone: data?.latestAttemptedBackup?.status === "failed" || data?.status === "failed" ? "danger" : data?.status === "success" ? "emerald" : "violet",
      },
      {
        label: "Latest completed",
        value: data?.latestCompletedBackup ? formatAdminDateTime(data.latestCompletedBackup.createdAt) : "None",
        detail: data?.latestCompletedBackup ? storageLabel(data.latestCompletedBackup) : "",
        tone: "purple",
      },
      {
        label: "Latest verified recovery point",
        value: data?.latestVerifiedBackup ? formatAdminDateTime(data.latestVerifiedBackup.verifiedAt || data.latestVerifiedBackup.createdAt) : "None",
        tone: "violet",
      },
      {
        label: "Off-site protection",
        value: offsite?.status === "verified" ? "Verified off-site" : "Off-site Backup Not Configured",
        detail: offsite?.label || "",
        tone: offsite?.status === "verified" ? "emerald" : "amber",
      },
      {
        label: "Next scheduled backup",
        value: data?.settings?.schedulerActive ? "External scheduler" : "Not independently scheduled",
        detail: data?.nextScheduledBackup || data?.settings?.scheduler,
        tone: "amber",
      },
      {
        label: "Storage used",
        value: bytesLabel(storage?.usageBytes),
        detail: `${data?.availableCount ?? 0} completed archives`,
        tone: "purple",
      },
      {
        label: "Latest failed backup",
        value: data?.latestFailedBackup ? formatAdminDateTime(data.latestFailedBackup.createdAt) : "None",
        detail: data?.latestFailedBackup?.errorDetail || "",
        tone: "danger",
      },
      {
        label: "Last isolated restore test",
        value: data?.lastIsolatedRestore ? formatAdminDateTime(data.lastIsolatedRestore.createdAt) : "None",
        detail: data?.lastIsolatedRestore ? data.lastIsolatedRestore.status : "",
        tone: "violet",
      },
    ],
    [data, offsite, storage]
  );

  async function createBackup() {
    const ok = await confirm({
      title: "Create a clinic backup?",
      message:
        "This starts a backend job: dump database records, pack uploaded dental files, redact environment secrets, store the archive, then verify it. Cloud off-site upload runs only when S3 credentials are configured.",
      confirmLabel: "Create backup",
      tone: "primary",
    });
    if (!ok) return;
    setBusy("create");
    try {
      const response = await api.createAdminBackup();
      pushToast(response.message || "Backup created.");
      await load();
    } catch (createError) {
      pushToast(createError.message, "error");
      await load();
    } finally {
      setBusy("");
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
      message: `This removes backup ${backup.id} from the catalog. The last known-good backup cannot be deleted. Type confirmation is required.`,
      confirmLabel: "Continue",
      tone: "danger",
    });
    if (!ok) return;
    try {
      await api.deleteAdminBackup(backup.id, { confirmation: "DELETE" });
      pushToast("Backup deleted.");
      await load();
    } catch (deleteError) {
      pushToast(deleteError.message, "error");
    }
  }

  async function saveSettings() {
    setBusy("settings");
    try {
      const response = await api.updateAdminBackupSettings({
        schedule,
        automatic: schedule !== "manual",
        retentionDaily: Number(retentionDaily),
        retentionWeekly: Number(retentionWeekly),
        retentionMonthly: Number(retentionMonthly),
        retentionManual: Number(retentionManual),
        retentionCount: Number(retentionManual),
        alertsEnabled,
      });
      pushToast(response.message || "Backup settings saved.");
      await load();
    } catch (saveError) {
      pushToast(saveError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function uploadBackup(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const ok = await confirm({
      title: "Store this backup file?",
      message:
        "The file will be validated and stored. It will not restore the database until you complete the recovery workflow.",
      confirmLabel: "Upload backup",
      tone: "primary",
    });
    if (!ok) return;
    setBusy("upload");
    try {
      const response = await api.uploadAdminBackup(file);
      pushToast(response.message || "Backup uploaded.");
      await load();
    } catch (uploadError) {
      pushToast(uploadError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function openRecovery(backup) {
    setRestorePhrase("");
    setRecovery({ backup, step: 1, validation: null, isolated: null });
  }

  async function validateRecovery() {
    if (!recovery?.backup) return;
    setBusy("validate");
    try {
      const result = await api.validateAdminBackup(recovery.backup.id);
      setRecovery((current) => ({ ...current, step: Math.max(current.step, 2), validation: result }));
      pushToast(result.message || "Archive validated.");
    } catch (validateError) {
      pushToast(validateError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function runIsolatedRecovery() {
    if (!recovery?.backup) return;
    setBusy("isolated");
    try {
      const result = await api.isolatedRestoreAdminBackup(recovery.backup.id);
      setRecovery((current) => ({ ...current, step: Math.max(current.step, 5), isolated: result }));
      pushToast(result.message || "Isolated restore test finished.");
      await load();
    } catch (isolatedError) {
      pushToast(isolatedError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function submitProductionRestore() {
    if (!recovery?.backup) return;
    if (restorePhrase.trim() !== "RESTORE") {
      pushToast("Type RESTORE to confirm production recovery.", "error");
      return;
    }
    setBusy("restore");
    try {
      const response = await api.restoreAdminBackup(recovery.backup.id, {
        confirmation: "RESTORE",
        mode: "production",
      });
      pushToast(response.message || "Database restored.");
      setRecovery(null);
      setRestorePhrase("");
      await load();
    } catch (restoreError) {
      pushToast(restoreError.message, "error");
    } finally {
      setBusy("");
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
              Existing Backup & Recovery catalog for Amethyst Dental Clinic. Legacy archives remain in PostgreSQL.
              Independent off-site protection is reported only after a verified object-storage copy exists.
            </p>
          </div>
          <div className="admin-heading-actions">
            <button className="button button--secondary" onClick={load} type="button">
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={createBackup} type="button" disabled={jobRunning}>
              <DatabaseBackup size={16} /> {busy === "create" ? "Running…" : "Create Backup"}
            </button>
          </div>
        </div>
        <div className="admin-stats-grid admin-backup-stats">
          {overviewCards.map((card) => (
            <AdminStatCard key={card.label} {...card} />
          ))}
        </div>
        <dl className="admin-backup-meta">
          <div>
            <dt>Storage destination</dt>
            <dd>{storage?.location || "PostgreSQL"}</dd>
          </div>
          <div>
            <dt>Persistent across deploys</dt>
            <dd>{storage?.persistentAcrossDeploys ? "Yes" : "No"}</dd>
          </div>
          <div>
            <dt>Survives a destroyed database</dt>
            <dd>{storage?.survivesDestroyedDatabase ? "Yes — verified off-site copy" : "No — off-site not verified"}</dd>
          </div>
          <div>
            <dt>Point-in-time recovery</dt>
            <dd>{data.pitr?.available ? data.pitr.window : "Unavailable on this plan"}</dd>
          </div>
        </dl>
        {data.lastError ? (
          <p className="inline-alert inline-alert--error">
            <AlertTriangle size={16} /> Latest failed backup: {data.lastError}
          </p>
        ) : null}
        {data.status === "success" && data.latestFailedBackup && data.latestAttemptedBackup?.status === "failed" ? (
          <p className="inline-alert inline-alert--error">
            A newer backup attempt failed after an older successful archive. The successful copy does not hide this failure.
          </p>
        ) : null}
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Create</span>
            <h2>Manual backup</h2>
            <p>
              Jobs move through Queued, Running, Uploading, Verifying, then Completed. Completed is shown only after
              required steps succeed. Environment secrets are redacted; they are never written into the downloadable archive.
            </p>
          </div>
        </div>
        <button className="button button--primary" onClick={createBackup} type="button" disabled={jobRunning}>
          <DatabaseBackup size={16} /> {busy === "create" ? "Working…" : "Create Backup"}
        </button>
      </section>

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">History</span>
            <h2>Backup history</h2>
            <p>Failed attempts stay visible for audit. Legacy database-stored copies are labeled until an independent copy is verified.</p>
          </div>
        </div>
        {backups.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table admin-backup-table">
              <thead>
                <tr>
                  <th>Backup ID</th>
                  <th>Created</th>
                  <th>Type</th>
                  <th>Size</th>
                  <th>Storage</th>
                  <th>Verification</th>
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
                    <td>{backup.backupType}{backup.scheduleSlot ? ` · ${backup.scheduleSlot}` : ""}</td>
                    <td>{bytesLabel(backup.byteSize)}</td>
                    <td>{storageLabel(backup)}</td>
                    <td><AdminStatusBadge status={backup.verificationStatus} /></td>
                    <td><AdminStatusBadge status={backup.pipelineStatus || backup.status} /></td>
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
                          className="button button--secondary button--compact"
                          disabled={!backup.restorable || jobRunning}
                          onClick={() => openRecovery(backup)}
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
            <h2>Safe recovery</h2>
            <p>
              Restore opens a staged workflow: validate, isolated test, then production approval. Production restore stays
              blocked unless the server enables a supervised recovery window. Upload a previously downloaded .dsb without restoring it.
            </p>
          </div>
        </div>
        <label className="button button--secondary">
          <Upload size={16} /> Upload backup
          <input type="file" accept=".dsb,.gz" hidden onChange={uploadBackup} disabled={jobRunning} />
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
        <div className="admin-backup-settings admin-backup-settings--wide">
          <label>
            <span>Schedule policy</span>
            <select value={schedule} onChange={(event) => setSchedule(event.target.value)}>
              <option value="manual">Manual only</option>
              <option value="automatic">Automatic (daily 2:00 AM Asia/Manila, weekly Sunday, monthly 1st)</option>
              <option value="daily">Daily while API is awake (legacy)</option>
              <option value="weekly">Weekly while API is awake (legacy)</option>
            </select>
          </label>
          <label>
            <span>Daily retention</span>
            <input type="number" min="1" max="90" value={retentionDaily} onChange={(event) => setRetentionDaily(event.target.value)} />
          </label>
          <label>
            <span>Weekly retention</span>
            <input type="number" min="1" max="52" value={retentionWeekly} onChange={(event) => setRetentionWeekly(event.target.value)} />
          </label>
          <label>
            <span>Monthly retention</span>
            <input type="number" min="1" max="36" value={retentionMonthly} onChange={(event) => setRetentionMonthly(event.target.value)} />
          </label>
          <label>
            <span>Manual retention</span>
            <input type="number" min="1" max="50" value={retentionManual} onChange={(event) => setRetentionManual(event.target.value)} />
          </label>
          <label className="field field--check">
            <input type="checkbox" checked={alertsEnabled} onChange={(event) => setAlertsEnabled(event.target.checked)} />
            <span>Notify administrators of backup failures</span>
          </label>
          <button className="button button--primary" type="button" onClick={saveSettings} disabled={jobRunning}>
            Save settings
          </button>
        </div>
        <p className="muted admin-backup-footnote">
          Off-site credentials and encryption keys stay on the server. This page never displays them.
          Automatic times are not marked active unless a real external scheduler has been deployed.
        </p>
      </section>

      {details ? (
        <AdminModal title="Backup details" onClose={() => setDetails(null)} wide>
          <dl className="admin-backup-details">
            <div><dt>ID</dt><dd>{details.id}</dd></div>
            <div><dt>Pipeline status</dt><dd>{details.pipelineStatus || details.status}</dd></div>
            <div><dt>Type</dt><dd>{details.backupType}</dd></div>
            <div><dt>Created</dt><dd>{formatAdminDateTime(details.createdAt)}</dd></div>
            <div><dt>Duration</dt><dd>{details.durationMs != null ? `${Math.round(details.durationMs / 1000)}s` : "—"}</dd></div>
            <div><dt>Size</dt><dd>{bytesLabel(details.byteSize)}</dd></div>
            <div><dt>Checksum</dt><dd>{details.checksumSha256 || "—"}</dd></div>
            <div><dt>Storage</dt><dd>{storageLabel(details)}</dd></div>
            <div><dt>Off-site object</dt><dd>{details.offsiteObjectKey || "None"}</dd></div>
            <div><dt>Encryption</dt><dd>{details.encryption || "none"}</dd></div>
            <div><dt>pg_dump</dt><dd>{details.pgDumpStatus || "—"}</dd></div>
            <div><dt>Tables</dt><dd>{details.tableCount} · {details.rowCount} rows</dd></div>
            <div><dt>Files in manifest</dt><dd>{Array.isArray(details.fileManifest) ? details.fileManifest.length : 0}</dd></div>
            <div><dt>Secret fields excluded</dt><dd>{Array.isArray(details.excludedFields) ? details.excludedFields.length : 0}</dd></div>
            <div><dt>Legacy vs independent</dt><dd>{details.offsiteProtected ? "Independently protected" : "Legacy database-stored (not off-site protected)"}</dd></div>
            <div><dt>Error</dt><dd>{details.errorDetail || "None"}</dd></div>
          </dl>
        </AdminModal>
      ) : null}

      {recovery ? (
        <AdminModal title="Recovery workflow" onClose={() => setRecovery(null)} wide>
          <ol className="admin-backup-steps">
            <li className={recovery.step >= 1 ? "is-current" : ""}>
              <strong>1. Select backup</strong>
              <p>
                {recovery.backup.id} · {formatAdminDateTime(recovery.backup.createdAt)} · {storageLabel(recovery.backup)}
              </p>
            </li>
            <li>
              <strong>2. Validate backup</strong>
              <p>Checks archive checksum, format, packed files, and secret-free payload.</p>
              <button className="button button--secondary" type="button" onClick={validateRecovery} disabled={Boolean(busy)}>
                <ShieldCheck size={16} /> {busy === "validate" ? "Validating…" : "Validate archive"}
              </button>
              {recovery.validation ? (
                <p className="muted">
                  Valid · {recovery.validation.tableCount} tables · {recovery.validation.fileCount} files · format v
                  {recovery.validation.formatVersion}
                </p>
              ) : null}
            </li>
            <li>
              <strong>3. Safety backup</strong>
              <p>A safety copy of the current system is created automatically only if production restore is approved and enabled.</p>
            </li>
            <li>
              <strong>4–5. Isolated restore test</strong>
              <p>Restores into a rolled-back transaction. Production tables are not kept changed.</p>
              <button className="button button--secondary" type="button" onClick={runIsolatedRecovery} disabled={Boolean(busy) || !recovery.validation}>
                {busy === "isolated" ? "Testing…" : "Run isolated restore test"}
              </button>
              {recovery.isolated ? (
                <pre className="admin-backup-pre">{JSON.stringify(recovery.isolated.sampleCounts || recovery.isolated.verifiedRowCounts, null, 2)}</pre>
              ) : null}
            </li>
            <li>
              <strong>6–8. Production approval</strong>
              <p>
                {data.productionRestoreEnabled
                  ? "This server currently allows supervised production restore. Type RESTORE. This overwrites live clinic data."
                  : "Production restore is disabled on this server. Isolated tests are the supported recovery verification. Operators must set BACKUP_ALLOW_PRODUCTION_RESTORE=true only for an approved recovery window."}
              </p>
              {data.productionRestoreEnabled ? (
                <>
                  <label className="field">
                    <span>Type RESTORE to confirm production recovery</span>
                    <input value={restorePhrase} onChange={(event) => setRestorePhrase(event.target.value)} autoComplete="off" />
                  </label>
                  <button
                    className="button button--danger"
                    type="button"
                    disabled={Boolean(busy) || restorePhrase.trim() !== "RESTORE" || !recovery.isolated}
                    onClick={submitProductionRestore}
                  >
                    Restore production database
                  </button>
                </>
              ) : null}
            </li>
          </ol>
          <div className="admin-modal__actions">
            <button className="button button--secondary" type="button" onClick={() => setRecovery(null)}>
              Close
            </button>
          </div>
        </AdminModal>
      ) : null}
    </div>
  );
}
