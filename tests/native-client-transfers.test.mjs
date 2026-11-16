import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import ts from '../client/node_modules/typescript/lib/typescript.js';
import { followNativeResponse, createClient } from '../scripts/m1-client.mjs';

const CHUNK = 2 * 1024 * 1024, sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const record = (value, status = 200, headers = {}) => ({ status, headers: { 'content-type': 'application/json', ...headers }, body: Buffer.from(JSON.stringify(value)) });
function download(bytes, extra = {}) {
  return { id: randomUUID(), size: bytes.length, sha256: sha256(bytes), chunkSize: CHUNK, chunks: Math.ceil(bytes.length / CHUNK), status: 200, contentType: 'application/zip', headers: { 'content-disposition': 'attachment; filename="timeline.zip"' }, ...extra };
}

test('independent Node client follows pending jobs, verifies chunks and exposes original ZIP bytes', async () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 7, 91), manifest = download(bytes), jobId = randomUUID(), routes = [];
  let polls = 0;
  const final = await followNativeResponse(record({ job: { id: jobId, state: 'queued' }, pending: true }, 202), async route => {
    routes.push(route);
    if (route.startsWith('/jobs/')) return ++polls === 1 ? record({ job: { id: jobId, state: 'running' }, pending: true }, 202) : record({ download: manifest });
    const index = Number(route.split('/').at(-1)), part = bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
    return { status: 200, headers: { 'x-content-sha256': sha256(part) }, body: part };
  }, { pollIntervalMs: 0 });
  assert.equal(final.status, 200); assert.deepEqual(final.bytes, bytes); assert.equal(final.headers['content-type'], 'application/zip');
  assert.deepEqual(routes, [`/jobs/${jobId}`, `/jobs/${jobId}`, `/downloads/${manifest.id}/chunks/0`, `/downloads/${manifest.id}/chunks/1`]);
});

test('job timeout and poll failure retain recoverable job identity; terminal partial receipts preserve HTTP evidence', async () => {
  const jobId = randomUUID(), pending = record({ job: { id: jobId, state: 'running' }, pending: true }, 202);
  await assert.rejects(followNativeResponse(pending, () => { throw new Error('must not poll'); }, { timeoutMs: 0 }), error => error.code === 'native_job_pending' && error.recoverable === true && error.jobId === jobId);
  await assert.rejects(followNativeResponse(pending, async () => { throw new Error('network lost'); }, { pollIntervalMs: 0 }), error => error.recoverable === true && error.jobId === jobId);
  const receipt = { ok: false, completed: [{ result: { id: 10 } }], uncertainTargets: [11], retrySamePlan: true, error: { code: 'repository_transport' } };
  const result = await followNativeResponse(pending, async () => record(receipt, 409), { pollIntervalMs: 0 });
  assert.equal(result.status, 409); assert.deepEqual(result.value, receipt);
});

test('download digest, size, status and current context checks fail closed', async () => {
  const bytes = Buffer.alloc(20, 8), manifest = download(bytes);
  const read = async () => ({ status: 200, headers: { 'x-content-sha256': sha256(bytes) }, body: bytes });
  await assert.rejects(followNativeResponse(record({ download: { ...manifest, sha256: 'a'.repeat(64) } }), read), error => error.code === 'native_transfer_integrity');
  await assert.rejects(followNativeResponse(record({ download: { ...manifest, status: 201 } }), read), error => error.code === 'native_transfer_invalid');
  await assert.rejects(followNativeResponse(record({ download: manifest }), async () => ({ status: 200, headers: {}, body: bytes.subarray(1) })), error => error.code === 'native_transfer_integrity');
  let checks = 0;
  await assert.rejects(followNativeResponse(record({ download: manifest }), read, { checkContext: () => { if (++checks > 1) throw new Error('changed identity'); } }), /changed identity/);
  assert.throws(() => createClient({ baseUrl: 'http://gateway.test/api/v1' }), /HTTPS/);
  assert.throws(() => createClient({ baseUrl: 'https://user:secret@gateway.test/api/v1' }), /HTTPS/);
});

globalThis.window = { location: { origin: 'https://ui.fixture.invalid' } };
globalThis.__transferEnvironment = { repositoryUrl: 'https://repo.fixture.invalid', authority: 'https://auth.fixture.invalid', projectRoot: '/Root/Fixture', writable: true };
const source = fs.readFileSync(new URL('../client/services/nativeApi.ts', import.meta.url), 'utf8')
  .replace("import { environment } from '../configuration';", 'const environment=globalThis.__transferEnvironment;')
  .replace('import.meta.env.VITE_NATIVE_API_URL', 'undefined');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const browser = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
