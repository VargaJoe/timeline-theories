import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from '../client/node_modules/typescript/lib/typescript.js';

globalThis.window = { location: { origin: 'https://image-recovery.fixture.invalid' } };
globalThis.__imageRecoveryEnvironment = { repositoryUrl: 'https://repo.fixture.invalid', authority: 'https://auth.fixture.invalid', projectRoot: '/Root/Fixture', writable: true };
const source = fs.readFileSync(new URL('../client/services/nativeApi.ts', import.meta.url), 'utf8')
  .replace("import { environment } from '../configuration';", 'const environment=globalThis.__imageRecoveryEnvironment;');
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
let fixtureId = 0;
async function fixture(send) {
  const native = await import(compile(source + '\n// image recovery transport fixture ' + ++fixtureId));
  native.configureNativeAuth(() => 'fixture-backend-token');
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer fixture-backend-token');
    assert.equal(headers.get('x-timeline-repository'), globalThis.__imageRecoveryEnvironment.repositoryUrl);
    assert.equal(headers.get('x-timeline-project'), globalThis.__imageRecoveryEnvironment.projectRoot);
    assert.equal(headers.get('x-timeline-authority'), globalThis.__imageRecoveryEnvironment.authority);
    assert.equal(headers.get('x-timeline-client-origin'), window.location.origin);
    assert.equal(init.redirect, 'error'); assert.equal(init.credentials, 'omit');
    const path = new URL(url).pathname;
    calls.push({ path, init });
    return send(path, init, calls.length);
  };
  return { native, calls };
}
const web = (value, status = 409, headers = {}) => Response.json(value, { status, headers });
const pending = operationId => ({ operationId, pending: true, repositoryWrites: 0 });
const request = operationId => ({ method: 'POST', body: JSON.stringify({ operationId }), headers: { 'Idempotency-Key': 'exact-recovery-key' } });

test('the actual browser transport returns only an opted-in exact pending image recovery and preserves its body', async () => {
  const operationId = randomUUID(), stoppedRequestId = randomUUID();
  const payloads = [pending(operationId), { ...pending(operationId), confirmed: false, error: { code: 'uncertain_image_mutation', message: 'Unconfirmed native completion.' } },
    { ...pending(operationId), stoppedRequestId, operatorMustConfirmStopped: true, outcome: 'confirmed', result: { setId: 42 } },
    { ...pending(operationId), stoppedRequestId, notPrepared: true, operatorMustConfirmStopped: true }];
  const f = await fixture(() => web(payloads.shift()));
  for (let index = 0; index < 4; index++) {
    const response = await f.native.nativeResponse('/images/recovery', request(operationId), { pendingImageRecoveryId: operationId });
    assert.equal(response.status, 409); assert.equal(response.bodyUsed, false);
    const body = await response.json();
    assert.equal(body.operationId, operationId); assert.equal(body.pending, true); assert.equal(body.repositoryWrites, 0);
  }
  assert.equal(f.calls.length, 4); assert.ok(f.calls.every(call => call.path === '/api/v1/images/recovery'));
});

test('pending recovery opt-in never changes default, foreign route, method, status or malformed response handling', async () => {
  const operationId = randomUUID(), expected = pending(operationId);
  const cases = [
    { options: undefined },
    { options: { pendingImageRecoveryId: randomUUID() } },
    { options: { pendingImageRecoveryId: 'not-a-uuid' } },
    { path: '/api/v1/images/recovery' },
    { path: '/images/drafts' },
    { init: { method: 'GET' } },
    { status: 400 }, { status: 403 }, { status: 500 }, { status: 504 },
    { body: { ...expected, operationId: randomUUID() } },
    { body: { ...expected, operationId: 'not-a-uuid' } },
    { body: { ...expected, pending: false } },
    { body: { ...expected, pending: 'true' } },
    { body: { ...expected, repositoryWrites: 1 } },
    { body: { ...expected, repositoryWrites: '0' } },
    { body: { operationId, pending: true } },
    { body: { ...expected, confirmed: true } },
    { body: { ...expected, notPrepared: false } },
    { body: { ...expected, operatorMustConfirmStopped: 'true' } },
    { body: { ...expected, stoppedRequestId: 'foreign-request' } },
    { body: { ...expected, outcome: ['unknown'] } },
    { body: { ...expected, result: [] } },
    { body: { ...expected, error: 'foreign error' } },
    { body: { ...expected, error: { code: 'foreign', message: 'Foreign error', status: 409 } } },
    { body: { ...expected, error: { message: 'Missing code' } } },
    { body: { ...expected, abandoned: true } },
    { body: { ...expected, type: 'https://problem.fixture.invalid', title: 'Foreign problem', status: 409 } },
    { body: { ...expected, cloudflare_error: true, error_code: 409 } },
    { body: [expected] }, { body: null },
    { raw: 'not json', contentType: 'application/json' },
    { raw: JSON.stringify(expected), contentType: 'text/html' },
    { raw: JSON.stringify(expected), contentType: 'text/html; application/json' },
  ];
  const f = await fixture(() => { throw new Error('Each negative case supplies its own response.'); });
  for (const value of cases) {
    globalThis.fetch = async () => value.raw !== undefined
      ? new Response(value.raw, { status: value.status ?? 409, headers: { 'Content-Type': value.contentType } })
      : web(Object.hasOwn(value, 'body') ? value.body : expected, value.status ?? 409);
    await assert.rejects(f.native.nativeResponse(value.path ?? '/images/recovery', value.init ?? request(operationId),
      Object.hasOwn(value, 'options') ? value.options : { pendingImageRecoveryId: operationId }),
    error => error instanceof f.native.NativeApiError && error.status >= 400);
  }
  globalThis.fetch = async () => web(expected);
  await assert.rejects(f.native.nativeRequest('/images/recovery', request(operationId)), error => error instanceof f.native.NativeApiError);
});

