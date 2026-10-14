import { environment } from '../configuration';

export interface NativeSnapshot extends Record<string, unknown> {
  Id: number;
  ParentId: number;
  Name: string;
  Path: string;
  Type: string;
  revision: string;
}
export interface NativeCommand extends Record<string, unknown> { action: string; }
export interface NativePlan { id: string; [key: string]: unknown; }
export interface NativeApplyResult {
  ok: boolean;
  completed: { index?: number; result: { id?: number; revision?: string; [key: string]: unknown }; [key: string]: unknown }[];
  notApplied?: unknown[];
  error?: { code?: string; message?: string; status?: number } | string;
  touchedIds?: number[];
  uncertainTargets?: number[];
  retrySamePlan?: boolean;
}
export class NativeApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly source?: string;
  readonly retryAfter?: number;
  applyResult?: NativeApplyResult;
  transportFailure?: boolean;
  constructor(message: string, status: number, code: string, source?: string, retryAfter?: number) {
    super(message); this.name = 'NativeApiError'; this.status = status; this.code = code;
    this.source = source; this.retryAfter = retryAfter;
  }
}

let getToken: () => string | undefined = () => undefined;
let identity = '';
const snapshots = new Map<number, NativeSnapshot>();
const targets = new Map<string, number>();
const pending = new Map<string, { planId: string; key: string }>();
const nativeBase = import.meta.env.VITE_NATIVE_API_URL || '/api/v1';
export interface NativeGatewayAvailability { ready: boolean; writable: boolean; error?: NativeApiError; }
let gatewayAvailability: { identity: string; expires: number; value: NativeGatewayAvailability } | undefined;
let gatewayDiscovery: { identity: string; promise: Promise<NativeGatewayAvailability> } | undefined;
let writeReadinessExpires = 0;

