import type { ReactNode } from 'react';
import type { Operation } from '../services/sensenet';
import { usePermissionState } from '../hooks/usePermissions';
import { PermissionUnavailable } from './PermissionUnavailable';

interface PermissionContentProps {
  operations: Operation[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionContent({ operations, children, fallback }: PermissionContentProps) {
  const state = usePermissionState(operations);
  if (state === 'allowed') return <>{children}</>;
  // Per-card controls intentionally use fallback=null and stay hidden.
  if (fallback !== undefined) return <>{fallback}</>;
  if (state === 'checking') return <div role="status" style={{ padding: 24 }}>Checking access…</div>;
  if (state === 'unavailable') return <PermissionUnavailable />;
  return <div role="status" style={{ padding: 24 }}>This operation is unavailable with your current permissions.</div>;
}
