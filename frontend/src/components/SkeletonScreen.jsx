function Line({ className = "" }) {
  return <span className={`skeleton-block skeleton-line ${className}`} />;
}

function Cards({ portal }) {
  if (portal === "admin") {
    return (
      <div className="admin-page">
        <section className="admin-welcome-card">
          <div>
            <Line className="skeleton-line--eyebrow" />
            <Line className="skeleton-line--title" />
          </div>
        </section>
        <section className="admin-stat-grid">
          {Array.from({ length: 8 }, (_, index) => (
            <article className="admin-stat-card" key={index}>
              <Line className="skeleton-line--label" />
              <Line className="skeleton-line--value" />
            </article>
          ))}
        </section>
      </div>
    );
  }

  if (portal === "staff") {
    return (
      <div className="staff-page">
        <section className="staff-welcome-card">
          <div>
            <Line className="skeleton-line--eyebrow skeleton-line--on-brand" />
            <Line className="skeleton-line--title skeleton-line--on-brand" />
            <Line className="skeleton-line--text skeleton-line--on-brand" />
          </div>
        </section>
        <section className="staff-stat-grid">
          {Array.from({ length: 4 }, (_, index) => (
            <article className="staff-summary-card" key={index}>
              <Line className="skeleton-line--label" />
              <Line className="skeleton-line--value" />
            </article>
          ))}
        </section>
      </div>
    );
  }

  if (portal === "dentist") {
    return (
      <div className="dentist-page">
        <div className="section-heading">
          <div>
            <Line className="skeleton-line--eyebrow" />
            <Line className="skeleton-line--title" />
            <Line className="skeleton-line--text" />
          </div>
        </div>
        <section className="dentist-stat-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <article className="dentist-stat-card" key={index}>
              <div>
                <Line className="skeleton-line--label" />
                <Line className="skeleton-line--value" />
              </div>
              <span className="skeleton-block skeleton-icon" />
            </article>
          ))}
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <section className="dashboard-welcome">
        <div>
          <Line className="skeleton-line--eyebrow" />
          <Line className="skeleton-line--title" />
          <Line className="skeleton-line--text" />
        </div>
        <span className="skeleton-block skeleton-seal" />
      </section>
      <section className="next-visit-card">
        <span className="skeleton-block skeleton-icon skeleton-icon--on-brand" />
        <div className="next-visit-card__content">
          <Line className="skeleton-line--eyebrow skeleton-line--on-brand" />
          <Line className="skeleton-line--title skeleton-line--on-brand" />
          <Line className="skeleton-line--text skeleton-line--on-brand" />
        </div>
      </section>
      <section className="glass-card patient-checkin-card">
        <Line className="skeleton-line--eyebrow" />
        <Line className="skeleton-line--title" />
        <Line className="skeleton-line--text" />
      </section>
      <section className="metrics-grid">
        {Array.from({ length: 4 }, (_, index) => (
          <article className="metric-card" key={index}>
            <span className="skeleton-block skeleton-icon" />
            <Line className="skeleton-line--label" />
            <Line className="skeleton-line--value" />
            <Line className="skeleton-line--text" />
          </article>
        ))}
      </section>
    </div>
  );
}

function Rows({ history }) {
  if (history) {
    return (
      <div className="appointments-page appointments-page--list">
        <div className="section-heading">
          <div>
            <Line className="skeleton-line--eyebrow" />
            <Line className="skeleton-line--title" />
            <Line className="skeleton-line--text" />
          </div>
        </div>
        <section className="appointment-history">
          <div className="appointment-history__cards">
            {Array.from({ length: 3 }, (_, index) => (
              <article className="appointment-history-card" key={index}>
                <header className="appointment-history-card__header">
                  <Line className="skeleton-line--label" />
                  <span className="skeleton-block skeleton-pill" />
                </header>
                <div className="appointment-history-card__details">
                  {Array.from({ length: 4 }, (_, field) => (
                    <div key={field} className={field === 2 ? "appointment-history-card__service" : undefined}>
                      <Line className="skeleton-line--label" />
                      <Line className="skeleton-line--text" />
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="skeleton-rows">
      <div className="section-heading">
        <div>
          <Line className="skeleton-line--eyebrow" />
          <Line className="skeleton-line--title" />
        </div>
      </div>
      <div className="skeleton-row-list">
        {Array.from({ length: 6 }, (_, index) => (
          <div className="skeleton-row" key={index}>
            <Line className="skeleton-line--label" />
            <Line className="skeleton-line--text" />
            <Line className="skeleton-line--text" />
            <span className="skeleton-block skeleton-pill" />
          </div>
        ))}
      </div>
    </div>
  );
}

function Simple() {
  return (
    <div className="skeleton-simple">
      <Line className="skeleton-line--title" />
      <span className="skeleton-block skeleton-panel" />
      <span className="skeleton-block skeleton-panel skeleton-panel--short" />
    </div>
  );
}

function Inline() {
  return (
    <div className="skeleton-inline">
      <Line className="skeleton-line--title" />
      <Line className="skeleton-line--text" />
    </div>
  );
}

export function skeletonKind(pathname = "") {
  const path = String(pathname || "").split("?")[0];
  if (path === "/dashboard" || path.endsWith("/dashboard")) return "cards";
  if (path.includes("/appointment") || path.includes("/queue") || path.includes("patient-record") || path.includes("/patients")) {
    return "rows";
  }
  return "simple";
}

export function skeletonPortal(pathname = "") {
  const path = String(pathname || "");
  if (path.startsWith("/admin")) return "admin";
  if (path.startsWith("/staff")) return "staff";
  if (path.startsWith("/dentist")) return "dentist";
  return "patient";
}

export function SkeletonScreen({
  label = "Loading",
  kind = "simple",
  portal = "patient",
  history = false,
  inline = false,
  session = false,
  cover = false,
  coverStyle,
}) {
  const text = String(label || "Loading").replace(/[.…\s]+$/u, "") || "Loading";
  const visual = inline ? (
    <Inline />
  ) : kind === "cards" ? (
    <Cards portal={portal} />
  ) : kind === "rows" ? (
    <Rows history={history && !session} />
  ) : (
    <Simple />
  );

  const classes = [
    "skeleton-screen",
    inline ? "skeleton-screen--inline loading-state loading-state--inline" : "loading-state",
    session ? "skeleton-screen--session" : "",
    cover ? "skeleton-screen--cover" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={classes} style={coverStyle} role="status" aria-live="polite" aria-busy="true" aria-label={text}>
      <p className="sr-only">{text}</p>
      {session ? (
        <div className="skeleton-session" aria-hidden="true">
          <aside className="skeleton-session__rail">
            <span className="skeleton-block skeleton-session__brand" />
            {Array.from({ length: 5 }, (_, index) => (
              <span className="skeleton-block skeleton-session__link" key={index} />
            ))}
          </aside>
          <div className="skeleton-session__main">
            <span className="skeleton-block skeleton-session__header" />
            {visual}
          </div>
        </div>
      ) : (
        <div aria-hidden="true">{visual}</div>
      )}
    </div>
  );
}
