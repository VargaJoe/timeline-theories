import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, hash } from '../client/api/store.mjs';
import { Coordinator } from '../client/api/coordinator.mjs';
import { DomainError } from '../client/domain/content.mjs';
import { imageOperationId } from '../client/api/image-assets.mjs';
import { recoverImage, observeHeldImage } from '../client/api/image-recovery.mjs';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';

// Actual SDK/HTTP/disk coordinator and journal, controlled read-only native
// postconditions. Real native timeout/performance proof is the local UI smoke.
let blobs;
before(async () => { blobs = await startBlobFixture(); });
after(async () => { await blobs.close(); });
async function setup({ prepared = true, action = 'image-variant' } = {}) {
  const config = { repositoryUrl: 'https://repository.fixture.invalid', authority: 'https://authority.fixture.invalid', projectRoot: '/Root/Content/' + randomUUID(), blobOptions: blobs.blobOptions };
  const store = new Store(config), coordinator = new Coordinator(config), principal = 'session:42:original-fixture-token-hash', key = 'saved-image-key';
  const payload = { operationId: imageOperationId(principal, key, action), action, targetId: 10, setId: 20, variant: { name: 'w400', width: 400, height: 200, mimeType: 'image/webp', byteLength: 100, sha256: 'a'.repeat(64) } };
  payload.requestHash = hash(payload);
  if (prepared) await store.prepareMutation(principal, payload, { setId: 20, path: config.projectRoot + '/ImageAssets/10/generation' });
  const stoppedRequestId = randomUUID();
  await coordinator.acquire({ requestId: stoppedRequestId, identity: 42, principal, operationId: payload.operationId });
  const state = { reads: 0, writes: 0, checks: 0, known: true, readable: true };
  const repo = { images: { reconcile: async () => {
    state.reads++;
    if (!state.readable) throw new DomainError('backend_denied', 'Current source Open denied.', 403);
    if (!state.known) throw new DomainError('uncertain_image_mutation', 'Image outcome still unknown.', 409, { uncertain: true });
    return { id: 10, setId: 20, variant: { id: 21, ...payload.variant }, reconciled: true };
  } }, write: async () => { state.writes++; throw new Error('Recovery must never dispatch a repository write.'); } };
  const context = { principal, identity: { Id: 42 }, repo, check: async () => { state.checks++; } };
  const input = { operationId: payload.operationId, stoppedRequestId, confirmStopped: true };
  return { config, store, coordinator, principal, payload, key, stoppedRequestId, state, context, input };
}

test('ordinary same-key retry observes committed native bytes without releasing a possibly running writer', async () => {
  const f = await setup();
  await assert.rejects(observeHeldImage(f.context, f.payload, f.store, f.coordinator), error => error.code === 'image_recovery_required' && error.details.outcome === 'confirmed' && error.details.operatorMustConfirmStopped);
  assert.equal((await f.coordinator.inspect()).state, 'held'); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
  const unconfirmed = await recoverImage(f.context, { operationId: f.payload.operationId }, f.key, f.store, f.coordinator);
  assert.equal(unconfirmed.status, 409); assert.equal(unconfirmed.value.operatorMustConfirmStopped, true); assert.equal((await f.coordinator.inspect()).state, 'held');
});

test('exact owner stop confirmation reconciles a lost response and durable retries never resend the image', async () => {
  const f = await setup();
  // This explicit test step represents the operator verifying the original
  // invocation stopped; the endpoint never derives that fact from elapsed time.
  const result = await recoverImage(f.context, f.input, f.key, f.store, f.coordinator);
  assert.equal(result.status, 200); assert.equal(result.value.confirmed, true); assert.equal(result.value.result.variant.id, 21);
  assert.equal((await f.coordinator.inspect()).state, 'released'); assert.equal((await f.store.pendingMutations()).length, 0); assert.equal(f.state.writes, 0);
  const nextSession = { ...f.context, principal: 'session:42:new-owner-session-hash' };
  const replay = await recoverImage(nextSession, f.input, f.key, f.store, f.coordinator);
  assert.equal(replay.status, 200); assert.equal(replay.value.confirmed, true); assert.equal(f.state.writes, 0);
});

test('wrong request, key, operation, identity or missing stop confirmation cannot release the writer', async () => {
  const f = await setup();
  for (const [context, input, key, code] of [
    [f.context, { ...f.input, confirmStopped: undefined }, f.key, 'stopped_confirmation_required'],
    [f.context, { ...f.input, stoppedRequestId: randomUUID() }, f.key, 'coordinator_owner_conflict'],
    [f.context, f.input, 'different-saved-key', 'idempotency_conflict'],
    [f.context, { ...f.input, operationId: randomUUID() }, f.key, 'operation_unavailable'],
    [{ ...f.context, identity: { Id: 99 }, principal: 'session:99:foreign' }, f.input, f.key, 'operation_unavailable'],
  ]) {
    await assert.rejects(recoverImage(context, input, key, f.store, f.coordinator), error => error.code === code);
    assert.equal((await f.coordinator.inspect()).state, 'held'); assert.equal((await f.store.pendingMutations()).length, 1);
  }
  assert.equal(f.state.writes, 0);
});

