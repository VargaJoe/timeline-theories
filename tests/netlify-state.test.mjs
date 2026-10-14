import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash, createDecipheriv } from 'node:crypto';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';
import { Store, appBinding, hash, stableJson } from '../client/api/store.mjs';
import { Coordinator } from '../client/api/coordinator.mjs';
import { MutationJournal } from '../client/api/journal.mjs';
import { DomainError } from '../client/domain/content.mjs';

// Real SDK -> actual @netlify/blobs/server HTTP endpoint and temporary disk.
// This SDK emulator checks conditions before separate filesystem awaits. These
// ordered contention checks validate protocol and fail-closed app behavior, not
// simultaneous cloud CAS atomicity. Deployment Preview supplies that last gate.
let fixture;
before(async () => { fixture = await startBlobFixture(); });
after(async () => { await fixture?.close(); });
function config(extra = {}) {
  return { repositoryUrl: 'https://fixture.invalid', authority: 'https://auth.fixture.invalid', projectRoot: '/Root/' + randomUUID(), blobOptions: fixture.blobOptions, ...extra };
}
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
const owner = (extra = {}) => ({ requestId: randomUUID(), identity: 42, principal: 'session:42:fixture', ...extra });
function payload(extra = {}) { const value = { operationId: randomUUID(), action: 'update', targetId: 10, type: 'MediaItem', fields: { Title: 'Approved' }, ...extra }; return { ...value, requestHash: hash(value) }; }
const beforeSnapshot = { snapshot: { Id: 10, Type: 'MediaItem', Title: 'Before', revision: 'before' } };

test('actual SDK HTTP onlyIfNew and stale onlyIfMatch conditions reject overwrites', async () => {
  const store = new Store(config());
  const first = await store.blobs.setJSON(store.prefix + 'probe', { version: 1 }, { onlyIfNew: true });
  assert.equal(first.modified, true); assert.ok(first.etag);
  assert.equal((await store.blobs.setJSON(store.prefix + 'probe', { version: 2 }, { onlyIfNew: true })).modified, false);
  const fetched = await store.blobs.getWithMetadata(store.prefix + 'probe', { type: 'json', consistency: 'strong' });
  assert.deepEqual(fetched.data, { version: 1 });
  assert.equal((await store.blobs.setJSON(store.prefix + 'probe', { version: 2 }, { onlyIfMatch: fetched.etag })).modified, true);
  assert.equal((await store.blobs.setJSON(store.prefix + 'probe', { version: 3 }, { onlyIfMatch: first.etag })).modified, false);
});

test('token-bound encrypted grants survive independent objects and fresh revocation', async () => {
  const cfg = config(), first = new Store(cfg), restarted = new Store(cfg);
  const grant = await first.issue({ id: randomUUID(), identity: 42, binding: appBinding(cfg), scopes: ['content:read'], credential: { mode: 'Bearer', value: 'private-backend-token' }, expires: Date.now() + 60000 });
  const row = (await first.read(`grants/${hash(grant.token)}`)).data;
  assert.equal(stableJson(row).includes('private-backend-token'), false);
  assert.equal(stableJson(row).includes(grant.token), false);
  assert.deepEqual((await restarted.grant(grant.token)).credential, { mode: 'Bearer', value: 'private-backend-token' });
  assert.equal(await restarted.active(grant.id), true);
  assert.equal(await first.revoke(grant.id, 99), 0);
  assert.equal(await first.revoke(grant.id, 42), 1);
  assert.equal(await restarted.revoke(grant.id, 42), 1);
  assert.equal(await restarted.active(grant.id), false);
  await rejectsCode(restarted.grant(grant.token), 'invalid_credential');
  await rejectsCode(restarted.grant('tta_invalid'), 'invalid_credential');
  await rejectsCode(restarted.revoke('../escape', 42), 'invalid_id');
});

