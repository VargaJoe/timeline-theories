import { useEffect, useMemo, useState } from 'react';
import { useSharedAuth } from '../context/useSharedAuth';
import { repositoryUrl } from '../configuration';
import { canOperations, subscribePermissions, type Operation } from '../services/sensenet';

/** Permission results are bound to the current identity and never authorize a write. */
export function usePermissions(operations: Operation[]): boolean {
  const auth = useSharedAuth();
  const [permissionRevision, setPermissionRevision] = useState(0);
  useEffect(() => subscribePermissions(() => setPermissionRevision(value => value + 1)), []);
  const operationKey = JSON.stringify(operations);
  const stableOperations = useMemo<Operation[]>(() => JSON.parse(operationKey), [operationKey]);
  const key = JSON.stringify([repositoryUrl, auth.isAuthenticated, auth.isLoading, auth.accessToken, auth.user, permissionRevision, operationKey]);
  const [result, setResult] = useState({ key: '', allowed: false });

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const refresh = async () => {
      const currentRequest = ++request;
      setResult(previous => previous.key === key ? previous : { key, allowed: false });
      if (auth.isLoading || stableOperations.length === 0) return;
      let allowed = false;
      try {
        allowed = await canOperations(stableOperations);
      } catch {
        // Unknown or unavailable permission metadata fails closed.
      }
      if (!cancelled && currentRequest === request) setResult({ key, allowed });
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    void refresh();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    const interval = window.setInterval(refresh, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [key, stableOperations, auth.isLoading]);

  return !auth.isLoading && result.key === key && result.allowed;
}
