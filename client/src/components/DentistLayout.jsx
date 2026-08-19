import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  CalendarDays,
  FolderOpen,
  Gem,
  LayoutDashboard,
  LogOut,
  Menu,
  Stethoscope,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../useAuth";
import { dentistInitials } from "../dentistUtils";

const navigation = [
  { to: "/dentist/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dentist/queue", label: "Patient Queue", icon: UsersRound },
  { to: "/dentist/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/dentist/patient-records", label: "Patient Records", icon: FolderOpen },
  { to: "/dentist/profile", label: "Profile", icon: UserRound },
];

export function DentistLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  useEffect(() => {
    let cancelled = false;
    api
      .getDentistProfile()
      .then((response) => {
        if (!cancelled) setProfile(response.profile);
      })
      .catch(() => {
        if (!cancelled) setProfile(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const displayName =
    profile?.fullName ||
    user?.fullName ||
    `Dr. ${`${user?.firstName || ""} ${user?.lastName || ""}`.trim()}`.trim() ||
    "Dentist";
  const specialization = profile?.specialization || "Dental Specialist";

  return (
    <div className="dentist-shell">
      <aside className={`dentist-sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="dentist-sidebar__brand">
          <span className="dentist-sidebar__gem" aria-hidden="true">
            <Gem size={21} />
          </span>
          <span>
            <strong>AMETHYST</strong>
            <small>Dental Clinic</small>
          </span>
          <button className="dentist-sidebar__close" onClick={() => setIsOpen(false)} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>

        <nav className="dentist-nav" aria-label="Dentist dashboard navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setIsOpen(false)}
              className={({ isActive }) => `dentist-nav__link ${isActive ? "is-active" : ""}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="dentist-sidebar__footer">
          <div className="dentist-user-summary">
            <span className="dentist-user-summary__avatar">{dentistInitials(profile || user)}</span>
            <span>
              <strong>{displayName}</strong>
              <small>{specialization}</small>
            </span>
          </div>
          <button className="dentist-nav__link dentist-nav__button" onClick={handleLogout}>
            <LogOut size={18} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {isOpen ? <button className="dentist-sidebar__scrim" onClick={() => setIsOpen(false)} aria-label="Close navigation" /> : null}

      <div className="dentist-main">
        <header className="dentist-header">
          <button className="dentist-menu-button" onClick={() => setIsOpen((open) => !open)} aria-label="Open dentist navigation">
            <Menu size={21} />
          </button>
          <div>
            <span className="dentist-header__badge">Clinical Workspace</span>
            <p>{date}</p>
          </div>
          <div className="dentist-header__actions">
            <span className="dentist-header__role">
              <Stethoscope size={14} /> Dentist
            </span>
          </div>
        </header>
        <main className="dentist-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
