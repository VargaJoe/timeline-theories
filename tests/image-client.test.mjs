import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash, webcrypto } from 'node:crypto';
import ts from '../client/node_modules/typescript/lib/typescript.js';
import fixtures from '../scripts/helpers/image-variant-fixture.cjs';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function compile(path, imports = {}) {
  let output = ts.transpileModule(fs.readFileSync(new URL('../client/' + path, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const [name, target] of Object.entries(imports)) output = output.replaceAll(`from '${name}'`, `from '${target}'`);
  return moduleUrl(output);
}
const config = moduleUrl("export const repositoryUrl='https://repository.fixture.invalid'; export const siteConfig={imageCache:{concurrencyLimit:2}};");
const native = moduleUrl('export const nativeResponse=(...args)=>globalThis.__imageNative(...args);');
const loadingUrl = compile('utils/imageLoading.ts', { '../configuration': config, '../services/nativeApi': native });
const { createImageRequestQueue, fetchImageBlob, nativeImagePresentationTarget } = await import(loadingUrl);
const variantsUrl = compile('utils/imageVariants.ts');
const { selectImageVariant, selectImageUrl } = await import(variantsUrl);
const { generateImageVariants, imageOutputSizes, inspectImageSource, normalizeGeneratedPng, posterStripLayout } = await import(compile('utils/imageGenerator.ts', { './imageLoading': loadingUrl }));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }

test('responsive selection uses actual CSS width and capped DPR, with no unsafe fallback', () => {
  const variants = [640, 160, 320].map(width => ({ width, height: width * 1.5, name: `w${width}`, url: `/${width}` }));
  assert.equal(selectImageVariant(variants, 120, 1).width, 160);
  assert.equal(selectImageVariant(variants, 120, 2).width, 320);
  assert.equal(selectImageVariant(variants, 120, 5).width, 320);
  assert.equal(selectImageVariant(variants, 260, 2).width, 640);
  assert.equal(selectImageVariant(variants, 1000, 2).width, 640);
  assert.equal(selectImageVariant(variants, 0, 2), undefined);
  assert.equal(selectImageUrl({ state: 'active', variants }, 'private-original', 120, 2), '/320');
  for (const state of ['blocked', 'stale', 'missing']) assert.equal(selectImageUrl({ state, variants }, 'private-original', 120, 2), undefined);
  assert.equal(selectImageUrl({ state: 'active', variants: [] }, 'original', 120), undefined);
  assert.equal(selectImageUrl({ state: 'legacy' }, 'original', 120), 'original');
});

test('image queue caps concurrency at two and removes aborted work without starting it', async () => {
  const queue = createImageRequestQueue(20), controllers = Array.from({ length: 5 }, () => new AbortController());
  const releases = [], started = [];
  const jobs = controllers.map((controller, index) => queue.run(async () => {
    started.push(index); const waiting = deferred(); releases.push(waiting.resolve); await waiting.promise; return index;
  }, controller.signal));
  const cancelled = assert.rejects(jobs[2], { name: 'AbortError' });
  await tick(); assert.deepEqual(started, [0, 1]); controllers[2].abort(); await cancelled;
  releases.shift()(); await tick(); assert.deepEqual(started, [0, 1, 3]);
  releases.shift()(); await tick(); assert.deepEqual(started, [0, 1, 3, 4]);
  releases.forEach(release => release()); await Promise.all([jobs[0], jobs[1], jobs[3], jobs[4]]);
});

test('native bytes use native binding and repository bearer is never sent to a third party', async () => {
  const oldFetch = globalThis.fetch, oldWindow = globalThis.window, calls = [];
  globalThis.window = { location: { origin: 'https://app.fixture.invalid' } };
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return new Response('image'); };
  globalThis.__imageNative = async (path, options) => { calls.push({ path, options }); return new Response('native'); };
  const controller = new AbortController();
  try {
    const generation = '12345678-1234-4123-8123-123456789abc';
    assert.deepEqual(nativeImagePresentationTarget(`/api/v1/images/12/${generation}/w320`, generation), { path: '/content/12/image-presentation', generationId: generation });
    assert.equal(nativeImagePresentationTarget(`https://third-party.fixture.invalid/api/v1/images/12/${generation}/w320`, generation), undefined);
    assert.equal(nativeImagePresentationTarget(`/api/v1/images/12/${generation}/w320?x=1`, generation), undefined);
    assert.equal(nativeImagePresentationTarget(`/api/v1/images/12/${generation}/w320`, 'different-generation'), undefined);
    await fetchImageBlob('/api/v1/images/1/generation/w320', { signal: controller.signal, accessToken: 'secret' });
    assert.equal(calls[0].path, '/api/v1/images/1/generation/w320');
    assert.equal(calls[0].options.cache, 'no-store');
    await fetchImageBlob('https://repository.fixture.invalid/cover', { signal: controller.signal, accessToken: 'secret' });
    assert.equal(calls[1].options.headers.Authorization, 'Bearer secret');
    assert.equal(calls[1].options.credentials, 'omit'); assert.equal(calls[1].options.redirect, 'error');
    assert.equal(calls[1].options.cache, 'no-store');
    await fetchImageBlob('https://third-party.fixture.invalid/cover', { signal: controller.signal, accessToken: 'secret' });
    assert.equal(calls[2].options.headers.Authorization, undefined);
    await assert.rejects(fetchImageBlob('/api/v1/images/1/w320?unsafe=1', { signal: controller.signal }));
    await assert.rejects(fetchImageBlob('data:image/png;base64,AA==', { signal: controller.signal }));
    let current = true;
    globalThis.fetch = async () => { current = false; return new Response('old identity'); };
    await assert.rejects(fetchImageBlob('https://third-party.fixture.invalid/cover', { signal: controller.signal, assertContext: () => { if (!current) throw Error('context changed'); } }), /context changed/);
  } finally { globalThis.fetch = oldFetch; globalThis.window = oldWindow; delete globalThis.__imageNative; }
});

