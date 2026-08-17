import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

const TOKEN_KEY = "amethyst_access_token";

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY));
  const [user, setUser] = useState(null);
  const [isLoading, setIsLoading] = useState(Boolean(token));

  useEffect(() => {
    let cancelled = false;

    async function hydrate() {
      if (!token) {
        setUser(null);
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      try {
        const response = await api.getCurrentUser();
        if (!cancelled) {
          setUser(response.user);
        }
      } catch {
        localStorage.removeItem(TOKEN_KEY);
        if (!cancelled) {
          setToken(null);
          setUser(null);
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
      isLoading,
      startSession(sessionToken, sessionUser) {
        localStorage.setItem(TOKEN_KEY, sessionToken);
        setToken(sessionToken);
        setUser(sessionUser);
      },
      updateUser(nextUser) {
        setUser(nextUser);
      },
      logout() {
        localStorage.removeItem(TOKEN_KEY);
        sessionStorage.removeItem("amethyst_pending_otp");
        setToken(null);
        setUser(null);
      },
    }),
    [token, user, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider.");
  }
  return context;
}
