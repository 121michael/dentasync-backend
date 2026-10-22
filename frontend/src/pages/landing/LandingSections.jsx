import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock,
  LockKeyhole,
  Mail,
  MapPin,
  Menu,
  Navigation,
  Phone,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../components/BrandMark";

export const LANDING_NAV = [
  { id: "home", label: "Home" },
  { id: "about", label: "About Us" },
  { id: "services", label: "Services" },
  { id: "locations", label: "Locations" },
  { id: "contact", label: "Contact Us" },
];

const PORTAL_FEATURES = [
  "Effortless appointment planning",
  "Secure treatment record access",
  "Real-time clinic queue updates",
];

const WEEKLY_LABELS = {
  weekday: "Monday – Friday",
  weekend: "Saturday – Sunday",
  holiday: "Public holidays",
};

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function scrollToSection(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const behavior = prefersReducedMotion() ? "auto" : "smooth";
  if (id === LANDING_NAV[0].id) {
    window.scrollTo({ top: 0, behavior });
  } else {
    target.scrollIntoView({ behavior, block: "start" });
  }
  if (target.tabIndex < 0 && target.hasAttribute("tabindex")) {
    target.focus({ preventScroll: true });
  }
}

export function useLandingReveal(rootRef, contentKey) {
  useEffect(() => {
    const root = rootRef.current;
    if (!root || prefersReducedMotion() || typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 }
    );
    root.querySelectorAll("[data-reveal]:not(.is-revealed)").forEach((element) => observer.observe(element));
    root.classList.add("landing--reveal-ready");
    return () => observer.disconnect();
  }, [rootRef, contentKey]);
}

export function useActiveSection(ids) {
  const [activeId, setActiveId] = useState(ids[0]);
  const key = ids.join("|");
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) setActiveId(visible[0].target.id);
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    key.split("|").forEach((id) => {
      const element = document.getElementById(id);
      if (element) observer.observe(element);
    });
    return () => observer.disconnect();
  }, [key]);
  return activeId;
}

export function formatClinicTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return "";
  const hours = Number(match[1]);
  const suffix = hours >= 12 ? "PM" : "AM";
  return `${hours % 12 || 12}:${match[2]} ${suffix}`;
}

function formatHourRange(open, close) {
  const start = formatClinicTime(open);
  const end = formatClinicTime(close);
  return start && end ? `${start} – ${end}` : "Closed";
}

