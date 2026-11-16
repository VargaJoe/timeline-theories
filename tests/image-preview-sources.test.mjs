import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';
import { imageReadRetryModuleUrl } from './helpers/image-read-retry-module.mjs';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const forbidden = '()=>{throw Error("Source preview must not publish or read full snapshots")}';
const native = moduleUrl(`
export const nativeRequest=(...args)=>globalThis.__previewSources.request(...args);
export const nativeResponse=(...args)=>globalThis.__previewSources.response(...args);
export const nativeSnapshot=${forbidden},applyNativeCommands=${forbidden},acknowledgeNativeCommands=${forbidden},nativeCoverPayload=${forbidden};
`);
const context = moduleUrl(`export const captureOperationContext=()=>{const subject=globalThis.__previewSources.identity;return()=>{if(subject!==globalThis.__previewSources.identity)throw Error('Operation context changed');};};export const assertOperations=${forbidden};`);
let compiled = ts.transpileModule(fs.readFileSync(new URL('../client/services/imageVariantService.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
for (const [from, to] of [['../configuration', moduleUrl("export const environment={projectRoot:'/Root/Fixture'};")], ['./nativeApi', native], ['./sensenet', context], ['../utils/posterStripLayout.mjs', new URL('../client/utils/posterStripLayout.mjs', import.meta.url).href]]) compiled = compiled.replaceAll(`'${from}'`, JSON.stringify(to));
compiled = compiled.replace("from '../utils/imageReadRetry'", `from '${imageReadRetryModuleUrl}'`);
const { ImagePreviewSourceSession } = await import(moduleUrl(compiled));
const version = n => 'sha256:' + n.toString(16).padStart(64, '0');
const signal = () => new AbortController().signal;
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function fixture() {
  const state = { identity: 'editor-a', metadata: [], downloads: [], versions: new Map(), ownerRevision: 1,
    result(ids) { return { owner: { Id: 7, revision: version(this.ownerRevision) }, sources: ids.map(id => ({ id, url: `/api/v1/content/${id}/cover`, version: version(this.versions.get(id) ?? id) })) }; },
    async request(path, init) {
      assert.equal(path, '/images/preview-sources'); assert.equal(init.method, 'POST'); assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
      const input = JSON.parse(init.body); assert.equal(input.ownerId, 7); this.metadata.push(input); return this.result(input.sourceIds);
    },
    async response(path, init) { this.downloads.push(path); assert.equal(init.cache, 'no-store'); return new Response(new Uint8Array([Number(path.split('/')[2]), 255]), { headers: { 'Content-Type': 'image/png' } }); },
  };
  globalThis.__previewSources = state; return state;
}
const load = prepared => Promise.all(prepared.sources.map(source => prepared.fetchSource(source, signal())));

test('one fresh metadata batch renews owner revision and source ACL before reusing unchanged exact original bytes', async () => {
  const state = fixture(), session = new ImagePreviewSourceSession(7);
  const first = await session.prepare([8, 9], signal()), originals = await load(first);
  assert.deepEqual(state.metadata, [{ ownerId: 7, sourceIds: [8, 9] }]);
  assert.deepEqual(first.sources, [{ id: 8, url: '/api/v1/content/8/cover' }, { id: 9, url: '/api/v1/content/9/cover' }]);
  assert.deepEqual([...new Uint8Array(await originals[0].arrayBuffer())], [8, 255]);
  state.ownerRevision++;
  const second = await session.prepare([9, 8], signal()), reused = await load(second);
  assert.equal(second.owner.revision, version(2), 'Publication uses the newly read owner revision.');
  assert.equal(reused[0], originals[1]); assert.equal(reused[1], originals[0]);
  assert.equal(state.metadata.length, 2, 'Regeneration never caches an authorization decision.');
  assert.deepEqual(state.downloads, ['/content/8/cover', '/content/9/cover'], 'Seed/order-only regeneration performs no redundant original I/O.');
  state.versions.set(8, 18);
  const changed = await session.prepare([8, 9], signal()), refreshed = await load(changed);
  assert.notEqual(refreshed[0], originals[0]); assert.equal(refreshed[1], originals[1]);
  assert.deepEqual(state.downloads, ['/content/8/cover', '/content/9/cover', '/content/8/cover']);
  await assert.rejects(first.fetchSource(first.sources[0], signal()), { name: 'AbortError' });
  session.dispose(); await assert.rejects(session.prepare([8], signal()), { name: 'AbortError' });
});

test('source authorization denial and a principal/permission context change discard private bytes and prohibit stale fetch closures', async () => {
  const state = fixture(), session = new ImagePreviewSourceSession(7);
  const first = await session.prepare([8], signal()); await load(first);
  const request = state.request; state.request = async () => { throw Error('Current Open denied'); };
  await assert.rejects(session.prepare([8], signal()), /Current Open denied/);
  await assert.rejects(first.fetchSource(first.sources[0], signal()), { name: 'AbortError' });
  state.request = request; await load(await session.prepare([8], signal()));
  assert.equal(state.downloads.length, 2, 'An authorized retry must redownload bytes after a denied refresh.');
  state.identity = 'editor-b'; const count = state.metadata.length;
  await assert.rejects(session.prepare([8], signal()), /context changed/);
  assert.equal(state.metadata.length, count, 'An old principal session cannot issue requests under the new identity.');
  await load(await new ImagePreviewSourceSession(7).prepare([8], signal()));
  assert.equal(state.downloads.length, 3, 'A new principal receives no previous editor bytes.');
});

test('batch response is exact and all-or-nothing; missing, reordered, foreign, duplicate or unversioned sources cannot reuse bytes', async () => {
  const state = fixture(), session = new ImagePreviewSourceSession(7), request = state.request;
  for (const corrupt of [
    result => { result.owner.Id = 17; }, result => { result.owner.revision = ''; },
    result => { result.sources.pop(); }, result => { result.sources.reverse(); },
    result => { result.sources[1] = { ...result.sources[0] }; },
    result => { result.sources[0].version = ''; }, result => { result.sources[0].url = 'https://foreign.invalid/original'; },
  ]) {
    await load(await session.prepare([8, 9], signal()));
    state.request = async function (path, init) { const result = await request.call(this, path, init); corrupt(result); return result; };
    await assert.rejects(session.prepare([8, 9], signal()), /invalid original-source snapshot/);
    state.request = request; const before = state.downloads.length;
    await load(await session.prepare([8, 9], signal()));
    assert.equal(state.downloads.length, before + 2, 'No private cache survives an invalid fresh authorization batch.');
  }
  const before = state.metadata.length;
  for (const ids of [[], [8, 8], [0], Array.from({ length: 13 }, (_, i) => i + 1)]) await assert.rejects(session.prepare(ids, signal()), /valid, distinct/);
  assert.equal(state.metadata.length, before);
});

test('private originals obey both LRU count and byte limits; oversized originals never enter the cache', async () => {
  const state = fixture(), session = new ImagePreviewSourceSession(7, { maxEntries: 2, maxBytes: 5 });
  const first = await session.prepare([8, 9, 10], signal());
  for (const source of first.sources) await first.fetchSource(source, signal());
  await load(await session.prepare([9, 8], signal()));
  assert.deepEqual(state.downloads, ['/content/8/cover', '/content/9/cover', '/content/10/cover', '/content/8/cover']);
  const bytesOnly = new ImagePreviewSourceSession(7, { maxEntries: 12, maxBytes: 3 });
  const before = state.downloads.length;
  await load(await bytesOnly.prepare([8, 9], signal()));
  await load(await bytesOnly.prepare([8], signal()));
  assert.equal(state.downloads.length, before + 3, 'Two 2-byte originals cannot remain in a 3-byte cache.');
  const oversized = new ImagePreviewSourceSession(7, { maxBytes: 1 });
  const oversizedBefore = state.downloads.length;
  await load(await oversized.prepare([8], signal())); await load(await oversized.prepare([8], signal()));
  assert.equal(state.downloads.length, oversizedBefore + 2);
});

test('transient metadata and failed peer reads preserve already verified originals until a fresh ACL batch', async () => {
  const state = fixture(), session = new ImagePreviewSourceSession(7), request = state.request, response = state.response;
  await load(await session.prepare([8], signal()));
  let failures = 0;
  state.request = async () => { failures++; throw Object.assign(Error('gateway'), { status: 520 }); };
  await assert.rejects(session.prepare([8], signal()), /temporarily failed/); assert.equal(failures, 2);
  state.request = request;
  const next = await session.prepare([8, 9], signal()); await next.fetchSource(next.sources[0], signal());
  state.response = async function (path, init) { if (path.includes('/9/')) { this.downloads.push(path); throw Object.assign(Error('gateway'), { status: 520 }); } return response.call(this, path, init); };
  let failure;
  try { await next.fetchSource(next.sources[1], signal()); } catch (error) { failure = error; }
  assert.equal(failure.name, 'ImageReadFailure');
  const peer = new AbortController(); peer.abort(failure);
  await assert.rejects(next.fetchSource(next.sources[0], peer.signal), error => error === failure);
  state.response = response;
  await load(await session.prepare([8, 9], signal()));
  assert.deepEqual(state.downloads, ['/content/8/cover', '/content/9/cover', '/content/9/cover', '/content/9/cover']);
  assert.equal(state.metadata.length, 3, 'Retry renews metadata rather than reusing an old authorization decision.');
  state.request = async () => { throw Object.assign(Error('bad JSON'), { status: 502, code: 'native_response_invalid' }); };
  await assert.rejects(session.prepare([8], signal()), /bad JSON/);
  state.request = request; await load(await session.prepare([8], signal()));
  assert.equal(state.downloads.filter(path => path === '/content/8/cover').length, 2, 'Invalid metadata purges bytes even when its wire status is 502.');
});

test('cancellation and superseded preparation drain late responses without retaining or exposing their bytes', async () => {
  const state = fixture(), session = new ImagePreviewSourceSession(7), cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(session.prepare([8], cancelled.signal), { name: 'AbortError' }); assert.equal(state.metadata.length, 0);
  const pending = deferred(), response = state.response;
  state.response = async function (...args) { await pending.promise; return response.apply(this, args); };
  const abort = new AbortController(), prepared = await session.prepare([8], abort.signal);
  const downloading = prepared.fetchSource(prepared.sources[0], abort.signal), rejected = assert.rejects(downloading, { name: 'AbortError' });
  await tick(); abort.abort(); pending.resolve(); await rejected;
  state.response = response; await load(await session.prepare([8], signal()));
  assert.equal(state.downloads.length, 2, 'Cancelled download completion cannot warm the next preview.');
  const waiting = deferred(), request = state.request;
  state.request = async function (path, init) { const ids = JSON.parse(init.body).sourceIds; if (ids[0] === 9) await waiting.promise; return request.call(this, path, init); };
  const old = session.prepare([9], signal()), oldRejected = assert.rejects(old, { name: 'AbortError' });
  const latest = await session.prepare([8], signal()); await load(latest); waiting.resolve(); await oldRejected;
  assert.equal(state.downloads.length, 2, 'A late obsolete metadata response does not clear the current valid cache.');
  const foreign = { id: 10, url: '/api/v1/content/10/cover' };
  await assert.rejects(latest.fetchSource(foreign, signal()), /current image sources/);
  session.dispose();
});
