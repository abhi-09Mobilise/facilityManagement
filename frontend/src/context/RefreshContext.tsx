// Lets any page hand its refresh fn to the navbar. AppLayout wraps children in
// <RefreshProvider>; each list page calls useRegisterRefresh(load) in an effect;
// the navbar IconButton reads `canRefresh` + `trigger()` from the same context.

import {
  createContext, useCallback, useContext, useEffect, useRef, useState,
  type ReactNode,
} from 'react';

type RefreshFn = () => void | Promise<void>;

interface RefreshContextValue {
  register: (fn: RefreshFn | null) => void;
  trigger: () => void;
  canRefresh: boolean;
}

const RefreshCtx = createContext<RefreshContextValue>({
  register: () => {},
  trigger: () => {},
  canRefresh: false,
});

export function RefreshProvider({ children }: { children: ReactNode }) {
  const fnRef = useRef<RefreshFn | null>(null);
  const [canRefresh, setCanRefresh] = useState(false);

  const register = useCallback((fn: RefreshFn | null) => {
    fnRef.current = fn;
    setCanRefresh(!!fn);
  }, []);

  const trigger = useCallback(() => {
    if (fnRef.current) fnRef.current();
  }, []);

  return (
    <RefreshCtx.Provider value={{ register, trigger, canRefresh }}>
      {children}
    </RefreshCtx.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshCtx);
}

// Register the current page's refresh handler. Safe to pass an inline function —
// we track the latest via a ref so the effect runs once per mount.
export function useRegisterRefresh(fn: RefreshFn) {
  const { register } = useContext(RefreshCtx);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  useEffect(() => {
    register(() => fnRef.current());
    return () => register(null);
  }, [register]);
}
