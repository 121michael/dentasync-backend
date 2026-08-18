import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  ClipboardPlus,
  Gem,
  LogOut,
  Menu,
  Stethoscope,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../useAuth";
import { staffInitials } from "./StaffUI";

const navigation = [
  { to: "/staff/check-ins", label: "Patient Check-in", icon: ClipboardPlus },
  { to: "/staff/queue", label: "Queue Management", icon: UsersRound },
  { to: "/staff/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/staff/patients", label: "Patient Record", icon: Stethoscope },
  { to: "/staff/notifications", label: "Notifications", icon: Bell },
  { to: "/staff/profile", label: "Profile", icon: UserRound },
];

function StaffNavigation({ onNavigate }) {
  return (
    <nav className="staff-nav" aria-label="Staff dashboard navigation">
      {navigation.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) => `staff-nav__link ${isActive ? "is-active" : ""}`}
        >
          <Icon size={19} aria-hidden="true" />
          <span>{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function StaffLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function closeMenu() {
    setIsMobileMenuOpen(false);
  }

  return (
    <div className="staff-shell">
      <aside className={`staff-sidebar ${isMobileMenuOpen ? "is-open" : ""}`}>
        <div className="staff-sidebar__brand">
          <span className="staff-sidebar__gem" aria-hidden="true">
            <Gem size={21} />
          </span>
          <span>
            <strong>AMETHYST</strong>
            <small>Dental Clinic</small>
          </span>
          <button className="staff-sidebar__close" onClick={closeMenu} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>

        <StaffNavigation onNavigate={closeMenu} />

        <div className="staff-sidebar__footer">
          <div className="staff-user-summary">
            <span className="staff-user-summary__avatar">{staffInitials(user)}</span>
            <span>
              <strong>{user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Staff member"}</strong>
              <small>{user?.role === "staff" ? "Staff / Secretary" : user?.role || "Staff"}</small>
            </span>
          </div>
          <button className="staff-nav__link staff-nav__button" onClick={handleLogout}>
            <LogOut size={19} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {isMobileMenuOpen && <button className="staff-sidebar__scrim" onClick={closeMenu} aria-label="Close navigation" />}

      <div className="staff-main">
        <header className="staff-header">
          <button
            className="staff-menu-button"
            onClick={() => setIsMobileMenuOpen((open) => !open)}
            aria-label="Open staff navigation"
          >
            <Menu size={21} />
          </button>
          <div>
            <span className="eyebrow">Amethyst Dental Clinic</span>
            <p>{date}</p>
          </div>
          <NavLink to="/staff/notifications" className="icon-button" aria-label="Open notifications">
            <Bell size={19} />
          </NavLink>
        </header>

        <main className="staff-content">
          <Outlet />
        </main>
      </div>

      <nav className="staff-mobile-nav" aria-label="Mobile staff navigation">
        {navigation.slice(0, 5).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `staff-mobile-nav__link ${isActive ? "is-active" : ""}`}
          >
            <Icon size={18} aria-hidden="true" />
            <span>{label.split(" ")[0]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
