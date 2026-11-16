import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Store, hash } from '../client/api/store.mjs';
import { Coordinator } from '../client/api/coordinator.mjs';
import { DomainError } from '../client/domain/content.mjs';
import { ImageAssets, imageOperationId } from '../client/api/image-assets.mjs';
import { recoverImage, observeHeldImage } from '../client/api/image-recovery.mjs';
import { imageJobInput } from '../client/api/image-jobs.mjs';
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
  if (action === 'image-draft') payload.generationId = randomUUID();
  payload.requestHash = hash(payload);
  if (prepared) await store.prepareMutation(principal, payload, { setId: 20, path: config.projectRoot + '/ImageAssets/10/generation' });
  const stoppedRequestId = randomUUID();
  const writer = await coordinator.acquire({ requestId: stoppedRequestId, identity: 42, principal, operationId: payload.operationId });
  const state = { reads: 0, ownerReads: 0, writes: 0, checks: 0, known: true, readable: true };
  const repo = { images: { owner: async () => {
    state.ownerReads++;
    if (!state.readable) throw new DomainError('backend_denied', 'Current owner Save denied.', 403);
    return { Id: 10 };
  }, reconcile: async () => {
    state.reads++;
    if (!state.readable) throw new DomainError('backend_denied', 'Current source Open denied.', 403);
    if (!state.known) throw new DomainError('uncertain_image_mutation', 'Image outcome still unknown.', 409, { uncertain: true });
    return { id: 10, setId: 20, variant: { id: 21, ...payload.variant }, reconciled: true };
  } }, write: async () => { state.writes++; throw new Error('Recovery must never dispatch a repository write.'); } };
  const context = { principal, identity: { Id: 42 }, repo, check: async () => { state.checks++; } };
  const input = { operationId: payload.operationId, stoppedRequestId, confirmStopped: true };
  return { config, store, coordinator, writer, principal, payload, key, stoppedRequestId, state, context, input };
}

