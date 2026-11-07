export function fetchPermissionRows(
  fetch: (url: string, init: RequestInit, awaitReady: boolean) => Promise<Response>,
  url: string,
  timeoutMs?: number,
): Promise<Record<string, unknown>[]>;