test('grant token_hash cannot decrypt and identity/binding/scopes/expiry are authenticated', async () => {
  const cfg = config(), store = new Store(cfg);
  const grant = await store.issue({ id: randomUUID(), identity: 42, binding: appBinding(cfg), scopes: ['content:read'], credential: { mode: 'ApiKey', value: 'backend-api-key' }, expires: Date.now() + 60000 });
  const key = `grants/${hash(grant.token)}`, original = (await store.read(key)).data;
  const bytes = Buffer.from(original.credential, 'base64');
  const wrongKey = createHash('sha256').update('timeline-theories/grant-credential/aes-256-gcm/v1\0').update(original.token_hash).digest();
  const decipher = createDecipheriv('aes-256-gcm', wrongKey, bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(stableJson({ id: original.id, token_hash: original.token_hash, identity: original.identity, binding: original.binding, scopes: original.scopes, expires: original.expires })));
  decipher.setAuthTag(bytes.subarray(12, 28));
  assert.throws(() => { decipher.update(bytes.subarray(28)); decipher.final(); });
  for (const change of [{ id: randomUUID() }, { identity: 99 }, { binding: hash('another') }, { scopes: ['media:write'] }, { expires: original.expires + 60000 }]) {
    const current = await store.read(key);
    assert.equal((await store.blobs.setJSON(store.prefix + key, { ...original, ...change }, { onlyIfMatch: current.etag })).modified, true);
    await rejectsCode(store.grant(grant.token), 'invalid_credential');
  }
});

test('immutable plan/reservation/receipts bind original principal and backend recovery identity', async () => {
  const cfg = config(), first = new Store(cfg), restarted = new Store(cfg);
  const grant = await first.issue({ id: randomUUID(), identity: 42, binding: appBinding(cfg), scopes: ['media:write'], credential: { mode: 'Bearer', value: 'backend' }, expires: Date.now() + 60000 });
  const principal = `grant:${grant.id}`, plan = { id: randomUUID(), principal, requestHash: hash('approved-plan'), expires: Date.now() + 1000, steps: [] };
  await first.savePlan(plan); assert.deepEqual(await restarted.plan(plan.id, principal), plan);
  await rejectsCode(restarted.plan(plan.id, 'session:42:other'), 'plan_unavailable');
  await rejectsCode(first.savePlan({ ...plan, expires: plan.expires + 1 }), 'plan_conflict');
  await first.revoke(grant.id, 42);
  assert.deepEqual(await restarted.recoveryPlan(plan.id, 42), plan);
  await rejectsCode(restarted.recoveryPlan(plan.id, 99), 'plan_unavailable');
  assert.equal(await first.reserve(principal, 'same-request', plan), null);
  await rejectsCode(restarted.reserve(principal, 'same-request', { ...plan, id: randomUUID() }), 'idempotency_conflict');
  const result = { ok: true, completed: [{ id: 10 }] };
  await first.finish(principal, 'same-request', result);
  assert.deepEqual(await restarted.reserve(principal, 'same-request', plan), result);
  await rejectsCode(first.finish(principal, 'same-request', { ok: false }), 'idempotency_conflict');
  await first.audit(principal, 'apply', 'completed', [10]);
  const audits = await first.blobs.list({ prefix: first.prefix + 'audit/' }); assert.equal(audits.blobs.length, 1);
});

test('durable pending fence precedes dispatch and immutable receipts precede fence removal', async () => {
  const cfg = config(), store = new Store(cfg), restarted = new Store(cfg), principal = 'session:42:fixture', command = payload();
  assert.equal((await store.prepareMutation(principal, command, beforeSnapshot)).created, true);
  assert.equal((await restarted.prepareMutation(principal, command, beforeSnapshot)).created, false);
  assert.equal((await restarted.pendingMutations()).length, 1);
  await rejectsCode(restarted.prepareMutation('session:99:other', payload(), beforeSnapshot), 'pending_recovery_required');
  await rejectsCode(restarted.prepareMutation(principal, payload(), beforeSnapshot), 'pending_recovery_required');
  const result = { id: 10, revision: 'after' };
  await restarted.completeMutation(principal, command, result);
  assert.deepEqual(await store.pendingMutations(), []);
  assert.deepEqual(JSON.parse((await store.mutationRow(principal, command.operationId)).result), result);
  await rejectsCode(store.prepareMutation(principal, { ...command, requestHash: hash('changed') }, beforeSnapshot), 'idempotency_conflict');
  const partial = payload(); await store.prepareMutation(principal, partial, beforeSnapshot);
  await store.partialMutation(principal, partial, { ok: false, completed: [{ id: 10 }] });
  assert.equal((await restarted.mutationRow(principal, partial.operationId)).state, 'partial');
});

