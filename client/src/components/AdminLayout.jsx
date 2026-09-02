import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Activity,
  Archive,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Cloud,
  FolderOpen,
  Gem,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  Shield,
  Users,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../useAuth";
import { api } from "../api";
import { AdminConfirmModal, AdminToastStack } from "./AdminUI";

const AdminUiContext = createContext(null);

export function useAdminUi() {
  const value = useContext(AdminUiContext);
  if (!value) {
    throw new Error("useAdminUi must be used inside AdminLayout");
  }
  return value;
}

const navigation = [
  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/users", label: "Manage User", icon: Users },
  { to: "/admin/archived-records", label: "Archived Records", icon: Archive },
  { to: "/admin/patient-records", label: "Patient Record", icon: FolderOpen },
  { to: "/admin/schedule", label: "Update Schedule", icon: CalendarDays },
  { to: "/admin/analytics", label: "General Analytics", icon: BarChart3 },
  { to: "/admin/ai-settings", label: "Manage AI Settings", icon: Bot },
  { to: "/admin/settings", label: "System Settings", icon: Settings },
  { to: "/admin/sync-data", label: "Sync Data", icon: Cloud },
];

const PAGE_TITLES = {
  "/admin/dashboard": "Dashboard Overview",
  "/admin/users": "Manage Users",
  "/admin/archived-records": "Archived Registry Vault",
  "/admin/patient-records": "Patient Records Vault",
  "/admin/schedule": "Clinic Schedule & Roster",
  "/admin/analytics": "General Operations Analytics",
  "/admin/ai-settings": "Amethyst AI Core Settings",
  "/admin/settings": "System Settings",
  "/admin/sync-data": "Cloud Data Synchronization",
  "/admin/audit-logs": "Security Audit",
};

export function AdminLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [systemStatus, setSystemStatus] = useState({
    coreInfrastructureOnline: true,
    activeOperationsTerminals: 0,
  });
  const [alerts, setAlerts] = useState({
    pendingAccounts: 0,
    pendingAppointments: 0,
    unreadNotifications: 0,
  });

  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(new Date());

  const pageTitle = useMemo(() => {
    const match = Object.keys(PAGE_TITLES).find((path) => location.pathname.startsWith(path));
    return PAGE_TITLES[match] || "Administrative Suite";
  }, [location.pathname]);

  const pushToast = useCallback((message, tone = "success") => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  }, []);

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setConfirmState({
        ...options,
        resolve: (value) => {
          setConfirmState(null);
          resolve(value);
        },
      });
    });
  }, []);

  useEffect(() => {
    let active = true;
    async function loadStatus() {
      try {
        const [status, dashboard, notifications] = await Promise.all([
          api.getAdminStatus(),
          api.getAdminDashboard().catch(() => null),
          api.getAdminNotifications().catch(() => null),
        ]);
        if (!active) return;
        setSystemStatus(status);
        const unread = Array.isArray(notifications?.notifications)
          ? notifications.notifications.filter((item) => !item.read).length
          : 0;
        setAlerts({
          pendingAccounts: Number(dashboard?.metrics?.pendingAccountApprovals || 0),
          pendingAppointments: Number(dashboard?.metrics?.pendingRequests || 0),
          unreadNotifications: unread,
        });
      } catch {
        if (active) {
          setSystemStatus({
            coreInfrastructureOnline: false,
            activeOperationsTerminals: 0,
          });
        }
      }
    }
    loadStatus();
    const timer = window.setInterval(loadStatus, 20000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [location.pathname]);

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  async function runSecurityAudit() {
    try {
      await api.runAdminSecurityAudit();
      pushToast("Security audit completed.");
      navigate("/admin/audit-logs");
    } catch (error) {
      pushToast(error.message || "Unable to run security audit.", "error");
    }
  }

  const hasUnread = alerts.unreadNotifications > 0;
  const uiValue = useMemo(
    () => ({ pushToast, confirm, systemStatus, pageTitle }),
    [pushToast, confirm, systemStatus, pageTitle]
  );

  return (
    <AdminUiContext.Provider value={uiValue}>
      <div className="admin-shell">
        <aside className={`admin-sidebar ${isOpen ? "is-open" : ""}`}>
          <div className="admin-sidebar__brand">
            <span className="admin-sidebar__gem" aria-hidden="true"><Gem size={21} /></span>
            <span>
              <strong>AMETHYST</strong>
              <small>Administrative Suite</small>
            </span>
            <button className="admin-sidebar__close" onClick={() => setIsOpen(false)} aria-label="Close navigation">
              <X size={20} />
            </button>
          </div>

          <nav className="admin-nav" aria-label="Admin dashboard navigation">
            {navigation.map(({ to, label, icon: Icon }) => {
              const showDot =
                (to === "/admin/users" && alerts.pendingAccounts > 0) ||
                (to === "/admin/schedule" && alerts.pendingAppointments > 0);
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => setIsOpen(false)}
                  className={({ isActive }) => `admin-nav__link ${isActive ? "is-active" : ""}`}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span>{label}</span>
                  {showDot ? <span className="nav-alert-dot" aria-hidden="true" /> : null}
                </NavLink>
              );
            })}
          </nav>

          <div className="admin-sidebar__footer">
            <div className="admin-user-summary">
              <span className="admin-user-summary__avatar">
                HQ
                <i className="admin-user-summary__shield" aria-hidden="true"><Shield size={11} /></i>
              </span>
              <span>
                <strong>System Root</strong>
                <small>Global Admin</small>
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
            <div className="admin-header__title-block">
              <h1>{pageTitle}</h1>
              <p>{date}</p>
            </div>
            <div className="admin-header__actions">
              <NavLink
                to="/admin/dashboard"
                className="icon-button"
                aria-label={
                  hasUnread
                    ? `Notifications, ${alerts.unreadNotifications} unread`
                    : "Notifications"
                }
                title="Unread admin alerts appear on the dashboard cards"
              >
                <Bell size={19} />
                {hasUnread || alerts.pendingAppointments > 0 ? (
                  <span className="alert-dot" aria-hidden="true" />
                ) : null}
              </NavLink>
              <button className="button button--primary button--compact" onClick={runSecurityAudit}>
                <Shield size={15} /> Run Security Audit
              </button>
            </div>
          </header>

          <div className="admin-status-bar" role="status">
            <span className={`admin-status-bar__pulse ${systemStatus.coreInfrastructureOnline ? "is-online" : "is-offline"}`}>
              <Activity size={14} />
              {systemStatus.coreInfrastructureOnline
                ? "Core Infrastructure Online"
                : "Core Infrastructure Offline"}
            </span>
            <span>
              Active Operations Terminals: {systemStatus.activeOperationsTerminals || 0} Live Channels
            </span>
          </div>

          <main className="admin-content">
            <Outlet />
          </main>
        </div>

        <AdminToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />
        {confirmState ? (
          <AdminConfirmModal
            title={confirmState.title || "Confirm action"}
            message={confirmState.message}
            confirmLabel={confirmState.confirmLabel || "Confirm"}
            tone={confirmState.tone || "danger"}
            onCancel={() => confirmState.resolve(false)}
            onConfirm={() => confirmState.resolve(true)}
          />
        ) : null}
      </div>
    </AdminUiContext.Provider>
  );
}
