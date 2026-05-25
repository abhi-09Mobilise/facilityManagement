import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { authApi, type LoginPayload } from '@/api/auth.api';
import type { CurrentUser, RegisterPayload } from '@/types';

interface AuthCtx {
  user: CurrentUser | null;
  loading: boolean;
  login: (p: LoginPayload) => Promise<void>;
  register: (p: RegisterPayload) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | undefined>(undefined);

function persist(token: string, user: CurrentUser) {
  localStorage.setItem('fm_token', token);
  localStorage.setItem('fm_user', JSON.stringify(user));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Rehydrate from localStorage so a page refresh doesn't kick the user out.
    const raw = localStorage.getItem('fm_user');
    if (raw) {
      try { setUser(JSON.parse(raw)); } catch { /* ignore */ }
    }
    setLoading(false);
  }, []);

  async function login(payload: LoginPayload) {
    const res = await authApi.login(payload);
    if (!res.status || !res.data) throw new Error(res.msg || 'Login failed');
    persist(res.data.token, res.data.user);
    setUser(res.data.user);
  }

  async function register(payload: RegisterPayload) {
    const res = await authApi.register(payload);
    if (!res.status || !res.data) throw new Error(res.msg || 'Registration failed');
    persist(res.data.token, res.data.user);
    setUser(res.data.user);
  }

  function logout() {
    localStorage.removeItem('fm_token');
    localStorage.removeItem('fm_user');
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, register, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