test('Cloudflare upstream problems remain transport failures with recovery opt-in and successful recovery stays ordinary', async () => {
  const operationId = randomUUID(), problem = { ...pending(operationId), cloudflare_error: true, status: 502, error_code: 502,
    type: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-502/' };
  const f = await fixture(() => web(problem, 502));
  await assert.rejects(f.native.nativeResponse('/images/recovery', request(operationId), { pendingImageRecoveryId: operationId }),
    error => error.code === 'native_gateway_upstream_error' && error.transportFailure === true && error.details.uncertain === true);
  const confirmed = { operationId, confirmed: true, pending: false, repositoryWrites: 0, result: { setId: 42 } };
  globalThis.fetch = async () => web(confirmed, 200);
  assert.deepEqual(await (await f.native.nativeResponse('/images/recovery', request(operationId), { pendingImageRecoveryId: operationId })).json(), confirmed);
});

test('an image metadata job retains its exact recovery reference on a real poll network failure', async () => {
  const jobId = randomUUID(), operationId = randomUUID(), stoppedRequestId = randomUUID();
  for (const path of ['/images/drafts', '/images/drafts/42/seal', '/images/drafts/42/delete']) {
    const f = await fixture((_path, _init, count) => {
      if (count === 1) return web({ job: { id: jobId, state: 'running' }, pending: true, recovery: { operationId, stoppedRequestId, requiresStoppedConfirmation: true } }, 202, { 'Retry-After': '0' });
      throw new TypeError('Poll connection lost');
    });
    await assert.rejects(f.native.nativeResponse(path, { method: 'POST', body: '{}' }), error => {
      assert.equal(error.code, 'native_gateway_unavailable'); assert.equal(error.transportFailure, true);
      assert.equal(error.jobId, jobId); assert.equal(error.recoverable, true);
      assert.deepEqual(error.details, { operationId, stoppedRequestId, uncertain: true }); return true;
    });
    assert.deepEqual(f.calls.map(call => call.path), ['/api/v1' + path, '/api/v1/jobs/' + jobId]);
  }
});

test('an image job deadline preserves recovery while unrelated routes and malformed references cannot lend it', async t => {
  const jobId = randomUUID(), operationId = randomUUID(), stoppedRequestId = randomUUID();
  const recovery = { operationId, stoppedRequestId, requiresStoppedConfirmation: true };
  for (const value of [
    { path: '/images/drafts', recovery, expected: true },
    { path: '/plans', recovery },
    { path: '/images/drafts/42/variants/w400', recovery },
    { path: '/images/drafts', recovery: { ...recovery, operationId: 'foreign' } },
    { path: '/images/drafts', recovery: { ...recovery, stoppedRequestId: 'foreign' } },
    { path: '/images/drafts', recovery: { ...recovery, requiresStoppedConfirmation: false } },
  ]) {
    const f = await fixture(() => web({ job: { id: jobId, state: 'running' }, pending: true, recovery: value.recovery }, 202));
    let nowCalls = 0;
    const clock = t.mock.method(Date, 'now', () => nowCalls++ ? 15 * 60 * 1000 : 0);
    try {
      await assert.rejects(f.native.nativeResponse(value.path, { method: 'POST', body: '{}' }), error => {
        assert.equal(error.code, 'native_job_pending'); assert.equal(error.jobId, jobId); assert.equal(error.recoverable, true);
        assert.deepEqual(error.details, value.expected ? { operationId, stoppedRequestId, uncertain: true } : undefined); return true;
      });
      assert.equal(f.calls.length, 1, 'An expired poll budget never dispatches another HTTP request');
    } finally { clock.mock.restore(); }
  }
});

test('pending image descriptors cannot switch the bound job or its saved recovery reference', async () => {
  const jobId = randomUUID(), operationId = randomUUID(), stoppedRequestId = randomUUID();
  for (const change of ['job', 'operation', 'request']) {
    const f = await fixture((_path, _init, count) => web({ job: { id: count > 1 && change === 'job' ? randomUUID() : jobId, state: 'running' }, pending: true,
      recovery: { operationId: count > 1 && change === 'operation' ? randomUUID() : operationId, stoppedRequestId: count > 1 && change === 'request' ? randomUUID() : stoppedRequestId, requiresStoppedConfirmation: true } }, 202, { 'Retry-After': '0' }));
    await assert.rejects(f.native.nativeResponse('/images/drafts', { method: 'POST', body: '{}' }), error => error.code === 'native_job_invalid');
    assert.equal(f.calls.length, 2);
  }
});
