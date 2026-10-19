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
  jobId?: string;
  recoverable?: boolean;
  planId?: string;
  idempotencyKey?: string;
  details?: unknown;
  constructor(message: string, status: number, code: string, source?: string, retryAfter?: number) {
    super(message); this.name = 'NativeApiError'; this.status = status; this.code = code;
    this.source = source; this.retryAfter = retryAfter;
  }
}

const creationApplyStart = Symbol('creationApplyStart');
type CreationRequestInit = RequestInit & { [creationApplyStart]?: () => void };

/** One user-owned form/import occurrence, never a deduplication of its fields. */
export class NativeCreationIntent {
  readonly name: string;
  private subject?: string;
  private input?: string;
  private complete = false;
  private result: unknown;
  private running?: Promise<unknown>;
  private applyStarted = false;
  private checkContext?: () => void;
  constructor(prefix = '') { this.name = prefix + crypto.randomUUID(); }
  get hasStartedApply(): boolean { return this.applyStarted; }
  requestInit(): RequestInit {
    // The SDK copies symbol properties; fetch never serializes them as headers.
    return { [creationApplyStart]: () => { this.applyStarted = true; } } as CreationRequestInit;
  }
  async run<T>(input: unknown, create: (name: string) => Promise<T>, checkContext: () => void = () => {}): Promise<T> {
    const subject = currentIdentity(), serialized = JSON.stringify(input);
    if (this.subject !== undefined && this.subject !== subject) throw new NativeApiError('Start a new create form after changing repository identity.', 409, 'identity_changed');
    try { this.checkContext?.(); } catch { throw new NativeApiError('The operation context changed. Check the saved outcome before starting a new create form.', 409, 'operation_context_changed'); }
    if (this.input !== undefined && this.input !== serialized) throw new NativeApiError('This create attempt has a saved outcome. Retry its original values, or check its outcome before starting a new form.', 409, 'creation_intent_changed');
    this.subject = subject; this.input = serialized; this.checkContext ??= checkContext;
    if (this.complete) return this.result as T;
    if (this.running) return this.running as Promise<T>;
    this.running = Promise.resolve().then(() => { assertNativeIdentity(subject); this.checkContext!(); return create(this.name); }).then(value => {
      assertNativeIdentity(subject); this.checkContext!(); this.result = value; this.complete = true; return value;
    }).catch(error => {
      // A preparation failure cannot write. Once apply starts, even a 400/403
      // may follow a committed write or a failed readback, so keep exact input.
      if (!this.applyStarted) this.input = undefined;
      throw error;
    }).finally(() => { this.running = undefined; });
    return this.running as Promise<T>;
  }
}
export function nativeCreationApplyStart(init?: RequestInit): () => void {
  return (init as CreationRequestInit | undefined)?.[creationApplyStart] ?? (() => {});
}

let getToken: () => string | undefined = () => undefined;
let identity = '';
const snapshots = new Map<number, NativeSnapshot>();
const targets = new Map<string, number>();
const pending = new Map<string, { planId: string; key: string }>();
const activeJobs = new Map<string, { identity: string; headers: Headers }>();
const CHUNK_BYTES = 2 * 1024 * 1024;
const INLINE_BYTES = 3 * 1024 * 1024;
const JSON_BYTES = 4 * 1024 * 1024;
const MAX_TRANSFER_BYTES = 64 * 1024 * 1024;
const generatedId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const nativeBase = '/api/v1';
export interface NativeGatewayAvailability { ready: boolean; writable: boolean; error?: NativeApiError; }
let gatewayAvailability: { identity: string; expires: number; value: NativeGatewayAvailability } | undefined;
let gatewayDiscovery: { identity: string; promise: Promise<NativeGatewayAvailability> } | undefined;
let writeReadinessExpires = 0;

