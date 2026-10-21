import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Archive,
  BarChart3,
  Bell,
  Bot,
  CalendarDays,
  Cloud,
  CreditCard,
  FolderOpen,
  LayoutDashboard,
  LogOut,
  Menu,
  Shield,
  Users,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { AdminConfirmModal, AdminToastStack } from "./AdminUI";
import { onNotificationsChanged } from "../notificationEvents";
import { BrandMark } from "./BrandMark";
import { LogoutConfirmDialog } from "./LogoutConfirmDialog";
import { FloatingCircleMenu } from "./FloatingCircleMenu";
import { RoleBottomDock } from "./RoleBottomDock";
import { useLogoutConfirm } from "./useLogoutConfirm";

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
  { to: "/admin/patient-records", label: "Patient Record", icon: FolderOpen },
  { to: "/admin/rfid", label: "RFID Tags", icon: CreditCard },
  { to: "/admin/schedule", label: "Clinic Schedule", icon: CalendarDays },
  { to: "/admin/notifications", label: "Notifications", icon: Bell },
  { to: "/admin/analytics", label: "General Analytics", icon: BarChart3 },
  { to: "/admin/ai-settings", label: "Manage AI Settings", icon: Bot },
  { to: "/admin/sync-data", label: "Sync Data", icon: Cloud },
  { to: "/admin/archived-records", label: "Archive", icon: Archive },
];

const PAGE_TITLES = {
  "/admin/dashboard": "Dashboard Overview",
  "/admin/users": "User Management",
  "/admin/archived-records": "Archive Records",
  "/admin/patient-records": "Patient Records Vault",
  "/admin/rfid": "RFID Tag Assignments",
  "/admin/schedule": "Clinic Schedule",
  "/admin/roster": "Staff Roster",
  "/admin/notifications": "Notifications",
  "/admin/analytics": "General Operations Analytics",
  "/admin/ai-settings": "Amethyst AI Core Settings",
  "/admin/settings": "System Settings",
  "/admin/sync-data": "Document Data Extraction",
  "/admin/audit-logs": "Security Audit",
};

export function AdminLayout() {
  const { requestLogout, logoutDialogProps } = useLogoutConfirm();
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
          api.getAdminStatus({ silent: true }),
          api.getAdminDashboard({ silent: true }).catch(() => null),
          api.getAdminNotifications({ silent: true }).catch(() => null),
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
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "admin" && detail.unread === 0) {
        setAlerts((current) => ({ ...current, unreadNotifications: 0 }));
        return;
      }
      loadStatus();
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      stopListening();
    };
  }, [location.pathname]);

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
  const isRfidPage = location.pathname.startsWith("/admin/rfid");
  const uiValue = useMemo(
    () => ({ pushToast, confirm, systemStatus, pageTitle }),
    [pushToast, confirm, systemStatus, pageTitle]
  );

  return (
    <AdminUiContext.Provider value={uiValue}>
      <div className={`admin-shell${isRfidPage ? " admin-shell--rfid" : ""}`}>
        <aside className={`admin-sidebar ${isOpen ? "is-open" : ""}`}>
          <div className="admin-sidebar__brand">
            <BrandMark title="AMETHYST" subtitle="Administrative Suite" />
            <button className="admin-sidebar__close" onClick={() => setIsOpen(false)} aria-label="Close navigation">
              <X size={20} />
            </button>
          </div>

          <nav className="admin-nav" aria-label="Admin dashboard navigation">
            {navigation.map(({ to, label, icon: Icon }) => {
              const showDot =
                (to === "/admin/users" && alerts.pendingAccounts > 0) ||
                (to === "/admin/schedule" && alerts.pendingAppointments > 0) ||
                (to === "/admin/notifications" && alerts.unreadNotifications > 0);
              return (
                <NavLink
                  key={to}
                  to={to}
                  onClick={() => {
                    setIsOpen(false);
                    if (to === "/admin/notifications") {
                      setAlerts((current) => ({ ...current, unreadNotifications: 0 }));
                    }
                  }}
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
            <button className="admin-nav__link admin-nav__button" onClick={requestLogout}>
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
                to="/admin/notifications"
                className="icon-button"
                onClick={() => setAlerts((current) => ({ ...current, unreadNotifications: 0 }))}
                aria-label={
                  hasUnread
                    ? `Notifications, ${alerts.unreadNotifications} unread`
                    : "Notifications"
                }
              >
                <Bell size={19} />
                {hasUnread ? <span className="alert-dot" aria-hidden="true" /> : null}
              </NavLink>
              <button className="button button--primary button--compact" onClick={runSecurityAudit}>
                <Shield size={15} /> Run Security Audit
              </button>
            </div>
          </header>

          <div className="admin-status-bar" role="status">
            <span>
              Active Operations Terminals: {systemStatus.activeOperationsTerminals || 0} Live Channels
            </span>
          </div>

          <main className="admin-content">
            <Outlet />
          </main>
        </div>

        <RoleBottomDock variant="wide">
          <FloatingCircleMenu
            groups={[
              {
                id: "clinic",
                label: "Clinic",
                items: [
                  { to: "/admin/dashboard", label: "Dashboard", icon: LayoutDashboard },
                  { to: "/admin/users", label: "Manage User", icon: Users, showDot: alerts.pendingAccounts > 0 },
                  { to: "/admin/patient-records", label: "Patient Record", icon: FolderOpen },
                  { to: "/admin/rfid", label: "RFID Tags", icon: CreditCard },
                  { to: "/admin/schedule", label: "Clinic Schedule", icon: CalendarDays, showDot: alerts.pendingAppointments > 0 },
                ],
              },
              {
                id: "system",
                label: "System",
                items: [
                  { to: "/admin/notifications", label: "Notifications", icon: Bell, showDot: hasUnread },
                  { to: "/admin/analytics", label: "General Analytics", icon: BarChart3 },
                  { to: "/admin/ai-settings", label: "Manage AI Settings", icon: Bot },
                  { to: "/admin/sync-data", label: "Sync Data", icon: Cloud },
                  { to: "/admin/archived-records", label: "Archive", icon: Archive },
                ],
              },
              {
                id: "session",
                label: "Session",
                items: [{ label: "Logout", icon: LogOut, onSelect: requestLogout }],
              },
            ]}
            onNavigate={(to) => {
              setIsOpen(false);
              if (to === "/admin/notifications") {
                setAlerts((current) => ({ ...current, unreadNotifications: 0 }));
              }
            }}
          />
        </RoleBottomDock>

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
        <LogoutConfirmDialog {...logoutDialogProps} />
      </div>
    </AdminUiContext.Provider>
  );
}
