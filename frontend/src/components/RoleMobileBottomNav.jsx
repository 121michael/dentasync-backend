import { useEffect, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Ellipsis } from "lucide-react";

function pathMatches(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export function RoleMobileBottomNav({
  ariaLabel,
  primary,
  more,
  moreActivePrefixes = [],
  hidden = false,
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
        {primary.map(({ to, label, icon: Icon, showDot }) => (
          <NavLink
            key={to}
            to={to}
            onClick={() => handleNavigate(to)}
            className={({ isActive }) => `role-mobile-nav__link${isActive ? " is-active" : ""}`}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label}</span>
            {showDot ? <span className="nav-alert-dot" aria-hidden="true" /> : null}
          </NavLink>
        ))}
        <button
          type="button"
          className={`role-mobile-nav__link${moreActive || moreOpen ? " is-active" : ""}`}
          aria-expanded={moreOpen}
          aria-haspopup="dialog"
          onClick={() => setMoreOpen((open) => !open)}
        >
          <Ellipsis size={19} aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>
    </div>
  );
}