export function configureNativeAuth(provider: () => string | undefined): void { getToken = provider; invalidateNativeSnapshots(); }
function cancelActiveJobs(): void {
  for (const [id, job] of activeJobs) {
    // Retain the original token and binding: a new identity cannot cancel an old caller's job.
    const headers = new Headers(job.headers); headers.set('Content-Type', 'application/json');
    void fetch(nativeUrl(`/jobs/${id}/cancel`), { method: 'POST', body: '{}', headers, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(30000) }).catch(() => {});
  }
  activeJobs.clear();
}
export function invalidateNativeSnapshots(): void { cancelActiveJobs(); snapshots.clear(); targets.clear(); pending.clear(); gatewayAvailability = undefined; gatewayDiscovery = undefined; writeReadinessExpires = 0; identity = ''; }
function currentIdentity(): string {
  const next = `${environment.repositoryUrl}\n${environment.projectRoot}\n${environment.authority}\n${getToken() || ''}`;
  if (identity !== next) { cancelActiveJobs(); snapshots.clear(); targets.clear(); pending.clear(); gatewayAvailability = undefined; gatewayDiscovery = undefined; writeReadinessExpires = 0; identity = next; }
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
  failure.details = detail.details;
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

function assertNativeIdentity(subject: string): void {
  if (currentIdentity() !== subject) throw new NativeApiError('The active repository identity changed during the request.', 409, 'identity_changed');
}
type SendNativeRoute = (route: string, init?: RequestInit) => Promise<Response>;
async function responseJson(response: Response): Promise<Record<string, unknown>> {
  let payload: unknown;
  try { payload = await response.json(); } catch { throw new NativeApiError('The native gateway returned an invalid response.', 502, 'native_response_invalid'); }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new NativeApiError('The native gateway returned an invalid response.', 502, 'native_response_invalid');
  return payload as Record<string, unknown>;
}
async function transferJson(send: SendNativeRoute, route: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await send(route, init), payload = await responseJson(response);
  if (!response.ok) throw responseError(payload, response.status);
  return payload;
}
async function sha256(bytes: Uint8Array): Promise<string> {
  const result = await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes).buffer);
  return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, '0')).join('');
}
function base64Bytes(value: unknown): Uint8Array {
  if (typeof value !== 'string' || value.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new NativeApiError('Invalid staged cover bytes.', 400, 'invalid_cover');
  try { return Uint8Array.from(atob(value), character => character.charCodeAt(0)); }
  catch { throw new NativeApiError('Invalid staged cover bytes.', 400, 'invalid_cover'); }
}
async function stageNativeUpload(send: SendNativeRoute, bytes: Uint8Array, input: Record<string, unknown>): Promise<string> {
  if (bytes.length < 1 || bytes.length > (input.kind === 'cover' ? 10 * 1024 * 1024 : MAX_TRANSFER_BYTES)) throw new NativeApiError('Upload exceeds the application byte limit.', 413, 'native_payload_limit');
  const sha = await sha256(bytes);
  const initialized = await transferJson(send, '/uploads', { method: 'POST', body: JSON.stringify({ ...input, size: bytes.length, sha256: sha }), headers: { 'Content-Type': 'application/json' } });
  const upload = initialized.upload as Record<string, unknown> | undefined;
  if (!upload || !generatedId(upload.id) || upload.size !== bytes.length || upload.sha256 !== sha || upload.chunkSize !== CHUNK_BYTES || upload.chunks !== Math.ceil(bytes.length / CHUNK_BYTES)) throw new NativeApiError('The native gateway returned an invalid upload reservation.', 502, 'native_transfer_invalid');
  for (let index = 0; index < Number(upload.chunks); index++) {
    await transferJson(send, `/uploads/${upload.id}/chunks/${index}`, { method: 'POST', body: Uint8Array.from(bytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)).buffer, headers: { 'Content-Type': 'application/octet-stream' } });
  }
  const completed = await transferJson(send, `/uploads/${upload.id}/complete`, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' } });
  const saved = completed.upload as Record<string, unknown> | undefined;
  if (!saved || saved.id !== upload.id || saved.complete !== true || saved.size !== bytes.length || saved.sha256 !== sha) throw new NativeApiError('The native gateway returned an invalid completed upload.', 502, 'native_transfer_invalid');
  return upload.id;
}
async function stageNativeInput(path: string, init: RequestInit, send: SendNativeRoute): Promise<RequestInit> {
  if (/\/(?:api\/v1\/)?plans$/.test(path) && typeof init.body === 'string') {
    let value: unknown; try { value = JSON.parse(init.body); } catch { return init; }
    const input = value as { commands?: NativeCommand[] };
    if (!input || !Array.isArray(input.commands)) return init;
    const largeBatch = new TextEncoder().encode(init.body).byteLength > JSON_BYTES;
    const commands: NativeCommand[] = [];
    for (const command of input.commands) {
      if (!command || typeof command !== 'object') { commands.push(command); continue; }
      const cover = command.action === 'cover' ? command : command.action === 'metadata' ? command.cover as Record<string, unknown> | undefined : undefined;
      if (!cover || typeof cover.bytesBase64 !== 'string' || (!largeBatch && cover.bytesBase64.length <= INLINE_BYTES)) { commands.push(command); continue; }
      const bytes = base64Bytes(cover.bytesBase64);
      const uploadId = await stageNativeUpload(send, bytes, { kind: 'cover', targetId: command.targetId, expectedRevision: command.expectedRevision, mimeType: cover.mimeType, fileName: cover.fileName || 'cover' });
      const staged = { ...cover }; delete staged.bytesBase64;
      commands.push(command.action === 'cover' ? { ...staged, action: command.action, uploadId } : { ...command, cover: { ...staged, uploadId } });
    }
    const body = JSON.stringify({ ...input, commands });
    if (new TextEncoder().encode(body).byteLength > JSON_BYTES) throw new NativeApiError('The native plan JSON exceeds the wire limit.', 413, 'native_payload_limit');
    return { ...init, body };
  }
  const zipTarget = path.match(/\/(?:api\/v1\/)?exchange\/(\d+)\/preview$/);
  if (zipTarget && init.body && typeof init.body !== 'string') {
    let bytes: Uint8Array | undefined;
    if (init.body instanceof Blob) bytes = new Uint8Array(await init.body.arrayBuffer());
    else if (init.body instanceof ArrayBuffer) bytes = new Uint8Array(init.body);
    else if (ArrayBuffer.isView(init.body)) bytes = new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength);
    if (bytes && bytes.length > INLINE_BYTES) {
      const uploadId = await stageNativeUpload(send, bytes, { kind: 'zip', targetId: Number(zipTarget[1]), mimeType: 'application/zip', fileName: 'timeline.zip' });
      const headers = new Headers(init.headers); headers.set('Content-Type', 'application/json');
      return { ...init, body: JSON.stringify({ uploadId }), headers };
    }
  }
  return init;
}
async function followNativeBrowserResponse(initial: Response, send: SendNativeRoute, subject: string, originalHeaders: Headers): Promise<Response> {
  let response = initial; const deadline = Date.now() + 15 * 60 * 1000; let jobId: string | undefined;
  for (;;) {
    assertNativeIdentity(subject);
    const payload = response.headers.get('content-type')?.toLowerCase().includes('application/json') ? await responseJson(response.clone()) : undefined;
    const job = payload?.job as Record<string, unknown> | undefined;
    if (response.status === 202 && payload?.pending === true) {
      if (!job || !generatedId(job.id) || jobId !== undefined && job.id !== jobId) throw new NativeApiError('The gateway returned an invalid pending job.', 502, 'native_job_invalid');
      jobId = job.id; activeJobs.set(jobId, { identity: subject, headers: new Headers(originalHeaders) });
      if (Date.now() >= deadline) {
        const failure = new NativeApiError('The job is still pending. Retry the same saved plan and apply key to recover its receipt.', 504, 'native_job_pending');
        failure.jobId = jobId; failure.recoverable = true; throw failure;
      }
      const retryAfter = Number(response.headers.get('retry-after') || 1);
      const delay = Math.min(5000, Math.max(250, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000));
      await new Promise(resolve => setTimeout(resolve, delay)); assertNativeIdentity(subject);
      try { response = await send(`/jobs/${jobId}`, { method: 'GET' }); }
      catch (error) { if (error instanceof NativeApiError) { error.jobId = jobId; error.recoverable = true; } throw error; }
      continue;
    }
    if (jobId) activeJobs.delete(jobId);
    const download = payload?.download as Record<string, unknown> | undefined;
    if (!download) return response;
    const size = Number(download.size), chunkSize = Number(download.chunkSize), count = Number(download.chunks);
    if (!generatedId(download.id) || !Number.isSafeInteger(size) || size < 1 || size > MAX_TRANSFER_BYTES || chunkSize !== CHUNK_BYTES || count !== Math.ceil(size / chunkSize) || typeof download.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(download.sha256) || download.status !== response.status || typeof download.contentType !== 'string') throw new NativeApiError('The native gateway returned an invalid download manifest.', 502, 'native_transfer_invalid');
    const bytes = new Uint8Array(size);
    for (let index = 0; index < count; index++) {
      const part = await send(`/downloads/${download.id}/chunks/${index}`, { method: 'GET' });
      if (!part.ok) throw responseError(await responseJson(part), part.status);
      const chunk = new Uint8Array(await part.arrayBuffer()); assertNativeIdentity(subject);
      if (chunk.length !== Math.min(chunkSize, size - index * chunkSize) || part.headers.get('x-content-sha256') !== await sha256(chunk)) throw new NativeApiError('Downloaded chunk failed integrity verification.', 502, 'native_transfer_integrity');
      bytes.set(chunk, index * chunkSize);
    }
    if (await sha256(bytes) !== download.sha256) throw new NativeApiError('Downloaded bytes failed SHA-256 verification.', 502, 'native_transfer_integrity');
    assertNativeIdentity(subject);
    const headers = new Headers();
    const original = download.headers as Record<string, string> | undefined;
    for (const key of ['content-type','content-disposition','x-skipped-images','x-timeline-skipped-images','x-timeline-skipped-covers']) if (typeof original?.[key] === 'string') headers.set(key, original[key]);
    headers.set('Content-Type', download.contentType); headers.set('Content-Length', String(size)); headers.set('Cache-Control', 'no-store');
    return new Response(bytes, { status: response.status, headers });
  }
}

