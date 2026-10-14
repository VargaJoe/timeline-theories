import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/content.mjs';
import { assertUuid, hash, openAppState } from './store.mjs';

const MAX_INPUT = 4 * 1024 * 1024;
const MAX_RESPONSE = 4 * 1024 * 1024;
const BACKGROUND_PATH = '/.netlify/functions/native-api-background';
const forwardedHeaders = ['authorization', 'x-timeline-backend-auth', 'x-timeline-client-origin', 'x-timeline-repository', 'x-timeline-authority', 'x-timeline-project'];
const inputHeaders = ['content-type', 'idempotency-key'];
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const cancelled = () => new DomainError('job_cancelled', 'The original caller cancelled this background job.', 409);
const errorResponse = error => ({ status: error instanceof DomainError ? error.status || 500 : 500, headers: { 'content-type': 'application/json' }, body: Buffer.from(JSON.stringify({ error: { code: error instanceof DomainError ? error.code : 'job_failed', message: error instanceof DomainError ? error.message : 'The background job failed.', ...(error instanceof DomainError && error.details ? { details: error.details } : {}) } })), readTargets: [] });

function appOrigin(config) {
  let url;
  try { url = new URL(config.frontendOrigin); } catch { throw new DomainError('invalid_configuration', 'Background jobs require the configured HTTPS app origin.', 503); }
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash || (config.local && url.origin !== 'https://localhost:8080')) throw new DomainError('invalid_configuration', 'Background jobs require the configured HTTPS app origin.', 503);
  return url.origin;
}
function owner(context) {
  const principal = context?.principal, identity = context?.identity?.Id;
  if (typeof principal !== 'string' || !principal || principal === 'visitor' || principal.length > 256 || !Number.isSafeInteger(identity) || identity < 1) throw new DomainError('job_owner_required', 'An authenticated application principal and backend identity are required.', 401);
  return { principal, identity };
}
function forwarded(request, origin) {
  const headers = new Headers();
  for (const name of forwardedHeaders) if (request.headers.has(name)) headers.set(name, request.headers.get(name));
  if (!headers.has('x-timeline-client-origin') && request.headers.get('origin') === origin) headers.set('x-timeline-client-origin', origin);
  return headers;
}
function longRoute(request, origin) {
  const url = new URL(request.url);
  if (url.origin !== origin || url.search || url.hash) throw new DomainError('job_route_invalid', 'A background job must use an application API route.');
  const post = /^\/api\/v1\/(plans|plans\/[0-9a-f-]{36}\/apply|providers\/(books\/(search|details)|media\/lookup|trakt\/list)|exchange\/\d+\/preview)$/i;
  const get = /^\/api\/v1\/exchange\/\d+\/export$/;
  if (!(request.method === 'POST' && post.test(url.pathname)) && !(request.method === 'GET' && get.test(url.pathname))) throw new DomainError('job_route_invalid', 'This API route does not support background execution.');
  return url.pathname;
}
/** Credentials travel only in this HTTPS request. Redirects are never followed,
 * including redirects to another origin on behalf of the same app. */
function invokeBackground(url, headers, bytes, config) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, { method: 'POST', headers: Object.fromEntries(headers), ...(config.local && config.ca ? { ca: config.ca } : {}), timeout: 15000 }, response => {
      response.resume();
      response.once('end', () => response.statusCode === 202 ? resolve() : reject(new Error('Background invocation was not acknowledged.')));
      response.once('error', reject);
    });
    request.once('timeout', () => request.destroy(new Error('Background invocation acknowledgement timed out.')));
    request.once('error', reject);
    request.end(bytes);
  });
}

/** Durable app-local background work. A claim is permanent: automatic runtime
 * retries may read the result, but may never repeat the original execution. */
