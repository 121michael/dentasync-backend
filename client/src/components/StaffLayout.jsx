import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../useAuth";
import { api } from "../api";
import { notifyNotificationsChanged, onNotificationsChanged } from "../notificationEvents";
import { staffInitials } from "../staffUtils";

const navigation = [
  { to: "/staff/check-ins", label: "Patient Check-in", icon: ClipboardPlus },
  { to: "/staff/queue", label: "Queue Management", icon: UsersRound },
  { to: "/staff/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/staff/patients", label: "Patient Record", icon: Stethoscope },
  { to: "/staff/notifications", label: "Notifications", icon: Bell },
  { to: "/staff/profile", label: "Profile", icon: UserRound },
];

function StaffNavigation({ onNavigate, hasUnread }) {
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
          {to === "/staff/notifications" && hasUnread ? (
            <span className="nav-alert-dot" aria-label="Unread notifications" />
          ) : null}
        </NavLink>
      ))}
    </nav>
  );
}

export function StaffLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const markedInboxRef = useRef(false);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  const refreshUnread = useCallback(async () => {
    try {
      const dashboard = await api.getStaffDashboard();
      setUnreadCount(Number(dashboard.metrics?.unreadNotifications || 0));
    } catch {
      // Keep the last known badge if the poll fails briefly.
    }
  }, []);

  useEffect(() => {
    refreshUnread();
    const timer = window.setInterval(refreshUnread, 20000);
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "staff" && detail.unread === 0) {
        setUnreadCount(0);
        return;
      }
      refreshUnread();
    });
    return () => {
      window.clearInterval(timer);
      stopListening();
    };
  }, [refreshUnread]);

  useEffect(() => {
    if (!location.pathname.startsWith("/staff/notifications")) {
      markedInboxRef.current = false;
      return undefined;
    }

    setUnreadCount(0);
    if (markedInboxRef.current) return undefined;
    markedInboxRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        await api.markAllStaffNotificationsRead();
        if (!cancelled) {
          notifyNotificationsChanged({ source: "staff", unread: 0 });
        }
      } catch {
        markedInboxRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function closeMenu() {
    setIsMobileMenuOpen(false);
  }

  const hasUnread = unreadCount > 0;

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

        <StaffNavigation onNavigate={closeMenu} hasUnread={hasUnread} />

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
            <span className="staff-header__badge">Staff Workspace</span>
            <p>{date}</p>
          </div>
          <div className="staff-header__actions">
            <span className="staff-header__role">Staff / Secretary</span>
            <NavLink
              to="/staff/notifications"
              className="icon-button"
              aria-label={hasUnread ? `Open notifications, ${unreadCount} unread` : "Open notifications"}
            >
              <Bell size={19} />
              {hasUnread ? <span className="alert-dot" aria-hidden="true" /> : null}
            </NavLink>
          </div>
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
            <span className="staff-mobile-nav__icon">
              <Icon size={18} aria-hidden="true" />
              {to === "/staff/notifications" && hasUnread ? <span className="nav-alert-dot" aria-hidden="true" /> : null}
            </span>
            <span>{label.split(" ")[0]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
