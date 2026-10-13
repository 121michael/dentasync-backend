import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { AuthContext } from "./authContext";

const TOKEN_KEY = "amethyst_access_token";
const PATIENT_THEME_KEY = "amethyst_theme";

function resetPatientThemePreference() {
  localStorage.removeItem(PATIENT_THEME_KEY);
  sessionStorage.removeItem(PATIENT_THEME_KEY);
  delete document.documentElement.dataset.theme;
}

const EMPTY_SESSION = {
  actingAs: false,
  actAsUserId: null,
  principal: null,
};

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [isLoading, setIsLoading] = useState(Boolean(token));

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      delete document.documentElement.dataset.theme;
      if (!token) {
        resetPatientThemePreference();
        setUser(null);
        setSession(EMPTY_SESSION);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.getCurrentUser();
        if (!cancelled) {
          setUser(response.user);
          setSession(response.session || EMPTY_SESSION);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        resetPatientThemePreference();
        if (!cancelled) {
          setToken(null);
          setUser(null);
          setSession(EMPTY_SESSION);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const value = useMemo(
    () => ({
      token,
      user,
      session,
      isLoading,
      actingAs: Boolean(session?.actingAs),
      principal: session?.principal || null,
      startSession(sessionToken, sessionUser, sessionMeta) {
        localStorage.setItem(TOKEN_KEY, sessionToken);
        setToken(sessionToken);
        setUser(sessionUser);
        setSession(sessionMeta || EMPTY_SESSION);
      },
      updateUser(nextUser) {
        setUser((current) =>
          typeof nextUser === "function" ? nextUser(current) : nextUser
        );
      },
      logout() {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem("amethyst_pending_otp");
        resetPatientThemePreference();
        setToken(null);
        setUser(null);
        setSession(EMPTY_SESSION);
      },
    }),
    [token, user, session, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