export class JobService {
  constructor(config, { store, invoke = invokeBackground, prepareResponse } = {}) {
    this.config = config; this.origin = appOrigin(config); this.invoke = invoke; this.prepareResponse = prepareResponse;
    Object.assign(this, store || openAppState(config));
  }
  key(id, suffix) { assertUuid(id, 'Job ID'); return this.prefix + `jobs/${id}/${suffix}`; }
  async read(id, suffix) { return this.blobs.getWithMetadata(this.key(id, suffix), { type: 'json', consistency: 'strong' }); }
  async owned(id, context) {
    const caller = owner(context), saved = await this.read(id, 'input');
    if (!saved || saved.data.principal !== caller.principal || saved.data.identity !== caller.identity) throw new DomainError('job_unavailable', 'This job is unavailable for the current application principal.', 404);
    if (saved.data.binding !== this.prefix) throw new DomainError('job_binding_mismatch', 'The saved job belongs to a different application target.', 503);
    await context.check();
    return saved.data;
  }
  async descriptor(id, context) {
    const saved = await this.owned(id, context), caller = owner(context);
    const [claim, cancellation, dispatch, writer] = await Promise.all([this.read(id, 'claim'), this.read(id, 'cancel'), this.read(id, 'dispatch-unconfirmed'), this.blobs.getWithMetadata(this.prefix + 'writer', { type: 'json', consistency: 'strong' })]);
    let recovery;
    const held = writer?.data, current = held?.owner;
    if (held?.binding === this.binding && held.state === 'held' && current?.jobId === id && current.principal === caller.principal && current.identity === caller.identity && saved.planId && current.planId === saved.planId) {
      assertUuid(current.requestId, 'Stopped request ID'); assertUuid(current.planId, 'Plan ID');
      recovery = { planId: current.planId, stoppedRequestId: current.requestId, requiresStoppedConfirmation: true };
    }
    await context.check();
    return json(202, { job: { id, state: claim ? cancellation ? 'cancelling' : 'running' : cancellation ? 'cancelled' : dispatch ? 'dispatch_unconfirmed' : 'queued' }, pending: true, ...(recovery ? { recovery } : {}) });
  }
  async enqueue(request, context, input, { requestId = randomUUID(), planId } = {}) {
    const caller = owner(context), route = longRoute(request, this.origin);
    assertUuid(requestId, 'Request ID');
    const apply = route.match(/^\/api\/v1\/plans\/([0-9a-f-]{36})\/apply$/i);
    if (apply) { assertUuid(apply[1], 'Plan ID'); planId = apply[1]; }
    if (planId !== undefined) assertUuid(planId, 'Plan ID');
    const idempotencyKey = request.headers.get('idempotency-key');
    if (apply && (!idempotencyKey || !/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey))) throw new DomainError('invalid_idempotency_key', 'Idempotency-Key must contain 8..128 safe characters.');
    const bytes = input === undefined ? Buffer.from(await request.arrayBuffer()) : Buffer.isBuffer(input) || input instanceof Uint8Array ? Buffer.from(input) : Buffer.from(JSON.stringify(input));
    if (bytes.length > MAX_INPUT) throw new DomainError('job_input_limit', 'Prepare an app upload before queuing input larger than 4 MiB.', 413);
    if (request.method === 'GET' && bytes.length) throw new DomainError('job_input_invalid', 'An export job cannot have a request body.');
    await context.check();
    const id = randomUUID(), headers = {};
    for (const name of inputHeaders) if (request.headers.has(name)) headers[name] = request.headers.get(name);
    const row = { id, binding: this.prefix, ...caller, requestId, ...(planId ? { planId } : {}), method: request.method, path: route, headers, body: bytes.toString('base64'), createdAt: new Date().toISOString() };
    const saved = await this.blobs.setJSON(this.key(id, 'input'), row, { onlyIfNew: true });
    if (!saved.modified) throw new DomainError('job_conflict', 'The generated job already exists.', 409);
    if (apply) {
      const mappingKey = this.prefix + `job-operations/${hash({ principal: caller.principal, key: idempotencyKey })}`;
      const reservation = await this.blobs.setJSON(mappingKey, { id, principal: caller.principal, identity: caller.identity, planId }, { onlyIfNew: true });
      if (!reservation.modified) {
        const previous = await this.blobs.getWithMetadata(mappingKey, { type: 'json', consistency: 'strong' });
        if (!previous || previous.data.principal !== caller.principal || previous.data.identity !== caller.identity || previous.data.planId !== planId) throw new DomainError('idempotency_conflict', 'This application key already belongs to a different saved plan.', 409);
        const previousResult = await this.read(previous.data.id, 'result');
        let final;
        try { final = previousResult && JSON.parse(Buffer.from(previousResult.data.body, 'base64').toString()); } catch { final = null; }
        const busy = previousResult?.data.status === 409 && final?.error?.code === 'coordinator_busy' && final.ok !== false && !Object.hasOwn(final, 'completed') && !Object.hasOwn(final, 'partial');
        const uncertainReceipt = final?.ok === false && final.planId === planId && final.retrySamePlan === true && Array.isArray(final.completed) && Array.isArray(final.notApplied);
        const uncertainError = final?.error?.details?.uncertain === true && final.ok === undefined && final.planId === undefined && !Object.hasOwn(final, 'completed') && !Object.hasOwn(final, 'notApplied');
        // Only an explicit same-owner API POST may reserve a new invocation
        // after a before-dispatch busy failure or terminal uncertainty. The
        // same saved plan/key reaches the journal's read-only reconciliation;
        // an existing pending dispatch is never sent to SenseNet again.
        // Automatic retries of the old job retain its permanent claim/result.
        if (!previousResult || final?.error?.code === 'job_cancelled' || !(busy || uncertainReceipt || uncertainError)) return this.status(previous.data.id, context);
        if (!previous.etag) throw new DomainError('state_invalid', 'The saved job reservation ETag is unavailable.', 503);
        await context.check();
        const replaced = await this.blobs.setJSON(mappingKey, { id, principal: caller.principal, identity: caller.identity, planId }, { onlyIfMatch: previous.etag });
        if (!replaced.modified) {
          const latest = await this.blobs.getWithMetadata(mappingKey, { type: 'json', consistency: 'strong' });
          if (!latest || latest.data.principal !== caller.principal || latest.data.identity !== caller.identity || latest.data.planId !== planId) throw new DomainError('idempotency_conflict', 'The saved job reservation changed for a different caller or plan.', 409);
          return this.status(latest.data.id, context);
        }
      }
    }
    const outbound = forwarded(request, this.origin), payload = Buffer.from(JSON.stringify({ jobId: id }));
    outbound.set('content-type', 'application/json'); outbound.set('content-length', String(payload.length));
    try { await this.invoke(new URL(BACKGROUND_PATH, this.origin), outbound, payload, this.config); }
    catch {
      // The accepted request may still be running. Never auto-redispatch it.
      await this.blobs.setJSON(this.key(id, 'dispatch-unconfirmed'), { id, at: new Date().toISOString() }, { onlyIfNew: true });
      return this.descriptor(id, context);
    }
    return this.descriptor(id, context);
  }
  async status(id, context) {
    await this.owned(id, context);
    const result = await this.read(id, 'result');
    if (!result) return this.descriptor(id, context);
    const final = result.data;
    if (final.readTargets?.length) await context.repo.assert(final.readTargets.map(target => ({ target, action: 'read' })));
    await context.check();
    return new Response([204, 205, 304].includes(final.status) ? null : Buffer.from(final.body, 'base64'), { status: final.status, headers: { ...final.headers, 'cache-control': 'no-store' } });
  }
  async cancel(id, context) {
    await this.owned(id, context);
    if (await this.read(id, 'result')) return this.status(id, context);
    await this.blobs.setJSON(this.key(id, 'cancel'), { id, ...owner(context), at: new Date().toISOString() }, { onlyIfNew: true });
    if (!await this.read(id, 'claim')) await this.saveResult(id, errorResponse(cancelled()), context);
    return this.status(id, context);
  }
  async saveResult(id, response, context) {
    let prepared = response;
    if (this.prepareResponse) prepared = await this.prepareResponse(response, context, { jobId: id });
    if (prepared instanceof Response) prepared = { status: prepared.status, headers: prepared.headers, body: Buffer.from(await prepared.arrayBuffer()), readTargets: response.readTargets };
    const body = Buffer.from(prepared.body ?? []), targets = prepared.readTargets ?? [];
    if (body.length > MAX_RESPONSE) throw new DomainError('job_response_limit', 'Prepare an app download before returning output larger than 4 MiB.', 413);
    if (!Number.isInteger(prepared.status) || prepared.status < 200 || prepared.status > 599 || !Array.isArray(targets) || targets.some(target => !Number.isSafeInteger(target) || target < 1)) throw new DomainError('job_response_invalid', 'The background result status or read targets are invalid.', 500);
    const headers = Object.fromEntries(new Headers(prepared.headers ?? {}));
    for (const name of ['authorization', 'proxy-authorization', 'set-cookie', 'connection', 'transfer-encoding', 'content-length']) delete headers[name];
    const row = { id, status: prepared.status, headers, body: body.toString('base64'), readTargets: [...new Set(targets)], completedAt: new Date().toISOString() };
    await this.blobs.setJSON(this.key(id, 'result'), row, { onlyIfNew: true });
  }
  async run(request, context, execute) {
    if (request.method !== 'POST' || new URL(request.url).origin !== this.origin || new URL(request.url).pathname !== BACKGROUND_PATH) throw new DomainError('job_dispatch_invalid', 'Use the application background POST endpoint.');
    const bytes = Buffer.from(await request.arrayBuffer());
    if (bytes.length > 256 * 1024) throw new DomainError('job_dispatch_invalid', 'The background envelope is too large.', 413);
    let envelope; try { envelope = JSON.parse(bytes.toString()); } catch { throw new DomainError('invalid_json', 'A job ID envelope is required.'); }
    if (!envelope || Object.keys(envelope).length !== 1 || typeof envelope.jobId !== 'string') throw new DomainError('job_dispatch_invalid', 'Only a saved job ID may be dispatched.');
    const id = assertUuid(envelope.jobId, 'Job ID'), row = await this.owned(id, context);
    if (await this.read(id, 'result')) return new Response(null, { status: 204 });
    const claim = { id, principal: row.principal, identity: row.identity, nonce: randomUUID(), startedAt: new Date().toISOString() };
    const reserved = await this.blobs.setJSON(this.key(id, 'claim'), claim, { onlyIfNew: true });
    if (!reserved.modified) return new Response(null, { status: 204 });
    const checkCancelled = async () => { if (await this.read(id, 'cancel')) throw cancelled(); };
    const assertOwner = async () => {
      const current = await this.read(id, 'claim');
      if (!current || current.data.nonce !== claim.nonce || current.data.principal !== row.principal || current.data.identity !== row.identity) throw new DomainError('job_owner_lost', 'This invocation no longer owns the saved job.', 409);
      await checkCancelled();
      await context.check();
      await checkCancelled();
    };
    const headers = forwarded(request, this.origin);
    for (const [name, value] of Object.entries(row.headers)) headers.set(name, value);
    const originalRequest = new Request(new URL(row.path, this.origin), { method: row.method, headers, ...(row.method === 'GET' ? {} : { body: Buffer.from(row.body, 'base64') }) });
    const job = { id, requestId: row.requestId, ...(row.planId ? { planId: row.planId } : {}), principal: row.principal, identity: row.identity, originalRequest, checkCancelled, assertOwner };
    try {
      await assertOwner();
      await this.saveResult(id, await execute({ request: originalRequest, context, job }), context);
    } catch (error) { await this.saveResult(id, errorResponse(error), context); }
    return new Response(null, { status: 204 });
  }
}