test('interrupted receipt archive retains a recoverable pending fence and never redispatches', async () => {
  let interrupt = false;
  const cfg = config(), interrupted = new Store({ ...cfg, blobOptions: { ...cfg.blobOptions, fetch: async (url, options) => {
    if (interrupt && String(url).includes('/pending-mutations') && options?.method?.toLowerCase() === 'put') throw new Error('simulated invocation termination before fence cleanup');
    return fetch(url, options);
  } } });
  const principal = 'session:42:fixture', command = payload();
  await interrupted.prepareMutation(principal, command, beforeSnapshot);
  interrupt = true;
  await assert.rejects(interrupted.completeMutation(principal, command, { id: 10, revision: 'after' }), /simulated invocation/);
  const restarted = new Store(cfg);
  assert.equal((await restarted.pendingMutations()).length, 1);
  assert.equal((await restarted.mutationRow(principal, command.operationId)).state, 'completed');
  let dispatched = 0;
  const journal = new MutationJournal(restarted, principal, { write: async () => { dispatched++; } });
  assert.equal(await journal.isPending(command), true);
  assert.equal((await journal.mutation(command)).replayed, true);
  assert.equal(dispatched, 0); assert.deepEqual(await restarted.pendingMutations(), []);
  assert.equal(await journal.isPending(command), false);
});

test('uncertain native update recovery checks postconditions and never repeats dispatch', async () => {
  const cfg = config(), store = new Store(cfg), principal = 'session:42:fixture', command = payload();
  let writes = 0, current = beforeSnapshot.snapshot;
  const repo = { read: async () => current, write: async () => { writes++; throw new Error('transport outcome unknown'); } };
  const journal = new MutationJournal(store, principal, repo);
  await assert.rejects(journal.mutation(command), /transport outcome unknown/);
  assert.equal(await journal.isPending(command), true);
  const resumed = new MutationJournal(new Store(cfg), principal, repo);
  await rejectsCode(resumed.assertRecoveryBoundary([randomUUID()]), 'pending_recovery_required');
  await resumed.assertRecoveryBoundary([command.operationId]);
  await rejectsCode(resumed.mutation(command), 'uncertain_update'); assert.equal(writes, 1);
  current = { ...current, Title: 'Approved', revision: 'after' };
  const result = await resumed.mutation(command);
  assert.equal(result.result.reconciled, true); assert.equal(writes, 1);
  assert.deepEqual(await store.pendingMutations(), []);
});

test('native create/delete/order/cover recovery preserves action-specific postconditions', async () => {
  const cfg = config(), principal = 'session:42:fixture';
  const create = payload({ action: 'create', parentId: 1, type: 'MediaItem', fields: { Name: 'reserved', Title: 'Approved' } });
  const store = new Store(cfg);
  await store.prepareMutation(principal, create, { path: '/Root/reserved', parent: { Id: 1 } });
  const created = { Id: 10, ParentId: 1, Type: 'MediaItem', Name: 'reserved', Title: 'Approved', revision: 'created' };
  const createJournal = new MutationJournal(store, principal, { read: async () => created });
  assert.equal((await createJournal.receipt(create)).result.id, 10);
  const remove = payload({ action: 'delete' }); await store.prepareMutation(principal, remove, beforeSnapshot);
  const removeJournal = new MutationJournal(store, principal, { read: async () => { throw new DomainError('missing', 'missing', 404); } });
  assert.equal((await removeJournal.receipt(remove)).result.deleted, true);
  const order = payload({ action: 'order', entries: [{ id: 10, position: 1 }, { id: 11, position: 2 }] });
  await store.prepareMutation(principal, order, { members: [] });
  let members = [{ Id: 10, Position: 1, revision: 'a' }, { Id: 11, Position: 7, revision: 'b' }];
  const orderJournal = new MutationJournal(store, principal, { children: async () => members });
  await rejectsCode(orderJournal.receipt(order), 'partial_order_conflict');
  members = [{ Id: 10, Position: 1, revision: 'a' }, { Id: 11, Position: 2, revision: 'b' }];
  assert.equal((await orderJournal.receipt(order)).result.atomic, false);
  const bytes = Buffer.from('approved binary'), cover = payload({ action: 'cover', fields: {}, bytesBase64: bytes.toString('base64') });
  await store.prepareMutation(principal, cover, beforeSnapshot);
  let coverBytes = Buffer.from('wrong');
  const coverJournal = new MutationJournal(store, principal, { read: async () => ({ ...beforeSnapshot.snapshot, revision: 'after' }), coverBytes: async () => coverBytes });
  await rejectsCode(coverJournal.receipt(cover), 'uncertain_cover_conflict');
  coverBytes = bytes;
  assert.equal((await coverJournal.receipt(cover)).result.reconciled, true);
});