export function configureNativeAuth(provider: () => string | undefined): void { getToken = provider; invalidateNativeSnapshots(); }
export function invalidateNativeSnapshots(): void { snapshots.clear(); targets.clear(); pending.clear(); gatewayAvailability = undefined; gatewayDiscovery = undefined; writeReadinessExpires = 0; identity = ''; }
function currentIdentity(): string {
  const next = `${environment.repositoryUrl}\n${environment.projectRoot}\n${environment.authority}\n${getToken() || ''}`;
  if (identity !== next) { snapshots.clear(); targets.clear(); pending.clear(); gatewayAvailability = undefined; gatewayDiscovery = undefined; writeReadinessExpires = 0; identity = next; }
  return next;
}
function nativeUrl(path: string): string {
  if (!/^\/(?:api\/v1\/)?[A-Za-z0-9/_-]+$/.test(path)) throw new NativeApiError('Invalid native API path.', 400, 'invalid_native_path');
  const base = new URL(nativeBase.replace(/\/$/, '') + '/', window.location.origin);
  if ((base.origin !== window.location.origin && base.protocol !== 'https:') || base.username || base.password || base.search || base.hash) {
    throw new NativeApiError('The native API needs a configured HTTPS gateway.', 503, 'invalid_native_configuration');
  }
  const relative = path.replace(/^\/api\/v1\//, '').replace(/^\//, '');
  return new URL(relative, base).href;
}
function responseError(payload: unknown, status: number, applyReceipt = false): NativeApiError {
  const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const detail = value.error && typeof value.error === 'object' ? value.error as Record<string, unknown> : value;
  const message = typeof detail.message === 'string' ? detail.message : typeof value.error === 'string' ? value.error : 'The native gateway rejected the request.';
  const retryAfter = detail.retryAfter ?? value.retryAfter;
  const source = detail.source ?? value.source;
  const failure = new NativeApiError(message, status, String(detail.code || value.code || 'native_request_failed'), typeof source === 'string' ? source : undefined, typeof retryAfter === 'number' ? retryAfter : undefined);
  if (applyReceipt && isNativeApplyResult(payload)) failure.applyResult = payload;
  return failure;
}
function isNativeApplyResult(value: unknown): value is NativeApplyResult {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  if (typeof receipt.ok !== 'boolean' || !Array.isArray(receipt.completed)) return false;
  if (receipt.completed.some(item => !item || typeof item !== 'object' || !item.result || typeof item.result !== 'object' ||
    Array.isArray(item.result) || (item.result.id !== undefined && (!Number.isSafeInteger(item.result.id) || item.result.id < 1)))) return false;
  if (receipt.notApplied !== undefined && !Array.isArray(receipt.notApplied)) return false;
  if (receipt.retrySamePlan !== undefined && typeof receipt.retrySamePlan !== 'boolean') return false;
  return ['touchedIds', 'uncertainTargets'].every(key => receipt[key] === undefined ||
    Array.isArray(receipt[key]) && receipt[key].every(id => Number.isSafeInteger(id) && id > 0));
}

/** Bearer and binding headers are supplied only to the configured gateway. */
export async function nativeResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const startedIdentity = currentIdentity();
  const token = getToken();
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Timeline-Repository', environment.repositoryUrl);
  headers.set('X-Timeline-Project', environment.projectRoot);
  headers.set('X-Timeline-Authority', environment.authority);
  // Same-origin GETs may omit Origin; this routes the session through actual backend token validation.
  headers.set('X-Timeline-Client-Origin', window.location.origin);
  if (token) headers.set('Authorization', `Bearer ${token}`); else headers.delete('Authorization');
  if (!['GET', 'HEAD'].includes((init.method || 'GET').toUpperCase())) headers.set('Content-Type', 'application/json');
  let response: Response;
  try { response = await fetch(nativeUrl(path), { ...init, headers, credentials: 'omit', redirect: 'error' }); }
  catch (error) {
    if (error instanceof NativeApiError) throw error;
    const failure = new NativeApiError('The native gateway is unavailable. Start the configured M1 gateway.', 503, 'native_gateway_unavailable');
    // Browser fetch cannot distinguish DNS/TLS/CORS failures from an absent service. This is never read-fallback evidence.
    failure.transportFailure = true;
    throw failure;
  }
  if (currentIdentity() !== startedIdentity) throw new NativeApiError('The active repository identity changed during the request.', 409, 'identity_changed');
  if (!response.ok) {
    let errorPayload: unknown;
    try { errorPayload = await response.json(); } catch { /* A failed transport may return a non-JSON error. */ }
    if (currentIdentity() !== startedIdentity) throw new NativeApiError('The active repository identity changed during the request.', 409, 'identity_changed');
    throw responseError(errorPayload, response.status, /(?:^|\/)plans\/[A-Za-z0-9_-]+\/apply$/.test(path));
  }
  return response;
}
export async function nativeRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const startedIdentity = currentIdentity();
  const response = await nativeResponse(path, init);
  let payload: unknown;
  try { payload = await response.json(); }
  catch { throw new NativeApiError('The native gateway returned an invalid response.', 502, 'native_response_invalid'); }
  if (currentIdentity() !== startedIdentity) throw new NativeApiError('The active repository identity changed during the request.', 409, 'identity_changed');
  if (payload && typeof payload === 'object' && Object.hasOwn(payload, 'data')) return (payload as { data: T }).data;
  return payload as T;
}