function web(value, status = 200, headers = {}) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } }); }
const revision = 'sha256:' + 'b'.repeat(64);
function installUploadFixture(terminal) {
  const uploads = new Map(), routes = [], sent = [], token = 'original-token';
  browser.configureNativeAuth(() => token);
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).pathname, headers = new Headers(init.headers); routes.push(route);
    assert.equal(headers.get('authorization'), 'Bearer original-token');
    assert.equal(headers.get('x-timeline-repository'), globalThis.__transferEnvironment.repositoryUrl);
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    if (route === '/api/v1/uploads') {
      const input = JSON.parse(init.body), id = randomUUID(), upload = { id, ...input, chunkSize: CHUNK, chunks: Math.ceil(input.size / CHUNK) };
      uploads.set(id, { upload, bytes: [] }); sent.push(input);
      return web({ upload }, 201);
    }
    const chunk = route.match(/\/uploads\/([^/]+)\/chunks\/(\d+)$/);
    if (chunk) {
      assert.equal(headers.get('content-type'), 'application/octet-stream');
      assert.ok(init.body.byteLength <= CHUNK);
      const saved = uploads.get(chunk[1]); saved.bytes[Number(chunk[2])] = Buffer.from(init.body);
      return web({ index: Number(chunk[2]) });
    }
    const complete = route.match(/\/uploads\/([^/]+)\/complete$/);
    if (complete) {
      const saved = uploads.get(complete[1]), bytes = Buffer.concat(saved.bytes);
      assert.equal(bytes.length, saved.upload.size); assert.equal(sha256(bytes), saved.upload.sha256);
      return web({ upload: { ...saved.upload, complete: true } });
    }
    return terminal(route, init);
  };
  return { uploads, routes, sent };
}

test('browser stages large cover and metadata cover without losing exact editor revision or file identity', async () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 1, 13); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
  let planInput;
  const f = installUploadFixture((route, init) => { assert.equal(route, '/api/v1/plans'); planInput = JSON.parse(init.body); return web({ id: randomUUID() }); });
  const commands = [
    { action: 'cover', targetId: 10, expectedRevision: revision, bytesBase64: bytes.toString('base64'), mimeType: 'image/png', fileName: 'one.png' },
    { action: 'metadata', targetId: 11, expectedRevision: revision, proposal: { fields: {} }, cover: { bytesBase64: bytes.toString('base64'), mimeType: 'image/png', fileName: 'two.png' } },
  ];
  await browser.nativeRequest('/plans', { method: 'POST', body: JSON.stringify({ commands }) });
  assert.equal(f.uploads.size, 2); assert.equal(f.sent[0].expectedRevision, revision); assert.equal(f.sent[1].targetId, 11);
  assert.equal(planInput.commands[0].bytesBase64, undefined); assert.equal(planInput.commands[0].expectedRevision, revision);
  assert.equal(planInput.commands[0].mimeType, 'image/png'); assert.equal(planInput.commands[0].fileName, 'one.png');
  assert.equal(planInput.commands[1].cover.bytesBase64, undefined); assert.ok(planInput.commands[1].cover.uploadId);
  assert.equal(commands[0].bytesBase64, bytes.toString('base64'));
});

test('browser large ZIP preview replaces wire bytes with an owned upload ID', async () => {
  let final;
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 1, 1);
  const f = installUploadFixture((route, init) => { assert.equal(route, '/api/v1/exchange/20/preview'); final = init; return web({ id: randomUUID() }); });
  await browser.nativeRequest('/exchange/20/preview', { method: 'POST', body: bytes, headers: { 'Content-Type': 'application/zip' } });
  assert.equal(f.sent[0].kind, 'zip'); assert.equal(f.sent[0].targetId, 20); assert.equal(f.uploads.size, 1);
  assert.equal(new Headers(final.headers).get('content-type'), 'application/json'); assert.ok(JSON.parse(final.body).uploadId);
});

