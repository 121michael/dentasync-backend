import { useEffect, useMemo, useRef, useState } from "react";
import { Bot, History, ImagePlus, Plus, SendHorizontal, Sparkles, X } from "lucide-react";
import { api } from "../api";
import { SectionHeading } from "../components/UI";

const WELCOME_MESSAGE = {
  role: "assistant",
  text: "Hi — I can help with Amethyst Dental hours, location, services, booking, queue check-in, and questions about teeth and oral care. You can ask in English or Tagalog (or Taglish). Use + to attach a dental photo or X-ray for a preliminary look. I cannot diagnose conditions or replace your dentist.\n\nKumusta — makakatulong ako sa oras, lokasyon, serbisyo, booking, pila, at tanong tungkol sa ngipin. Puwede kang magtanong sa English o Tagalog. Hindi ako makakapag-diagnose o pumalit sa dentista.",
};

function manilaDayStamp(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
}

function groupLabelForDay(day, today) {
  if (day === today) return "Today";
  const todayDate = new Date(`${today}T12:00:00+08:00`);
  todayDate.setUTCDate(todayDate.getUTCDate() - 1);
  const yesterday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(todayDate);
  if (day === yesterday) return "Yesterday";
  return "Earlier";
}

function formatHistoryTime(value, group) {
  const date = new Date(value);
  const time = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  if (group === "Today") return time;
  if (group === "Yesterday") return `Yesterday · ${time}`;
  return new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function groupConversations(conversations) {
  const today = manilaDayStamp(new Date());
  const groups = [];
  const seen = new Map();
  for (const item of conversations) {
    const day = manilaDayStamp(item.updatedAt || item.createdAt);
    const label = groupLabelForDay(day, today);
    if (!seen.has(label)) {
      const group = { label, items: [] };
      seen.set(label, group);
      groups.push(group);
    }
    seen.get(label).items.push(item);
  }
  return groups;
}

export function ClinicAssistantPage() {
  const [messages, setMessages] = useState([WELCOME_MESSAGE]);
  const [conversationId, setConversationId] = useState(null);
  const [input, setInput] = useState("");
  const [attachment, setAttachment] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(true);
  const [unavailableMessage, setUnavailableMessage] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [conversations, setConversations] = useState([]);
  const [openingId, setOpeningId] = useState("");
  const listRef = useRef(null);
  const fileInputRef = useRef(null);

  const groupedHistory = useMemo(() => groupConversations(conversations), [conversations]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await api.getClinicAssistantStatus();
        if (cancelled) return;
        const isAvailable = response.available !== false;
        setAvailable(isAvailable);
        setUnavailableMessage(
          isAvailable
            ? ""
            : response.message ||
              "The AI Clinic Assistant is temporarily unavailable. Please contact the front desk."
        );
      } catch {
        if (!cancelled) {
          setAvailable(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, busy]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function loadHistory() {
    setHistoryLoading(true);
    setHistoryError("");
    try {
      const response = await api.getClinicAssistantConversations();
      setConversations(response.conversations || []);
    } catch (loadError) {
      setHistoryError(loadError.message || "Unable to load chat history.");
    } finally {
      setHistoryLoading(false);
    }
  }

  async function openHistory() {
    setHistoryOpen(true);
    await loadHistory();
  }

  function startNewChat() {
    setConversationId(null);
    setMessages([WELCOME_MESSAGE]);
    setError("");
    setHistoryOpen(false);
  }

  async function openConversation(id) {
    if (!id || openingId) return;
    const previousMessages = messages;
    const previousId = conversationId;
    setOpeningId(id);
    setHistoryError("");
    try {
      const response = await api.getClinicAssistantConversation(id);
      const loaded = (response.messages || []).map((item) => ({
        id: item.id,
        role: item.role || (item.sender === "patient" ? "user" : "assistant"),
        text: item.text,
        source: item.source || null,
        analysis: item.analysis || null,
        attachmentName: item.attachmentName || null,
        createdAt: item.createdAt,
      }));
      setConversationId(response.conversation?.id || id);
      setMessages(loaded.length ? loaded : [WELCOME_MESSAGE]);
      setError("");
      setHistoryOpen(false);
    } catch (openError) {
      setHistoryError(openError.message || "Unable to open that conversation.");
      setMessages(previousMessages);
      setConversationId(previousId);
    } finally {
      setOpeningId("");
    }
  }

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
    if ((!message && !attachment) || busy || !available) return;

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
    const activeConversationId = conversationId;
    clearAttachment();
    setBusy(true);
    try {
      const response = await api.askClinicAssistant({
        message: userText,
        question: userText,
        image: fileToSend || undefined,
        conversationId: activeConversationId || undefined,
      });
      const answer =
        response.answer ||
        response.message ||
        "I could not find an answer. Please contact the clinic for help.";
      if (response.conversationId) {
        setConversationId(response.conversationId);
      }
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
      const disabled =
        /unavailable/i.test(String(sendError.message || "")) ||
        sendError.status === 503;
      if (disabled) {
        setAvailable(false);
        setUnavailableMessage(sendError.message);
      }
      setError(sendError.message);
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          text: disabled
            ? sendError.message
            : "Sorry — I could not reach the clinic assistant just now. Please try again or contact the front desk.",
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
        detail="Ask in English or Tagalog about teeth, oral care, clinic hours, services, and appointments. Magtanong sa English o Tagalog. Attach a dental photo or X-ray with +. Preliminary notes are not a diagnosis."
      />

      <section className="glass-card assistant-panel">
        <div className="assistant-disclaimer" role="note">
          <Sparkles size={16} aria-hidden="true" />
          <p>
            <strong>Disclaimer:</strong> AI-generated information is preliminary and does not replace
            examination or diagnosis by a licensed dentist.
          </p>
        </div>

        <div className="assistant-toolbar">
          <button type="button" className="button button--secondary" onClick={startNewChat}>
            <Plus size={16} aria-hidden="true" /> New Chat
          </button>
          <button
            type="button"
            className="button button--secondary"
            onClick={() => (historyOpen ? setHistoryOpen(false) : openHistory())}
            aria-expanded={historyOpen}
            aria-controls="assistant-history-panel"
          >
            <History size={16} aria-hidden="true" /> Chat History
          </button>
        </div>

        {!available ? (
          <p className="inline-alert inline-alert--error" role="status">
            {unavailableMessage ||
              "The AI Clinic Assistant is temporarily unavailable. Please contact the front desk."}
          </p>
        ) : null}
        {error && available ? <p className="inline-alert inline-alert--error">{error}</p> : null}

        <div className={`assistant-workspace${historyOpen ? " is-history-open" : ""}`}>
          <div className="assistant-thread" ref={listRef} aria-live="polite">
            {messages.map((item, index) => (
              <article
                key={item.id || `${item.role}-${index}`}
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

          {historyOpen ? (
            <aside
              id="assistant-history-panel"
              className="assistant-history"
              aria-label="Chat history"
            >
              <div className="assistant-history__head">
                <div>
                  <p className="assistant-history__eyebrow">Chat History</p>
                  <h2>Previous conversations</h2>
                </div>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setHistoryOpen(false)}
                  aria-label="Close chat history"
                >
                  <X size={16} />
                </button>
              </div>

              {historyLoading ? (
                <p className="assistant-history__status" role="status">
                  Loading conversations…
                </p>
              ) : null}
              {historyError ? (
                <div className="assistant-history__error">
                  <p>{historyError}</p>
                  <button type="button" className="button button--secondary" onClick={loadHistory}>
                    Retry
                  </button>
                </div>
              ) : null}
              {!historyLoading && !historyError && !conversations.length ? (
                <p className="assistant-history__empty">
                  No saved conversations yet. Send a message and it will appear here automatically.
                </p>
              ) : null}
              {!historyLoading
                ? groupedHistory.map((group) => (
                    <section key={group.label} className="assistant-history__group">
                      <h3>{group.label}</h3>
                      <ul>
                        {group.items.map((item) => (
                          <li key={item.id}>
                            <button
                              type="button"
                              className={`assistant-history__item${
                                item.id === conversationId ? " is-active" : ""
                              }`}
                              onClick={() => openConversation(item.id)}
                              disabled={Boolean(openingId)}
                            >
                              <span>{item.title || "New Conversation"}</span>
                              <small>{formatHistoryTime(item.updatedAt || item.createdAt, group.label)}</small>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  ))
                : null}
              {openingId ? (
                <p className="assistant-history__status" role="status">
                  Opening conversation…
                </p>
              ) : null}
            </aside>
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
            disabled={busy || !available}
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
              placeholder="Ask about teeth or the clinic · Magtanong tungkol sa ngipin o klinika…"
              disabled={busy || !available}
              maxLength={800}
            />
          </label>
          <button
            className="button button--primary"
            disabled={busy || !available || (!input.trim() && !attachment)}
          >
            <SendHorizontal size={16} /> Send
          </button>
        </form>
      </section>
    </div>
  );
}