test('generator preserves native resolution and contains all 1–4 poster groups', () => {
  assert.deepEqual(imageOutputSizes('media-sizes', [{ width: 360, height: 480 }]), [{ width: 160, height: 213 }, { width: 320, height: 427 }]);
  assert.deepEqual(imageOutputSizes('media-sizes', [{ width: 80, height: 120 }]), [{ width: 80, height: 120 }]);
  assert.deepEqual(imageOutputSizes('timeline-composite', [{ width: 360, height: 480 }]).map(size => size.width), [400, 800, 1200]);
  assert(imageOutputSizes('timeline-composite', [{ width: 50, height: 70 }])[0].width < 400);
  for (let count = 1; count <= 4; count++) {
    const slots = posterStripLayout(count);
    assert.equal(slots.length, count);
    for (const slot of slots) assert(slot.x >= 0 && slot.x + slot.width <= 400 && slot.y >= 0 && slot.y + slot.height <= 200);
  }
  // Extremely narrow sources are rejected rather than resized above the decoder/output limits.
  assert.throws(() => imageOutputSizes('media-sizes', [{ width: 1, height: 8192 }]), /aspect ratio/);
});

test('source inspection rejects huge raster dimensions before browser decode', async () => {
  const bytes = fixtures.png(2, 3);
  assert.deepEqual(await inspectImageSource(new Blob([bytes], { type: 'image/png' })), { width: 2, height: 3 });
  const oversized = Buffer.from(bytes); oversized.writeUInt32BE(100000, 16);
  await assert.rejects(inspectImageSource(new Blob([oversized], { type: 'image/png' })), /pixel dimensions/);
  await assert.rejects(inspectImageSource(new Blob([bytes], { type: 'image/jpeg' })), /matching MIME/);
  await assert.rejects(inspectImageSource(new Blob(['broken'], { type: 'image/png' })));
});

test('generated PNG normalization strips metadata, verifies all CRCs and rejects changed pixel semantics', async () => {
  function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const value of body) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const length = Buffer.alloc(4), checksum = Buffer.alloc(4); length.writeUInt32BE(data.length); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const original = fixtures.png(2, 3), color = chunk('sRGB', Buffer.from([0]));
  const decorated = Buffer.concat([original.subarray(0, 33), color, original.subarray(33)]);
  const normalized = await normalizeGeneratedPng(new Blob([decorated], { type: 'image/png' }));
  assert.deepEqual(Buffer.from(await normalized.arrayBuffer()), original);
  assert.deepEqual(Buffer.from(decorated.subarray(33, 33 + color.length)), color, 'Input bytes are preserved.');
  const broken = Buffer.from(decorated); broken[broken.length - 1] ^= 1;
  await assert.rejects(normalizeGeneratedPng(new Blob([broken], { type: 'image/png' })), /CRC/);
  const transparency = Buffer.concat([original.subarray(0, 33), chunk('tRNS', Buffer.from([0, 0, 0, 0, 0, 0])), original.subarray(33)]);
  await assert.rejects(normalizeGeneratedPng(new Blob([transparency], { type: 'image/png' })), /Unsupported/);
  for (const [offset, value] of [[8, 16], [9, 3], [12, 1]]) {
    const header = Buffer.from(original.subarray(16, 29)); header[offset] = value;
    const invalid = Buffer.concat([original.subarray(0, 8), chunk('IHDR', header), original.subarray(33)]);
    await assert.rejects(normalizeGeneratedPng(new Blob([invalid], { type: 'image/png' })), /8-bit RGB or RGBA/);
  }
});