async function setupClaimedImageJob(action = 'image-delete') {
  const f = await setup({ prepared: false, action });
  await f.coordinator.releaseOwned(f.writer);
  f.stoppedRequestId = randomUUID(); f.input = { operationId: f.payload.operationId, stoppedRequestId: f.stoppedRequestId, confirmStopped: true };
  f.context.scopes = ['covers:write']; f.context.repo.paths = { root: f.config.projectRoot };
  const generationId = randomUUID(), jobId = randomUUID();
  const path = action === 'image-draft' ? '/api/v1/images/drafts' : `/api/v1/images/drafts/20/${action.slice(6)}`;
  const body = action === 'image-draft' ? { ownerId: 10, generationId, expectedRevision: 'sha256:' + 'a'.repeat(64), manifest: { schemaVersion: 1, kind: 'media-sizes', projectPath: f.config.projectRoot, ownerId: 10, generationId, sourceIds: [10], sourceStamps: [{ id: 10, stamp: 'a'.repeat(64) }], recipe: { template: 'media-sizes-v1', sourceIds: [10] }, variants: [] } } : action === 'image-seal' ? { ownerId: 10, variants: [{ id: 21, ...f.payload.variant }] } : { ownerId: 10 };
  const bytes = Buffer.from(JSON.stringify(body)), image = imageJobInput(path, bytes, f.context, f.config.projectRoot, f.key);
  const mapping = { id: jobId, principal: f.principal, identity: 42, image };
  const job = { id: jobId, binding: f.store.prefix, requestId: f.stoppedRequestId, principal: f.principal, identity: 42, image, method: 'POST', path, headers: { 'content-type': 'application/json', 'idempotency-key': f.key }, body: bytes.toString('base64') };
  const claim = { id: jobId, principal: f.principal, identity: 42, nonce: randomUUID(), startedAt: new Date().toISOString() };
  await f.store.immutable(`image-job-operations/${f.payload.operationId}`, mapping);
  await f.store.immutable(`jobs/${jobId}/input`, job);
  await f.store.immutable(`jobs/${jobId}/claim`, claim);
  return { ...f, jobId, mapping, job, claim };
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

test('explicit abandonment archives an unconfirmed draft and clears only its shared fence while preserving partial native state', async () => {
  for (const root of [null, { Id: 19, Path: '/owner/(images)', description: 'preserved root', files: ['preserved-original.png'] }]) {
    const f = await setup({ action: 'image-draft' }); f.state.known = false;
    const native = { allowedChildTypes: ['Folder', 'File'], root, generation: null, original: Buffer.from('original cover') };
    const preserved = hash(native), before = await f.store.mutationRow(f.principal, f.payload.operationId);
    const images = new ImageAssets({ api: async () => { f.state.writes++; throw new Error('Abandonment must not alter native partial state.'); } });
    images.owner = f.context.repo.images.owner;
    images.storage = async () => native.root;
    images.node = async path => { assert.equal(path, root.Path + '/' + f.payload.generationId); throw new DomainError('content_unavailable', 'The exact generation is absent.', 404); };
    f.context.repo.images = images;
    const result = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
    assert.equal(result.status, 200); assert.equal(result.value.confirmed, false); assert.equal(result.value.pending, false); assert.equal(result.value.abandoned, true);
    assert.equal(result.value.failure.code, 'image_publication_abandoned'); assert.equal(result.value.failure.outcomeUnconfirmed, true);
    assert.equal(result.value.failure.partialStatePreserved, true); assert.equal(result.value.repositoryWrites, 0);
    const terminal = await f.store.mutationRow(f.principal, f.payload.operationId);
    assert.equal(terminal.state, 'partial'); assert.equal(terminal.payload, before.payload); assert.equal(terminal.before_state, before.before_state); assert.equal(terminal.request_hash, before.request_hash);
    assert.equal((await f.store.pendingMutations()).length, 0); assert.equal((await f.coordinator.inspect()).state, 'released'); assert.equal(f.state.writes, 0);
    assert.equal(hash(native), preserved);
    const next = { operationId: randomUUID(), action: 'create', targetId: 99 }; next.requestHash = hash(next);
    assert.equal((await f.store.prepareMutation('session:99:independent-writer', next, { path: '/another-target' })).created, true, 'A terminal abandonment must actually remove the global dispatch fence');
  }
});

test('abandonment requires the original operation, key, backend identity and exact explicitly stopped invocation', async () => {
  const f = await setup(); f.state.known = false;
  const before = await f.coordinator.inspect();
  for (const [context, input, key, code] of [
    [f.context, { operationId: f.payload.operationId, abandon: true }, f.key, 'stopped_confirmation_required'],
    [f.context, { ...f.input, abandon: true, confirmStopped: undefined }, f.key, 'stopped_confirmation_required'],
    [f.context, { ...f.input, abandon: false }, f.key, 'invalid_input'],
    [f.context, { ...f.input, abandon: 'true' }, f.key, 'invalid_input'],
    [f.context, { ...f.input, abandon: true }, 'different-saved-key', 'idempotency_conflict'],
    [{ ...f.context, identity: { Id: 99 }, principal: 'session:99:foreign' }, { ...f.input, abandon: true }, f.key, 'operation_unavailable'],
    [f.context, { ...f.input, operationId: randomUUID(), abandon: true }, f.key, 'operation_unavailable'],
    [f.context, { ...f.input, stoppedRequestId: randomUUID(), abandon: true }, f.key, 'coordinator_owner_conflict'],
  ]) await assert.rejects(recoverImage(context, input, key, f.store, f.coordinator), error => error.code === code);
  assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
});

test('exact historical provenance plus explicit attestation survives a later read-only owner replacing the released original', async () => {
  const f = await setup(); f.state.known = false;
  await f.coordinator.releaseOwned(f.writer);
  await f.coordinator.run(async () => {}, { requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
  assert.notEqual((await f.coordinator.inspect()).owner.requestId, f.stoppedRequestId);
  assert.equal(await f.store.read(`image-stopped-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`), null);
  const historical = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(historical.value.abandoned, true); assert.equal(historical.value.repositoryWrites, 0); assert.equal((await f.store.pendingMutations()).length, 0);
  assert.equal((await f.store.read(`image-stopped-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`)).data.stoppedRequestId, f.stoppedRequestId);
  const exact = await setup(); exact.state.known = false;
  await exact.coordinator.releaseAbandoned(exact.stoppedRequestId, 42);
  const result = await recoverImage(exact.context, { ...exact.input, abandon: true }, exact.key, exact.store, exact.coordinator);
  assert.equal(result.value.abandoned, true); assert.equal(exact.state.writes, 0);
});

test('historical registration alone never supplies stop confirmation or abandonment authority', async () => {
  const f = await setup(); f.state.known = false;
  await f.coordinator.releaseOwned(f.writer);
  await f.coordinator.run(async () => {}, { requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
  const before = await f.coordinator.inspect();
  await assert.rejects(recoverImage(f.context, { operationId: f.payload.operationId, stoppedRequestId: f.stoppedRequestId, abandon: true }, f.key, f.store, f.coordinator), error => error.code === 'stopped_confirmation_required');
  await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => error.code === 'coordinator_owner_conflict');
  assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
  assert.equal(await f.store.read(`image-stopped-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`), null);
});

test('missing, foreign or unreadable historical provenance cannot clear a pending image operation', async () => {
  for (const mismatch of ['missing', 'requestId', 'identity', 'principal', 'operationId', 'transport', 'proof-read']) {
    const f = await setup(); f.state.known = false;
    await f.coordinator.releaseOwned(f.writer);
    await f.coordinator.run(async () => {}, { requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
    const before = await f.coordinator.inspect(), read = f.store.read.bind(f.store), historyKey = `writer-requests/${f.stoppedRequestId}`;
    const otherBinding = new Store({ ...f.config, projectRoot: '/Root/Content/' + randomUUID() });
    assert.equal(await otherBinding.read(historyKey), null, 'Request provenance is scoped to the same repository/auth/project binding');
    f.store.read = async key => {
      if (mismatch === 'proof-read' && key === `image-stopped-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`) throw new DomainError('state_unavailable', 'Saved stop proof strong read failed.', 503);
      const saved = await read(key);
      if (key !== historyKey) return saved;
      if (mismatch === 'missing') return null;
      if (mismatch === 'transport') throw new DomainError('state_unavailable', 'History strong read failed.', 503);
      return { ...saved, data: { ...saved.data, [mismatch]: mismatch === 'identity' ? 99 : mismatch === 'principal' ? 'session:99:foreign' : randomUUID() } };
    };
    await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.code === (['transport', 'proof-read'].includes(mismatch) ? 'state_unavailable' : 'coordinator_owner_conflict'));
    assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
    assert.equal(await read(`image-stopped-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`), null);
  }
});

test('historical provenance never releases a different held actor, even for the same operation', async () => {
  const f = await setup(); f.state.known = false;
  await f.coordinator.releaseOwned(f.writer);
  await f.coordinator.acquire({ requestId: randomUUID(), identity: 42, principal: f.principal, operationId: f.payload.operationId });
  const before = await f.coordinator.inspect();
  f.coordinator.releaseAbandoned = async () => { throw new Error('Historical provenance must never release another actor.'); };
  await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.code === 'coordinator_owner_conflict');
  assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
});

test('a failed historical stop-proof write cannot archive a receipt, and a later held writer blocks guard acquisition', async () => {
  for (const stage of ['proof-write', 'new-writer']) {
    const f = await setup(); f.state.known = false;
    await f.coordinator.releaseOwned(f.writer);
    await f.coordinator.run(async () => {}, { requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
    const before = await f.coordinator.inspect(), immutable = f.store.immutable.bind(f.store);
    let future;
    f.store.immutable = async (key, ...args) => {
      if (key.startsWith('image-stopped-confirmations/')) {
        if (stage === 'proof-write') throw new DomainError('state_unavailable', 'Stop attestation persistence failed.', 503);
        const result = await immutable(key, ...args);
        future = await f.coordinator.acquire({ requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
        return result;
      }
      return immutable(key, ...args);
    };
    f.coordinator.releaseAbandoned = async () => { throw new Error('Historical recovery must never release a current writer.'); };
    await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.code === (stage === 'proof-write' ? 'state_unavailable' : 'coordinator_busy'));
    if (stage === 'proof-write') assert.deepEqual(await f.coordinator.inspect(), before);
    else assert.equal((await f.coordinator.inspect()).owner.requestId, future.requestId);
    assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'pending'); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
  }
});

test('confirmed native completion and existing terminal receipts take precedence over abandonment', async () => {
  const f = await setup();
  const completed = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(completed.value.confirmed, true); assert.equal(completed.value.abandoned, undefined); assert.equal(completed.value.result.variant.id, 21);
  const row = await f.store.mutationRow(f.principal, f.payload.operationId);
  assert.equal(row.state, 'completed');
  assert.deepEqual(await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), completed);
  assert.deepEqual(await f.store.mutationRow(f.principal, f.payload.operationId), row);
  const failed = await setup(); failed.state.known = false;
  const originalFailure = { ok: false, code: 'image_integrity', message: 'Original terminal failure.', completed: [] };
  await failed.store.partialMutation(failed.principal, failed.payload, originalFailure);
  const failureRow = await failed.store.mutationRow(failed.principal, failed.payload.operationId);
  const result = await recoverImage(failed.context, { ...failed.input, abandon: true }, failed.key, failed.store, failed.coordinator);
  assert.deepEqual(result.value.failure, originalFailure); assert.equal(result.value.abandoned, undefined); assert.equal(failed.state.reads, 0);
  assert.deepEqual(await failed.store.mutationRow(failed.principal, failed.payload.operationId), failureRow); assert.equal(failed.state.writes, 0);
});

test('owner/source ACL failures and transport failures cannot abandon or release a held writer', async () => {
  for (const code of ['owner-denied', 'source-denied', 'repository_timeout', 'backend_failure']) {
    const f = await setup(); f.state.known = false;
    const before = await f.coordinator.inspect();
    if (code === 'owner-denied') f.state.readable = false;
    else f.context.repo.images.reconcile = async () => { throw new DomainError(code === 'source-denied' ? 'backend_denied' : code, 'Native observation failed.', code === 'source-denied' ? 403 : 502); };
    await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.status === (code.endsWith('denied') ? 403 : 502));
    assert.deepEqual(await f.coordinator.inspect(), before); assert.equal((await f.store.pendingMutations()).length, 1);
    assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'pending'); assert.equal(f.state.writes, 0);
  }
});

test('abandonment persists its exact stop proof before release and a lost acknowledgement never releases a future writer', async () => {
  const f = await setup(); f.state.known = false;
  const release = f.coordinator.releaseAbandoned.bind(f.coordinator);
  f.coordinator.releaseAbandoned = async (...args) => {
    assert.deepEqual((await f.store.read(`image-stopped-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`)).data, { operationId: f.payload.operationId, stoppedRequestId: f.stoppedRequestId, identity: 42, principal: f.principal });
    await release(...args); throw new Error('lost stopped release acknowledgement');
  };
  await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), /lost stopped release acknowledgement/);
  f.coordinator.releaseAbandoned = async () => { throw new Error('A future writer must not be released.'); };
  const future = await f.coordinator.acquire({ requestId: randomUUID(), identity: 42, principal: f.principal, operationId: f.payload.operationId });
  const before = await f.coordinator.inspect();
  await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.code === 'coordinator_owner_conflict');
  assert.deepEqual(await f.coordinator.inspect(), before);
  await f.coordinator.releaseOwned(future);
  const result = await recoverImage({ ...f.context, principal: 'session:42:renewed-owner-token' }, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(result.value.abandoned, true); assert.equal(f.state.writes, 0);
});

test('an abandoned receipt survives interrupted pending cleanup and renewed-session retries without another native write', async () => {
  const f = await setup(); f.state.known = false;
  const update = f.store.updatePending.bind(f.store);
  f.store.updatePending = async () => { throw new Error('interrupted fence cleanup'); };
  await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), /interrupted fence cleanup/);
  const terminal = await f.store.mutationRow(f.principal, f.payload.operationId);
  assert.equal(terminal.state, 'partial'); assert.equal(JSON.parse(terminal.result).code, 'image_publication_abandoned'); assert.equal((await f.store.pendingMutations()).length, 1);
  f.store.updatePending = update;
  const nextSession = { ...f.context, principal: 'session:42:renewed-owner-token' };
  const result = await recoverImage(nextSession, { operationId: f.payload.operationId }, f.key, f.store, f.coordinator);
  assert.equal(result.value.confirmed, false); assert.equal(result.value.abandoned, true); assert.equal(result.value.pending, false);
  assert.equal((await f.store.pendingMutations()).length, 0); assert.deepEqual(await f.store.mutationRow(f.principal, f.payload.operationId), terminal);
  assert.equal(f.state.writes, 0);
});

