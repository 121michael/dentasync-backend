import { useEffect, useState } from "react";

export function patientRegistryKey(item) {
  return String(item?.id ?? "");
}

export function patientRegistryName(item) {
  return String(item?.fullName || item?.patientName || "Patient").trim() || "Patient";
}

export function patientRegistryId(item) {
  return String(item?.patientId || item?.recordCode || item?.profileCode || item?.id || "—");
}

export function PatientRegistryPicker({
  items = [],
  onView,
  focusKey = "",
  focusedRef = null,
  emptyLabel = "Select a patient",
  viewLabel = "View patient record",
}) {
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState("");

  useEffect(() => {
    const match = (items || []).find((item) => {
      const id = patientRegistryId(item);
      const key = patientRegistryKey(item);
      const needle = String(focusKey || "").trim();
      if (!needle) return false;
      return key === needle || id === needle || String(item.linkedUserId || "") === needle;
    });
    if (match) setSelected(patientRegistryKey(match));
  }, [items, focusKey]);

  useEffect(() => {
    if (!(items || []).some((item) => patientRegistryKey(item) === selected)) {
      setSelected("");
    }
  }, [items, selected]);

  const needle = filter.trim().toLowerCase();
  const visible = (items || []).filter((item) => {
    if (!needle) return true;
    return `${patientRegistryName(item)} ${patientRegistryId(item)}`.toLowerCase().includes(needle);
  });
  const chosen = visible.find((item) => patientRegistryKey(item) === selected)
    || (items || []).find((item) => patientRegistryKey(item) === selected)
    || null;

  return (
    <div className="patient-registry-picker">
      <label className="patient-registry-picker__field">
        <span>Find in these results</span>
        <input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Type a patient name or ID"
          aria-label="Filter the current search results by patient name or ID"
          autoComplete="off"
        />
      </label>
      <label className="patient-registry-picker__field">
        <span>Patient</span>
        <select
          ref={chosen && focusedRef ? focusedRef : undefined}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          aria-label="Choose a patient by name and ID"
        >
          <option value="">{emptyLabel}</option>
          {visible.map((item) => (
            <option key={patientRegistryKey(item)} value={patientRegistryKey(item)}>
              {patientRegistryName(item)} · {patientRegistryId(item)}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="button button--primary patient-registry-picker__view"
        disabled={!chosen}
        onClick={() => chosen && onView(chosen)}
      >
        {viewLabel}
      </button>
    </div>
  );
}
