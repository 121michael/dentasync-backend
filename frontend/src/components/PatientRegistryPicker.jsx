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

  const chosen = (items || []).find((item) => patientRegistryKey(item) === selected) || null;

  return (
    <div className="patient-registry-picker">
      <label className="patient-registry-picker__field">
        <span>Patient</span>
        <select
          ref={chosen && focusedRef ? focusedRef : undefined}
          value={selected}
          onChange={(event) => setSelected(event.target.value)}
          aria-label="Search results: choose a patient by name and ID"
        >
          <option value="">{emptyLabel}</option>
          {(items || []).map((item) => (
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
