import { Clock3, Mail, MessageCircleHeart, Phone, ShieldCheck } from "lucide-react";
import { SectionHeading } from "../components/UI";

export function SupportPage() {
  return (
    <div className="support-page">
      <SectionHeading
        eyebrow="We’re here when you need us"
        title="Help & support"
        detail="Reach the Amethyst Dental care team for appointment, records, and portal assistance."
      />
      <section className="support-grid">
        <article className="support-card glass-card">
          <span><Phone size={23} /></span>
          <h2>Call the clinic</h2>
          <p>For appointment changes or urgent dental concerns during clinic hours.</p>
          <a href="tel:+63285551234">+63 2 8555 1234</a>
        </article>
        <article className="support-card glass-card">
          <span><Mail size={23} /></span>
          <h2>Email care support</h2>
          <p>For non-urgent questions about records, coverage, or your account.</p>
          <a href="mailto:care@amethystdental.example">care@amethystdental.example</a>
        </article>
        <article className="support-card glass-card">
          <span><Clock3 size={23} /></span>
          <h2>Clinic hours</h2>
          <p>Monday to Saturday</p>
          <strong>9:00 AM – 6:00 PM</strong>
        </article>
      </section>
      <section className="support-banner">
        <MessageCircleHeart size={28} />
        <div>
          <span className="eyebrow">A calm answer is close</span>
          <h2>For a dental emergency, call the clinic directly.</h2>
          <p>Portal messages are reviewed during standard clinic hours and are not monitored for emergencies.</p>
        </div>
      </section>
      <section className="privacy-banner">
        <ShieldCheck size={20} />
        <div>
          <strong>Your care conversations stay private.</strong>
          <span>Use your authorized patient account whenever you share personal health information.</span>
        </div>
      </section>
    </div>
  );
}
