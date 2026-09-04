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
import { ClinicAssistantPage } from "./pages/ClinicAssistantPage";
import { DashboardPage } from "./pages/DashboardPage";
import { FamilyPage } from "./pages/FamilyPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PasswordResetPage } from "./pages/PasswordResetPage";
import { ProfilePage } from "./pages/ProfilePage";
import { QueueDisplayPage } from "./pages/QueueDisplayPage";
import { QueuePage } from "./pages/QueuePage";
import { RecordsPage } from "./pages/RecordsPage";
import { StaffAppointmentsPage } from "./pages/StaffAppointmentsPage";
import { StaffBillingPage } from "./pages/StaffBillingPage";
import { StaffCheckInPage } from "./pages/StaffCheckInPage";
import { StaffDashboardPage } from "./pages/StaffDashboardPage";
import { StaffNotificationsPage } from "./pages/StaffNotificationsPage";
import { StaffPatientsPage } from "./pages/StaffPatientsPage";
import { StaffProfilePage } from "./pages/StaffProfilePage";
import { StaffQueuePage } from "./pages/StaffQueuePage";
import { SupportPage } from "./pages/SupportPage";
import { AdminDashboardPage } from "./pages/AdminDashboardPage";
import { AdminManageUsersPage } from "./pages/AdminManageUsersPage";
import { AdminArchivedPage } from "./pages/AdminArchivedPage";
import { AdminPatientRecordsPage } from "./pages/AdminPatientRecordsPage";
import { AdminRfidPage } from "./pages/AdminRfidPage";
import { AdminSchedulePage } from "./pages/AdminSchedulePage";
import { AdminAnalyticsPage } from "./pages/AdminAnalyticsPage";
import { AdminAiSettingsPage } from "./pages/AdminAiSettingsPage";
import { AdminSettingsPage } from "./pages/AdminSettingsPage";
import { AdminSyncPage } from "./pages/AdminSyncPage";
import { AdminAuditPage } from "./pages/AdminAuditPage";
import { AdminNotificationsPage } from "./pages/AdminNotificationsPage";
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
  if (roleFor(user) === "staff") return "/staff/dashboard";
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
      <Route path="/queue-display" element={<QueueDisplayPage />} />
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
          <Route path="/assistant" element={<ClinicAssistantPage />} />
          <Route path="/family" element={<FamilyPage />} />
          <Route path="/profile" element={<ProfilePage theme={theme} onThemeChange={setTheme} />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/support" element={<SupportPage />} />
        </Route>
        <Route element={<StaffPortal />}>
          <Route path="/staff" element={<Navigate to="/staff/dashboard" replace />} />
          <Route path="/staff/dashboard" element={<StaffDashboardPage />} />
          <Route path="/staff/check-in" element={<StaffCheckInPage />} />
          <Route path="/staff/check-ins" element={<Navigate to="/staff/check-in" replace />} />
          <Route path="/staff/appointments" element={<StaffAppointmentsPage />} />
          <Route path="/staff/patient-records" element={<StaffPatientsPage />} />
          <Route path="/staff/patients" element={<Navigate to="/staff/patient-records" replace />} />
          <Route path="/staff/queue" element={<StaffQueuePage />} />
          <Route path="/staff/billing" element={<StaffBillingPage />} />
          <Route path="/staff/notifications" element={<StaffNotificationsPage />} />
          <Route path="/staff/profile" element={<StaffProfilePage />} />
        </Route>
        <Route element={<AdminPortal />}>
          <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
          <Route path="/admin/dashboard" element={<AdminDashboardPage />} />
          <Route path="/admin/users" element={<AdminManageUsersPage />} />
          <Route path="/admin/archived-records" element={<AdminArchivedPage />} />
          <Route path="/admin/patient-records" element={<AdminPatientRecordsPage />} />
          <Route path="/admin/rfid" element={<AdminRfidPage />} />
          <Route path="/admin/schedule" element={<AdminSchedulePage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/ai-settings" element={<AdminAiSettingsPage />} />
          <Route path="/admin/settings" element={<AdminSettingsPage />} />
          <Route path="/admin/sync-data" element={<AdminSyncPage />} />
          <Route path="/admin/audit-logs" element={<AdminAuditPage />} />
          <Route path="/admin/patients" element={<Navigate to="/admin/patient-records" replace />} />
          <Route path="/admin/staff" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/dentists" element={<Navigate to="/admin/users" replace />} />
          <Route path="/admin/appointments" element={<Navigate to="/admin/schedule" replace />} />
          <Route path="/admin/security" element={<Navigate to="/admin/audit-logs" replace />} />
          <Route path="/admin/sync" element={<Navigate to="/admin/sync-data" replace />} />
          <Route path="/admin/notifications" element={<AdminNotificationsPage />} />
          <Route path="/admin/profile" element={<Navigate to="/admin/dashboard" replace />} />
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
