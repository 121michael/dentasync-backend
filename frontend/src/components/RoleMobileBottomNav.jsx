import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Ellipsis } from "lucide-react";

function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavItem({ to, label, icon: Icon, showDot, onNavigate, className = "role-mobile-nav__link" }) {
  return (
    <NavLink
      to={to}
      onClick={() => onNavigate?.(to)}
      className={({ isActive }) => `${className}${isActive ? " is-active" : ""}`}
    >
      <Icon size={18} aria-hidden="true" />
      <span>{label}</span>
      {showDot ? <span className="nav-alert-dot" aria-hidden="true" /> : null}
    </NavLink>
  );
}

export function CompactRoleNav({ ariaLabel, items, center, className = "" }) {
  const left = items.slice(0, 2);
  const right = items.slice(2);

  return (
    <nav className={`role-mobile-nav ${className}`.trim()} aria-label={ariaLabel}>
      <div className="role-mobile-nav__cluster">
        {left.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
      <div className="role-mobile-nav__center">{center}</div>
      <div className="role-mobile-nav__cluster">
        {right.map((item) => (
          <NavItem key={item.to} {...item} />
        ))}
      </div>
    </nav>
  );
}

export function RoleMobileBottomNav({
  ariaLabel,
  primary,
  more,
  moreActivePrefixes = [],
  hidden = false,
  center = null,
  onNavigate,
}) {
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);

  useEffect(() => {
    setMoreOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!moreOpen) return undefined;
    function onKey(event) {
      if (event.key === "Escape") setMoreOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const moreActive =
    more.some((item) => pathMatches(location.pathname, item.to)) ||
    moreActivePrefixes.some((prefix) => pathMatches(location.pathname, prefix));

  function handleNavigate(to) {
    setMoreOpen(false);
    onNavigate?.(to);
  }

  const left = primary.slice(0, 2);
  const right = primary.slice(2);

  return (
    <div className={`role-mobile-nav-root${hidden ? " is-hidden" : ""}`}>
      {moreOpen ? (
        <button
          type="button"
          className="role-mobile-nav__scrim"
          onClick={() => setMoreOpen(false)}
          aria-label="Close more navigation"
        />
      ) : null}

      {moreOpen ? (
        <div className="role-mobile-nav__sheet" role="dialog" aria-label="More destinations">
          <p className="eyebrow">More</p>
          <nav className="role-mobile-nav__sheet-list">
            {more.map(({ to, label, icon: Icon, showDot }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => handleNavigate(to)}
                className={({ isActive }) => `role-mobile-nav__sheet-link${isActive ? " is-active" : ""}`}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
                {showDot ? <span className="nav-alert-dot" aria-hidden="true" /> : null}
              </NavLink>
            ))}
          </nav>
        </div>
      ) : null}

      <nav className="role-mobile-nav" aria-label={ariaLabel}>
        <div className="role-mobile-nav__cluster">
          {left.map((item) => (
            <NavItem key={item.to} {...item} onNavigate={handleNavigate} />
          ))}
        </div>
        <div className="role-mobile-nav__center">{center}</div>
        <div className="role-mobile-nav__cluster">
          {right.map((item) => (
            <NavItem key={item.to} {...item} onNavigate={handleNavigate} />
          ))}
          <button
            type="button"
            className={`role-mobile-nav__link${moreActive || moreOpen ? " is-active" : ""}`}
            aria-expanded={moreOpen}
            aria-haspopup="dialog"
            onClick={() => setMoreOpen((open) => !open)}
          >
            <Ellipsis size={18} aria-hidden="true" />
            <span>More</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