test('a terminal native result appearing during abandonment observation is retained instead of a synthesized failure', async () => {
  const f = await setup(); f.state.known = false;
  let observations = 0;
  f.context.repo.images.reconcile = async () => {
    if (++observations === 2) await f.store.completeMutation(f.principal, f.payload, { id: 10, setId: 20, reconciled: true });
    if (observations <= 2) throw new DomainError('uncertain_image_mutation', 'Initial native observation incomplete.', 409, { uncertain: true });
    return { id: 10, setId: 20, reconciled: true };
  };
  const result = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(result.value.confirmed, true); assert.equal(result.value.abandoned, undefined); assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'completed');
  assert.equal(f.state.writes, 0);
});

test('a terminal receipt winning the archive race cannot be overwritten by abandonment', async () => {
  const f = await setup(); f.state.known = false;
  const partial = f.store.partialMutation.bind(f.store);
  f.store.partialMutation = async (...args) => {
    await f.store.completeMutation(f.principal, f.payload, { id: 10, setId: 20, reconciled: true });
    f.state.known = true;
    return partial(...args);
  };
  const result = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(result.value.confirmed, true); assert.equal(result.value.abandoned, undefined); assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'completed');
  assert.equal((await f.store.pendingMutations()).length, 0); assert.equal(f.state.writes, 0);
});

