import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { AuthAPI } from "../../lib/api";

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [ready, setReady] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const me = await AuthAPI.me();
      setUser({ username: me.sub, exp: me.exp });
    } catch {
      setUser(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const login  = async (u,p) => { await AuthAPI.login(u,p); await refresh(); };
  const logout = async () => {
    try {
      await AuthAPI.logout();
    } finally {
      setUser(null);
    }
  };

  return (
    <AuthCtx.Provider value={{ user, ready, login, logout, refresh }}>
      {children}
    </AuthCtx.Provider>
  );
}
export const useAuth = () => useContext(AuthCtx);
