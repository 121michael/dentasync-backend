import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider } from "./auth";
import { LoadingState } from "./components/UI";
import { PortalLayout } from "./components/PortalLayout";
import { StaffLayout } from "./components/StaffLayout";
import { AdminLayout } from "./components/AdminLayout";
import { DentistLayout } from "./components/DentistLayout";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { ProfilePage } from "./pages/ProfilePage";
import { QueuePage } from "./pages/QueuePage";
import { RecordsPage } from "./pages/RecordsPage";
import { StaffAppointmentsPage } from "./pages/StaffAppointmentsPage";
import { StaffCheckInPage } from "./pages/StaffCheckInPage";
import { StaffNotificationsPage } from "./pages/StaffNotificationsPage";
import { StaffPatientsPage } from "./pages/StaffPatientsPage";
import { StaffProfilePage } from "./pages/StaffProfilePage";
import { StaffQueuePage } from "./pages/StaffQueuePage";
import { SupportPage } from "./pages/SupportPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminPatientsPage, AdminStaffPage, AdminDentistsPage } from "./pages/AdminUsersPages";
import { AdminAppointmentsPage } from "./pages/AdminAppointmentsPage";
import { AdminAnalyticsPage } from "./pages/AdminAnalyticsPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { AdminSecurityPage } from "./pages/AdminSecurityPage";
import { AdminSyncPage } from "./pages/AdminSyncPage";
import { AdminNotificationsPage } from "./pages/AdminNotificationsPage";
import { AdminProfilePage } from "./pages/AdminProfilePage";
import { DentistDashboardPage } from "./pages/DentistDashboardPage";
import { DentistQueuePage } from "./pages/DentistQueuePage";
import { DentistAppointmentsPage } from "./pages/DentistAppointmentsPage";
import { DentistRecordsPage } from "./pages/DentistRecordsPage";
import { DentistProfilePage } from "./pages/DentistProfilePage";
import { useAuth } from "./useAuth";

function roleFor(user) {
  return String(user?.role || "").toLowerCase();
}

function landingRoute(user) {
  if (roleFor(user) === "admin") return "/admin/dashboard";
  if (roleFor(user) === "staff") return "/staff/check-ins";
  if (roleFor(user) === "dentist") return "/dentist/dashboard";
  if (roleFor(user) === "patient") return "/dashboard";
  return "/access-denied";
}

function RequireAuthenticated() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Opening your secure clinic session" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function PatientPortal({ theme, onThemeChange }) {
  const { user } = useAuth();
  if (roleFor(user) !== "patient") return <Navigate to={landingRoute(user)} replace />;
  return <PortalLayout theme={theme} onToggleTheme={() => onThemeChange(theme === "dark" ? "light" : "dark")} />;
}

function StaffPortal() {
  const { user } = useAuth();
  if (roleFor(user) !== "staff") return <Navigate to={landingRoute(user)} replace />;
  return <StaffLayout />;
}

function AdminPortal() {
  const { user } = useAuth();
  if (roleFor(user) !== "admin") return <Navigate to={landingRoute(user)} replace />;
  return <AdminLayout />;
}

function DentistPortal() {
  const { user } = useAuth();
  if (roleFor(user) !== "dentist") return <Navigate to={landingRoute(user)} replace />;
  return <DentistLayout />;
}

function PublicOnly() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Checking your secure session" />;
  return user ? <Navigate to={landingRoute(user)} replace /> : <Outlet />;
}

function AccessDeniedPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  return (
    <main className="role-access-denied">
      <section className="empty-state empty-state--error">
        <h1>Portal access is unavailable</h1>
        <p>This account does not have access to the selected Amethyst Dental workspace.</p>
        <button className="button button--primary" onClick={() => { logout(); navigate("/login", { replace: true }); }}>
          Return to sign in
        </button>
      </section>
    </main>
  );
}

function PortalRoutes() {
  const [theme, setTheme] = useState(() => localStorage.getItem("amethyst_theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("amethyst_theme", theme);
  }, [theme]);

  return (
    <Routes>
      <Route element={<PublicOnly />}>
        <Route path="/login" element={<AuthPage />} />
        <Route path="/register" element={<AuthPage />} />
        <Route path="/forgot-password" element={<PasswordResetPage mode="request" />} />
        <Route path="/reset-password" element={<PasswordResetPage mode="reset" />} />
        <Route path="/reset-password/:token" element={<PasswordResetPage mode="reset" />} />
      </Route>
      <Route element={<RequireAuthenticated />}>
        <Route element={<PatientPortal theme={theme} onThemeChange={setTheme} />}>
          <Route path="/patient/dashboard" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/appointments" element={<AppointmentsPage />} />
          <Route path="/queue" element={<QueuePage />} />
          <Route path="/records" element={<RecordsPage />} />
          <Route path="/profile" element={<ProfilePage theme={theme} onThemeChange={setTheme} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/support" element={<SupportPage />} />
        </Route>
        <Route element={<StaffPortal />}>
          <Route path="/staff" element={<Navigate to="/staff/check-ins" replace />} />
          <Route path="/staff/check-ins" element={<StaffCheckInPage />} />
          <Route path="/staff/queue" element={<StaffQueuePage />} />
          <Route path="/staff/appointments" element={<StaffAppointmentsPage />} />
          <Route path="/staff/patients" element={<StaffPatientsPage />} />
          <Route path="/staff/notifications" element={<StaffNotificationsPage />} />
          <Route path="/staff/profile" element={<StaffProfilePage />} />
        </Route>
        <Route element={<AdminPortal />}>
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
          <Route path="/admin/patients" element={<AdminPatientsPage />} />
          <Route path="/admin/staff" element={<AdminStaffPage />} />
          <Route path="/admin/dentists" element={<AdminDentistsPage />} />
          <Route path="/admin/appointments" element={<AdminAppointmentsPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/security" element={<AdminSecurityPage />} />
          <Route path="/admin/sync" element={<AdminSyncPage />} />
          <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
          <Route path="/admin/profile" element={<AdminProfilePage />} />
        </Route>
        <Route element={<DentistPortal />}>
          <Route path="/dentist" element={<Navigate to="/dentist/dashboard" replace />} />
          <Route path="/dentist/dashboard" element={<DentistDashboardPage />} />
          <Route path="/dentist/queue" element={<DentistQueuePage />} />
          <Route path="/dentist/appointments" element={<DentistAppointmentsPage />} />
          <Route path="/dentist/patient-records" element={<DentistRecordsPage />} />
          <Route path="/dentist/profile" element={<DentistProfilePage />} />
        </Route>
        <Route path="/access-denied" element={<AccessDeniedPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <PortalRoutes />
      </BrowserRouter>
    </AuthProvider>
  );
}

export default App;