test('browser follows asynchronous apply to final receipt and retry retains the original plan and key', async () => {
  browser.configureNativeAuth(() => 'apply-token');
  const planId = randomUUID(), jobId = randomUUID(), applyKeys = [], commands = [{ action: 'update', targetId: 10, expectedRevision: revision, fields: { Title: 'Reviewed' } }];
  let previews = 0, polls = 0, failPoll = true;
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).pathname;
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer apply-token');
    if (route === '/api/v1/plans') { previews++; return web({ id: planId }); }
    if (route.endsWith('/apply')) { applyKeys.push(new Headers(init.headers).get('idempotency-key')); return web({ pending: true, job: { id: jobId, state: 'running' } }, 202, { 'Retry-After': '0.25' }); }
    assert.equal(route, `/api/v1/jobs/${jobId}`); polls++;
    if (failPoll) { failPoll = false; throw new Error('lost poll'); }
    return web({ ok: true, completed: [{ index: 0, result: { id: 10, revision } }] });
  };
  await assert.rejects(browser.applyNativeCommands(commands), error => error.transportFailure === true && error.recoverable === true && error.jobId === jobId);
  const result = await browser.applyNativeCommands(commands);
  assert.equal(result.ok, true); assert.equal(previews, 1); assert.equal(polls, 2); assert.equal(applyKeys.length, 2); assert.equal(applyKeys[0], applyKeys[1]);
  browser.acknowledgeNativeCommands(commands);
});

test('browser logout sends job cancellation with original headers before clearing caller state', async () => {
  let token = 'before-logout', canceledHeaders, polls = 0;
  const jobId = randomUUID(); browser.configureNativeAuth(() => token);
  globalThis.fetch = async (url, init) => {
    const route = new URL(url).pathname;
    if (route.endsWith('/cancel')) { canceledHeaders = new Headers(init.headers); assert.equal(init.method, 'POST'); return web({ canceled: true }); }
    if (route.endsWith('/apply')) {
      setTimeout(() => { token = undefined; browser.invalidateNativeSnapshots(); }, 20);
      return web({ pending: true, job: { id: jobId, state: 'running' } }, 202, { 'Retry-After': '0.25' });
    }
    polls++; throw new Error('must not poll after logout');
  };
  await assert.rejects(browser.nativeResponse(`/plans/${randomUUID()}/apply`, { method: 'POST', body: '{}', headers: { 'Idempotency-Key': randomUUID() } }), error => error.code === 'identity_changed');
  assert.equal(polls, 0); assert.equal(canceledHeaders.get('authorization'), 'Bearer before-logout');
  assert.equal(canceledHeaders.get('x-timeline-repository'), globalThis.__transferEnvironment.repositoryUrl);
});

