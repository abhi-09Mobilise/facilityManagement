// TenantScopeContext — the top-level {tenant, organisation} the whole app
// operates against. Owned by the navbar in AppLayout; consumed by any
// page that needs to filter data by tenant or organisation (Dashboard,
// Sites, Buildings, Facilities, Floors, etc.).
//
// Rules:
//   - Setting tenantId clears organisationId (cascade — an org belongs
//     to a tenant, changing the tenant invalidates the picked org).
//   - State is mirrored into sessionStorage so a page refresh keeps the
//     picked scope. Key: 'fm.tenantScope'.
//   - reset() wipes both at once (used on logout).
//
// This is separate from MastersFilterContext, which owns the finer
// site → building → floor cascade inside the /admin/masters/* shell.
// After this refactor MastersFilterContext no longer stores
// organisationId — it reads it from here.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'fm.tenantScope';

export interface TenantScope {
  tenantId: number | null;
  organisationId: number | null;
  setTenantId: (id: number | null) => void;
  setOrganisationId: (id: number | null) => void;
  reset: () => void;
}

interface Persisted {
  tenantId: number | null;
  organisationId: number | null;
}

const EMPTY: Persisted = { tenantId: null, organisationId: null };

function loadPersisted(): Persisted {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      tenantId:       typeof parsed.tenantId       === 'number' ? parsed.tenantId       : null,
      organisationId: typeof parsed.organisationId === 'number' ? parsed.organisationId : null,
    };
  } catch {
    return EMPTY;
  }
}

function persist(v: Persisted): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* quota / private-mode — best effort only */
  }
}

const Ctx = createContext<TenantScope | undefined>(undefined);

export function TenantScopeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<Persisted>(() => loadPersisted());

  useEffect(() => { persist(state); }, [state]);

  const setTenantId = useCallback((id: number | null) => {
    // Cascade: changing the tenant invalidates any picked organisation.
    setState({ tenantId: id, organisationId: null });
  }, []);

  const setOrganisationId = useCallback((id: number | null) => {
    setState((prev) => ({ ...prev, organisationId: id }));
  }, []);

  const reset = useCallback(() => setState(EMPTY), []);

  const value = useMemo<TenantScope>(() => ({
    tenantId:        state.tenantId,
    organisationId:  state.organisationId,
    setTenantId,
    setOrganisationId,
    reset,
  }), [state, setTenantId, setOrganisationId, reset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenantScope(): TenantScope {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTenantScope must be used within <TenantScopeProvider>');
  return ctx;
}