/** Only explicit HTTP evidence of an unavailable application gateway permits ordinary legacy GETs. */
export function canUseLegacyRead(error: unknown): error is NativeApiError {
  return environment.mode !== 'm0-local' && error instanceof NativeApiError && !error.transportFailure &&
    error.status === 503 && ['native_gateway_unconfigured', 'native_gateway_unavailable'].includes(error.code);
}
export function markNativeGatewayUnavailable(error: NativeApiError): void {
  const subject = currentIdentity();
  gatewayAvailability = { identity: subject, expires: Date.now() + 15000, value: { ready: false, writable: false, error } };
  writeReadinessExpires = 0; snapshots.clear(); targets.clear();
}
async function discoverGateway(): Promise<NativeGatewayAvailability> {
  const subject = currentIdentity();
  let value: NativeGatewayAvailability;
  try {
    const response = await nativeResponse('/capabilities');
    const sameOrigin = new URL(nativeUrl('/capabilities')).origin === window.location.origin;
    if (sameOrigin && response.headers.get('content-type')?.toLowerCase().includes('text/html')) {
      value = { ready: false, writable: false, error: new NativeApiError('The native gateway is not deployed on this site. Browsing remains available; editing requires the M1 gateway.', 503, 'native_gateway_unconfigured') };
    } else {
      let data: Record<string, unknown>;
      try { data = await response.json(); } catch { throw new NativeApiError('The native gateway discovery response is invalid.', 502, 'native_response_invalid'); }
      if (!data || data.repository !== environment.repositoryUrl || data.authority !== environment.authority || data.project !== environment.projectRoot) {
        throw new NativeApiError('The native gateway targets a different repository, authority or project.', 403, 'native_binding_mismatch');
      }
      const operations = data.operations;
      if (!Array.isArray(operations) || !['lookup', 'snapshots', 'plans', 'plans/{id}/apply'].every(operation => operations.includes(operation)) || typeof data.readOnly !== 'boolean' || data.backendProtocolRequired !== 'gateway-coordinated-v1') {
        throw new NativeApiError('The native gateway does not advertise the required M1 operations.', 503, 'native_capability_mismatch');
      }
      value = { ready: true, writable: environment.writable && !data.readOnly };
    }
  } catch (caught) {
    const error = caught instanceof NativeApiError ? caught : new NativeApiError('Native gateway discovery failed.', 502, 'native_response_invalid');
    if (error.status === 404 && ['native_request_failed', 'route_unavailable'].includes(error.code) && !error.transportFailure) {
      value = { ready: false, writable: false, error: new NativeApiError('The native gateway discovery route is not deployed. Editing is unavailable.', 503, 'native_gateway_unconfigured') };
    } else if (!error.transportFailure && error.status === 503 && ['native_gateway_unconfigured', 'native_gateway_unavailable'].includes(error.code)) {
      value = { ready: false, writable: false, error };
    } else throw error;
  }
  if (currentIdentity() !== subject) throw new NativeApiError('The active repository identity changed during discovery.', 409, 'identity_changed');
  gatewayAvailability = { identity: subject, expires: Date.now() + 15000, value };
  return value;
}
export async function nativeGatewayAvailability(): Promise<NativeGatewayAvailability> {
  const subject = currentIdentity();
  if (gatewayAvailability?.identity === subject && gatewayAvailability.expires > Date.now()) return gatewayAvailability.value;
  if (gatewayDiscovery?.identity === subject) return gatewayDiscovery.promise;
  const promise = discoverGateway(); gatewayDiscovery = { identity: subject, promise };
  try { return await promise; } finally { if (gatewayDiscovery?.promise === promise) gatewayDiscovery = undefined; }
}
export async function nativeReadSidecarAvailable(): Promise<boolean> {
  const availability = await nativeGatewayAvailability();
  if (availability.ready) return true;
  if (canUseLegacyRead(availability.error)) return false;
  throw availability.error || new NativeApiError('The configured M1 gateway is required.', 503, 'native_gateway_unconfigured');
}
export async function requireNativeWriteReadiness(target: string | number, parent = false): Promise<void> {
  const availability = await nativeGatewayAvailability();
  if (!availability.ready) throw availability.error || new NativeApiError('Editing requires the configured M1 gateway.', 503, 'native_gateway_unconfigured');
  if (!availability.writable) throw new NativeApiError('The configured native gateway is read only.', 403, 'native_read_only');
  if (writeReadinessExpires > Date.now()) return;
  try {
    // Verify a same-caller repository snapshot through the application gateway. Do not refresh an editor's saved revision.
    const snapshot = await nativeRequest<NativeSnapshot>('/lookup', { method: 'POST', body: JSON.stringify({ target, ...(parent ? { parent: true } : {}) }) });
    if (!cachedNativeSnapshot(target)) rememberNativeSnapshot(snapshot);
    writeReadinessExpires = Date.now() + 15000;
  } catch (caught) {
    if (caught instanceof NativeApiError && canUseLegacyRead(caught)) markNativeGatewayUnavailable(caught);
    throw caught;
  }
}

