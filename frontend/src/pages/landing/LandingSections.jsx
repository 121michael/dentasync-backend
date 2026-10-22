import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
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
  RotateCw,
  X,
} from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { BrandMark } from "../../components/BrandMark";

// Covers a Render cold start or a backend that is still redeploying after the static site went live.
const CLINIC_INFO_RETRY_DELAYS_MS = [2000, 5000];

function isClinicInfo(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      value.clinic &&
      typeof value.clinic === "object" &&
      Array.isArray(value.services) &&
      Array.isArray(value.locations) &&
      value.hours &&
      Array.isArray(value.hours.weekly)
  );
}

function isRetryableFailure(error) {
  const status = Number(error?.status);
  return !status || status === 404 || status === 408 || status === 429 || status >= 500;
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function useClinicInfo() {
  const [info, setInfo] = useState(null);
  const [status, setStatus] = useState("loading");
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    setStatus((current) => (current === "ready" ? current : "loading"));
    for (let attempt = 0; ; attempt += 1) {
      try {
        const data = await api.getPublicClinicInfo();
        if (!isClinicInfo(data)) {
          throw Object.assign(new Error("Unexpected clinic info response"), { status: 502 });
        }
        if (requestRef.current !== requestId) return;
        setInfo(data);
        setStatus("ready");
        return;
      } catch (error) {
        if (requestRef.current !== requestId) return;
        const delay = CLINIC_INFO_RETRY_DELAYS_MS[attempt];
        if (delay === undefined || !isRetryableFailure(error)) {
          setStatus((current) => (current === "ready" ? current : "error"));
          return;
        }
        await wait(delay);
        if (requestRef.current !== requestId) return;
      }
    }
  }, []);

  useEffect(() => {
    load();
    return () => {
      requestRef.current += 1;
    };
  }, [load]);

  return { info, status, retry: load };
}

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

