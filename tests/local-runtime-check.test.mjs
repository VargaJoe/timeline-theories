import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLocalRuntime } from '../scripts/local-runtime-check.mjs';

const capabilities = { version: '1', basePath: '/api/v1', operations: [], repository: 'https://localhost:41016', authority: 'https://localhost:41017', project: '/Root/Content/timelines' };
const success = async url => ({ status: 200, value: url.includes('/capabilities') ? capabilities : url.includes('openid-configuration') ? { issuer: 'https://localhost:41017' } : { d: { Id: 1162 } } });

test('one-shot M0 diagnosis checks actual content as well as app and discovery, with no credentials', async () => {
  const calls = [];
  const result = await checkLocalRuntime({}, async url => { calls.push(url); return success(url); });
  assert(result.every(row => row.ok)); assert.equal(calls.length, 3);
  assert(calls.every(url => /^https:\/\/localhost:(8080|41016|41017)\//.test(url)));
  assert(calls.every(url => !/HasPermission|Save|Delete|AddNew|GetCurrentUser/i.test(url)));
  assert(calls.some(url => url.endsWith("Content('timelines')?$select=Id&metadata=no")));
});

test('a healthy app cannot conceal an unavailable content dependency', async () => {
  const result = await checkLocalRuntime({}, async url => {
    if (url.includes(':41016/')) throw new Error('private error details');
    return success(url);
  });
  assert.deepEqual(result.map(row => row.ok), [true, false, true]);
  assert(!JSON.stringify(result).includes('private error details'));
});

test('foreign targets and non-M0 modes send no diagnostic requests', async () => {
  let calls = 0;
  for (const environment of [{ TIMELINE_DOCKER_PROFILE: 'development' }, { VITE_SENSENET_REPO_URL: 'https://foreign.example' }, { VITE_OIDC_AUTHORITY: 'https://other.example' }, { VITE_PROJECT_ROOT_PATH: '/Root/Content/other' }]) {
    await assert.rejects(checkLocalRuntime(environment, async () => { calls++; }), /restricted/);
  }
  assert.equal(calls, 0);
});

test('wrong target descriptors, malformed JSON objects and HTTP errors fail diagnosis', async () => {
  for (const probe of [async () => ({ status: 503, value: {} }), async () => ({ status: 200, value: {} }), async url => ({ ...(await success(url)), ...(url.includes('/capabilities') ? { value: { ...capabilities, project: '/Root/Content/other' } } : {}) })]) {
    const result = await checkLocalRuntime({}, probe);
    assert(result.some(row => !row.ok));
  }
});