test('unknown native outcome stays pending after confirmed stop and recovery never redispatches', async () => {
  const f = await setup(); f.state.known = false;
  const result = await recoverImage(f.context, f.input, f.key, f.store, f.coordinator);
  assert.equal(result.status, 409); assert.equal(result.value.pending, true); assert.equal((await f.store.pendingMutations()).length, 1);
  assert.equal((await f.coordinator.inspect()).state, 'released'); assert.equal(f.state.writes, 0);
  const repeated = await recoverImage(f.context, { operationId: f.payload.operationId }, f.key, f.store, f.coordinator);
  assert.equal(repeated.value.pending, true); assert.equal(f.state.writes, 0);
});

test('current source ACL and repository binding still gate private recovery', async () => {
  const f = await setup(); f.state.readable = false;
  await assert.rejects(observeHeldImage(f.context, f.payload, f.store, f.coordinator), error => error.status === 403);
  const otherConfig = { ...f.config, projectRoot: '/Root/Content/' + randomUUID() };
  await assert.rejects(recoverImage(f.context, f.input, f.key, new Store(otherConfig), new Coordinator(otherConfig)), error => error.code === 'operation_unavailable');
  assert.equal((await f.coordinator.inspect()).state, 'held'); assert.equal(f.state.writes, 0);
});

test('a missing journal without explicit stop proof reports its exact held request without changing any state', async () => {
  const f = await setup({ prepared: false }), before = await f.coordinator.inspect();
  const keys = async () => (await f.store.blobs.list({ prefix: f.store.prefix })).blobs.map(row => row.key).sort();
  const beforeKeys = await keys();
  const result = await recoverImage(f.context, { operationId: f.payload.operationId }, f.key, f.store, f.coordinator);
  assert.equal(result.status, 409); assert.equal(result.value.notPrepared, true); assert.equal(result.value.pending, true);
  assert.equal(result.value.operatorMustConfirmStopped, true); assert.equal(result.value.stoppedRequestId, f.stoppedRequestId);
  assert.equal(result.value.repositoryWrites, 0); assert.deepEqual(await f.coordinator.inspect(), before);
  assert.deepEqual(await keys(), beforeKeys); assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null);
  assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0);
});

test('missing-journal recovery rejects a wrong key, identity, operation, request or expired context without releasing', async () => {
  const f = await setup({ prepared: false }), before = await f.coordinator.inspect();
  for (const [context, input, key, code] of [
    [f.context, f.input, 'different-saved-key', 'idempotency_conflict'],
    [{ ...f.context, identity: { Id: 99 }, principal: 'session:99:foreign' }, f.input, f.key, 'operation_unavailable'],
    [f.context, { ...f.input, operationId: randomUUID() }, f.key, 'operation_unavailable'],
    [f.context, { ...f.input, stoppedRequestId: randomUUID() }, f.key, 'coordinator_owner_conflict'],
    [{ ...f.context, check: async () => { throw new DomainError('grant_revoked', 'Recovery caller revoked.', 403); } }, f.input, f.key, 'grant_revoked'],
  ]) {
    await assert.rejects(recoverImage(context, input, key, f.store, f.coordinator), error => error.code === code);
    assert.deepEqual(await f.coordinator.inspect(), before);
  }
  assert.equal((await f.store.blobs.list({ prefix: f.store.prefix + 'image-unprepared-confirmations/' })).blobs.length, 0);
  assert.equal((await f.store.pendingMutations()).length, 0); assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0);
});

test('each exact dedicated image action can release its confirmed stopped pre-journal writer without a native read or write', async () => {
  for (const action of ['image-draft', 'image-variant', 'image-seal', 'image-delete']) {
    const f = await setup({ prepared: false, action });
    const original = f.coordinator.releaseAbandoned.bind(f.coordinator);
    f.coordinator.releaseAbandoned = async (...args) => {
      const proof = await f.store.read(`image-unprepared-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`);
      assert.deepEqual(proof.data, { version: 1, operationId: f.payload.operationId, stoppedRequestId: f.stoppedRequestId, identity: 42, principal: f.principal, action, notPrepared: true, confirmStopped: true });
      return original(...args);
    };
    const result = await recoverImage(f.context, f.input, f.key, f.store, f.coordinator);
    assert.equal(result.status, 200); assert.equal(result.value.notPrepared, true); assert.equal(result.value.pending, false);
    assert.equal(result.value.repositoryWrites, 0); assert.equal(result.value.confirmed, undefined); assert.equal(result.value.result, undefined);
    assert.equal((await f.coordinator.inspect()).state, 'released'); assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null);
    assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0); assert.ok(f.state.checks > 0);
  }
});

