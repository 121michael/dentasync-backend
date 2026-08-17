import { Sparkles } from "lucide-react";

export function BrandMark({ compact = false }) {
  return (
    <div className={`brand-mark ${compact ? "brand-mark--compact" : ""}`}>
      <span className="brand-mark__gem" aria-hidden="true">
        <Sparkles size={compact ? 17 : 21} strokeWidth={2.4} />
      </span>
      {!compact && (
        <span className="brand-mark__text">
          <strong>Amethyst Dental</strong>
          <small>Premium Care Portal</small>
        </span>
      )}
    </div>
  );
}
