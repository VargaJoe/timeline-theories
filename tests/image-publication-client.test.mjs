import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';
import { imageReadRetryModuleUrl } from './helpers/image-read-retry-module.mjs';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const native = moduleUrl(`export const nativeRequest=(...args)=>globalThis.imagePublicationFixture.request(...args);
export const nativeResponse=(...args)=>{if(globalThis.imagePublicationFixture.response)return globalThis.imagePublicationFixture.response(...args);throw new Error('unexpected original download during publication')};
export const nativeSnapshot=async(...args)=>{globalThis.imagePublicationFixture.snapshots?.push(args);return globalThis.imagePublicationFixture.owner};
export const nativeCoverPayload=async(file,fileName)=>({bytesBase64:Buffer.from(await file.arrayBuffer()).toString('base64'),mimeType:file.type,fileName});
export const applyNativeCommands=async commands=>globalThis.imagePublicationFixture.apply(commands);
export const acknowledgeNativeCommands=()=>{};`);
const context = moduleUrl(`export const captureOperationContext=()=>()=>{if(globalThis.imagePublicationFixture.changed)throw new Error('context changed')};export const assertOperations=async()=>{await globalThis.imagePublicationFixture.preflight?.()};`);
const config = moduleUrl(`export const environment={projectRoot:'/Root/Fixture'};`);
let source = ts.transpileModule(fs.readFileSync(new URL('../client/services/imageVariantService.ts', import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
for (const [from, to] of [['../configuration', config], ['./nativeApi', native], ['./sensenet', context], ['../utils/posterStripLayout.mjs', new URL('../client/utils/posterStripLayout.mjs', import.meta.url).href]]) source = source.replaceAll(`'${from}'`, JSON.stringify(to));
source = source.replace("from '../utils/imageReadRetry'", `from '${imageReadRetryModuleUrl}'`);
const { ImagePublication, OriginalImageUpload, imageCapabilities, imagePresentation, sourceForGeneration } = await import(moduleUrl(source));

test('uncertain image recovery retains its exact step key, requires explicit stopped confirmation and accepts only zero-write matching results', async () => {
  const operationId = crypto.randomUUID(), stoppedRequestId = crypto.randomUUID(), calls = [];
  const owner = { Id: 7, revision: 'sha256:' + 'a'.repeat(64) };
  let recoveryReply;
  globalThis.imagePublicationFixture = { owner, async request() { throw Object.assign(new Error('unconfirmed'), { details: { uncertain: true, operationId, stoppedRequestId } }); }, async response(path, init) {
    calls.push({ path, body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
    return Response.json(recoveryReply, { status: recoveryReply.pending ? 409 : 200 });
  } };
  const generated = { sources: [{ id: 8, stamp: 'b'.repeat(64) }], recipe: { template: 'poster-strip-v1', sourceIds: [8] }, variants: [] };
  const publication = new ImagePublication(7, generated, 'timeline-composite', owner), signal = new AbortController().signal;
  await assert.rejects(publication.publish(signal, () => {}), /unconfirmed/);
  assert.equal(publication.blockedBeforeWrite, false);
  assert.equal(publication.recovery.operationId, operationId);
  await assert.rejects(publication.recover(signal, false, true), /explicit stopped confirmation/);
  assert.equal(calls.length, 0);
  recoveryReply = { operationId, pending: true, repositoryWrites: 0 };
  assert.equal((await publication.recover(signal)).pending, true);
  assert.deepEqual(calls[0], { path: '/images/recovery', body: { operationId }, key: publication.generationId + ':draft' });
  recoveryReply = { operationId, confirmed: false, pending: false, abandoned: true, repositoryWrites: 0, failure: { code: 'image_publication_abandoned' } };
  assert.equal((await publication.recover(signal, true, true)).abandoned, true);
  assert.deepEqual(calls[1].body, { operationId, stoppedRequestId, confirmStopped: true, abandon: true });
  assert.equal(calls[1].key, calls[0].key);
  for (const invalid of [{ ...recoveryReply, operationId: crypto.randomUUID() }, { ...recoveryReply, repositoryWrites: 1 }, { ...recoveryReply, confirmed: true }, { ...recoveryReply, failure: { code: 'foreign' } }]) {
    recoveryReply = invalid;
    await assert.rejects(publication.recover(signal, true, true), /could not confirm/);
  }
  globalThis.imagePublicationFixture.changed = true;
  const priorCalls = calls.length;
  await assert.rejects(publication.recover(signal, true, true), /context changed/);
  assert.equal(calls.length, priorCalls);
});

test('a proven older-write rejection cannot become recovery for the rejected current publication', async () => {
  const owner = { Id: 7, revision: 'sha256:' + 'a'.repeat(64) }, calls = [];
  const generated = { sources: [{ id: 8, stamp: 'b'.repeat(64) }], recipe: { template: 'poster-strip-v1', sourceIds: [8] }, variants: [] };
  globalThis.imagePublicationFixture = { owner, async request(path, init) {
    calls.push({ path, key: init.headers['Idempotency-Key'] });
    throw Object.assign(Error('Recover the previous application write'), { status: 409, code: 'pending_recovery_required', details: { blockedBeforeWrite: true, operationId: crypto.randomUUID(), stoppedRequestId: crypto.randomUUID() } });
  } };
  const publication = new ImagePublication(7, generated, 'timeline-composite', owner), signal = new AbortController().signal;
  await assert.rejects(publication.publish(signal, () => {}), /previous application write/);
  assert.equal(publication.hasStartedMutation, true, 'Sending the API request alone does not prove a repository dispatch.');
  assert.equal(publication.blockedBeforeWrite, true); assert.equal(publication.recovery, undefined);
  await assert.rejects(publication.recover(signal), /original failed request/);
  assert.equal(calls.length, 1, 'A blocked response must not trigger recovery or another request automatically.');
  const fresh = new ImagePublication(7, generated, 'timeline-composite', owner);
  await assert.rejects(fresh.publish(signal, () => {}), /previous application write/);
  assert.notEqual(calls[1].key, calls[0].key, 'A fresh preview cannot reuse the permanently failed job key.');
});

test('missing, malformed or uncertain before-write claims retain exact own-step recovery', async () => {
  const owner = { Id: 7, revision: 'sha256:' + 'a'.repeat(64) }, operationId = crypto.randomUUID(), stoppedRequestId = crypto.randomUUID();
  for (const details of [{}, { blockedBeforeWrite: 'true' }, { blockedBeforeWrite: true, uncertain: true }]) {
    globalThis.imagePublicationFixture = { owner, async request() { throw Object.assign(Error('Unconfirmed own image operation'), { status: 409, code: 'pending_recovery_required', details: { ...details, operationId, stoppedRequestId } }); } };
    const publication = new ImagePublication(7, { sources: [], recipe: { sourceIds: [] }, variants: [] }, 'timeline-composite', owner);
    await assert.rejects(publication.publish(new AbortController().signal, () => {}), /Unconfirmed own/);
    assert.equal(publication.blockedBeforeWrite, false); assert.deepEqual(publication.recovery, { operationId, stoppedRequestId });
  }
});

test('a stored generic MIME original reaches guarded byte decoding without changing original metadata', async () => {
  const owner = { Id: 8, CoverImageBin: { ContentType: 'application/octet-stream' } }, calls = [], snapshots = [];
  globalThis.imagePublicationFixture = { owner, snapshots, async request(path) { calls.push(path); throw Error('Source preparation must not request a presentation or a native image operation.'); } };
  assert.deepEqual(await sourceForGeneration(8, new AbortController().signal), { id: 8, url: '/api/v1/content/8/cover' });
  assert.equal(owner.CoverImageBin.ContentType, 'application/octet-stream'); assert.deepEqual(calls, []);
  assert.deepEqual(snapshots, [[8, { refresh: true }]], 'Source preparation must inspect a fresh stored-original snapshot.');
  for (const contentType of ['', 'application/pdf', 'image/svg+xml', 'text/plain']) {
    globalThis.imagePublicationFixture.owner = { Id: 8, CoverImageBin: { ContentType: contentType } };
    await assert.rejects(sourceForGeneration(8, new AbortController().signal), /Upload an original/);
  }
});

test('a confirmed image step cannot lend its recovery reference to a later failed upload', async () => {
  const owner = { Id: 7, revision: 'sha256:' + 'a'.repeat(64) }; let draftConfirmed = false;
  globalThis.imagePublicationFixture = { owner, async request(path) {
    if (path === '/images/drafts' && !draftConfirmed) throw Object.assign(Error('unconfirmed draft'), { details: { operationId: crypto.randomUUID(), stoppedRequestId: crypto.randomUUID() } });
    if (path === '/images/drafts') return { setId: 90, ownerRevision: 'sha256:' + 'b'.repeat(64) };
    throw Error('lost upload connection');
  } };
  const generated = { sources: [{ id: 8, stamp: 'b'.repeat(64) }], recipe: { template: 'poster-strip-v1', sourceIds: [8] }, variants: [{ name: 'w400', width: 400, height: 200, mimeType: 'image/png', byteLength: 3, sha256: 'c'.repeat(64), blob: new Blob(['abc']) }] };
  const publication = new ImagePublication(7, generated, 'timeline-composite', owner), signal = new AbortController().signal;
  await assert.rejects(publication.publish(signal, () => {}), /unconfirmed draft/); assert.ok(publication.recovery);
  draftConfirmed = true;
  await assert.rejects(publication.publish(signal, () => {}), /lost upload connection/);
  assert.equal(publication.recovery, undefined, 'a stale draft reference cannot close a different upload');
});

test('image publisher retries exact draft/upload/seal keys without staging binary bytes in a plan', async () => {
  const seen = new Map(), requests = [], commands = [], faults = new Set(['draft', 'variant', 'seal']);
  const owner = { Id: 7, revision: 'sha256:original-owner' };
  globalThis.imagePublicationFixture = { owner, async request(path, init) {
    const body = init.body && JSON.parse(init.body), key = init.headers?.['Idempotency-Key'];
    requests.push({ path, body, key });
    if (path === '/images/capabilities') return { available: true };
    if (path.endsWith('/image-presentation/editor')) return { state: 'active', recipe: { sourceIds: [8] } };
    assert.ok(path.startsWith('/images/drafts'), 'generated bytes go only through the dedicated SenseNet path');
    assert.ok(key);
    if (seen.has(key)) assert.deepEqual(body, seen.get(key), 'retry keeps the exact saved payload');
    else seen.set(key, body);
    const phase = path === '/images/drafts' ? 'draft' : path.endsWith('/seal') ? 'seal' : 'variant';
    if (faults.delete(phase)) throw new TypeError('lost response after commit');
    if (phase === 'draft') return { setId: 90, ownerRevision: 'sha256:' + 'c'.repeat(64) };
    if (phase === 'variant') return { ...body.variant, id: 91 };
    return { setId: 90, sealed: true };
  }, async apply(value) { commands.push(value); return { ok: true }; } };
  assert.equal((await imageCapabilities()).available, true, 'nativeRequest already unwraps data');
  assert.deepEqual((await imagePresentation(7, undefined, true)).recipe.sourceIds, [8]);
  const generated = { sources: [{ id: 8, stamp: 'a'.repeat(64), url: '/api/v1/content/8/cover' }], recipe: { template: 'poster-strip-v1', sourceIds: [8], seed: 42 },
    variants: [{ name: 'w400', width: 400, height: 200, mimeType: 'image/webp', byteLength: 3, sha256: 'b'.repeat(64), blob: new Blob(['abc']) }] };
  const intent = new ImagePublication(7, generated, 'timeline-composite', owner);
  for (let index = 0; index < 3; index++) await assert.rejects(intent.publish(new AbortController().signal, () => {}), /lost response/);
  await intent.publish(new AbortController().signal, () => {});
  await intent.publish(new AbortController().signal, () => {});
  assert.equal(seen.size, 3, 'one idempotency key per logical SenseNet mutation');
  assert.equal(requests.filter(item => item.path.endsWith('/variants/w400')).length, 2);
  assert.equal(commands.length, 1);
  assert.deepEqual(commands[0], [{ action: 'cover-presentation', targetId: 7, expectedRevision: 'sha256:' + 'c'.repeat(64), setId: 90 }]);
  assert.equal(owner.revision, 'sha256:original-owner', 'Acknowledged setup revision belongs only to the retained publication intent.');
  assert.ok(!JSON.stringify(commands).includes('YWJj'), 'plan/journal command never contains the output bytes');
});

test('an identity/context change prevents a prepared image publication from dispatching', async () => {
  let dispatched = false;
  globalThis.imagePublicationFixture = { changed: false, request: async () => { dispatched = true; } };
  const intent = new ImagePublication(7, { sources: [], variants: [] }, 'timeline-composite', { Id: 7, revision: 'before' });
  globalThis.imagePublicationFixture.changed = true;
  await assert.rejects(intent.publish(new AbortController().signal, () => {}), /context changed/);
  assert.equal(dispatched, false);
});

test('leaving the editor after sealing prevents a new activation dispatch', async () => {
  const controller = new AbortController(), owner = { Id: 7, revision: 'before' };
  let applied = false;
  globalThis.imagePublicationFixture = { owner, async request(path) {
    if (path === '/images/drafts') return { setId: 90, ownerRevision: 'sha256:' + 'c'.repeat(64) };
    if (path.endsWith('/seal')) { controller.abort(); return { sealed: true }; }
    throw new Error('unexpected request');
  }, async apply() { applied = true; } };
  const intent = new ImagePublication(7, { sources: [{ id: 8, stamp: 'a'.repeat(64) }], variants: [], recipe: { template: 'poster-strip-v1', sourceIds: [8] } }, 'timeline-composite', owner);
  await assert.rejects(intent.publish(controller.signal, () => {}), error => error.name === 'AbortError');
  assert.equal(applied, false);
});

test('original upload preserves selected bytes and its exact command across a lost response', async () => {
  const commands = [], owner = { Id: 7, revision: 'original-owner' };
  let lost = true;
  globalThis.imagePublicationFixture = { owner, async apply(value) {
    commands.push(value);
    if (lost) { lost = false; throw new TypeError('lost original upload response'); }
    return { ok: true };
  } };
  const bytes = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
  const intent = new OriginalImageUpload(7, new File([bytes], 'original.png', { type: 'image/png' }));
  await assert.rejects(intent.upload(new AbortController().signal), /lost original/);
  await intent.upload(new AbortController().signal);
  await intent.upload(new AbortController().signal);
  assert.equal(commands.length, 2, 'successful readback is retained for a UI refresh retry');
  assert.deepEqual(commands[0], commands[1], 'the original owner revision and payload are stable on retry');
  assert.equal(commands[0][0].action, 'cover', 'use the existing original-cover writer');
  assert.deepEqual(Buffer.from(commands[0][0].bytesBase64, 'base64'), Buffer.from(bytes), 'no canvas resize or re-encoding of originals');
});

test('lost draft acknowledgement retains its exact revision and later external edits remain activation conflicts', async () => {
  const originalRevision = 'sha256:' + 'a'.repeat(64), setupRevision = 'sha256:' + 'b'.repeat(64), externalRevision = 'sha256:' + 'c'.repeat(64);
  const owner = { Id: 7, revision: originalRevision }, requests = [], snapshots = []; let lost = true;
  globalThis.imagePublicationFixture = { owner, snapshots, async request(path, init) {
    const body = JSON.parse(init.body); requests.push({ path, body, key: init.headers['Idempotency-Key'] });
    if (path === '/images/drafts') {
      assert.equal(body.expectedRevision, originalRevision);
      if (lost) { lost = false; globalThis.imagePublicationFixture.owner = { ...owner, revision: externalRevision }; throw Error('lost draft acknowledgement'); }
      return { setId: 90, ownerRevision: setupRevision };
    }
    assert(path.endsWith('/seal')); return { sealed: true };
  }, async apply(commands) {
    assert.equal(commands[0].expectedRevision, setupRevision, 'The API-recorded setup revision must not adopt a later external owner edit.');
    assert.notEqual(commands[0].expectedRevision, globalThis.imagePublicationFixture.owner.revision);
    throw Error('revision_conflict');
  } };
  const intent = new ImagePublication(7, { sources: [{ id: 8, stamp: 'd'.repeat(64) }], variants: [], recipe: { template: 'poster-strip-v1', sourceIds: [8] } }, 'timeline-composite', owner);
  await assert.rejects(intent.publish(new AbortController().signal, () => {}), /lost draft/);
  await assert.rejects(intent.publish(new AbortController().signal, () => {}), /revision_conflict/);
  assert.deepEqual(requests[0], requests[1], 'The draft recovery request is byte-for-byte equivalent at the JSON contract.');
  assert.deepEqual(snapshots, [], 'Retry must not refresh away the owner revision guard.');
  assert.equal(owner.revision, originalRevision);
});

test('invalid post-setup owner revisions cannot advance a draft to seal or activation', async () => {
  for (const ownerRevision of [undefined, '', 'newest', 'sha256:' + 'x'.repeat(64)]) {
    const requests = [];
    globalThis.imagePublicationFixture = { async request(path) { requests.push(path); return { setId: 90, ownerRevision }; }, async apply() { throw Error('must not activate'); } };
    const intent = new ImagePublication(7, { sources: [], variants: [], recipe: { sourceIds: [] } }, 'timeline-composite', { Id: 7, revision: 'sha256:' + 'a'.repeat(64) });
    await assert.rejects(intent.publish(new AbortController().signal, () => {}), /invalid draft/);
    assert.deepEqual(requests, ['/images/drafts']);
  }
});

test('preflight failure does not lock a publication that has sent no image mutation', async () => {
  let unavailable = true, writes = 0;
  globalThis.imagePublicationFixture = { owner: { Id: 7, revision: 'before' },
    preflight: async () => { if (unavailable) throw Error('gateway timed out before dispatch'); },
    request: async path => { writes++; return path === '/images/drafts' ? { setId: 90, ownerRevision: 'sha256:' + 'a'.repeat(64) } : {}; },
    apply: async () => {},
  };
  const intent = new ImagePublication(7, { sources: [], variants: [], recipe: { sourceIds: [] } }, 'timeline-composite', { Id: 7, revision: 'before' });
  await assert.rejects(intent.publish(new AbortController().signal, () => {}), /before dispatch/);
  assert.equal(intent.hasStartedMutation, false);
  assert.equal(writes, 0);
  unavailable = false;
  await intent.publish(new AbortController().signal, () => {});
  assert.equal(intent.hasStartedMutation, true);
  assert.equal(writes, 2, 'Only draft and seal are needed for this empty test set.');
});

test('timeout on a later variant keeps the exact generation, bytes and keys until success', async () => {
  const calls = [], activations = [];
  let timeout = true;
  const owner = { Id: 7, revision: 'before' };
  const variants = [400, 800].map(width => ({ name: 'w' + width, width, height: width / 2, mimeType: 'image/webp', byteLength: 3, sha256: 'b'.repeat(64), blob: new Blob([width === 400 ? 'abc' : 'def']) }));
  const generated = { sources: [{ id: 8, stamp: 'a'.repeat(64) }], recipe: { sourceIds: [8] }, variants };
  globalThis.imagePublicationFixture = { owner, async request(path, init) {
    calls.push({ path, body: JSON.parse(init.body), key: init.headers['Idempotency-Key'] });
    if (path === '/images/drafts') return { setId: 90, ownerRevision: 'sha256:' + 'c'.repeat(64) };
    if (path.endsWith('/w800') && timeout) { timeout = false; const error = new Error('The request timed out.'); error.code = 'native_gateway_timeout'; error.details = { uncertain: true }; throw error; }
    return path.includes('/variants/') ? { ...JSON.parse(init.body).variant, id: path.endsWith('/w400') ? 91 : 92 } : {};
  }, async apply(commands) { activations.push(commands); } };
  const intent = new ImagePublication(7, generated, 'timeline-composite', owner);
  await assert.rejects(intent.publish(new AbortController().signal, () => {}), /timed out/);
  assert.equal(intent.hasStartedMutation, true, 'The selection must remain bound to the uncertain request.');
  const generation = intent.generationId;
  await intent.publish(new AbortController().signal, () => {});
  const writesAtSuccess = calls.length;
  await intent.publish(new AbortController().signal, () => {});
  assert.equal(intent.generationId, generation);
  assert.equal(calls.length, writesAtSuccess);
  assert.equal(calls.filter(c => c.path === '/images/drafts').length, 1);
  assert.equal(calls.filter(c => c.path.endsWith('/w400')).length, 1);
  const retried = calls.filter(c => c.path.endsWith('/w800'));
  assert.equal(retried.length, 2);
  assert.deepEqual(retried[0], retried[1]);
  assert.equal(activations.length, 1);
  const next = new ImagePublication(7, generated, 'timeline-composite', owner);
  assert.notEqual(next.generationId, generation, 'After success a new edit starts an independent publication.');
  assert.equal(next.hasStartedMutation, false);
});

test('retry after a completed publication and failed presentation refresh performs no second activation', async () => {
  let writes = 0, activations = 0, refreshes = 0;
  const owner = { Id: 7, revision: 'before' };
  globalThis.imagePublicationFixture = { owner, async request(path) {
    if (path.endsWith('/image-presentation/editor')) {
      if (++refreshes === 1) throw Error('lost display refresh');
      return { state: 'active', setId: 90 };
    }
    writes++;
    return path === '/images/drafts' ? { setId: 90, ownerRevision: 'sha256:' + 'a'.repeat(64) } : {};
  }, async apply() { activations++; } };
  const intent = new ImagePublication(7, { sources: [], variants: [], recipe: { sourceIds: [] } }, 'timeline-composite', owner);
  await intent.publish(new AbortController().signal, () => {});
  await assert.rejects(imagePresentation(7, undefined, true), /lost display/);
  await intent.publish(new AbortController().signal, () => {});
  assert.equal((await imagePresentation(7, undefined, true)).state, 'active');
  assert.equal(writes, 2);
  assert.equal(activations, 1);
});
