import { useEffect } from "react";
import { AlertCircle, ArrowRight, Sparkles } from "lucide-react";
import { beginPageLoader, endPageLoader } from "../loadingStore";
import { ToothLoader } from "./ToothLoader";

export function LoadingState({ label = "Preparing your care overview", inline = false }) {
  useEffect(() => {
    if (inline) return undefined;
    beginPageLoader(label);
    return () => endPageLoader();
  }, [inline, label]);

  return (
    <ToothLoader
      compact={inline}
      label={label}
      className={inline ? "loading-state loading-state--inline" : "loading-state tooth-loader--page"}
      active
    />
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <section className="empty-state empty-state--error">
      <AlertCircle size={28} />
      <div>
        <h2>We could not load this section</h2>
        <p>{message}</p>
      </div>
      {onRetry && (
        <button className="button button--secondary" onClick={onRetry}>
          Try again
        </button>
      )}
    </section>
  );
}

export function EmptyState({ title, detail, action, icon }) {
  return (
    <section className="empty-state">
      <span className="empty-state__icon">{icon || <Sparkles size={23} />}</span>
      <h2>{title}</h2>
      <p>{detail}</p>
      {action}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, detail, action }) {
  return (
    <div className="section-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {detail && <p>{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function DetailLink({ children, onClick }) {
  return (
    <button className="text-link" onClick={onClick}>
      {children} <ArrowRight size={16} aria-hidden="true" />
    </button>
  );
}
