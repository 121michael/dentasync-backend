import { Clock3, Mail, Phone } from "lucide-react";
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
          <p>Weekdays 9:00 AM – 4:00 PM. Weekends and holidays 11:00 AM – 4:00 PM, unless the clinic schedule is updated.</p>
          <strong>Mon–Fri 9–4 · Sat–Sun 11–4</strong>
        </article>
      </section>
    </div>
  );
}
