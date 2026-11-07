import type { Operation } from './operationGuard.mjs';
export type DisplayPermissionState = 'allowed' | 'denied' | 'unavailable';
export interface DisplayPermissions {
  remember(content: unknown, aliases?: (string | number)[]): unknown;
  can(operations: readonly Operation[], options?: { refreshSince?: number }): Promise<boolean>;
  inspect(operations: readonly Operation[], options?: { refreshSince?: number }): Promise<DisplayPermissionState>;
  invalidate(): void;
}
export function createDisplayPermissions(dependencies: {
  identity: () => string;
  writable: () => boolean;
  load: (target: string | number) => Promise<unknown>;
  ready: (target: string | number, parent?: boolean) => Promise<boolean>;
  now?: () => number;
  ttlMs?: number;
  concurrency?: number;
}): DisplayPermissions;
