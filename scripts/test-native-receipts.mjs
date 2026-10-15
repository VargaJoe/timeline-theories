import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

// Exercises the real browser transport/plan code; effects are bounded fake HTTP responses.
globalThis.window = { location: { origin: 'https://ui.test' } };
const source = fs.readFileSync(new URL('../client/services/nativeApi.ts', import.meta.url), 'utf8')
  .replace("import { environment } from '../configuration';", "const environment={repositoryUrl:'https://repo.test',authority:'https://auth.test',projectRoot:'/Root/Content/timelines',writable:true,mode:'m0-local'};")
  .replace('import.meta.env.VITE_NATIVE_API_URL', 'undefined');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const native = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
let checks = 0;
async function test(name, run) {
  native.configureNativeAuth(() => 'test-backend-token');
  await run(); checks++; process.stdout.write('PASS ' + name + '\n');
}

await test('uncertain HTTP409 retains recovery receipt and exact status/code/source', async () => {
  const receipt = { ok: false, completed: [], notApplied: [1], touchedIds: [42], uncertainTargets: [42], retrySamePlan: true,
    error: { code: 'backend_write_uncertain', message: 'Outcome uncertain', source: 'repository', retryAfter: 2 } };
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init.headers).get('X-Timeline-Client-Origin'), 'https://ui.test');
    return response(receipt, 409);
  };
  await assert.rejects(native.nativeRequest('/plans/plan-one/apply', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.status, 409); assert.equal(error.code, 'backend_write_uncertain'); assert.equal(error.source, 'repository'); assert.equal(error.retryAfter, 2);
    assert.deepEqual(error.applyResult, receipt); return true;
  });
});
await test('HTTP403 partial receipt preserves the completed exact content target', async () => {
  const receipt = { ok: false, completed: [{ index: 0, result: { id: 42, revision: 'gw:opaque-hash' } }], notApplied: [1],
    error: { code: 'permission_denied', message: 'Later target denied' } };
  globalThis.fetch = async () => response(receipt, 403);
  await assert.rejects(native.nativeRequest('/plans/plan-one/apply', { method: 'POST', body: '{}' }), error => {
    assert.equal(error.status, 403); assert.equal(error.code, 'permission_denied'); assert.deepEqual(error.applyResult, receipt); return true;
  });
});
await test('malformed error receipts cannot masquerade as completed/recoverable writes', async () => {
  for (const changes of [{ completed: [{ result: { id: '42' } }] }, { completed: [{ result: [] }] }, { touchedIds: [0] }, { retrySamePlan: 'yes' }]) {
    globalThis.fetch = async () => response({ ok: false, completed: [], ...changes, error: { code: 'permission_denied' } }, 403);
    await assert.rejects(native.nativeRequest('/plans/plan-one/apply', { method: 'POST', body: '{}' }), error => {
      assert.equal(error.status, 403); assert.equal(error.applyResult, undefined); return true;
    });
  }
});
await test('a non-apply error never attaches a write receipt', async () => {
  globalThis.fetch = async () => response({ ok: false, completed: [], error: { code: 'permission_denied' } }, 403);
  await assert.rejects(native.nativeRequest('/lookup', { method: 'POST', body: '{}' }), error => error.status === 403 && error.applyResult === undefined);
});
await test('retry after uncertain HTTP409 reuses the same plan and idempotency key', async () => {
  const requests = [], keys = [];
  let attempts = 0;
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname; requests.push(path);
    if (path === '/api/v1/plans') return response({ id: 'plan-retry' });
    assert.equal(path, '/api/v1/plans/plan-retry/apply'); keys.push(new Headers(init.headers).get('Idempotency-Key'));
    return ++attempts === 1 ? response({ ok: false, completed: [], touchedIds: [42], uncertainTargets: [42], retrySamePlan: true,
      error: { code: 'backend_write_uncertain', message: 'Outcome uncertain' } }, 409) : response({ ok: true, completed: [{ result: { id: 42, revision: 'gw:next' } }] });
  };
  const commands = [{ action: 'update', targetId: 42, expectedRevision: 'gw:previous', fields: { Notes: 'Approved exact notes' } }];
  await assert.rejects(native.applyNativeCommands(commands), error => error.applyResult?.retrySamePlan === true);
  assert.equal((await native.applyNativeCommands(commands)).ok, true);
  assert.equal(requests.filter(path => path === '/api/v1/plans').length, 1); assert.ok(keys[0]); assert.equal(keys[0], keys[1]);
  native.acknowledgeNativeCommands(commands);
});
await test('malformed HTTP207 apply receipt fails closed before success or partial reporting', async () => {
  globalThis.fetch = async url => new URL(url).pathname === '/api/v1/plans' ? response({ id: 'plan-invalid' }) : response({ ok: false, completed: [{ result: { id: -1 } }] }, 207);
  await assert.rejects(native.applyNativeCommands([{ action: 'update', targetId: 42, fields: { Notes: 'Never claim applied' } }]),
    error => error.status === 502 && error.code === 'native_receipt_invalid' && error.applyResult === undefined);
});
process.stdout.write(JSON.stringify({ passed: true, checks }) + '\n');
