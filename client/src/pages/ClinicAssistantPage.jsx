import { useEffect, useRef, useState } from "react";
import { Bot, SendHorizontal, Sparkles } from "lucide-react";
import { api } from "../api";
import { SectionHeading } from "../components/UI";

export function ClinicAssistantPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi — I can help with clinic services, booking, HMO coverage, queue check-in, and general oral-care information. I cannot diagnose conditions or replace your dentist.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  async function sendMessage(event) {
    event.preventDefault();
    const message = input.trim();
    if (!message || busy) return;

    setError("");
    setInput("");
    setMessages((current) => [...current, { role: "user", text: message }]);
    setBusy(true);
    try {
      const response = await api.askClinicAssistant({ message, question: message });
      const answer =
        response.answer ||
        response.message ||
        "I could not find an answer. Please contact the clinic for help.";
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: answer,
          source: response.source || response.model || null,
        },
      ]);
    } catch (sendError) {
      setError(sendError.message);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: "Sorry — I could not reach the clinic assistant just now. Please try again or contact the front desk.",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="assistant-page">
      <SectionHeading
        eyebrow="Clinic information"
        title="AI Clinic Assistant"
        detail="Ask about services, appointments, HMO fields, and queue check-in. Not a medical diagnosis."
      />

      <section className="glass-card assistant-panel">
        <div className="assistant-disclaimer" role="note">
          <Sparkles size={16} aria-hidden="true" />
          <p>
            <strong>Disclaimer:</strong> This assistant provides general clinic information only. It is
            not a diagnosis, prescription, or substitute for professional dental care.
          </p>
        </div>

        {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

        <div className="assistant-thread" ref={listRef} aria-live="polite">
          {messages.map((item, index) => (
            <article
              key={`${item.role}-${index}`}
              className={`assistant-bubble assistant-bubble--${item.role}`}
            >
              {item.role === "assistant" ? (
                <span className="assistant-bubble__avatar" aria-hidden="true">
                  <Bot size={16} />
                </span>
              ) : null}
              <div>
                <p>{item.text}</p>
                {item.source ? <small>Source: {item.source}</small> : null}
              </div>
            </article>
          ))}
          {busy ? (
            <article className="assistant-bubble assistant-bubble--assistant">
              <span className="assistant-bubble__avatar" aria-hidden="true">
                <Bot size={16} />
              </span>
              <p>Thinking…</p>
            </article>
          ) : null}
        </div>

        <form className="assistant-composer" onSubmit={sendMessage}>
          <label className="field assistant-composer__field">
            <span className="sr-only">Your question</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask about services, booking, HMO, or queue…"
              disabled={busy}
              maxLength={800}
            />
          </label>
          <button className="button button--primary" disabled={busy || !input.trim()}>
            <SendHorizontal size={16} /> Send
          </button>
        </form>
      </section>
    </div>
  );
}
