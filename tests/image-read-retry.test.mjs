import test from 'node:test';
import assert from 'node:assert/strict';
import { imageReadRetryModuleUrl } from './helpers/image-read-retry-module.mjs';
const { readImage, ImageReadFailure } = await import(imageReadRetryModuleUrl);
const options = extra => ({ signal: new AbortController().signal, retryDelayMs: 0, ...extra });

test('an explicit image read retries a gateway failure once and retains the successful body', async () => {
  let calls = 0;
  const blob = new Blob(['original']);
  const result = await readImage(async () => { if (++calls === 1) throw Object.assign(Error('Cloudflare'), { status: 520 }); return blob; }, options());
  assert.equal(result, blob); assert.equal(calls, 2);
  await new Promise(resolve => setTimeout(resolve, 15)); assert.equal(calls, 2, 'There is no later refresh or polling.');
});

test('permission, identity, validation and conflict failures are never retried', async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 429]) {
    let calls = 0; const error = Object.assign(Error('denied'), { status });
    await assert.rejects(readImage(async () => { calls++; throw error; }, options()), value => value === error);
    assert.equal(calls, 1);
  }
  let sent = 0;
  await assert.rejects(readImage(async () => { sent++; }, options({ assertContext: () => { throw Error('identity changed'); } })), /identity changed/);
  assert.equal(sent, 0);
  for (const error of [Object.assign(Error('invalid metadata'), { status: 502, code: 'native_response_invalid' }), Object.assign(Error('contract'), { status: 503, code: 'backend_contract' }), Object.assign(Error('denied'), { status: 403, transportFailure: true })]) {
    let calls = 0; await assert.rejects(readImage(async () => { calls++; throw error; }, options()), value => value === error); assert.equal(calls, 1);
  }
});

test('a caller signal does not disable the body deadline and hung reads release after two attempts', async () => {
  const signals = [];
  await assert.rejects(readImage(signal => { signals.push(signal); return new Promise(() => {}); }, options({ timeoutMs: 8 })), error => error instanceof ImageReadFailure && error.status === 504);
  assert.equal(signals.length, 2); assert.ok(signals.every(signal => signal.aborted));
});

test('abort and identity changes stop the retry, including an interrupted response body', async () => {
  const controller = new AbortController(); let count = 0;
  await assert.rejects(readImage(async () => { count++; controller.abort(); throw Object.assign(Error('gateway'), { status: 520 }); }, options({ signal: controller.signal })), { name: 'AbortError' });
  assert.equal(count, 1);
  let identity = 'a'; count = 0;
  await assert.rejects(readImage(async () => { count++; identity = 'b'; throw new TypeError('socket closed during body'); }, options({ assertContext: () => { if (identity !== 'a') throw Error('identity changed'); } })), /identity changed/);
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(readImage(async () => { count++; throw new TypeError('socket closed during body'); }, options()), error => error instanceof ImageReadFailure && error.status === 503);
  assert.equal(count, 2);
});
