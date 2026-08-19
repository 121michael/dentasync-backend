import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  ClipboardPlus,
  Gem,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Stethoscope,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useAuth } from "../useAuth";
import { staffInitials } from "../staffUtils";
import { StaffConfirmModal, StaffToastStack } from "./StaffUI";

const StaffUiContext = createContext(null);

export function useStaffUi() {
  const value = useContext(StaffUiContext);
  if (!value) {
    throw new Error("useStaffUi must be used inside StaffLayout");
  }
  return value;
}

const navigation = [
  { to: "/staff/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/staff/check-in", label: "Patient Check-In", icon: ClipboardPlus },
  { to: "/staff/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/staff/patient-records", label: "Patient Records", icon: Stethoscope },
  { to: "/staff/queue", label: "Queue Management", icon: UsersRound },
  { to: "/staff/billing", label: "Billing & Invoices", icon: Receipt },
  { to: "/staff/notifications", label: "Notifications", icon: Bell },
  { to: "/staff/profile", label: "Profile", icon: UserRound },
];

const PAGE_TITLES = {
  "/staff/dashboard": "Clinic Operations Overview",
  "/staff/check-in": "Patient Check-In Center",
  "/staff/appointments": "Appointment Management",
  "/staff/patient-records": "Patient Records",
  "/staff/queue": "Live Patient Queue",
  "/staff/billing": "Billing & Invoice Center",
  "/staff/notifications": "Notification Center",
  "/staff/profile": "Professional Profile",
};

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
          <Icon size={18} aria-hidden="true" />
          <span>{label}</span>
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
  const [toasts, setToasts] = useState([]);
  const [confirmState, setConfirmState] = useState(null);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(now);

  const pageTitle = useMemo(() => {
    const match = Object.keys(PAGE_TITLES).find((path) => location.pathname.startsWith(path));
    return PAGE_TITLES[match] || "Clinic Operations";
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

  function handleLogout() {
    logout();
    navigate("/login", { replace: true });
  }

  function closeMenu() {
    setIsMobileMenuOpen(false);
  }

  const uiValue = useMemo(() => ({ pushToast, confirm, pageTitle }), [pushToast, confirm, pageTitle]);

  return (
    <StaffUiContext.Provider value={uiValue}>
      <div className="staff-shell">
        <aside className={`staff-sidebar ${isMobileMenuOpen ? "is-open" : ""}`}>
          <div className="staff-sidebar__brand">
            <span className="staff-sidebar__gem" aria-hidden="true">
              <Gem size={21} />
            </span>
            <span>
              <strong>AMETHYST</strong>
              <small>Clinic Operations</small>
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
                <strong>Clinic Staff</strong>
                <small>Front Desk Coordinator</small>
              </span>
            </div>
            <button className="staff-nav__link staff-nav__button" onClick={handleLogout}>
              <LogOut size={18} aria-hidden="true" />
              <span>Logout</span>
            </button>
          </div>
        </aside>

        {isMobileMenuOpen ? (
          <button className="staff-sidebar__scrim" onClick={closeMenu} aria-label="Close navigation" />
        ) : null}

        <div className="staff-main">
          <header className="staff-header">
            <button
              className="staff-menu-button"
              onClick={() => setIsMobileMenuOpen((open) => !open)}
              aria-label="Open staff navigation"
            >
              <Menu size={21} />
            </button>
            <div className="staff-header__title-block">
              <h1>{pageTitle}</h1>
              <p>
                {date} · {time}
              </p>
            </div>
            <div className="staff-header__actions">
              <span className="staff-header__role">Front Desk</span>
              <NavLink to="/staff/notifications" className="icon-button" aria-label="Open notifications">
                <Bell size={19} />
              </NavLink>
            </div>
          </header>

          <div className="staff-status-bar" role="status">
            <span>Core clinic operations online</span>
            <span>Staff session active · live queue sync enabled</span>
          </div>

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

        <StaffToastStack toasts={toasts} />
        {confirmState ? (
          <StaffConfirmModal
            title={confirmState.title}
            message={confirmState.message}
            confirmLabel={confirmState.confirmLabel}
            tone={confirmState.tone}
            onConfirm={() => confirmState.resolve(true)}
            onCancel={() => confirmState.resolve(false)}
          />
        ) : null}
      </div>
    </StaffUiContext.Provider>
  );
}