test('a confirmed preflight that becomes unavailable during recheck stays pending rather than being abandoned', async () => {
  const f = await setup();
  let observations = 0;
  f.context.repo.images.reconcile = async () => {
    if (++observations === 1) return { id: 10, setId: 20, reconciled: true };
    throw new DomainError('uncertain_image_mutation', 'Native completion changed during readback.', 409, { uncertain: true });
  };
  const result = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(result.status, 409); assert.equal(result.value.pending, true); assert.equal(result.value.abandoned, undefined);
  assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'pending'); assert.equal((await f.store.pendingMutations()).length, 1); assert.equal(f.state.writes, 0);
});

test('losing the recovery writer immediately before archiving cannot clear the fence or release the new owner', async () => {
  const f = await setup(); f.state.known = false;
  const read = f.store.mutationRow.bind(f.store);
  let replaced = false, future;
  f.store.mutationRow = async (...args) => {
    const row = await read(...args);
    if (!replaced && f.state.reads >= 2) {
      replaced = true;
      const held = await f.coordinator.inspect();
      await f.coordinator.releaseAbandoned(held.owner.requestId, 42);
      future = await f.coordinator.acquire({ requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
    }
    return row;
  };
  await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.code === 'coordinator_owner_lost');
  assert.equal((await f.coordinator.inspect()).owner.requestId, future.requestId); assert.equal((await f.store.pendingMutations()).length, 1);
  assert.equal((await read(f.principal, f.payload.operationId)).state, 'pending'); assert.equal(f.state.writes, 0);
});

test('context revocation during stop proof persistence or native recheck cannot clear the pending fence', async () => {
  for (const stage of ['proof', 'recheck']) {
    const f = await setup(); f.state.known = false;
    let revoked = false;
    f.context.check = async () => { if (revoked) throw new DomainError('grant_revoked', 'The original caller was revoked.', 403); };
    if (stage === 'proof') {
      const immutable = f.store.immutable.bind(f.store);
      f.store.immutable = async (key, ...args) => { const result = await immutable(key, ...args); if (key.startsWith('image-stopped-confirmations/')) revoked = true; return result; };
      const before = await f.coordinator.inspect();
      await assert.rejects(recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator), error => error.code === 'grant_revoked');
      assert.deepEqual(await f.coordinator.inspect(), before);
    } else {
      const owner = f.context.repo.images.owner;
      f.context.repo.images.owner = async (...args) => { const result = await owner(...args); if (f.state.ownerReads === 2) revoked = true; return result; };
      const result = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
      assert.equal(result.status, 403); assert.equal(result.value.pending, true);
    }
    assert.equal((await f.store.pendingMutations()).length, 1); assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'pending'); assert.equal(f.state.writes, 0);
  }
});

