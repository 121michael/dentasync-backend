import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Bell,
  CalendarDays,
  Cloud,
  Gem,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  Stethoscope,
  UserRound,
  Users,
  UsersRound,
  X,
} from "lucide-react";
import { useState } from "react";
import { useAuth } from "../useAuth";
import { adminInitials } from "../adminUtils";

const navigation = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/patients", label: "Patient Management", icon: Users },
  { to: "/admin/staff", label: "Staff Management", icon: UsersRound },
  { to: "/admin/dentists", label: "Dentist Management", icon: Stethoscope },
  { to: "/admin/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/admin/analytics", label: "Reports / Analytics", icon: BarChart3 },
  { to: "/admin/settings", label: "System Settings", icon: Settings },
  { to: "/admin/security", label: "Security / Access Control", icon: Shield },
  { to: "/admin/sync", label: "System Synchronization", icon: Cloud },
  { to: "/admin/notifications", label: "Notifications", icon: Bell },
  { to: "/admin/profile", label: "Admin Profile", icon: UserRound },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
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

  return (
    <div className="admin-shell">
      <aside className={`admin-sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="admin-sidebar__brand">
          <span className="admin-sidebar__gem" aria-hidden="true"><Gem size={21} /></span>
          <span>
            <strong>AMETHYST</strong>
            <small>Dental Clinic</small>
          </span>
          <button className="admin-sidebar__close" onClick={() => setIsOpen(false)} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>

        <nav className="admin-nav" aria-label="Admin dashboard navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setIsOpen(false)}
              className={({ isActive }) => `admin-nav__link ${isActive ? "is-active" : ""}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-sidebar__footer">
          <div className="admin-user-summary">
            <span className="admin-user-summary__avatar">{adminInitials(user)}</span>
            <span>
              <strong>{user?.fullName || `${user?.firstName || ""} ${user?.lastName || ""}`.trim() || "Administrator"}</strong>
              <small>Administrator</small>
            </span>
          </div>
          <button className="admin-nav__link admin-nav__button" onClick={handleLogout}>
            <LogOut size={18} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {isOpen ? <button className="admin-sidebar__scrim" onClick={() => setIsOpen(false)} aria-label="Close navigation" /> : null}

      <div className="admin-main">
        <header className="admin-header">
          <button className="admin-menu-button" onClick={() => setIsOpen((open) => !open)} aria-label="Open admin navigation">
            <Menu size={21} />
          </button>
          <div>
            <span className="admin-header__badge">Admin Workspace</span>
            <p>{date}</p>
          </div>
          <div className="admin-header__actions">
            <span className="admin-header__role"><Activity size={14} /> System Control</span>
            <NavLink to="/admin/notifications" className="icon-button" aria-label="Open notifications">
              <Bell size={19} />
            </NavLink>
          </div>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