export function LandingHeader({ activeId, onNavigate }) {
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
          <Link
            to="/register"
            className="landing-button landing-button--gold landing-header__cta"
            onClick={() => setMenuOpen(false)}
          >
            Create Account
          </Link>
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
      <div className="landing-section__inner">
        <div className="landing-split landing-about">
          <div className="landing-about__intro">
            <SectionHeading id="about-title" eyebrow="About Us" title="Private dental care, beautifully connected.">
              Schedule, track, and understand your dental journey through one calm, secure patient experience.
            </SectionHeading>
            <p className="landing-about__note" data-reveal>
              <LockKeyhole size={16} aria-hidden="true" /> Your health information is protected with account-level access
              controls.
            </p>
          </div>
          <ol className="landing-about__pillars" data-reveal>
            {PORTAL_FEATURES.map((feature, index) => (
              <li key={feature}>
                <span className="landing-about__numeral">{String(index + 1).padStart(2, "0")}</span>
                <strong>{feature}</strong>
              </li>
            ))}
          </ol>
        </div>
        {hmoProviders?.length ? (
          <div className="landing-about__hmo" data-reveal>
            <div className="landing-about__hmo-head">
              <span className="landing-about__hmo-title">
                <BadgeCheck size={17} aria-hidden="true" /> Accredited HMO partners
              </span>
              <small>Clinic staff verify HMO eligibility and coverage for each visit.</small>
            </div>
            <ul>
              {hmoProviders.map((provider) => (
                <li key={provider}>{provider}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function LoadState({ status, onRetry, tone = "light", label, lines = 3 }) {
  if (status === "error") {
    return (
      <p className={`landing-status landing-status--${tone}`} role="status">
        <AlertCircle size={16} aria-hidden="true" />
        <span>{label} could not be loaded right now.</span>
        <button type="button" className="landing-status__retry" onClick={onRetry}>
          <RotateCw size={14} aria-hidden="true" /> Retry
        </button>
      </p>
    );
  }
  return (
    <div className={`landing-skeleton landing-skeleton--${tone}`} role="status" aria-label={`Loading ${label.toLowerCase()}`}>
      {Array.from({ length: lines }, (_, index) => (
        <span key={index} />
      ))}
    </div>
  );
}

export function ServicesSection({ services, status, onRetry }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const active = services[activeIndex] || services[0];

  return (
    <section id="services" className="landing-section landing-section--plum" tabIndex={-1} aria-labelledby="services-title">
      <div className="landing-section__inner">
        <SectionHeading id="services-title" eyebrow="Clinic Services" title="Care for every smile in the family." tone="dark">
          Explore the services patients can request through the Amethyst Dental patient portal.
        </SectionHeading>
        {status === "loading" ? (
          <div className="landing-services-skeleton" role="status" aria-label="Loading services">
            {[0, 1, 2, 3].map((index) => (
              <span key={index} />
            ))}
          </div>
        ) : status === "error" ? (
          <LoadState status={status} onRetry={onRetry} tone="dark" label="Clinic services" />
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
                  <span className="landing-service-card__top">
                    <span className="landing-service-card__index">{String(index + 1).padStart(2, "0")}</span>
                    <span className="landing-service-card__glyph">
                      <ToothGlyph size={26} />
                    </span>
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
              <Link to="/register" className="landing-button landing-button--gold">
                Create Account <ArrowRight size={17} aria-hidden="true" />
              </Link>
            </article>
          </div>
        ) : (
          <p className="landing-status landing-status--dark" role="status">
            Clinic services will be listed here soon.
          </p>
        )}
      </div>
    </section>
  );
}

function LocationCard({ location }) {
  return (
    <span className="landing-location__card">
      <span className="landing-location__icon">
        <MapPin size={20} aria-hidden="true" />
      </span>
      <span className="landing-location__text">
        <strong className="landing-location__name">{location.name}</strong>
        <address>{location.address}</address>
      </span>
    </span>
  );
}

function mapQuery(location) {
  return [location.name, location.address].filter(Boolean).join(", ");
}

const MAP_LOAD_TIMEOUT_MS = 15000;

function ClinicMap({ location }) {
  const frameRef = useRef(null);
  const [inView, setInView] = useState(typeof IntersectionObserver === "undefined");
  const [state, setState] = useState("loading");
  const query = mapQuery(location);
  const src = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&z=17&hl=en&output=embed`;

  useEffect(() => {
    if (inView) return undefined;
    const node = frameRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setInView(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [inView]);

  useEffect(() => {
    if (!inView || state !== "loading") return undefined;
    const timer = window.setTimeout(() => setState("failed"), MAP_LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [inView, state]);

  return (
    <figure className="landing-map" ref={frameRef}>
      {inView ? (
        <iframe
          title={`Map showing ${query}`}
          src={src}
          allowFullScreen
          referrerPolicy="no-referrer-when-downgrade"
          onLoad={() => setState("ready")}
        />
      ) : null}
      {state !== "ready" ? (
        <div className={`landing-map__overlay ${state === "failed" ? "is-failed" : ""}`} role="status">
          <MapPin size={22} aria-hidden="true" />
          {state === "failed" ? (
            <>
              <span>The map could not load right now.</span>
              {location.directionsUrl ? (
                <a href={location.directionsUrl} target="_blank" rel="noopener noreferrer">
                  Open in Google Maps
                </a>
              ) : null}
            </>
          ) : (
            <span>Loading map…</span>
          )}
        </div>
      ) : null}
      {location.directionsUrl ? (
        <figcaption className="landing-map__caption">
          <span>Map not loading?</span>
          <a href={location.directionsUrl} target="_blank" rel="noopener noreferrer">
            Open in Google Maps
          </a>
        </figcaption>
      ) : null}
    </figure>
  );
}

function LocationPanel({ locations, status, onRetry, activeIndex, onSelect }) {
  const active = locations[activeIndex] || locations[0];

  if (status !== "ready") return <LoadState status={status} onRetry={onRetry} label="The clinic location" lines={2} />;
  if (!locations.length) {
    return (
      <p className="landing-status" role="status">
        <MapPin size={16} aria-hidden="true" />
        <span>Our clinic address will be published here once the clinic confirms it.</span>
      </p>
    );
  }
  return (
    <div className="landing-locations">
      {locations.length > 1 ? (
        <SwipeCarousel
          label="Branches"
          tone="light"
          items={locations}
          getKey={(location) => location.id}
          activeIndex={activeIndex}
          onSelect={onSelect}
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
  if (status !== "ready") return <LoadState status={status} onRetry={onRetry} label="Opening hours" />;
  const today = hours?.today;
  const todayRowId = today && ["weekday", "weekend", "holiday"].includes(today.source) ? today.source : null;
  const upcoming = (hours?.exceptions || []).slice(0, 6);

  return (
    <div className="landing-hours">
      {today ? (
        <p className={`landing-hours__today ${today.closed ? "is-closed" : ""}`}>
          <Clock size={16} aria-hidden="true" />
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
            <CalendarClock size={15} aria-hidden="true" /> Upcoming schedule changes
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
  const [activeIndex, setActiveIndex] = useState(0);
  const active = locations[activeIndex] || locations[0];
  const hasMap = status === "loading" || (status === "ready" && Boolean(active?.address));

  return (
    <section id="locations" className="landing-section landing-section--ivory" tabIndex={-1} aria-labelledby="locations-title">
      <div className={`landing-section__inner landing-visit ${hasMap ? "has-map" : "landing-split"}`}>
        <div className="landing-visit__column landing-visit__location">
          <SectionHeading id="locations-title" eyebrow="Locations" title="Visit the clinic." />
          <div className={status === "error" ? "landing-panel-slot" : "landing-panel"} data-reveal>
            <LocationPanel
              locations={locations}
              status={status}
              onRetry={onRetry}
              activeIndex={activeIndex}
              onSelect={setActiveIndex}
            />
          </div>
        </div>
        {hasMap ? (
          <div className="landing-visit__map" data-reveal>
            {status === "ready" ? (
              <ClinicMap key={active.id} location={active} />
            ) : (
              <div className="landing-map landing-map--placeholder" role="status" aria-label="Loading clinic map" />
            )}
          </div>
        ) : null}
        <div className="landing-visit__column landing-visit__hours" id="hours" tabIndex={-1} aria-labelledby="hours-title" role="region">
          <SectionHeading id="hours-title" eyebrow="Operating Hours" title="Opening times." />
          <div className={status === "error" ? "landing-panel-slot" : "landing-panel"} data-reveal>
            <HoursPanel hours={hours} status={status} onRetry={onRetry} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function ContactSection({ clinic, status, onRetry }) {
  const phoneHref = telHref(clinic?.phone);
  const hasContact = Boolean(clinic?.phone || clinic?.email || clinic?.address);

  return (
    <section id="contact" className="landing-section landing-section--plum landing-contact" tabIndex={-1} aria-labelledby="contact-title">
      <div className="landing-section__inner landing-split">
        <SectionHeading id="contact-title" eyebrow="Contact Us" title="We would love to welcome you." tone="dark">
          Reach the clinic directly, or create your patient account to manage appointments online.
        </SectionHeading>
        <div className="landing-contact__details" data-reveal>
          {status !== "ready" ? (
            <LoadState status={status} onRetry={onRetry} tone="dark" label="Contact details" />
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
            <p className="landing-status landing-status--dark" role="status">
              Contact details will appear here once the clinic publishes them.
            </p>
          )}
          <Link to="/register" className="landing-button landing-button--gold">
            Create Account <ArrowRight size={17} aria-hidden="true" />
          </Link>
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
