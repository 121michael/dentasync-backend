import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  FolderOpen,
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
import { BrandMark } from "./BrandMark";
import { onNotificationsChanged } from "../notificationEvents";

const navigation = [
  { to: "/dentist/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dentist/queue", label: "Patient Queue", icon: UsersRound },
  { to: "/dentist/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/dentist/patient-records", label: "Patient Records", icon: FolderOpen },
  { to: "/dentist/notifications", label: "Notifications", icon: Bell },
  { to: "/dentist/profile", label: "Profile", icon: UserRound },
];

export function DentistLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
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

  useEffect(() => {
    let active = true;
    async function loadAlerts() {
      try {
        const dashboard = await api.getDentistDashboard({ silent: true });
        if (!active) return;
        setUnreadNotifications(Number(dashboard?.metrics?.unreadNotifications || 0));
      } catch {
        if (!active) return;
      }
    }
    if (location.pathname.startsWith("/dentist/notifications")) {
      setUnreadNotifications(0);
    } else {
      loadAlerts();
    }
    const timer = window.setInterval(loadAlerts, 20000);
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "dentist" && detail.unread === 0) {
        setUnreadNotifications(0);
        return;
      }
      loadAlerts();
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      stopListening();
    };
  }, [location.pathname]);

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
  const hasUnread = unreadNotifications > 0;

  return (
    <div className="dentist-shell">
      <aside className={`dentist-sidebar ${isOpen ? "is-open" : ""}`}>
        <div className="dentist-sidebar__brand">
          <BrandMark title="AMETHYST" subtitle="Dental Clinic" />
          <button className="dentist-sidebar__close" onClick={() => setIsOpen(false)} aria-label="Close navigation">
            <X size={20} />
          </button>
        </div>

        <nav className="dentist-nav" aria-label="Dentist dashboard navigation">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => {
                setIsOpen(false);
                if (to === "/dentist/notifications") {
                  setUnreadNotifications(0);
                }
              }}
              className={({ isActive }) => `dentist-nav__link ${isActive ? "is-active" : ""}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
              {to === "/dentist/notifications" && hasUnread ? (
                <span className="nav-alert-dot" aria-hidden="true" />
              ) : null}
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
            <NavLink
              to="/dentist/notifications"
              className="icon-button"
              onClick={() => setUnreadNotifications(0)}
              aria-label={hasUnread ? `Notifications, ${unreadNotifications} unread` : "Notifications"}
            >
              <Bell size={19} />
              {hasUnread ? <span className="alert-dot" aria-hidden="true" /> : null}
            </NavLink>
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
