import { useEffect, useRef, useState } from "react";
import { Bot, ImagePlus, SendHorizontal, Sparkles, X } from "lucide-react";
import { api } from "../api";
import { SectionHeading } from "../components/UI";

export function ClinicAssistantPage() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hi — I can help with clinic services, booking, HMO coverage, queue check-in, and general oral-care information. Use the + button to attach a dental photo or X-ray for preliminary review. I cannot diagnose conditions or replace your dentist.",
    },
  ]);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const listRef = useRef(null);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function clearAttachment() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setAttachment(null);
    setPreviewUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function onPickFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setAttachment(file);
    setPreviewUrl(URL.createObjectURL(file));
    setError("");
  }

  async function sendMessage(event) {
    event.preventDefault();
    const message = input.trim();
    if ((!message && !attachment) || busy) return;

    setError("");
    setInput("");
    const userText = message || "Please review this dental image.";
    setMessages((current) => [
      ...current,
      {
        role: "user",
        text: userText,
        attachmentName: attachment?.name || null,
        attachmentPreview: previewUrl || null,
      },
    ]);
    const fileToSend = attachment;
    clearAttachment();
    setBusy(true);
    try {
      const response = await api.askClinicAssistant({
        message: userText,
        question: userText,
        image: fileToSend || undefined,
      });
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
          analysis: response.analysis || null,
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
        detail="Ask about services and appointments, or attach a dental photo/X-ray with +. Preliminary image notes are not a diagnosis."
      />

      <section className="glass-card assistant-panel">
        <div className="assistant-disclaimer" role="note">
          <Sparkles size={16} aria-hidden="true" />
          <p>
            <strong>Disclaimer:</strong> AI-generated information is preliminary and does not replace
            examination or diagnosis by a licensed dentist.
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
                {item.attachmentName ? (
                  <small className="assistant-attachment-label">Attached: {item.attachmentName}</small>
                ) : null}
                {item.analysis?.possibleToothNumber ? (
                  <small>
                    Possible tooth {item.analysis.possibleToothNumber}
                    {item.analysis.possibleSurface
                      ? ` · ${item.analysis.possibleSurface}`
                      : ""}{" "}
                    (preliminary)
                  </small>
                ) : null}
                {item.source ? <small>Source: {item.source}</small> : null}
              </div>
            </article>
          ))}
          {busy ? (
            <article className="assistant-bubble assistant-bubble--assistant">
              <span className="assistant-bubble__avatar" aria-hidden="true">
                <Bot size={16} />
              </span>
              <p>{attachment || messages.at(-1)?.attachmentName ? "Reviewing image…" : "Thinking…"}</p>
            </article>
          ) : null}
        </div>

        {attachment ? (
          <div className="assistant-attachment-chip">
            <ImagePlus size={15} />
            <span>{attachment.name}</span>
            <button type="button" className="icon-button" onClick={clearAttachment} aria-label="Remove attachment">
              <X size={14} />
            </button>
          </div>
        ) : null}

        <form className="assistant-composer" onSubmit={sendMessage}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="sr-only"
            onChange={onPickFile}
          />
          <button
            type="button"
            className="button button--secondary assistant-attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            aria-label="Attach dental photo or X-ray"
            title="Attach dental photo or X-ray"
          >
            <ImagePlus size={18} />
            <span aria-hidden="true">+</span>
          </button>
          <label className="field assistant-composer__field">
            <span className="sr-only">Your question</span>
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Ask the AI Assistant… or attach an image with +"
              disabled={busy}
              maxLength={800}
            />
          </label>
          <button
            className="button button--primary"
            disabled={busy || (!input.trim() && !attachment)}
          >
            <SendHorizontal size={16} /> Send
          </button>
        </form>
      </section>
    </div>
  );
}