test('abandon:true never synthesizes a terminal receipt for an unprepared stopped invocation', async () => {
  const f = await setup({ prepared: false });
  const result = await recoverImage(f.context, { ...f.input, abandon: true }, f.key, f.store, f.coordinator);
  assert.equal(result.value.notPrepared, true); assert.equal(result.value.abandoned, undefined); assert.equal(result.value.pending, false);
  assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null); assert.equal(f.state.writes, 0);
});

test('a claimed metadata job stopped before acquiring a writer gets only a guarded durable absence proof', async () => {
  for (const action of ['image-draft', 'image-seal', 'image-delete']) {
    const f = await setupClaimedImageJob(action);
    assert.equal(await f.store.read(`writer-requests/${f.stoppedRequestId}`), null);
    f.coordinator.releaseAbandoned = async () => { throw new Error('Pre-writer job recovery must never release another invocation.'); };
    const result = await recoverImage(f.context, f.input, f.key, f.store, f.coordinator);
    assert.equal(result.status, 200); assert.equal(result.value.notPrepared, true); assert.equal(result.value.pending, false); assert.equal(result.value.repositoryWrites, 0);
    assert.equal(result.value.result, undefined); assert.equal(result.value.confirmed, undefined); assert.equal(result.value.failure, undefined);
    assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null); assert.equal((await f.store.pendingMutations()).length, 0);
    assert.equal(await f.store.read(`jobs/${f.jobId}/result`), null, 'The recovery endpoint must not synthesize a job success or failure result');
    const proof = (await f.store.read(`image-unprepared-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`)).data;
    assert.equal(proof.jobId, f.jobId); assert.equal(proof.confirmStopped, true); assert.equal(proof.action, action);
    const replay = await recoverImage({ ...f.context, principal: 'session:42:renewed-owner-token' }, f.input, f.key, f.store, f.coordinator);
    assert.deepEqual(replay, result); assert.equal(f.state.ownerReads, 2); assert.equal(f.state.reads, 0); assert.equal(f.state.writes, 0);
  }
});

