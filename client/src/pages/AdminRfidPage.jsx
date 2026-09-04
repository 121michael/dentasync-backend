import { useCallback, useEffect, useState } from "react";
import { CreditCard, RefreshCw, Search, Trash2 } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { useAdminUi } from "../components/AdminLayout";

export function AdminRfidPage() {
  const { pushToast, confirm } = useAdminUi();
  const [rows, setRows] = useState(null);
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [draftTags, setDraftTags] = useState({});

  const load = useCallback(async () => {
    try {
      const response = await api.listAdminRfidAssignments(applied);
      const users = response.users || response.assignments || response.items || [];
      setRows(users);
      setDraftTags(
        Object.fromEntries(
          users.map((user) => [user.id || user.userId, user.rfidTag || user.rfid_tag || ""])
        )
      );
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function assignTag(user) {
    const userId = user.id || user.userId;
    const rfidTag = String(draftTags[userId] || "").trim();
    if (!rfidTag) {
      pushToast("Enter an RFID tag before assigning.", "error");
      return;
    }
    setBusy(`assign-${userId}`);
    try {
      const response = await api.assignAdminRfid({ userId, rfidTag });
      pushToast(response.message || "RFID tag assigned.");
      await load();
    } catch (assignError) {
      pushToast(assignError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function clearTag(user) {
    const userId = user.id || user.userId;
    const ok = await confirm({
      title: "Clear RFID tag",
      message: `Remove the RFID assignment for ${user.fullName || user.name || user.email}?`,
      confirmLabel: "Clear tag",
    });
    if (!ok) return;
    setBusy(`clear-${userId}`);
    try {
      const response = await api.clearAdminRfid(userId);
      pushToast(response.message || "RFID tag cleared.");
      await load();
    } catch (clearError) {
      pushToast(clearError.message, "error");
    } finally {
      setBusy("");
    }
  }

  if (error && !rows) return <ErrorState message={error} onRetry={load} />;
  if (!rows) return <LoadingState label="Loading RFID assignments…" />;

  return (
    <div className="admin-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="admin-panel">
        <div className="admin-panel__heading">
          <div>
            <span className="eyebrow">Access credentials</span>
            <h2>RFID Tag Assignments</h2>
            <p>Search clinic users and assign or clear RFID tags used for staff check-in.</p>
          </div>
          <button className="button button--secondary" onClick={load}>
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        <form
          className="admin-toolbar"
          onSubmit={(event) => {
            event.preventDefault();
            setApplied(search.trim());
          }}
        >
          <label className="admin-search">
            <Search size={17} />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by name, email, phone, or RFID…"
            />
          </label>
          <button className="button button--secondary button--compact">Search</button>
        </form>

        {rows.length ? (
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role</th>
                  <th>Current RFID</th>
                  <th>Assign / update</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((user) => {
                  const userId = user.id || user.userId;
                  const current = user.rfidTag || user.rfid_tag || "";
                  return (
                    <tr key={userId}>
                      <td>
                        <strong>{user.fullName || user.name || "User"}</strong>
                        <small>{user.email || user.phone || userId}</small>
                      </td>
                      <td>{user.role || "—"}</td>
                      <td>
                        {current ? <code>{current}</code> : <span className="muted-copy">Unassigned</span>}
                      </td>
                      <td>
                        <label className="field">
                          <span className="sr-only">RFID tag</span>
                          <input
                            value={draftTags[userId] || ""}
                            onChange={(event) =>
                              setDraftTags((currentDraft) => ({
                                ...currentDraft,
                                [userId]: event.target.value,
                              }))
                            }
                            placeholder="Scan or type RFID tag"
                          />
                        </label>
                      </td>
                      <td>
                        <div className="staff-row-actions">
                          <button
                            type="button"
                            className="button button--primary button--compact"
                            disabled={Boolean(busy)}
                            onClick={() => assignTag(user)}
                          >
                            <CreditCard size={14} />
                            {busy === `assign-${userId}` ? "Saving…" : "Assign"}
                          </button>
                          {current ? (
                            <button
                              type="button"
                              className="button button--danger button--compact"
                              disabled={Boolean(busy)}
                              onClick={() => clearTag(user)}
                            >
                              <Trash2 size={14} />
                              {busy === `clear-${userId}` ? "Clearing…" : "Clear"}
                            </button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No users found" detail="Try another search term." />
        )}
      </section>
    </div>
  );
}
