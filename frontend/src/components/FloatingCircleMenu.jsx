import { useEffect, useId, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

function MenuEntry({ item, open, onNavigate }) {
  const Icon = item.icon;
  const content = (
    <>
      <span className="fab-menu__item-icon" aria-hidden="true">
        {Icon ? <Icon size={16} /> : null}
      </span>
      <span>{item.label}</span>
      {item.showDot ? <span className="nav-alert-dot" aria-hidden="true" /> : null}
    </>
  );

  if (item.to) {
    return (
      <NavLink
        to={item.to}
        tabIndex={open ? 0 : -1}
        onClick={() => onNavigate(item.to)}
        className={({ isActive }) => `fab-menu__item${isActive ? " is-active" : ""}`}
      >
        {content}
      </NavLink>
    );
  }

  return (
    <button
      type="button"
      tabIndex={open ? 0 : -1}
      className="fab-menu__item fab-menu__item--action"
      onClick={() => {
        onNavigate();
        item.onSelect?.();
      }}
    >
      {content}
    </button>
  );
}

export function FloatingCircleMenu({ groups, items, onNavigate, hidden = false }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const sections = groups?.length
    ? groups
    : items?.length
      ? [{ id: "menu", label: null, items }]
      : [];

  useEffect(() => {
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  function handleNavigate(to) {
    setOpen(false);
    onNavigate?.(to);
  }

  if (!sections.length) return null;

  return (
    <div className={`fab-menu${open ? " is-open" : ""}${hidden ? " is-hidden" : ""}`}>
      {open ? (
        <button
          type="button"
          className="fab-menu__scrim"
          onClick={() => setOpen(false)}
          aria-label="Close menu"
        />
      ) : null}

      <nav
        className="fab-menu__panel"
        id={panelId}
        aria-label="Navigation menu"
        aria-hidden={!open}
      >
        {sections.map((section) => (
          <div key={section.id || section.label || "menu"} className="fab-menu__group">
            {section.label ? <p className="fab-menu__group-label">{section.label}</p> : null}
            <div className="fab-menu__group-list">
              {(section.items || []).map((item) => (
                <MenuEntry
                  key={item.to || item.label}
                  item={item}
                  open={open}
                  onNavigate={handleNavigate}
                />
              ))}
            </div>
          </div>
        ))}
      </nav>

      <button
        type="button"
        className="fab-menu__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="true"
        aria-label={open ? "Close menu" : "Open menu"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="fab-menu__button-label">Menu</span>
      </button>
    </div>
  );
}