test('independent coordinators exclude held contenders and persist a released tombstone', async () => {
  const cfg = config(), first = new Coordinator(cfg), second = new Coordinator(cfg), options = owner({ planId: randomUUID(), jobId: randomUUID() });
  let finish, held;
  const acquired = new Promise(resolve => { held = resolve; });
  const active = first.run(async guard => { await guard.assertOwner(); held(); await new Promise(resolve => { finish = resolve; }); return 'finished'; }, options);
  await acquired;
  const inspected = await second.inspect(); assert.equal(inspected.state, 'held'); assert.equal(inspected.owner.requestId, options.requestId); assert.equal(inspected.owner.jobId, options.jobId);
  let dispatch = 0;
  await rejectsCode(second.run(async () => { dispatch++; }, owner()), 'coordinator_busy'); assert.equal(dispatch, 0);
  finish(); assert.equal(await active, 'finished');
  const released = await new Coordinator(cfg).inspect(); assert.equal(released.state, 'released'); assert.ok(released.etag); assert.notEqual(released.etag, inspected.etag);
  assert.equal(await second.run(async guard => { await guard.assertOwner(); return 'next'; }, owner()), 'next');
});

test('stopped-invocation recovery requires exact original identity and stale owners cannot release successors', async () => {
  const cfg = config(), first = new Coordinator(cfg), restarted = new Coordinator(cfg), options = owner({ planId: randomUUID(), jobId: randomUUID() });
  const stopped = await first.acquire(options);
  await rejectsCode(restarted.releaseAbandoned(options.requestId, 99), 'coordinator_owner_conflict');
  await rejectsCode(restarted.releaseAbandoned(randomUUID(), 42), 'coordinator_owner_conflict');
  await rejectsCode(restarted.run(async () => {}, owner({ waitMs: 10 })), 'coordinator_busy');
  assert.deepEqual(await restarted.releaseAbandoned(options.requestId, 42), { released: true, requestId: options.requestId, planId: options.planId, jobId: options.jobId });
  await rejectsCode(restarted.acquire(options), 'coordinator_request_reused');
  const successor = await restarted.acquire(owner());
  await rejectsCode(first.assertHeld(stopped), 'coordinator_owner_lost');
  await rejectsCode(first.releaseOwned(stopped), 'coordinator_owner_lost');
  await rejectsCode(first.releaseAbandoned(options.requestId, 42), 'coordinator_owner_conflict');
  assert.equal((await restarted.inspect()).owner.requestId, successor.requestId);
  await restarted.releaseOwned(successor);
});

test('application writer errors release only their own record and binding state fails closed', async () => {
  const cfg = config(), coordinator = new Coordinator(cfg);
  await assert.rejects(coordinator.run(async () => { throw new Error('expected action failure'); }, owner()), /expected action failure/);
  assert.equal((await coordinator.inspect()).state, 'released');
  const current = await coordinator.record();
  await coordinator.blobs.setJSON(coordinator.prefix + 'writer', { ...current.data, binding: hash('tampered') }, { onlyIfMatch: current.etag });
  await rejectsCode(coordinator.run(async () => {}, owner()), 'coordinator_binding_mismatch');
});

test('missing SDK ETags fail closed before any application dispatch', async () => {
  const cfg = config();
  const hiddenTags = { ...cfg.blobOptions, fetch: async (url, options) => {
    const response = await fetch(url, options);
    if (options?.method?.toLowerCase() === 'get' && !new Headers(options?.headers).get('accept')?.includes('signed-url')) {
      const headers = new Headers(response.headers); headers.delete('etag');
      return new Response(response.body, { status: response.status, headers });
    }
    return response;
  } };
  let dispatched = 0;
  const coordinator = new Coordinator({ ...cfg, blobOptions: hiddenTags });
  await rejectsCode(coordinator.run(async () => { dispatched++; }, owner()), 'coordinator_state_invalid');
  assert.equal(dispatched, 0);
  const plain = new Store(cfg), principal = 'session:42:fixture', command = payload();
  await plain.prepareMutation(principal, command, beforeSnapshot);
  const hidden = new Store({ ...cfg, blobOptions: hiddenTags });
  await rejectsCode(hidden.completeMutation(principal, command, { id: 10 }), 'state_invalid');
  assert.equal((await plain.pendingMutations()).length, 1);
});