/** Bearer and binding headers are supplied only to the configured gateway. */
export async function nativeResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const startedIdentity = currentIdentity(), token = getToken(), headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  headers.set('X-Timeline-Repository', environment.repositoryUrl);
  headers.set('X-Timeline-Project', environment.projectRoot);
  headers.set('X-Timeline-Authority', environment.authority);
  // Same-origin GETs may omit Origin; this routes the session through actual backend token validation.
  headers.set('X-Timeline-Client-Origin', window.location.origin);
  if (token) headers.set('Authorization', `Bearer ${token}`); else headers.delete('Authorization');
  const send: SendNativeRoute = async (route, options = {}) => {
    assertNativeIdentity(startedIdentity);
    const requestHeaders = new Headers(headers);
    for (const [key, value] of new Headers(options.headers)) requestHeaders.set(key, value);
    for (const key of ['Authorization','X-Timeline-Repository','X-Timeline-Project','X-Timeline-Authority','X-Timeline-Client-Origin']) {
      if (headers.has(key)) requestHeaders.set(key, headers.get(key)!); else requestHeaders.delete(key);
    }
    if (!['GET', 'HEAD'].includes((options.method || 'GET').toUpperCase()) && !requestHeaders.has('Content-Type')) requestHeaders.set('Content-Type', 'application/json');
    let result: Response;
    try { result = await fetch(nativeUrl(route), { ...options, headers: requestHeaders, credentials: 'omit', redirect: 'error', signal: options.signal || AbortSignal.timeout(120000) }); }
    catch (error) {
      if (error instanceof NativeApiError) throw error;
      const failure = new NativeApiError('The native gateway request failed. Recover an approved apply with the same saved plan and key.', 503, 'native_gateway_unavailable');
      failure.transportFailure = true; throw failure;
    }
    assertNativeIdentity(startedIdentity); return result;
  };
  const staged = await stageNativeInput(path, init, send);
  const response = await followNativeBrowserResponse(await send(path, staged), send, startedIdentity, headers);
  if (!response.ok) {
    let errorPayload: unknown;
    try { errorPayload = await response.json(); } catch { /* A failed transport may return a non-JSON error. */ }
    assertNativeIdentity(startedIdentity);
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
function nativeTarget(target: string | number): string | number {
  if (typeof target === 'string' && /^\d+$/.test(target)) {
    const id = Number(target);
    if (!Number.isSafeInteger(id) || id < 1) throw new NativeApiError('The content ID is invalid.', 400, 'invalid_native_target');
    return id;
  }
  return target;
}
export async function requireNativeWriteReadiness(target: string | number, parent = false): Promise<void> {
  const availability = await nativeGatewayAvailability();
  if (!availability.ready) throw availability.error || new NativeApiError('Editing requires the configured M1 gateway.', 503, 'native_gateway_unconfigured');
  if (!availability.writable) throw new NativeApiError('The configured native gateway is read only.', 403, 'native_read_only');
  if (writeReadinessExpires > Date.now()) return;
  try {
    // Verify a same-caller repository snapshot through the application gateway. Do not refresh an editor's saved revision.
    const snapshot = await nativeRequest<NativeSnapshot>('/lookup', { method: 'POST', body: JSON.stringify({ target: nativeTarget(target), ...(parent ? { parent: true } : {}) }) });
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
  const value = await nativeRequest<NativeSnapshot>('/lookup', { method: 'POST', body: JSON.stringify({ target: nativeTarget(target), ...(parent ? { parent: true } : {}) }) });
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
export function nativeCommandFailure(commands: NativeCommand[], error: unknown): NativeApiError {
  const operation = pending.get(JSON.stringify({ commands }));
  const failure = error instanceof NativeApiError ? error : new NativeApiError('The created content could not be read back. Retry the original create attempt to recover its saved result.', 503, 'native_readback_unavailable');
  if (operation) { failure.planId = operation.planId; failure.idempotencyKey = operation.key; failure.recoverable = true; }
  if (!(error instanceof NativeApiError)) failure.transportFailure = true;
  return failure;
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
export async function applyNativeCommands(commands: NativeCommand[], checkContext: () => void = () => {}, onApplyStart: () => void = () => {}): Promise<NativeApplyResult> {
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
  let result: NativeApplyResult;
  onApplyStart();
  try { result = await nativeRequest<NativeApplyResult>(`/plans/${operation.planId}/apply`, {
    method: 'POST', body: '{}', headers: { 'Idempotency-Key': operation.key },
  }); } catch (error) { throw nativeCommandFailure(commands, error); }
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
