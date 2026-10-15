import { getStore } from '@netlify/blobs';
import { createHash, randomBytes, randomUUID, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { DomainError } from '../domain/content.mjs';

export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : stableJson(value)).digest('hex');
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function assertUuid(value, label = 'ID') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new DomainError('invalid_id', `${label} must be a UUID.`);
  return value;
}
export const appBinding = config => hash({ repository: config.repositoryUrl, authority: config.authority, project: config.projectRoot });
/** Site-wide private state. Reads deliberately bypass the edge cache. Replacing
 * a Function must preserve its records, so this is never deployment-scoped. */
export function openAppState(config = {}) {
  const binding = appBinding(config);
  return { binding, prefix: `v1/${binding}/`, blobs: getStore({ ...config.blobOptions, name: config.blobStoreName || 'timeline-app-state-v1', consistency: 'strong' }) };
}
function assertPrincipal(principal) {
  if (typeof principal !== 'string' || !principal || principal.length > 256) throw new DomainError('invalid_principal', 'A bounded application principal is required.');
}
function assertHash(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) throw new DomainError('invalid_request_hash', 'A SHA-256 payload hash is required.');
}
function keyFor(principal, id) { assertPrincipal(principal); return hash({ principal, id }); }
function grantAAD(row) {
  return Buffer.from(stableJson({ id: row.id, token_hash: row.token_hash, identity: row.identity, binding: row.binding, scopes: row.scopes, expires: row.expires }));
}
// The original random bearer token is the only credential key material. A state
// store reader who possesses token_hash still cannot decrypt backend credentials.
function credentialKey(token) { return createHash('sha256').update('timeline-theories/grant-credential/aes-256-gcm/v1\0').update(token).digest(); }
function encryptCredential(value, token, row) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', credentialKey(token), iv);
  cipher.setAAD(grantAAD(row));
  const bytes = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64');
}
function decryptCredential(value, token, row) {
  try {
    const bytes = Buffer.from(value, 'base64');
    if (bytes.length < 29) throw new Error('Invalid ciphertext');
    const cipher = createDecipheriv('aes-256-gcm', credentialKey(token), bytes.subarray(0, 12));
    cipher.setAAD(grantAAD(row)); cipher.setAuthTag(bytes.subarray(12, 28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString());
  } catch { throw new DomainError('invalid_credential', 'Credential is unavailable or its immutable grant was changed.', 401); }
}
const unavailable = () => new DomainError('invalid_credential', 'Credential is expired, revoked or unavailable.', 401);

export class Store {
  constructor(config = {}) { Object.assign(this, openAppState(config)); }
  async read(key) { return this.blobs.getWithMetadata(this.prefix + key, { type: 'json', consistency: 'strong' }); }
  async immutable(key, value, conflict = 'state_conflict') {
    const written = await this.blobs.setJSON(this.prefix + key, value, { onlyIfNew: true });
    if (written.modified) return value;
    const saved = await this.read(key);
    if (!saved || stableJson(saved.data) !== stableJson(value)) throw new DomainError(conflict, 'This immutable state record already has different content.', 409);
    return saved.data;
  }
  async issue({ id, identity, binding, scopes, credential, expires }) {
    assertUuid(id, 'Grant ID');
    if (!Number.isSafeInteger(identity) || identity < 1 || binding !== this.binding || !Array.isArray(scopes) || !scopes.length || scopes.some(scope => typeof scope !== 'string') || new Set(scopes).size !== scopes.length || !Number.isSafeInteger(expires) || expires <= Date.now() || !credential || !['ApiKey','Bearer'].includes(credential.mode) || typeof credential.value !== 'string' || !credential.value) throw new DomainError('invalid_grant', 'Grant identity, binding, scopes, backend credential and expiry must be explicit.');
    const token = 'tta_' + randomBytes(32).toString('base64url');
    const row = { id, token_hash: hash(token), identity, binding, scopes: [...scopes], expires };
    row.credential = encryptCredential(credential, token, row);
    // An interrupted issuance leaves only an unusable index. The random token
    // is not returned until both immutable writes complete successfully.
    await this.immutable(`grant-ids/${id}`, { id, token_hash: row.token_hash, identity }, 'grant_conflict');
    await this.immutable(`grants/${row.token_hash}`, row, 'grant_conflict');
    return { id, token, scopes: row.scopes, expiresAt: new Date(expires).toISOString(), identity };
  }
  async grant(token) {
    if (typeof token !== 'string' || !/^tta_[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
    const tokenHash = hash(token), record = await this.read(`grants/${tokenHash}`);
    if (!record || record.data.token_hash !== tokenHash) throw unavailable();
    const row = record.data;
    if (!uuidPattern.test(row.id) || row.expires <= Date.now() || await this.read(`revocations/${row.id}`)) throw unavailable();
    const credential = decryptCredential(row.credential, token, row);
    if (!await this.active(row.id)) throw unavailable();
    return { ...row, revoked: 0, credential };
  }
  async active(id) {
    assertUuid(id, 'Grant ID');
    const indexed = await this.read(`grant-ids/${id}`);
    if (!indexed) return false;
    const row = await this.read(`grants/${indexed.data.token_hash}`);
    if (!row || row.data.id !== id || row.data.identity !== indexed.data.identity || row.data.expires <= Date.now()) return false;
    // The revocation fence is the final strong read before the caller's
    // dispatch check returns, independent of a held content writer.
    return !await this.read(`revocations/${id}`);
  }
  async revoke(id, identity) {
    assertUuid(id, 'Grant ID');
    const indexed = await this.read(`grant-ids/${id}`);
    if (!indexed || indexed.data.identity !== identity) return 0;
    const result = await this.blobs.setJSON(this.prefix + `revocations/${id}`, { id, identity }, { onlyIfNew: true });
    if (result.modified) return 1;
    const saved = await this.read(`revocations/${id}`);
    if (saved?.data.id !== id || saved.data.identity !== identity) throw new DomainError('state_invalid', 'The grant revocation record is unavailable or inconsistent.', 503);
    return 1;
  }
  async savePlan(plan) {
    assertUuid(plan.id, 'Plan ID'); assertPrincipal(plan.principal); assertHash(plan.requestHash);
    return this.immutable(`plans/${plan.id}`, plan, 'plan_conflict');
  }
  async plan(id, principal) {
    assertUuid(id, 'Plan ID'); assertPrincipal(principal);
    const row = await this.read(`plans/${id}`);
    if (!row || row.data.principal !== principal) throw new DomainError('plan_unavailable', 'Plan is unavailable for this credential.', 404);
    return row.data;
  }
  async recoveryPlan(id, identity) {
    assertUuid(id, 'Plan ID');
    const row = await this.read(`plans/${id}`);
    let owned = false;
    if (row?.data.principal.startsWith('grant:')) {
      const grantId = row.data.principal.slice(6);
      if (uuidPattern.test(grantId)) owned = (await this.read(`grant-ids/${grantId}`))?.data.identity === identity;
    } else owned = row?.data.principal.startsWith(`session:${identity}:`) === true;
    if (!owned) throw new DomainError('plan_unavailable', 'Recovery plan is unavailable for this backend identity.', 404);
    return row.data;
  }
  async reserve(principal, key, plan) {
    if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) throw new DomainError('invalid_idempotency_key', 'Idempotency-Key must contain 8..128 safe characters.');
    assertUuid(plan.id, 'Plan ID'); assertHash(plan.requestHash);
    const slot = keyFor(principal, key);
    await this.immutable(`operations/${slot}/reservation`, { principal, key, request_hash: plan.requestHash, plan_id: plan.id }, 'idempotency_conflict');
    return (await this.read(`operations/${slot}/receipt`))?.data.result ?? null;
  }
  async finish(principal, key, result) {
    const slot = keyFor(principal, key), reserved = await this.read(`operations/${slot}/reservation`);
    if (!reserved) throw new DomainError('operation_unavailable', 'A saved operation reservation is required.', 409);
    await this.immutable(`operations/${slot}/receipt`, { ...reserved.data, state: result.ok ? 'completed' : 'partial', result }, 'idempotency_conflict');
  }
  async audit(principal, operation, outcome, targets) {
    assertPrincipal(principal);
    await this.immutable(`audit/${randomUUID()}`, { at: Date.now(), principal, operation, outcome, targets });
  }
  async mutationRow(principal, operationId) {
    assertUuid(operationId, 'Operation ID');
    const slot = keyFor(principal, operationId), receipt = await this.read(`mutation-receipts/${slot}`);
    if (receipt) return receipt.data;
    return (await this.read('pending-mutations'))?.data.entries?.[slot] ?? null;
  }
  async pendingMutations() { return Object.values((await this.read('pending-mutations'))?.data.entries ?? {}); }
  async updatePending(change) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const previous = await this.read('pending-mutations');
      const state = previous?.data ?? { version: 1, entries: {} };
      const next = change(structuredClone(state));
      if (!next) return false;
      if (previous && !previous.etag) throw new DomainError('state_invalid', 'Shared pending state ETag is unavailable.', 503);
      const result = await this.blobs.setJSON(this.prefix + 'pending-mutations', next, previous ? { onlyIfMatch: previous.etag } : { onlyIfNew: true });
      if (result.modified) return true;
    }
    throw new DomainError('state_busy', 'Shared pending state changed repeatedly; retry the same saved plan/key.', 503);
  }
  async prepareMutation(principal, payload, before) {
    assertUuid(payload.operationId, 'Operation ID'); assertHash(payload.requestHash);
    const slot = keyFor(principal, payload.operationId), existing = await this.mutationRow(principal, payload.operationId);
    if (existing) {
      if (existing.request_hash !== payload.requestHash) throw new DomainError('idempotency_conflict', 'Operation ID already exists with different content.', 409);
      return { row: existing, created: false };
    }
    const row = { principal, operation_id: payload.operationId, request_hash: payload.requestHash, payload: JSON.stringify(payload), before_state: JSON.stringify(before), state: 'pending', result: null, started: Date.now() };
    let created = false;
    await this.updatePending(state => {
      created = false;
      const current = state.entries[slot];
      if (current) {
        if (current.request_hash !== payload.requestHash) throw new DomainError('idempotency_conflict', 'Operation ID already exists with different content.', 409);
        return null;
      }
      if (Object.keys(state.entries).length) throw new DomainError('pending_recovery_required', 'A previous application write has an uncertain outcome. Its original caller must recover the saved operation before preparing another dispatch.', 409);
      state.entries[slot] = row; created = true; return state;
    });
    return { row: await this.mutationRow(principal, payload.operationId), created };
  }
  async terminalMutation(principal, payload, result, state) {
    assertUuid(payload.operationId, 'Operation ID'); assertHash(payload.requestHash);
    const slot = keyFor(principal, payload.operationId), row = await this.mutationRow(principal, payload.operationId);
    if (!row || row.request_hash !== payload.requestHash) throw new DomainError('idempotency_conflict', 'A matching pending mutation is required.', 409);
    const terminal = { ...row, state, result: JSON.stringify(result) };
    // Archive BEFORE removing the shared pending fence. A crash leaves either
    // pending+receipt or receipt, never an untracked dispatched mutation.
    await this.immutable(`mutation-receipts/${slot}`, terminal, 'idempotency_conflict');
    await this.updatePending(pending => {
      const current = pending.entries[slot];
      if (!current) return null;
      if (current.request_hash !== payload.requestHash) throw new DomainError('idempotency_conflict', 'Shared mutation fence changed unexpectedly.', 409);
      delete pending.entries[slot]; return pending;
    });
  }
  async completeMutation(principal, payload, result) { return this.terminalMutation(principal, payload, result, 'completed'); }
  async partialMutation(principal, payload, result) { return this.terminalMutation(principal, payload, result, 'partial'); }
  close() {}
}
export function constantEqual(a, b) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