test('browser native binary helper reconstructs download manifest and preserves final partial receipt errors', async () => {
  browser.configureNativeAuth(() => 'download-token');
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 8, 19), manifest = download(bytes);
  globalThis.fetch = async url => {
    const route = new URL(url).pathname;
    if (route.endsWith('/export')) return web({ download: manifest });
    const index = Number(route.split('/').at(-1)), part = bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
    return new Response(part, { headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': sha256(part) } });
  };
  const response = await browser.nativeResponse('/exchange/20/export');
  assert.equal(response.headers.get('content-type'), 'application/zip'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  const receipt = { ok: false, completed: [{ result: { id: 10 } }], uncertainTargets: [11], retrySamePlan: true, error: { code: 'partial', message: 'Write uncertain.' } };
  globalThis.fetch = async () => web(receipt, 409);
  await assert.rejects(browser.nativeResponse(`/plans/${randomUUID()}/apply`, { method: 'POST', body: '{}' }), error => error.applyResult?.uncertainTargets[0] === 11 && error.status === 409);
});

test('image GETs retain their caller signal across large downloads and reconstruct the exact original body', async () => {
  const previousFetch = globalThis.fetch, generation = randomUUID(), bytes = Buffer.alloc(3 * 1024 * 1024 + 31, 57);
  const paths = ['/content/8/cover', '/content/8/image-presentation', `/images/8/${generation}/w320`];
  browser.configureNativeAuth(() => 'image-read-token');
  try {
    for (const initial of paths.flatMap(route => [route, '/api/v1' + route])) {
      const controller = new AbortController(), manifest = download(bytes, { contentType: 'image/png', headers: {} }), routes = [];
      globalThis.fetch = async (url, init) => {
        const route = new URL(url).pathname; routes.push(route);
        assert.equal(init.signal, controller.signal, 'Both the initial read and every download chunk share the bounded image caller signal.');
        assert.equal(new Headers(init.headers).get('authorization'), 'Bearer image-read-token');
        assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error');
        if (routes.length === 1) return web({ download: manifest });
        const index = Number(route.split('/').at(-1)), part = bytes.subarray(index * CHUNK, (index + 1) * CHUNK);
        return new Response(part, { headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': sha256(part) } });
      };
      const response = await browser.nativeResponse(initial, { signal: controller.signal });
      assert.equal(response.headers.get('content-type'), 'image/png'); assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
      assert.deepEqual(routes, [initial.startsWith('/api/v1/') ? initial : '/api/v1' + initial, `/api/v1/downloads/${manifest.id}/chunks/0`, `/api/v1/downloads/${manifest.id}/chunks/1`]);
    }
  } finally { globalThis.fetch = previousFetch; browser.invalidateNativeSnapshots(); }
});

test('cancelling a large image GET aborts a waiting chunk body and never requests the next chunk, with either API path form', async () => {
  const previousFetch = globalThis.fetch, bytes = Buffer.alloc(3 * 1024 * 1024 + 31, 61);
  browser.configureNativeAuth(() => 'image-read-token');
  try {
    for (const initial of ['/content/8/cover', '/api/v1/content/8/cover']) {
      const controller = new AbortController(), manifest = download(bytes, { contentType: 'image/png', headers: {} }), routes = [];
      let readingBody, bodyAborted = false;
      const bodyStarted = new Promise(resolve => { readingBody = resolve; });
      globalThis.fetch = async (url, init) => {
        const route = new URL(url).pathname; routes.push(route);
        if (routes.length === 1) return web({ download: manifest });
        assert.equal(route, `/api/v1/downloads/${manifest.id}/chunks/0`); assert.equal(init.signal, controller.signal);
        const stream = new ReadableStream({ start(target) {
          init.signal.addEventListener('abort', () => { bodyAborted = true; target.error(init.signal.reason); }, { once: true });
        } });
        const response = new Response(stream, { headers: { 'Content-Type': 'application/octet-stream', 'X-Content-SHA256': sha256(bytes.subarray(0, CHUNK)) } });
        const readBody = response.arrayBuffer.bind(response);
        response.arrayBuffer = () => { readingBody(); return readBody(); };
        return response;
      };
      const reading = browser.nativeResponse(initial, { signal: controller.signal });
      const reason = new DOMException('The image attempt was cancelled.', 'AbortError'), rejected = assert.rejects(reading, error => error === reason);
      await bodyStarted; controller.abort(reason); await rejected;
      assert.equal(bodyAborted, true); assert.equal(routes.length, 2);
      assert.equal(routes.some(route => route.endsWith('/chunks/1')), false);
    }
  } finally { globalThis.fetch = previousFetch; browser.invalidateNativeSnapshots(); }
});

test('publication, upload, recovery and unrelated GET continuations retain their existing independent signals', async () => {
  const previousFetch = globalThis.fetch, bytes = Buffer.alloc(20, 3);
  browser.configureNativeAuth(() => 'unchanged-lifetime-token');
  try {
    for (const [initial, method] of [
      ['/images/drafts', 'POST'], [`/plans/${randomUUID()}/apply`, 'POST'], ['/uploads', 'POST'], ['/images/recovery', 'POST'],
      ['/exchange/20/export', 'GET'], ['/content/8/image-presentation/editor', 'GET'], ['/content/8/cover', 'POST'],
    ]) {
      const controller = new AbortController(), manifest = download(bytes), signals = [];
      globalThis.fetch = async (_url, init) => {
        signals.push(init.signal);
        if (signals.length === 1) { assert.equal(init.signal, controller.signal); return web({ download: manifest }); }
        assert.notEqual(init.signal, controller.signal, 'Only allowlisted initial image GETs inherit their caller lifetime into continuations.');
        controller.abort(); assert.equal(init.signal.aborted, false);
        return new Response(bytes, { headers: { 'X-Content-SHA256': sha256(bytes) } });
      };
      const response = await browser.nativeResponse(initial, { method, signal: controller.signal, ...(method === 'POST' ? { body: '{}' } : {}) });
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes); assert.equal(signals.length, 2);
    }
  } finally { globalThis.fetch = previousFetch; browser.invalidateNativeSnapshots(); }
});
