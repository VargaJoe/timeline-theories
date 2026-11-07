import { useEffect, useMemo, useState } from 'react';
import { useSharedAuth } from '../context/useSharedAuth';
import { repositoryUrl } from '../configuration';
import { inspectDisplayOperations, subscribePermissions, type Operation } from '../services/sensenet';
import type { DisplayPermissionState } from '../services/displayPermissions.mjs';

/** Permission results are bound to the current identity and never authorize a write. */
export function usePermissionState(operations: Operation[]): 'checking' | DisplayPermissionState {
  const auth = useSharedAuth();
  const [permissionRevision, setPermissionRevision] = useState(0);
  useEffect(() => subscribePermissions(() => setPermissionRevision(value => value + 1)), []);
  const operationKey = JSON.stringify(operations);
  const stableOperations = useMemo<Operation[]>(() => JSON.parse(operationKey), [operationKey]);
  const key = JSON.stringify([repositoryUrl, auth.isAuthenticated, auth.isLoading, auth.accessToken, auth.user, permissionRevision, operationKey]);
  const [result, setResult] = useState<{ key: string; state: DisplayPermissionState; resolved: boolean }>({ key: '', state: 'denied', resolved: false });

  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      setResult(previous => previous.key === key ? previous : { key, state: 'denied', resolved: false });
      if (auth.isLoading) return;
      if (stableOperations.length === 0) { setResult({ key, state: 'denied', resolved: true }); return; }
      let state: DisplayPermissionState = 'unavailable';
      try {
        state = await inspectDisplayOperations(stableOperations);
      } catch {
        // Unknown or unavailable permission metadata fails closed.
      }
      if (!cancelled) setResult({ key, state, resolved: true });
    };
    // Content views are snapshots. Recheck only when their target, caller or
    // explicit invalidation changes; idle/focus/visibility never refresh data.
    void check();
    return () => { cancelled = true; };
  }, [key, stableOperations, auth.isLoading]);

  if (auth.isLoading || result.key !== key || !result.resolved) return 'checking';
  return result.state;
}

export function usePermissions(operations: Operation[]): boolean {
  return usePermissionState(operations) === 'allowed';
}