test('a pre-writer job claim without explicit stop confirmation is read-only discovery', async () => {
  const f = await setupClaimedImageJob(), before = await f.coordinator.inspect();
  const result = await recoverImage(f.context, { operationId: f.payload.operationId }, f.key, f.store, f.coordinator);
  assert.equal(result.status, 409); assert.equal(result.value.operatorMustConfirmStopped, true); assert.equal(result.value.stoppedRequestId, f.stoppedRequestId);
  assert.equal(result.value.pending, true); assert.equal(result.value.notPrepared, true); assert.deepEqual(await f.coordinator.inspect(), before);
  assert.equal(await f.store.read(`image-unprepared-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`), null);
  assert.equal(f.state.ownerReads, 0); assert.equal(f.state.writes, 0);
});

test('incomplete or mismatched job mapping, input and claim records cannot establish absence recovery authority', async () => {
  for (const fault of ['mapping-missing', 'input-missing', 'claim-missing', 'binding', 'mapping-identity', 'input-identity', 'claim-identity', 'claim-id', 'principal', 'metadata']) {
    const f = await setupClaimedImageJob(), before = await f.coordinator.inspect(), read = f.store.read.bind(f.store);
    f.store.read = async key => {
      const saved = await read(key);
      if (key === `image-job-operations/${f.payload.operationId}`) {
        if (fault === 'mapping-missing') return null;
        if (fault === 'mapping-identity') return { ...saved, data: { ...saved.data, identity: 99 } };
        if (fault === 'principal') return { ...saved, data: { ...saved.data, principal: 'session:99:foreign' } };
      }
      if (key === `jobs/${f.jobId}/input`) {
        if (fault === 'input-missing') return null;
        if (fault === 'binding') return { ...saved, data: { ...saved.data, binding: 'v1/foreign-project/' } };
        if (fault === 'input-identity') return { ...saved, data: { ...saved.data, identity: 99 } };
        if (fault === 'metadata') return { ...saved, data: { ...saved.data, body: Buffer.from(JSON.stringify({ ownerId: 99 })).toString('base64') } };
      }
      if (key === `jobs/${f.jobId}/claim`) {
        if (fault === 'claim-missing') return null;
        if (fault === 'claim-identity') return { ...saved, data: { ...saved.data, identity: 99 } };
        if (fault === 'claim-id') return { ...saved, data: { ...saved.data, id: randomUUID() } };
      }
      return saved;
    };
    await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => error.code === 'operation_unavailable');
    assert.deepEqual(await f.coordinator.inspect(), before); assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null);
    assert.equal(await read(`image-unprepared-confirmations/${f.payload.operationId}/${f.stoppedRequestId}`), null); assert.equal(f.state.writes, 0);
  }
});

