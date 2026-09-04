import { NavLink, Outlet, useNavigate } from "react-router-dom";
import {
  Bell,
  Bot,
  CalendarDays,
  CircleHelp,
  ClipboardList,
  LayoutDashboard,
  LogOut,
  Moon,
  Sun,
  UserRound,
  Users,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";
import { useAuth } from "../useAuth";
import { api } from "../api";
import { onNotificationsChanged } from "../notificationEvents";

const navigation = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/queue", label: "Queue Status", icon: UsersRound },
  { to: "/records", label: "Treatment History", icon: ClipboardList },
  { to: "/assistant", label: "AI Assistant", icon: Bot },
  { to: "/family", label: "Family", icon: Users },
  { to: "/profile", label: "My Profile", icon: UserRound },
  { to: "/notifications", label: "Notifications", icon: Bell, alertKey: "unread" },
];

function initials(user) {
  return `${user?.firstName?.[0] || ""}${user?.lastName?.[0] || ""}`.toUpperCase() || "AD";
}

export function PortalLayout({ theme, onToggleTheme }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [unreadCount, setUnreadCount] = useState(0);
  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  const refreshAlerts = useCallback(async () => {
    try {
      const dashboard = await api.getDashboard();
      setUnreadCount(Number(dashboard.unreadNotifications || 0));
    } catch {
      // Keep the last known badge state if the poll fails briefly.
    }
  }, []);

  useEffect(() => {
    refreshAlerts();
    const timer = window.setInterval(refreshAlerts, 20000);
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "patient" && typeof detail.unread === "number") {
        setUnreadCount(detail.unread);
        return;
      }
      refreshAlerts();
    });
    return () => {
      window.clearInterval(timer);
      stopListening();
    };
  }, [refreshAlerts]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onFocus = () => refreshAlerts();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshAlerts]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  const hasUnread = unreadCount > 0;

  return (
    <div className="portal-shell">
      <aside className="portal-sidebar">
        <BrandMark />
        <nav className="portal-nav" aria-label="Patient portal navigation">
          {navigation.map(({ to, label, icon: Icon, alertKey }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => `portal-nav__link ${isActive ? "is-active" : ""}`}
            >
              <Icon size={19} aria-hidden="true" />
              <span>{label}</span>
              {alertKey === "unread" && hasUnread ? (
                <span className="nav-alert-dot" aria-label={`${unreadCount} unread notifications`} />
              ) : null}
            </NavLink>
          ))}
        </nav>
        <div className="portal-sidebar__footer">
          <NavLink to="/support" className="portal-nav__link">
            <CircleHelp size={19} aria-hidden="true" />
            <span>Help &amp; Support</span>
          </NavLink>
          <button className="portal-nav__link portal-nav__button" onClick={handleLogout}>
            <LogOut size={19} aria-hidden="true" />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      <div className="portal-main">
        <header className="portal-header">
          <div className="portal-header__date">
            <span className="eyebrow">Premium care, thoughtfully connected</span>
            <span>{date}</span>
          </div>
          <div className="portal-header__actions">
            <button
              className="icon-button"
              onClick={onToggleTheme}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
            >
              {theme === "dark" ? <Sun size={19} /> : <Moon size={19} />}
            </button>
            <NavLink
              to="/notifications"
              className="icon-button notification-button"
              aria-label={hasUnread ? `Notifications, ${unreadCount} unread` : "Notifications"}
            >
              <Bell size={19} />
              {hasUnread ? <span className="alert-dot" aria-hidden="true" /> : null}
            </NavLink>
            <NavLink to="/profile" className="avatar-button" aria-label="Open patient profile">
              {initials(user)}
            </NavLink>
          </div>
        </header>
        <main className="portal-content">
          <Outlet />
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile patient portal navigation">
        {navigation.slice(0, 5).map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) => `mobile-nav__link ${isActive ? "is-active" : ""}`}
          >
            <Icon size={19} aria-hidden="true" />
            <span>{label.split(" ")[0]}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
