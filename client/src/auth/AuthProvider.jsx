import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { apiFetch } from "../api/http.js";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [status, setStatus] = useState("checking");
  const [user, setUser] = useState(null);

  const bootstrap = useCallback(async () => {
    setStatus("checking");
    try {
      const data = await apiFetch("/auth/me");
      setUser(data.user);
      setStatus("authenticated");
    } catch {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await apiFetch("/auth/login", {
      method: "POST",
      body: JSON.stringify(credentials)
    });
    setUser(data.user);
    setStatus("authenticated");
    return data.user;
  }, []);

  const logout = useCallback(async () => {
    await apiFetch("/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setStatus("anonymous");
  }, []);

  const value = useMemo(() => ({
    status,
    user,
    bootstrap,
    login,
    logout,
    isAuthenticated: status === "authenticated"
  }), [bootstrap, login, logout, status, user]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
