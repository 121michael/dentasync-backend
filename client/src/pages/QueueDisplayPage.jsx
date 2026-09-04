import { useCallback, useEffect, useState } from "react";
import { api } from "../api";

function titleCase(value) {
  return String(value || "waiting")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function QueueDisplayPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [clock, setClock] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const response = await api.getPublicQueueDisplay();
      setData(response);
      setError("");
    } catch (loadError) {
      setError(loadError.message);
    }
  }, []);

  useEffect(() => {
    load();
    const poll = window.setInterval(load, 8000);
    const tick = window.setInterval(() => setClock(new Date()), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(tick);
    };
  }, [load]);

  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  }).format(clock);

  return (
    <main className="queue-display">
      <header className="queue-display__header">
        <div>
          <p className="eyebrow eyebrow--light">Amethyst Dental · Live Queue</p>
          <h1>{data?.clinicName || "Amethyst Dental Clinic"}</h1>
        </div>
        <div className="queue-display__clock">
          <strong>{time}</strong>
          <small>Public waiting-room board</small>
        </div>
      </header>

      {error ? <p className="inline-alert inline-alert--error">{error}</p> : null}

      <section className="queue-display__now">
        <span className="eyebrow eyebrow--light">Now serving</span>
        {data?.nowServing ? (
          <>
            <h2>{data.nowServing.token}</h2>
            <p>
              {data.nowServing.procedure} · {titleCase(data.nowServing.status)}
            </p>
          </>
        ) : (
          <>
            <h2>No active ticket</h2>
            <p>The clinic queue is clear. New check-ins will appear here.</p>
          </>
        )}
      </section>

      <section className="queue-display__list">
        <div className="queue-display__list-head">
          <h3>Up next</h3>
          <small>Token only · no private medical details</small>
        </div>
        {data?.upNext?.length ? (
          <div className="queue-display__grid">
            {data.upNext.map((entry) => (
              <article key={entry.token} className="queue-display__card">
                <strong>{entry.token}</strong>
                <span>#{String(entry.position).padStart(2, "0")}</span>
                <small>{titleCase(entry.status)}</small>
              </article>
            ))}
          </div>
        ) : (
          <p className="queue-display__empty">No additional patients are waiting.</p>
        )}
      </section>
    </main>
  );
}
