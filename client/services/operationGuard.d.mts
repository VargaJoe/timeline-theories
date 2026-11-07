import type { Repository } from '@sensenet/client-core';
export type Operation = { target: string | number; action: 'read' | 'update' | 'delete' | 'upload' } | { target: string | number; action: 'create'; contentType: string };
export interface OperationGuard {
  assert: (operations: readonly Operation[]) => Promise<void>;
  can: (operations: readonly Operation[]) => Promise<boolean>;
  invalidate: () => void;
  context: () => () => void;
  subscribe: (listener: () => void) => () => void;
}
export function createOperationGuard(dependencies: {probe: (target: string | number, permissions: ('Open' | 'Save' | 'Delete' | 'AddNew')[]) => Promise<boolean>; childTypes: (target: string | number) => Promise<string[]>; batchProbe?: (operations: readonly Operation[]) => Promise<boolean>; writable: () => boolean; identity: () => string}): OperationGuard;
export function guardRepository(raw: Repository, guard: OperationGuard, options?: { writesCheckedByTransport?: boolean }): Repository;
export function snapshotRequestInit(init?: RequestInit): Readonly<RequestInit & { method: string }>;
