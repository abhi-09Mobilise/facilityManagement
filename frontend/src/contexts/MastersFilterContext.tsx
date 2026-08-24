// MastersFilterContext — the shared Site -> Building -> Floor cascade that
// lives inside the Masters tabbed shell (below the navbar Tenant + Org).
//
// Rules:
//   - Setting a higher tier clears every lower tier (change site -> clear
//     building/floor). Mirrors the FK hierarchy.
//   - State is mirrored into sessionStorage so a page refresh keeps the
//     picked scope. Persisted under key 'fm.mastersFilter'.
//   - reset() clears everything at once.
//
// Note: organisationId used to live here too. It's since been promoted to
// TenantScopeContext because the navbar owns it and pages outside the
// masters shell (Dashboard, etc.) also need it. Anything that used to read
// filter.organisationId now reads useTenantScope().organisationId.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react';

const STORAGE_KEY = 'fm.mastersFilter';

export interface MastersFilter {
  siteId: number | null;
  buildingId: number | null;
  floorId: number | null;
  setSiteId: (id: number | null) => void;
  setBuildingId: (id: number | null) => void;
  setFloorId: (id: number | null) => void;
  reset: () => void;
}

interface Persisted {
  siteId: number | null;
  buildingId: number | null;
  floorId: number | null;
}

const EMPTY: Persisted = {
  siteId: null,
  buildingId: null,
  floorId: null,
};

function loadPersisted(): Persisted {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      siteId:     typeof parsed.siteId     === 'number' ? parsed.siteId     : null,
      buildingId: typeof parsed.buildingId === 'number' ? parsed.buildingId : null,
      floorId:    typeof parsed.floorId    === 'number' ? parsed.floorId    : null,
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
    /* quota / private-mode — best-effort only */
  }
}

const Ctx = createContext<MastersFilter | undefined>(undefined);

export function MastersFilterProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<Persisted>(() => loadPersisted());

  useEffect(() => { persist(state); }, [state]);

  const setSiteId = useCallback((id: number | null) => {
    // Cascade: changing site clears building + floor.
    setState((prev) => ({ ...prev, siteId: id, buildingId: null, floorId: null }));
  }, []);

  const setBuildingId = useCallback((id: number | null) => {
    // Cascade: changing building clears floor.
    setState((prev) => ({ ...prev, buildingId: id, floorId: null }));
  }, []);

  const setFloorId = useCallback((id: number | null) => {
    setState((prev) => ({ ...prev, floorId: id }));
  }, []);

  const reset = useCallback(() => setState(EMPTY), []);

  const value = useMemo<MastersFilter>(() => ({
    siteId:     state.siteId,
    buildingId: state.buildingId,
    floorId:    state.floorId,
    setSiteId,
    setBuildingId,
    setFloorId,
    reset,
  }), [state, setSiteId, setBuildingId, setFloorId, reset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useMastersFilter(): MastersFilter {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useMastersFilter must be used within <MastersFilterProvider>');
  return ctx;
}

// Non-throwing variant for pages that are shared between the Masters shell
// and legacy standalone routes. Returns a stub with all-null values and
// no-op setters when the provider isn't mounted so the caller can uniformly
// call `filter.setSiteId(...)` without extra gating.
export function useMastersFilterOptional(): MastersFilter & { mounted: boolean } {
  const ctx = useContext(Ctx);
  if (!ctx) {
    return {
      siteId:     null,
      buildingId: null,
      floorId:    null,
      setSiteId:      () => {},
      setBuildingId:  () => {},
      setFloorId:     () => {},
      reset:          () => {},
      mounted: false,
    };
  }
  return { ...ctx, mounted: true };
}
