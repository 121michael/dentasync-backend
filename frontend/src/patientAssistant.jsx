import { createContext, useCallback, useContext, useMemo, useState } from "react";

const PatientAssistantContext = createContext(null);

export function PatientAssistantProvider({ children }) {
  const [open, setOpen] = useState(false);

  const openAssistant = useCallback(() => setOpen(true), []);
  const closeAssistant = useCallback(() => setOpen(false), []);
  const toggleAssistant = useCallback(() => setOpen((current) => !current), []);

  const value = useMemo(
    () => ({ open, setOpen, openAssistant, closeAssistant, toggleAssistant }),
    [open, openAssistant, closeAssistant, toggleAssistant]
  );

  return (
    <PatientAssistantContext.Provider value={value}>{children}</PatientAssistantContext.Provider>
  );
}

export function usePatientAssistant() {
  const context = useContext(PatientAssistantContext);
  if (!context) {
    throw new Error("usePatientAssistant must be used within PatientAssistantProvider");
  }
  return context;
}
