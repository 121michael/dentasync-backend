import { MessageCircle } from "lucide-react";
import { ClinicAssistantChat } from "./ClinicAssistantChat";
import { usePatientAssistant } from "../patientAssistant";

export function PatientAssistantWidget() {
  const { open, toggleAssistant, closeAssistant } = usePatientAssistant();

  return (
    <div className={`patient-assistant${open ? " is-open" : ""}`}>
      <div
        id="patient-assistant-panel"
        className="patient-assistant__panel"
        role="dialog"
        aria-modal="false"
        aria-labelledby="patient-assistant-title"
      >
        <h2 id="patient-assistant-title" className="sr-only">
          AI Clinic Assistant
        </h2>
        <ClinicAssistantChat compact visible={open} onMinimize={closeAssistant} />
      </div>

      <button
        type="button"
        className="patient-assistant__bubble"
        aria-label={open ? "Close AI Assistant" : "Open AI Assistant"}
        aria-expanded={open}
        aria-controls="patient-assistant-panel"
        onClick={toggleAssistant}
      >
        <MessageCircle size={22} aria-hidden="true" />
      </button>
    </div>
  );
}