test('pre-writer job recovery rejects wrong keys, request UUIDs, backend identities and a different held actor', async () => {
  const f = await setupClaimedImageJob(), before = await f.coordinator.inspect();
  for (const [context, input, key, code] of [
    [f.context, f.input, 'different-original-key', 'idempotency_conflict'],
    [f.context, { ...f.input, stoppedRequestId: randomUUID() }, f.key, 'coordinator_owner_conflict'],
    [{ ...f.context, principal: 'session:99:foreign', identity: { Id: 99 } }, f.input, f.key, 'operation_unavailable'],
  ]) await assert.rejects(recoverImage(context, input, key, f.store, f.coordinator), error => error.code === code);
  assert.deepEqual(await f.coordinator.inspect(), before);
  await f.coordinator.acquire({ requestId: randomUUID(), identity: 42, principal: f.principal, operationId: randomUUID() });
  const held = await f.coordinator.inspect();
  f.coordinator.releaseAbandoned = async () => { throw new Error('No different held actor may be released.'); };
  await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => error.code === 'coordinator_owner_conflict');
  assert.deepEqual(await f.coordinator.inspect(), held); assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null); assert.equal(f.state.writes, 0);
});

test('journal preparation during claimed-job authorization or proof persistence prevents an absence result', async () => {
  for (const stage of ['authorization', 'proof']) {
    const f = await setupClaimedImageJob();
    if (stage === 'authorization') {
      const owner = f.context.repo.images.owner;
      f.context.repo.images.owner = async (...args) => { const value = await owner(...args); await f.store.prepareMutation(f.principal, f.payload, { setId: 20 }); return value; };
    } else {
      const immutable = f.store.immutable.bind(f.store);
      f.store.immutable = async (key, ...args) => { const value = await immutable(key, ...args); if (key.startsWith('image-unprepared-confirmations/')) await f.store.prepareMutation(f.principal, f.payload, { setId: 20 }); return value; };
    }
    await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => error.code === 'image_recovery_changed');
    assert.equal((await f.store.pendingMutations()).length, 1); assert.equal((await f.store.mutationRow(f.principal, f.payload.operationId)).state, 'pending');
    const normal = await recoverImage(f.context, { operationId: f.payload.operationId }, f.key, f.store, f.coordinator);
    assert.equal(normal.value.confirmed, true); assert.equal(normal.value.notPrepared, undefined); assert.equal(f.state.writes, 0);
  }
});

test('current owner Save, context and durable proof failures keep pre-writer jobs unfinalized', async () => {
  for (const stage of ['save', 'context', 'proof-read', 'proof-write', 'claim-read']) {
    const f = await setupClaimedImageJob();
    if (stage === 'save') f.state.readable = false;
    if (stage === 'context') {
      const owner = f.context.repo.images.owner;
      let revoked = false;
      f.context.repo.images.owner = async (...args) => { const value = await owner(...args); revoked = true; return value; };
      f.context.check = async () => { if (revoked) throw new DomainError('grant_revoked', 'Current caller was revoked.', 403); };
    }
    if (stage === 'proof-write') {
      const immutable = f.store.immutable.bind(f.store);
      f.store.immutable = async (key, ...args) => { if (key.startsWith('image-unprepared-confirmations/')) throw new DomainError('state_unavailable', 'Proof write failed.', 503); return immutable(key, ...args); };
    }
    if (stage === 'proof-read' || stage === 'claim-read') {
      const read = f.store.read.bind(f.store);
      f.store.read = async key => { if (stage === 'proof-read' ? key.startsWith('image-unprepared-confirmations/') : key === `jobs/${f.jobId}/claim`) throw new DomainError('state_unavailable', 'Proof chain read failed.', 503); return read(key); };
    }
    await assert.rejects(recoverImage(f.context, f.input, f.key, f.store, f.coordinator), error => stage === 'save' ? error.status === 403 : error.code === (stage === 'context' ? 'grant_revoked' : 'state_unavailable'));
    assert.equal(await f.store.mutationRow(f.principal, f.payload.operationId), null); assert.equal(await f.store.read(`jobs/${f.jobId}/result`), null);
    assert.equal((await f.store.pendingMutations()).length, 0); assert.equal(f.state.writes, 0);
  }
});
