import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes, useNavigate } from "react-router-dom";
import { AuthProvider } from "./auth";
import { LoadingState } from "./components/UI";
import { PortalLayout } from "./components/PortalLayout";
import { StaffLayout } from "./components/StaffLayout";
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
import { useAuth } from "./useAuth";

function roleFor(user) {
  return String(user?.role || "").toLowerCase();
}

function landingRoute(user) {
  if (roleFor(user) === "staff") return "/staff/check-ins";
  if (roleFor(user) === "patient") return "/dashboard";
  return "/access-denied";
}

function RequireAuthenticated() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingState label="Opening your secure clinic session" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}

function PatientPortal({ theme, onThemeChange }) {
  const { user } = useAuth();
  const role = roleFor(user);

  if (role !== "patient") {
    return <Navigate to={landingRoute(user)} replace />;
  }

  return <PortalLayout theme={theme} onToggleTheme={() => onThemeChange(theme === "dark" ? "light" : "dark")} />;
}

function StaffPortal() {
  const { user } = useAuth();

  if (roleFor(user) !== "staff") {
    return <Navigate to={landingRoute(user)} replace />;
  }

  return <StaffLayout />;
}

function PublicOnly() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Checking your secure session" />;
  return user ? <Navigate to={landingRoute(user)} replace /> : <Outlet />;
}

function AccessDeniedPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  function signOut() {
    logout();
    navigate("/login", { replace: true });
  }

  return (
    <main className="role-access-denied">
      <section className="empty-state empty-state--error">
        <h1>Portal access is unavailable</h1>
        <p>This account does not have access to the patient or staff dashboard in this application.</p>
        <button className="button button--primary" onClick={signOut}>Return to sign in</button>
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
