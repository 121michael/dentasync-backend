import { useEffect, useId, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";

export function FloatingCircleMenu({ items, onNavigate, hidden = false }) {
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();

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

  if (!items?.length) return null;

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
        aria-label="Quick destinations"
        hidden={!open}
      >
        {items.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            tabIndex={open ? 0 : -1}
            onClick={() => handleNavigate(to)}
            className={({ isActive }) => `fab-menu__item${isActive ? " is-active" : ""}`}
          >
            <span className="fab-menu__item-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
            <span>{label}</span>
          </NavLink>
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
