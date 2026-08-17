import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth";
import { LoadingState } from "./components/UI";
import { PortalLayout } from "./components/PortalLayout";
import { AppointmentsPage } from "./pages/AppointmentsPage";
import { AuthPage } from "./pages/AuthPage";
import { DashboardPage } from "./pages/DashboardPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { ProfilePage } from "./pages/ProfilePage";
import { QueuePage } from "./pages/QueuePage";
import { RecordsPage } from "./pages/RecordsPage";
import { SupportPage } from "./pages/SupportPage";
import { useAuth } from "./useAuth";

function ProtectedPortal({ theme, onThemeChange }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <LoadingState label="Opening your private care portal" />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return (
    <PortalLayout
      theme={theme}
      onToggleTheme={() => onThemeChange(theme === "dark" ? "light" : "dark")}
    />
  );
}

function PublicOnly() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <LoadingState label="Checking your secure session" />;
  return user ? <Navigate to="/dashboard" replace /> : <AuthPage />;
}

function PortalRoutes() {
  const [theme, setTheme] = useState(() => localStorage.getItem("amethyst_theme") || "light");

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("amethyst_theme", theme);
  }, [theme]);

  return (
    <Routes>
      <Route path="/login" element={<PublicOnly />} />
      <Route path="/register" element={<PublicOnly />} />
      <Route element={<ProtectedPortal theme={theme} onThemeChange={setTheme} />}>
        <Route path="/patient/dashboard" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/appointments" element={<AppointmentsPage />} />
        <Route path="/queue" element={<QueuePage />} />
        <Route path="/records" element={<RecordsPage />} />
        <Route path="/profile" element={<ProfilePage theme={theme} onThemeChange={setTheme} />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/support" element={<SupportPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
