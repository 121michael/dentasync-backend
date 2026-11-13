import { NavLink, Outlet } from "react-router-dom";
import {
  Bell,
  CalendarDays,
  ClipboardPlus,
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
import { LogoutConfirmDialog } from "./LogoutConfirmDialog";
import { FloatingCircleMenu } from "./FloatingCircleMenu";
import { RoleBottomDock } from "./RoleBottomDock";
import { useLogoutConfirm } from "./useLogoutConfirm";
import { onNotificationsChanged } from "../notificationEvents";

const navigation = [
  { to: "/dentist/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/dentist/queue", label: "Patient Queue", icon: UsersRound },
  { to: "/dentist/appointments", label: "Appointments", icon: CalendarDays },
  { to: "/dentist/patient-records", label: "Patient Records", icon: FolderOpen },
  { to: "/dentist/prescriptions", label: "Prescription Management", icon: ClipboardPlus },
  { to: "/dentist/notifications", label: "Notifications", icon: Bell },
  { to: "/dentist/profile", label: "Profile", icon: UserRound },
];

export function DentistLayout() {
  const { user } = useAuth();
  const { requestLogout, logoutDialogProps } = useLogoutConfirm();
  const [isOpen, setIsOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [branchContext, setBranchContext] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(
    () => sessionStorage.getItem("dentasync.activeBranchId") || ""
  );

  useEffect(() => {
    let cancelled = false;
    api.getDentistBranchContext({ silent: true })
      .then((context) => {
        if (cancelled) return;
        const active = context.activeBranches || [];
        const stored = sessionStorage.getItem("dentasync.activeBranchId");
        const chosen = active.find((branch) => String(branch.id) === String(stored)) || active[0] || null;
        if (chosen?.id) sessionStorage.setItem("dentasync.activeBranchId", String(chosen.id));
        else sessionStorage.removeItem("dentasync.activeBranchId");
        setSelectedBranchId(chosen ? String(chosen.id) : "");
        setBranchContext(context);
      })
      .catch((error) => {
        if (error?.status === 403) sessionStorage.removeItem("dentasync.activeBranchId");
        if (!cancelled) setBranchContext({ operational: false, message: error.message, activeBranches: [] });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function chooseBranch(nextId) {
    sessionStorage.setItem("dentasync.activeBranchId", String(nextId));
    setSelectedBranchId(String(nextId));
  }
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
    loadAlerts();
    const timer = window.setInterval(loadAlerts, 20000);
    const stopListening = onNotificationsChanged((detail) => {
      if (detail?.source === "dentist" && typeof detail.unread === "number") {
        setUnreadNotifications(detail.unread);
        return;
      }
      loadAlerts();
    });
    return () => {
      active = false;
      window.clearInterval(timer);
      stopListening();
    };
  }, []);

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
          <button className="dentist-nav__link dentist-nav__button" onClick={requestLogout}>
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
            <span className="dentist-header__badge">
              {branchContext?.branch?.name || branchContext?.activeBranches?.find((branch) => String(branch.id) === selectedBranchId)?.name
                ? `DentaSync — ${(branchContext.branch?.name || branchContext.activeBranches.find((branch) => String(branch.id) === selectedBranchId)?.name)} Branch`
                : "DentaSync"}
            </span>
            <p>{date}</p>
            {(branchContext?.activeBranches || []).length > 1 ? (
              <label>
                Branch
                <select value={selectedBranchId} onChange={(event) => chooseBranch(event.target.value)}>
                  {branchContext.activeBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>{branch.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {branchContext && !branchContext.operational ? <p>{branchContext.message}</p> : null}
          </div>
          <div className="dentist-header__actions">
            <NavLink
              to="/dentist/notifications"
              className="icon-button"
              onClick={() => setIsOpen(false)}
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
          <Outlet key={selectedBranchId || "branch"} />
        </main>
      </div>

      <RoleBottomDock variant="wide">
        <FloatingCircleMenu
          groups={[
            {
              id: "clinical",
              label: "Clinical",
              items: [
                { to: "/dentist/dashboard", label: "Dashboard", icon: LayoutDashboard },
                { to: "/dentist/queue", label: "Patient Queue", icon: UsersRound },
                { to: "/dentist/appointments", label: "Appointments", icon: CalendarDays },
                { to: "/dentist/patient-records", label: "Patient Records", icon: FolderOpen },
                { to: "/dentist/prescriptions", label: "Prescription Management", icon: ClipboardPlus },
              ],
            },
            {
              id: "account",
              label: "Account",
              items: [
                { to: "/dentist/notifications", label: "Notifications", icon: Bell, showDot: hasUnread },
                { to: "/dentist/profile", label: "Profile", icon: UserRound },
                { label: "Logout", icon: LogOut, onSelect: requestLogout },
              ],
            },
          ]}
          onNavigate={() => {
            setIsOpen(false);
          }}
        />
      </RoleBottomDock>
      <LogoutConfirmDialog {...logoutDialogProps} />
    </div>
  );
}