test('a journal row appearing after the absence proof blocks release and later uses normal journal recovery', async () => {
  const f = await setup({ prepared: false }), before = await f.coordinator.inspect(), immutable = f.store.immutable.bind(f.store);
  f.store.immutable = async (key, ...args) => {
    const result = await immutable(key, ...args);
    if (key.startsWith('image-unprepared-confirmations/')) await f.store.prepareMutation(f.principal, f.payload, { setId: 20 });
    return result;
  };
  await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => error.code === 'image_recovery_changed');
  assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 1);
  assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0);
  f.store.immutable = immutable;
  const result = await recoverImage(f.context, f.input, f.key, f.store, f.coordinator);
  assert.equal(result.status, 200); assert.equal(result.value.confirmed, true); assert.equal(result.value.notPrepared, undefined);
  assert.equal((await f.coordinator.inspect()).state, 'released'); assert.equal((await f.store.pendingMutations()).length, 0);
});

test('lost release acknowledgement replays its durable absent-journal proof without touching a different future writer', async () => {
  const f = await setup({ prepared: false }), release = f.coordinator.releaseAbandoned.bind(f.coordinator);
  f.coordinator.releaseAbandoned = async (...args) => { await release(...args); throw new Error('lost release acknowledgement'); };
  await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), /lost release acknowledgement/);
  assert.equal((await f.coordinator.inspect()).state, 'released');
  const nextSession = { ...f.context, principal: 'session:42:renewed-session-hash' };
  f.coordinator.releaseAbandoned = async () => { throw new Error('An old proof must not release another writer.'); };
  const replay = await recoverImage(nextSession, f.input, f.key, f.store, f.coordinator);
  assert.equal(replay.status, 200); assert.equal(replay.value.notPrepared, true); assert.equal(replay.value.pending, false);
  const future = { requestId: randomUUID(), identity: 42, principal: 'session:42:future-writer', operationId: randomUUID() };
  await f.coordinator.acquire(future);
  const before = await f.coordinator.inspect();
  assert.deepEqual(await recoverImage(nextSession, f.input, f.key, f.store, f.coordinator), replay);
  assert.deepEqual(await f.coordinator.inspect(), before);
  await assert.rejects(recoverImage(nextSession, f.input, 'different-saved-key', f.store, f.coordinator), error => error.code === 'idempotency_conflict');
  await assert.rejects(recoverImage({ ...nextSession, identity: { Id: 99 } }, f.input, f.key, f.store, f.coordinator), error => error.code === 'operation_unavailable');
  assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 0);
  assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0);
});

test('a later exact-key terminal receipt takes precedence over an old absence proof for a renewed session', async () => {
  const f = await setup({ prepared: false });
  await recoverImage(f.context, f.input, f.key, f.store, f.coordinator);
  await f.store.prepareMutation(f.principal, f.payload, { setId: 20 });
  await f.store.completeMutation(f.principal, f.payload, { id: 10, setId: 20, variant: { id: 21, ...f.payload.variant }, reconciled: true });
  assert.equal((await f.store.pendingMutations()).length, 0);
  assert.equal(await f.store.read(`image-recoveries/42/${f.payload.operationId}`), null, 'Only an absence proof exists, so recovery must locate the original principal terminal row');
  const nextSession = { ...f.context, principal: 'session:42:renewed-session-hash' };
  const result = await recoverImage(nextSession, f.input, f.key, f.store, f.coordinator);
  assert.equal(result.status, 200); assert.equal(result.value.confirmed, true); assert.equal(result.value.notPrepared, undefined);
  assert.equal(result.value.result.variant.id, 21); assert.equal(f.state.writes, 0); assert.ok(f.state.reads > 0);
});

test('context revocation while persisting an absence proof blocks release', async () => {
  const f = await setup({ prepared: false }), before = await f.coordinator.inspect(), immutable = f.store.immutable.bind(f.store);
  let revoked = false;
  f.context.check = async () => { if (revoked) throw new DomainError('grant_revoked', 'Recovery caller revoked.', 403); };
  f.store.immutable = async (...args) => { const result = await immutable(...args); revoked = true; return result; };
  await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => error.code === 'grant_revoked');
  assert.deepEqual(await f.coordinator.inspect(), before);
  assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null); assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0);
});
