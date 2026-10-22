import { useRef } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle2, ChevronDown, Clock, LockKeyhole, ShieldCheck, Sparkles } from "lucide-react";
import {
  AboutSection,
  ContactSection,
  LANDING_NAV,
  LandingFooter,
  LandingHeader,
  PORTAL_FEATURES,
  ServicesSection,
  VisitSection,
  scrollToSection,
  useActiveSection,
  useClinicInfo,
  useLandingReveal,
} from "./landing/LandingSections";

export function LandingPage() {
  const { info: clinicInfo, status: clinicInfoStatus, retry: loadClinicInfo } = useClinicInfo();
  const landingRef = useRef(null);
  const activeSection = useActiveSection(LANDING_NAV.map((item) => item.id));
  useLandingReveal(landingRef, clinicInfoStatus);

  return (
    <main className="landing" ref={landingRef}>
      <LandingHeader activeId={activeSection} onNavigate={scrollToSection} />
      <section className="auth-page" id="home" tabIndex={-1} aria-label="Home">
        <div className="auth-page__glow auth-page__glow--one" />
        <div className="auth-page__glow auth-page__glow--two" />
        <section className="auth-showcase">
          <div className="auth-showcase__copy">
            <span className="eyebrow">Private dental care, beautifully connected</span>
            <h1
              className="auth-showcase__tagline"
              aria-label="We create healthy beautiful smiles for your entire family"
            >
              <span className="auth-showcase__tagline-lead">We create</span>
              <span className="auth-showcase__tagline-main">
                <span className="auth-showcase__tagline-emphasis">Healthy</span>
                <span className="auth-showcase__tagline-emphasis auth-showcase__tagline-emphasis--beautiful">
                  Beautiful
                </span>
                <span className="auth-showcase__tagline-accent">Smiles</span>
              </span>
              <span className="auth-showcase__tagline-foot">
                <span className="auth-showcase__tagline-support">
                  <span>For your</span>
                  <span>Entire</span>
                </span>
                <span className="auth-showcase__tagline-family">Family</span>
              </span>
            </h1>
            <p className="auth-showcase__lede">
              Schedule, track, and understand your dental journey through one calm,
              secure patient experience.
            </p>
            <ul className="auth-showcase__highlights" aria-label="Clinic highlights">
              <li>
                <Clock size={16} aria-hidden="true" />
                Open Daily
              </li>
              <li>
                <Sparkles size={16} aria-hidden="true" />
                Free Consultation
              </li>
              <li>
                <ShieldCheck size={16} aria-hidden="true" />
                HMO Accredited
              </li>
            </ul>
            <div className="landing-hero__actions">
              <Link to="/register" className="landing-button landing-button--gold">
                Create Account <ArrowRight size={17} aria-hidden="true" />
              </Link>
              <a
                href="#services"
                className="landing-button landing-button--ghost"
                onClick={(event) => {
                  event.preventDefault();
                  scrollToSection("services");
                }}
              >
                Explore services
              </a>
            </div>
          </div>
          <a
            href="#about"
            className="landing-hero__scroll"
            aria-label="Scroll to About Us"
            onClick={(event) => {
              event.preventDefault();
              scrollToSection("about");
            }}
          >
            <span>Discover</span>
            <ChevronDown size={18} aria-hidden="true" />
          </a>
        </section>

        <section className="auth-panel landing-portal" id="portal" aria-labelledby="portal-title">
          <div className="auth-card landing-portal__card">
            <span className="auth-card__icon">
              <ShieldCheck size={26} aria-hidden="true" />
            </span>
            <span className="eyebrow">Patient portal</span>
            <h2 id="portal-title">Your care, in one secure portal</h2>
            <ul className="landing-portal__features">
              {PORTAL_FEATURES.map((feature) => (
                <li key={feature}>
                  <CheckCircle2 size={17} aria-hidden="true" />
                  {feature}
                </li>
              ))}
            </ul>
            <Link to="/login" className="button button--primary button--wide">
              Sign in <ArrowRight size={18} aria-hidden="true" />
            </Link>
            <Link to="/register" className="button button--secondary button--wide">
              Create account
            </Link>
            <p className="auth-security-note">
              <LockKeyhole size={15} aria-hidden="true" /> Your health information is protected with account-level
              access controls.
            </p>
          </div>
        </section>
      </section>
      <AboutSection hmoProviders={clinicInfo?.hmoProviders} />
      <ServicesSection services={clinicInfo?.services || []} status={clinicInfoStatus} onRetry={loadClinicInfo} />
      <VisitSection
        locations={clinicInfo?.locations || []}
        hours={clinicInfo?.hours}
        status={clinicInfoStatus}
        onRetry={loadClinicInfo}
      />
      <ContactSection clinic={clinicInfo?.clinic} status={clinicInfoStatus} onRetry={loadClinicInfo} />
      <LandingFooter clinicName={clinicInfo?.clinic?.name} />
    </main>
  );
}
