// App-wide light/dark theme. Flips both the Tailwind strategy class on
// <html> (so CSS variables in globals.css re-resolve) and feeds MUI's
// ThemeProvider via a reactive hook so MUI surfaces (MuiPaper, MuiDataGrid,
// MuiDialog, …) switch palette at the same instant.
//
// First visit: auto-follow prefers-color-scheme. Any explicit toggle after
// that persists to localStorage and wins over the OS preference.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const STORAGE_KEY = 'fm.themeMode';

const ThemeCtx = createContext<ThemeContextValue>({
  mode: 'light',
  setMode: () => {},
  toggle: () => {},
});

function readInitialMode(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  // No stored preference → follow OS once.
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readInitialMode);

  // Keep <html class="dark"> in sync so Tailwind + CSS vars track the mode.
  useEffect(() => {
    const root = document.documentElement;
    if (mode === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    root.style.colorScheme = mode; // native UI (scrollbar, autofill) matches
  }, [mode]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try { window.localStorage.setItem(STORAGE_KEY, m); } catch { /* quota / privacy mode */ }
  }, []);

  const toggle = useCallback(() => {
    setModeState((prev) => {
      const next = prev === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(STORAGE_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({ mode, setMode, toggle }), [mode, setMode, toggle]);

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useThemeMode() {
  return useContext(ThemeCtx);
}