function generatorEnvironment({ mime = 'image/webp', size = 0, onDecode } = {}) {
  const previous = { createImageBitmap: globalThis.createImageBitmap, document: globalThis.document, crypto: globalThis.crypto };
  const closed = [], canvases = [];
  globalThis.createImageBitmap = async blob => {
    const dimensions = await inspectImageSource(blob); await onDecode?.();
    return { ...dimensions, close() { closed.push(dimensions); } };
  };
  globalThis.document = { createElement() {
    const calls = [], canvas = {
      width: 0, height: 0,
      getContext() { return new Proxy({}, { set(target, key, value) { target[key] = value; return true; }, get(target, key) {
        return target[key] ?? ((...args) => calls.push([key, ...args.map(value => typeof value === 'object' ? { width: value.width, height: value.height } : value)]));
      } }); },
      toBlob(callback) { callback(new Blob([size ? new Uint8Array(size) : mime === 'image/png' ? fixtures.png(canvas.width, canvas.height) : JSON.stringify({ width: canvas.width, height: canvas.height, calls })], { type: mime })); },
    };
    canvases.push(canvas); return canvas;
  } };
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  return { closed, canvases, restore() { for (const [key, value] of Object.entries(previous)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true }); } };
}

test('full generator enforces two source workers, ordered deterministic outputs, hashes and cleanup', async () => {
  const env = generatorEnvironment(), releases = [], started = [], sources = Array.from({ length: 4 }, (_, index) => ({ id: index + 1, url: `/source/${index}`, stamp: `stamp-${index}` }));
  const options = { kind: 'timeline-composite', sources, seed: 42, fetchSource: async source => {
    started.push(source.id); const wait = deferred(); releases.push(wait.resolve); await wait.promise;
    return new Blob([fixtures.png(360, 480, source.id)], { type: 'image/png' });
  } };
  try {
    const pending = generateImageVariants(options); await tick(); assert.deepEqual(started, [1, 2]);
    releases.shift()(); await tick(); assert.deepEqual(started, [1, 2, 3]);
    releases.shift()(); await tick(); assert.deepEqual(started, [1, 2, 3, 4]);
    releases.forEach(release => release()); const result = await pending;
    assert.deepEqual(result.recipe, { template: 'poster-strip-v1', sourceIds: [1, 2, 3, 4], seed: 42 });
    assert.deepEqual(result.variants.map(variant => variant.width), [400, 800, 1200]);
    for (const variant of result.variants) {
      assert.equal(variant.sha256, createHash('sha256').update(Buffer.from(await variant.blob.arrayBuffer())).digest('hex'));
      assert.equal(variant.byteLength, variant.blob.size);
    }
    assert.equal(env.closed.length, 4); assert(env.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
    const repeated = await generateImageVariants({ ...options, fetchSource: async source => new Blob([fixtures.png(360, 480, source.id)], { type: 'image/png' }) });
    assert.deepEqual(repeated.variants.map(variant => variant.sha256), result.variants.map(variant => variant.sha256));
  } finally { env.restore(); }
});

test('generator accepts PNG encoder fallback but rejects oversized output, stale contexts and cancellation', async () => {
  const source = { id: 1, url: '/original', stamp: 'current' }, blob = new Blob([fixtures.png(80, 120)], { type: 'image/png' });
  let env = generatorEnvironment({ mime: 'image/png' });
  try {
    const generated = await generateImageVariants({ kind: 'media-sizes', sources: [source], seed: 0, fetchSource: async () => blob });
    assert.equal(generated.variants[0].mimeType, 'image/png'); assert.equal(generated.variants[0].width, 80);
    assert.equal(generated.recipe.seed, 0);
  } finally { env.restore(); }
  env = generatorEnvironment({ size: 1024 * 1024 + 1 });
  try { await assert.rejects(generateImageVariants({ kind: 'media-sizes', sources: [source], fetchSource: async () => blob }), /1 MiB/); assert.equal(env.closed.length, 1); }
  finally { env.restore(); }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(generateImageVariants({ kind: 'media-sizes', sources: [source], seed: -1, fetchSource: async () => blob }), /seed/);
  await assert.rejects(generateImageVariants({ kind: 'media-sizes', sources: [source], signal: controller.signal, fetchSource: async () => { throw Error('must not start'); } }), { name: 'AbortError' });
  await assert.rejects(generateImageVariants({ kind: 'media-sizes', sources: [source], assertContext: () => { throw Error('identity changed'); }, fetchSource: async () => blob }), /identity changed/);
});
