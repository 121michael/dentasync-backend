import { useEffect } from "react";
import { Bot } from "lucide-react";
import { SectionHeading } from "../components/UI";
import { usePatientAssistant } from "../patientAssistant";

export function ClinicAssistantPage() {
  const { openAssistant } = usePatientAssistant();

  useEffect(() => {
    openAssistant();
  }, [openAssistant]);

  return (
    <div className="assistant-page">
      <SectionHeading
        eyebrow="Clinic information"
        title="AI Clinic Assistant"
        detail="Ask in English or Tagalog about teeth, oral care, clinic hours, services, and appointments. Magtanong sa English o Tagalog. Attach a dental photo or X-ray with +. Preliminary notes are not a diagnosis."
      />
      <section className="glass-card assistant-route-card">
        <span className="assistant-route-card__mark" aria-hidden="true">
          <Bot size={20} />
        </span>
        <div>
          <h2>The assistant is open in the chat window</h2>
          <p>
            You can keep using the Patient Portal while you chat. Close or minimize the window
            whenever you like — your conversation stays available from the floating chat button.
          </p>
        </div>
        <button type="button" className="button button--primary" onClick={openAssistant}>
          Open AI Assistant
        </button>
      </section>
    </div>
  );
}