export function rememberNativeSnapshot(value: NativeSnapshot): NativeSnapshot {
  currentIdentity();
  if (!Number.isSafeInteger(value?.Id) || value.Id < 1 || typeof value.revision !== 'string' || !value.revision || typeof value.Type !== 'string' || typeof value.Path !== 'string') {
    throw new NativeApiError('The native gateway did not return a content revision.', 502, 'native_revision_missing');
  }
  snapshots.set(value.Id, value);
  targets.set(String(value.Id), value.Id); targets.set(value.Path, value.Id);
  return value;
}
export function cachedNativeSnapshot(target: string | number): NativeSnapshot | undefined {
  currentIdentity();
  const id = typeof target === 'number' ? target : targets.get(String(target));
  return id === undefined ? undefined : snapshots.get(id);
}
export async function nativeSnapshot(target: string | number, { parent = false, refresh = false } = {}): Promise<NativeSnapshot> {
  const cached = cachedNativeSnapshot(target);
  if (cached && !refresh) return cached;
  const value = await nativeRequest<NativeSnapshot>('/lookup', { method: 'POST', body: JSON.stringify({ target, ...(parent ? { parent: true } : {}) }) });
  rememberNativeSnapshot(value); targets.set(String(target), value.Id);
  return value;
}
export async function nativeSnapshots(ids: number[]): Promise<NativeSnapshot[]> {
  const values: NativeSnapshot[] = [];
  const uniqueIds = [...new Set(ids)];
  for (let index = 0; index < uniqueIds.length; index += 100) {
    const batch = await nativeRequest<NativeSnapshot[]>('/snapshots', { method: 'POST', body: JSON.stringify({ ids: uniqueIds.slice(index, index + 100) }) });
    for (const value of batch) values.push(rememberNativeSnapshot(value));
  }
  return values;
}
export function acknowledgeNativeCommands(commands: NativeCommand[]): void {
  currentIdentity(); pending.delete(JSON.stringify({ commands }));
}
export interface NativeCoverPayload { bytesBase64: string; mimeType: string; fileName: string; }
export async function nativeCoverPayload(file: Blob, fileName = 'cover'): Promise<NativeCoverPayload> {
  if (file.size < 1 || file.size > 10 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Cover must be PNG, JPEG or WebP, at most 10 MiB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const valid = file.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value) :
    file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 :
    new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
  if (!valid || /[\\/"\r\n]/.test(fileName) || fileName.includes(String.fromCharCode(0))) throw new Error('Invalid cover signature or file name');
  let binary = '';
  for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return { bytesBase64: btoa(binary), mimeType: file.type, fileName };
}

/** Retains an apply key across an uncertain transport outcome so UI retry cannot duplicate a create. */
export async function applyNativeCommands(commands: NativeCommand[], checkContext: () => void = () => {}): Promise<NativeApplyResult> {
  const startedIdentity = currentIdentity();
  const serialized = JSON.stringify({ commands });
  checkContext();
  let operation = pending.get(serialized);
  if (!operation) {
    const plan = await nativeRequest<NativePlan>('/plans', { method: 'POST', body: serialized });
    if (typeof plan.id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(plan.id)) throw new NativeApiError('The native gateway returned an invalid plan.', 502, 'native_plan_invalid');
    checkContext();
    operation = { planId: plan.id, key: crypto.randomUUID() };
    pending.set(serialized, operation);
  }
  checkContext();
  if (currentIdentity() !== startedIdentity) throw new NativeApiError('The active repository identity changed before apply.', 409, 'identity_changed');
  const result = await nativeRequest<NativeApplyResult>(`/plans/${operation.planId}/apply`, {
    method: 'POST', body: '{}', headers: { 'Idempotency-Key': operation.key },
  });
  checkContext();
  if (!isNativeApplyResult(result)) throw new NativeApiError('The native gateway returned an invalid apply receipt.', 502, 'native_receipt_invalid');
  if (!result.ok) {
    const error = result.error && typeof result.error === 'object' ? result.error : undefined;
    const failure = new NativeApiError(error?.message || (typeof result.error === 'string' ? result.error : 'The native operation was not fully applied. Refresh before retrying.'), error?.status || 409, error?.code || 'native_apply_incomplete');
    failure.applyResult = result;
    throw failure;
  }
  for (const completed of result.completed) {
    const id = completed.result.id;
    if (id && completed.result.revision) {
      const before = snapshots.get(id);
      if (before) snapshots.set(id, { ...before, revision: completed.result.revision });
    }
  }
  return result;
}