function formatScheduleDate(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return new Intl.DateTimeFormat("en-PH", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function telHref(phone) {
  const digits = String(phone || "").replace(/[^\d+]/g, "");
  return digits ? `tel:${digits}` : null;
}

function ToothGlyph({ size = 30 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        d="M15.5 6.5c-5.2 0-9 4.1-9 9.8 0 4.6 1.9 7.7 2.9 11.6 1.2 4.9 2 14.1 6.1 14.1 3.1 0 3.2-6.8 5.1-10.7.9-1.9 2-2.9 3.4-2.9s2.5 1 3.4 2.9c1.9 3.9 2 10.7 5.1 10.7 4.1 0 4.9-9.2 6.1-14.1 1-3.9 2.9-7 2.9-11.6 0-5.7-3.8-9.8-9-9.8-3.8 0-5.7 2-8.5 2s-4.7-2-8.5-2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M17 13.5c1.6-1 3.4-1.1 5-.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
    </svg>
  );
}

function SectionHeading({ eyebrow, title, children, id, tone = "light" }) {
  return (
    <div className={`landing-heading landing-heading--${tone}`} data-reveal>
      <span className="landing-eyebrow">{eyebrow}</span>
      <h2 id={id}>{title}</h2>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

function SwipeCarousel({ label, items, getKey, activeIndex, onSelect, renderItem, tone = "dark" }) {
  const trackRef = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });

  const updateEdges = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges({
      start: track.scrollLeft <= 4,
      end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 4,
    });
  }, []);

  useEffect(() => {
    updateEdges();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateEdges);
    observer.observe(track);
    return () => observer.disconnect();
  }, [updateEdges, items.length]);

  function behavior() {
    return prefersReducedMotion() ? "auto" : "smooth";
  }

  function scrollPage(direction) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(track.clientWidth * 0.8, 200), behavior: behavior() });
  }

  function revealItem(index) {
    const track = trackRef.current;
    const item = track?.children[index];
    if (!track || !item) return;
    const start = item.offsetLeft;
    const end = start + item.offsetWidth;
    if (start < track.scrollLeft) {
      track.scrollTo({ left: start - 16, behavior: behavior() });
    } else if (end > track.scrollLeft + track.clientWidth) {
      track.scrollTo({ left: end - track.clientWidth + 16, behavior: behavior() });
    }
  }

  function select(index) {
    onSelect(index);
    revealItem(index);
  }

  function handleKeyDown(event) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = Math.min(items.length - 1, Math.max(0, activeIndex + (event.key === "ArrowRight" ? 1 : -1)));
    select(next);
    trackRef.current?.children[next]?.querySelector("button")?.focus({ preventScroll: true });
  }

  return (
    <div className={`landing-carousel landing-carousel--${tone}`} role="region" aria-roledescription="carousel" aria-label={label}>
      <div className="landing-carousel__bar">
        <span className="landing-carousel__count" aria-live="polite">
          {String(activeIndex + 1).padStart(2, "0")} <span aria-hidden="true">/</span>
          <span className="sr-only"> of </span> {String(items.length).padStart(2, "0")}
        </span>
        <div className="landing-carousel__arrows">
          <button type="button" onClick={() => scrollPage(-1)} disabled={edges.start} aria-label={`Previous ${label.toLowerCase()}`}>
            <ChevronLeft size={18} />
          </button>
          <button type="button" onClick={() => scrollPage(1)} disabled={edges.end} aria-label={`Next ${label.toLowerCase()}`}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <ul className="landing-carousel__track" ref={trackRef} onScroll={updateEdges} onKeyDown={handleKeyDown}>
        {items.map((item, index) => (
          <li key={getKey(item)} className="landing-carousel__item">
            <button
              type="button"
              className={`landing-carousel__card ${index === activeIndex ? "is-active" : ""}`}
              aria-pressed={index === activeIndex}
              onClick={() => select(index)}
            >
              {renderItem(item, index)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LandingHeader({ activeId, onNavigate, onCreateAccount }) {
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const closeOnEscape = (event) => event.key === "Escape" && setMenuOpen(false);
    const closeOnDesktop = () => window.innerWidth > 900 && setMenuOpen(false);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", closeOnDesktop);
    return () => {
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", closeOnDesktop);
    };
  }, [menuOpen]);

  function go(event, id) {
    event.preventDefault();
    setMenuOpen(false);
    onNavigate(id);
  }

  return (
    <header className={`landing-header ${menuOpen ? "is-menu-open" : ""}`}>
      <div className="landing-header__bar">
        <a href="#home" className="landing-header__brand" onClick={(event) => go(event, "home")} aria-label="Amethyst Dental home">
          <BrandMark />
        </a>
        <nav className="landing-header__nav" id="landing-nav" aria-label="Landing page">
          <ul>
            {LANDING_NAV.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={activeId === item.id ? "is-active" : ""}
                  aria-current={activeId === item.id ? "true" : undefined}
                  onClick={(event) => go(event, item.id)}
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="landing-header__actions">
          <button
            type="button"
            className="landing-button landing-button--gold landing-header__cta"
            onClick={() => {
              setMenuOpen(false);
              onCreateAccount();
            }}
          >
            Create Account
          </button>
          <button
            type="button"
            className="landing-header__toggle"
            aria-expanded={menuOpen}
            aria-controls="landing-nav"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {menuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
    </header>
  );
}

export function AboutSection({ hmoProviders }) {
  return (
    <section id="about" className="landing-section landing-section--ivory" tabIndex={-1} aria-labelledby="about-title">
      <div className="landing-section__inner landing-about">
        <SectionHeading id="about-title" eyebrow="About Us" title="Private dental care, beautifully connected.">
          Schedule, track, and understand your dental journey through one calm, secure patient experience.
        </SectionHeading>
        <ol className="landing-about__pillars" data-reveal>
          {PORTAL_FEATURES.map((feature, index) => (
            <li key={feature}>
              <span className="landing-about__numeral">{String(index + 1).padStart(2, "0")}</span>
              <strong>{feature}</strong>
            </li>
          ))}
        </ol>
        <p className="landing-about__note" data-reveal>
          <LockKeyhole size={16} aria-hidden="true" /> Your health information is protected with account-level access controls.
        </p>
        {hmoProviders?.length ? (
          <div className="landing-about__hmo" data-reveal>
            <span className="landing-about__hmo-title">
              <BadgeCheck size={17} aria-hidden="true" /> Accredited HMO partners
            </span>
            <ul>
              {hmoProviders.map((provider) => (
                <li key={provider}>{provider}</li>
              ))}
            </ul>
            <small>Clinic staff verify HMO eligibility and coverage for each visit.</small>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LoadState({ status, onRetry, tone = "light", label }) {
  if (status === "error") {
    return (
      <div className={`landing-empty landing-empty--${tone}`} role="status">
        <p>{label} is temporarily unavailable.</p>
        <button type="button" className="landing-button landing-button--outline" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <div className={`landing-skeleton landing-skeleton--${tone}`} aria-busy="true" aria-label={`Loading ${label.toLowerCase()}`}>
      <span />
      <span />
      <span />
    </div>
  );
}

export function ServicesSection({ services, status, onRetry, onCreateAccount }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = services[activeIndex] || services[0];

  return (
    <section id="services" className="landing-section landing-section--plum" tabIndex={-1} aria-labelledby="services-title">
      <div className="landing-section__inner">
        <SectionHeading id="services-title" eyebrow="Clinic Services" title="Care for every smile in the family." tone="dark">
          Explore the services patients can request through the Amethyst Dental patient portal.
        </SectionHeading>
        {status !== "ready" ? (
          <LoadState status={status} onRetry={onRetry} tone="dark" label="The service list" />
        ) : services.length ? (
          <div className="landing-services" data-reveal>
            <SwipeCarousel
              label="Services"
              items={services}
              getKey={(service) => service.id}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
              renderItem={(service, index) => (
                <>
                  <span className="landing-service-card__index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="landing-service-card__glyph">
                    <ToothGlyph />
                  </span>
                  <strong>{service.name}</strong>
                </>
              )}
            />
            <article className="landing-service-detail" aria-live="polite" key={active.id}>
              <span className="landing-eyebrow">Service {String(activeIndex + 1).padStart(2, "0")}</span>
              <h3>{active.name}</h3>
              {active.description ? <p>{active.description}</p> : null}
              <p className="landing-service-detail__how">
                Create your patient account to request this service once the clinic approves your registration.
              </p>
              <button type="button" className="landing-button landing-button--gold" onClick={onCreateAccount}>
                Create Account <ArrowRight size={17} aria-hidden="true" />
              </button>
            </article>
          </div>
        ) : (
          <div className="landing-empty landing-empty--dark" role="status">
            <p>Clinic services will be listed here soon.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function LocationCard({ location }) {
  return (
    <>
      <span className="landing-location__icon">
        <MapPin size={22} aria-hidden="true" />
      </span>
      <strong className="landing-location__name">{location.name}</strong>
      <address>{location.address}</address>
    </>
  );
}

function LocationPanel({ locations, status, onRetry }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = locations[activeIndex] || locations[0];

  if (status !== "ready") return <LoadState status={status} onRetry={onRetry} label="Clinic location" />;
  if (!locations.length) {
    return (
      <div className="landing-empty" role="status" data-reveal>
        <MapPin size={22} aria-hidden="true" />
        <p>Our clinic address will be published here once the clinic confirms it.</p>
      </div>
    );
  }
  return (
    <div className="landing-locations" data-reveal>
      {locations.length > 1 ? (
        <SwipeCarousel
          label="Branches"
          tone="light"
          items={locations}
          getKey={(location) => location.id}
          activeIndex={activeIndex}
          onSelect={setActiveIndex}
          renderItem={(location) => <LocationCard location={location} />}
        />
      ) : null}
      <article className="landing-location" aria-live="polite">
        <LocationCard location={active} />
        {active.directionsUrl ? (
          <a className="landing-button landing-button--plum" href={active.directionsUrl} target="_blank" rel="noopener noreferrer">
            <Navigation size={16} aria-hidden="true" /> Get directions
          </a>
        ) : null}
      </article>
    </div>
  );
}

function HoursPanel({ hours, status, onRetry }) {
  if (status !== "ready") return <LoadState status={status} onRetry={onRetry} label="The clinic schedule" />;
  const today = hours?.today;
  const todayRowId = today && ["weekday", "weekend", "holiday"].includes(today.source) ? today.source : null;
  const upcoming = (hours?.exceptions || []).slice(0, 6);

  return (
    <div className="landing-hours__panel" data-reveal>
      {today ? (
        <p className={`landing-hours__today ${today.closed ? "is-closed" : ""}`}>
          <Clock size={17} aria-hidden="true" />
          {today.closed ? "Closed today" : `Open today · ${formatHourRange(today.open, today.close)}`}
          {today.source === "custom" ? <span> (special hours)</span> : null}
          {today.isHoliday && !today.closed ? <span> (holiday hours)</span> : null}
        </p>
      ) : null}
      <dl className="landing-hours__table">
        {(hours?.weekly || []).map((row) => (
          <div key={row.id} className={row.id === todayRowId ? "is-today" : ""}>
            <dt>
              {WEEKLY_LABELS[row.id] || row.id}
              {row.id === todayRowId ? <span className="landing-hours__badge">Today</span> : null}
            </dt>
            <dd className={!row.open || !row.close ? "is-closed" : ""}>{formatHourRange(row.open, row.close)}</dd>
          </div>
        ))}
      </dl>
      {upcoming.length ? (
        <div className="landing-hours__exceptions">
          <span className="landing-hours__exceptions-title">
            <CalendarClock size={16} aria-hidden="true" /> Upcoming schedule changes
          </span>
          <ul>
            {upcoming.map((day) => (
              <li key={day.date} className={day.closed ? "is-closed" : ""}>
                <span>{formatScheduleDate(day.date)}</span>
                <span>
                  {day.closed
                    ? "Closed"
                    : `${day.isHoliday ? "Holiday hours" : "Special hours"} · ${formatHourRange(day.open, day.close)}`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function VisitSection({ locations, hours, status, onRetry }) {
  return (
    <section id="locations" className="landing-section landing-section--ivory" tabIndex={-1} aria-labelledby="locations-title">
      <div className="landing-section__inner landing-visit">
        <div className="landing-visit__column">
          <SectionHeading id="locations-title" eyebrow="Locations" title="Visit the clinic." />
          <LocationPanel locations={locations} status={status} onRetry={onRetry} />
        </div>
        <div className="landing-visit__column" id="hours" tabIndex={-1} aria-labelledby="hours-title" role="region">
          <SectionHeading id="hours-title" eyebrow="Operating Hours" title="Opening times." />
          <HoursPanel hours={hours} status={status} onRetry={onRetry} />
        </div>
      </div>
    </section>
  );
}

export function ContactSection({ clinic, status, onRetry, onCreateAccount }) {
  const phoneHref = telHref(clinic?.phone);
  const hasContact = Boolean(clinic?.phone || clinic?.email);

  return (
    <section id="contact" className="landing-section landing-section--plum landing-contact" tabIndex={-1} aria-labelledby="contact-title">
      <div className="landing-section__inner landing-contact__grid">
        <SectionHeading id="contact-title" eyebrow="Contact Us" title="We would love to welcome you." tone="dark">
          Reach the clinic directly, or create your patient account to manage appointments online.
        </SectionHeading>
        <div className="landing-contact__card" data-reveal>
          {status !== "ready" ? (
            <LoadState status={status} onRetry={onRetry} tone="dark" label="Contact information" />
          ) : hasContact ? (
            <ul className="landing-contact__list">
              {clinic.phone ? (
                <li>
                  <Phone size={18} aria-hidden="true" />
                  <span>
                    <small>Call the clinic</small>
                    {phoneHref ? <a href={phoneHref}>{clinic.phone}</a> : clinic.phone}
                  </span>
                </li>
              ) : null}
              {clinic.email ? (
                <li>
                  <Mail size={18} aria-hidden="true" />
                  <span>
                    <small>Email</small>
                    <a href={`mailto:${clinic.email}`}>{clinic.email}</a>
                  </span>
                </li>
              ) : null}
              {clinic.address ? (
                <li>
                  <MapPin size={18} aria-hidden="true" />
                  <span>
                    <small>Address</small>
                    {clinic.address}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="landing-contact__empty">
              Contact details will appear here once the clinic publishes them.
            </p>
          )}
          <button type="button" className="landing-button landing-button--gold" onClick={onCreateAccount}>
            Create Account <ArrowRight size={17} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}

export function LandingFooter({ clinicName }) {
  return (
    <footer className="landing-footer">
      <div className="landing-section__inner landing-footer__inner">
        <BrandMark />
        <p>
          <Link to="/terms">Terms &amp; Conditions</Link>
          <span aria-hidden="true"> · </span>
          <Link to="/privacy">Privacy Notice</Link>
        </p>
        <small>
          © {new Date().getFullYear()} {clinicName || "Amethyst Dental Clinic"}
        </small>
      </div>
    </footer>
  );
}
