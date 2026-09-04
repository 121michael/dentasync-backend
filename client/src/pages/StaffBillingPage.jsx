import { useCallback, useEffect, useState } from "react";
import { Plus, RefreshCw, Search } from "lucide-react";
import { api } from "../api";
import { EmptyState, ErrorState, LoadingState } from "../components/UI";
import { StaffModal, StaffStatusBadge } from "../components/StaffUI";
import { useStaffUi } from "../components/StaffLayout";
import { formatStaffDate } from "../staffUtils";

const emptyInvoice = {
  patientName: "",
  patientPhone: "",
  patientUserId: "",
  appointmentId: "",
  serviceName: "",
  amount: "",
  amountPaid: "0",
  paymentStatus: "pending",
  notes: "",
};

export function StaffBillingPage() {
  const { pushToast } = useStaffUi();
  const [search, setSearch] = useState("");
  const [applied, setApplied] = useState("");
  const [data, setData] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(emptyInvoice);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getStaffBilling(applied));
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, [applied]);

  useEffect(() => {
    load();
  }, [load]);

  async function createInvoice(event) {
    event.preventDefault();
    setBusy("create");
    try {
      const response = await api.createStaffInvoice({
        ...form,
        amount: Number(form.amount),
        amountPaid: Number(form.amountPaid || 0),
        appointmentId: form.appointmentId || null,
      });
      pushToast(response.message || "Invoice generated successfully.");
      setFormOpen(false);
      setForm(emptyInvoice);
      await load();
    } catch (createError) {
      pushToast(createError.message, "error");
    } finally {
      setBusy("");
    }
  }

  async function updatePayment(invoice, updates) {
    setBusy(`pay-${invoice.id}`);
    try {
      const response = await api.updateStaffInvoice(invoice.id, updates);
      pushToast(response.message || "Payment record updated.");
      setSelected(response.invoice);
      await load();
    } catch (updateError) {
      pushToast(updateError.message, "error");
    } finally {
      setBusy("");
    }
  }

  function printInvoice(invoice) {
    const popup = window.open("", "_blank", "width=720,height=900");
    if (!popup) {
      pushToast("Pop-up blocked. Allow pop-ups to print invoices.", "error");
      return;
    }
    popup.document.write(`<!doctype html><html><head><title>${invoice.invoiceCode}</title>
      <style>body{font-family:Georgia,serif;padding:32px;color:#1f1235}h1{color:#5b21b6}table{width:100%;border-collapse:collapse;margin-top:24px}td{padding:8px;border-bottom:1px solid #eadff7}</style>
      </head><body>
      <h1>Amethyst Dental Invoice</h1>
      <p><strong>${invoice.invoiceCode}</strong></p>
      <table>
        <tr><td>Patient</td><td>${invoice.patientName}</td></tr>
        <tr><td>Service</td><td>${invoice.serviceName}</td></tr>
        <tr><td>Amount</td><td>₱${Number(invoice.amount).toFixed(2)}</td></tr>
        <tr><td>Paid</td><td>₱${Number(invoice.amountPaid).toFixed(2)}</td></tr>
        <tr><td>Status</td><td>${invoice.paymentStatus}</td></tr>
        <tr><td>Date</td><td>${invoice.invoiceDate}</td></tr>
        <tr><td>Staff</td><td>${invoice.createdByName || "Clinic Staff"}</td></tr>
      </table>
      <script>window.print()</script>
      </body></html>`);
    popup.document.close();
  }

  if (error && !data) return <ErrorState message={error} onRetry={load} />;
  if (!data) return <LoadingState label="Loading billing center…" />;

  const invoices = data.invoices || [];

  return (
    <div className="staff-page">
      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}
      {data.setupRequired || data.message ? (
        <p className="inline-alert inline-alert--error">{data.message}</p>
      ) : null}

      <section className="staff-panel">
        <div className="staff-panel__heading">
          <div>
            <span className="eyebrow">Front desk finance</span>
            <h2>Billing & Invoice Center</h2>
            <p>Create billing records, update payment status, and print invoices. Online payment processing is not included.</p>
          </div>
          <div className="staff-heading-actions">
            <button className="button button--secondary" onClick={load}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="button button--primary" onClick={() => setFormOpen(true)} disabled={Boolean(data.setupRequired)}>
              <Plus size={16} /> Create Invoice
            </button>
          </div>
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
              placeholder="Search invoice, patient, or service"
            />
          </label>
          <button className="button button--secondary button--compact">Search</button>
        </form>

        {invoices.length ? (
          <div className="staff-table-wrap">
            <table className="staff-table">
              <thead>
                <tr>
                  <th>Transaction ID</th>
                  <th>Invoice ID</th>
                  <th>Patient</th>
                  <th>Appointment</th>
                  <th>Service</th>
                  <th>Amount</th>
                  <th>Payment Status</th>
                  <th>Date</th>
                  <th>Processed By</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>
                      <code>TXN-{invoice.id}</code>
                    </td>
                    <td>
                      <code>{invoice.invoiceCode}</code>
                    </td>
                    <td>
                      <strong>{invoice.patientName}</strong>
                    </td>
                    <td>{invoice.appointmentId ? `#${invoice.appointmentId}` : "—"}</td>
                    <td>{invoice.serviceName}</td>
                    <td>₱{Number(invoice.amount).toFixed(2)}</td>
                    <td>
                      <StaffStatusBadge status={invoice.paymentStatus} />
                    </td>
                    <td>{formatStaffDate(invoice.invoiceDate)}</td>
                    <td>{invoice.createdByName || "—"}</td>
                    <td>
                      <div className="staff-row-actions">
                        <button className="button button--secondary button--compact" onClick={() => setSelected(invoice)}>
                          View
                        </button>
                        <button className="button button--secondary button--compact" onClick={() => printInvoice(invoice)}>
                          Print
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No invoices yet" detail="Create a billing record for a completed or billed service." />
        )}
      </section>

      {formOpen ? (
        <StaffModal title="Generate invoice" onClose={() => setFormOpen(false)} wide>
          <form className="admin-form" onSubmit={createInvoice}>
            <div className="field-grid field-grid--two">
              <label className="field"><span>Patient name</span><input required value={form.patientName} onChange={(e) => setForm((c) => ({ ...c, patientName: e.target.value }))} /></label>
              <label className="field"><span>Patient phone</span><input value={form.patientPhone} onChange={(e) => setForm((c) => ({ ...c, patientPhone: e.target.value }))} /></label>
              <label className="field"><span>Patient user ID</span><input value={form.patientUserId} onChange={(e) => setForm((c) => ({ ...c, patientUserId: e.target.value }))} /></label>
              <label className="field"><span>Appointment ID</span><input value={form.appointmentId} onChange={(e) => setForm((c) => ({ ...c, appointmentId: e.target.value }))} /></label>
              <label className="field"><span>Service</span><input required value={form.serviceName} onChange={(e) => setForm((c) => ({ ...c, serviceName: e.target.value }))} /></label>
              <label className="field"><span>Amount</span><input required type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} /></label>
              <label className="field"><span>Amount paid</span><input type="number" min="0" step="0.01" value={form.amountPaid} onChange={(e) => setForm((c) => ({ ...c, amountPaid: e.target.value }))} /></label>
              <label className="field">
                <span>Payment status</span>
                <select value={form.paymentStatus} onChange={(e) => setForm((c) => ({ ...c, paymentStatus: e.target.value }))}>
                  <option value="pending">Pending</option>
                  <option value="partially_paid">Partially Paid</option>
                  <option value="paid">Paid</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label className="field field--full"><span>Notes</span><textarea rows="3" value={form.notes} onChange={(e) => setForm((c) => ({ ...c, notes: e.target.value }))} /></label>
            </div>
            <button className="button button--primary" disabled={Boolean(busy)}>
              {busy === "create" ? "Creating…" : "Generate Invoice"}
            </button>
          </form>
        </StaffModal>
      ) : null}

      {selected ? (
        <StaffModal title={`Invoice ${selected.invoiceCode}`} onClose={() => setSelected(null)}>
          <div className="staff-detail-grid">
            <p><small>Patient</small><strong>{selected.patientName}</strong></p>
            <p><small>Service</small><strong>{selected.serviceName}</strong></p>
            <p><small>Amount</small><strong>₱{Number(selected.amount).toFixed(2)}</strong></p>
            <p><small>Paid</small><strong>₱{Number(selected.amountPaid).toFixed(2)}</strong></p>
            <p><small>Status</small><strong><StaffStatusBadge status={selected.paymentStatus} /></strong></p>
            <p><small>Staff</small><strong>{selected.createdByName || "—"}</strong></p>
          </div>
          <div className="staff-heading-actions">
            <button
              className="button button--primary"
              disabled={Boolean(busy)}
              onClick={() =>
                updatePayment(selected, {
                  amountPaid: selected.amount,
                  paymentStatus: "paid",
                })
              }
            >
              Mark Paid
            </button>
            <button
              className="button button--secondary"
              disabled={Boolean(busy)}
              onClick={() =>
                updatePayment(selected, {
                  paymentStatus: "partially_paid",
                  amountPaid: Math.max(Number(selected.amountPaid) || 0, Number(selected.amount) / 2),
                })
              }
            >
              Mark Partial
            </button>
            <button className="button button--secondary" onClick={() => printInvoice(selected)}>
              Print / Download
            </button>
          </div>
        </StaffModal>
      ) : null}
    </div>
  );
}
