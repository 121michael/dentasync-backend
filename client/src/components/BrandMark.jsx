const LOGO_SRC = "/logo.png";

export function BrandMark({
  compact = false,
  title = "Amethyst Dental",
  subtitle = "Premium Care Portal",
}) {
  return (
    <div className={`brand-mark ${compact ? "brand-mark--compact" : ""}`}>
      <span className="brand-mark__gem" aria-hidden="true">
        <img src={LOGO_SRC} alt="" className="brand-mark__logo" />
      </span>
      {!compact ? (
        <span className="brand-mark__text">
          <strong>{title}</strong>
          {subtitle ? <small>{subtitle}</small> : null}
        </span>
      ) : null}
    </div>
  );
}
