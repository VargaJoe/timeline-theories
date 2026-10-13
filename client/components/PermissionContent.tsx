import type { ReactNode } from 'react';
import type { Operation } from '../services/sensenet';
import { usePermissions } from '../hooks/usePermissions';

interface PermissionContentProps {
  operations: Operation[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function PermissionContent({ operations, children, fallback = <div role="status" style={{ padding: 24 }}>This operation is unavailable with your current permissions.</div> }: PermissionContentProps) {
  return <>{usePermissions(operations) ? children : fallback}</>;
}
