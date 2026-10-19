import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
let fixtureCount = 0;
async function fixture({ mode = 'production', discovery = 'html', lookupError, readOnly = false, readAllowed = true, writeAllowed = true, token = 'fixture-backend-jwt' } = {}) {
  const environment = { mode, repositoryUrl: 'https://repo.test', authority: 'https://auth.test', projectRoot: '/Root/Content/timelines', writable: true };
  globalThis.window = { location: { origin: 'https://ui.test' } };
  globalThis.__availabilityEnvironment = environment;
  const rawCalls = [], rawWrites = [], aclCalls = [], childTypeCalls = [], nativeCalls = [];
  const snapshot = id => ({ Id: id, ParentId: 5, Name: 'media' + id, Path: environment.projectRoot + '/MediaLibrary/media' + id,
    Type: 'MediaItem', revision: 'gw:fixture-hash:4', Title: 'Native title', DisplayName: 'Native title', Description: '' });
  const capabilities = () => ({ repository: environment.repositoryUrl, authority: environment.authority, project: environment.projectRoot,
    readOnly, operations: ['lookup', 'snapshots', 'plans', 'plans/{id}/apply'], backendProtocolRequired: 'gateway-coordinated-v1' });
  globalThis.fetch = async (url, init) => {
    const path = new URL(url).pathname; nativeCalls.push({ path, init });
    const headers = new Headers(init.headers);
    assert.equal(headers.get('X-Timeline-Repository'), environment.repositoryUrl);
    assert.equal(headers.get('X-Timeline-Authority'), environment.authority);
    assert.equal(headers.get('X-Timeline-Project'), environment.projectRoot);
    assert.equal(headers.get('X-Timeline-Client-Origin'), window.location.origin);
    assert.equal(init.redirect, 'error');
    if (path.endsWith('/capabilities')) {
      if (discovery === 'html') return new Response('<!doctype html><main>Public site</main>', { headers: { 'Content-Type': 'text/html' } });
      if (discovery === '404') return response({ code: 'route_unavailable', message: 'Route unavailable' }, 404);
      if (discovery === 'tls') throw new TypeError('fetch failed: certificate verification');
      if (discovery === '401' || discovery === '403') return response({ code: 'permission_denied', message: 'Denied' }, Number(discovery));
      if (discovery === 'mismatch') return response({ ...capabilities(), project: '/Root/Content/another' });
      if (discovery === 'protocol-mismatch') return response({ ...capabilities(), backendProtocolRequired: 'another-coordinator' });
      if (discovery === 'invalid') return new Response('not json', { headers: { 'Content-Type': 'application/json' } });
      if (discovery === 'unavailable') return response({ code: 'native_gateway_unavailable', message: 'Not started' }, 503);
      return response(capabilities());
    }
    if (lookupError) return response({ code: lookupError.code, message: 'Lookup unavailable or denied' }, lookupError.status);
    if (path.endsWith('/lookup')) { const body = JSON.parse(init.body); return response({ data: snapshot(typeof body.target === 'string' && body.target.startsWith('/Root/') ? 1 : Number(body.target)) }); }
    if (path.endsWith('/snapshots')) return response({ data: JSON.parse(init.body).ids.map(snapshot) });
    throw new Error('Unexpected native write');
  };
  class MockRepository {
    constructor() {
      this.configuration = { repositoryUrl: environment.repositoryUrl, token: token || undefined };
      this.security = { hasPermission: async (target, permissions) => {
        aclCalls.push({ target, permissions, token: this.configuration.token }); return permissions.includes('Open') ? readAllowed : writeAllowed;
      } };
      this.allowedChildTypes = { get: async target => { childTypeCalls.push(target); return { d: { results: [{ Name: 'MediaItem' }] } }; } };
    }
    async awaitReadyState() {}
    async fetch(url, init = {}) {
      rawCalls.push({ url, method: init.method || 'GET', token: this.configuration.token });
      if (!readAllowed) return response({ error: 'Forbidden' }, 403);
      const value = { ...snapshot(1), revision: undefined, Title: 'Raw permitted title', DisplayName: 'Raw permitted title' };
      return response({ d: new URL(url).searchParams.has('query') ? { results: [value] } : value });
    }
    async load(options) {
      return (await this.fetch(environment.repositoryUrl + '/odata.svc/content(' + options.idOrPath + ')?$select=' + (options.oDataOptions?.select || []).join(',') + '&$top=1000', { method: 'GET' })).json();
    }
    async loadCollection(options) {
      return (await this.fetch(environment.repositoryUrl + '/odata.svc' + options.path + '?query=TypeIs%3AMediaItem&$top=100', { method: 'GET' })).json();
    }
    async patch(options) {
      rawWrites.push({ action: 'update', options });
      return (await this.fetch(environment.repositoryUrl + '/odata.svc/content(' + options.idOrPath + ')', { method: 'PATCH', body: JSON.stringify(options.content) })).json();
    }
    async post(options) { rawWrites.push({ action: 'create', options }); throw new Error('Unexpected raw write'); }
    async delete(options) { rawWrites.push({ action: 'delete', options }); throw new Error('Unexpected raw write'); }
  }
  globalThis.__availabilityRepository = MockRepository;
  const nonce = '\n// availability fixture ' + ++fixtureCount;
  const nativeSource = read('client/services/nativeApi.ts')
    .replace("import { environment } from '../configuration';", 'const environment=globalThis.__availabilityEnvironment;')
    .replace('import.meta.env.VITE_NATIVE_API_URL', 'undefined');
  const nativeUrl = compile(nativeSource + nonce);
  const native = await import(nativeUrl);
  const senseSource = read('client/services/sensenet.ts')
    .replace("import { Repository } from '@sensenet/client-core';", 'const Repository=globalThis.__availabilityRepository;')
    .replace("import { repositoryUrl, environment } from '../configuration';", 'const environment=globalThis.__availabilityEnvironment;const repositoryUrl=environment.repositoryUrl;')
    .replace("from './operationGuard.mjs'", 'from ' + JSON.stringify(new URL('client/services/operationGuard.mjs', root).href))
    .replace("from '../domain/content.mjs'", 'from ' + JSON.stringify(new URL('client/domain/content.mjs', root).href))
    .replace("from './nativeApi'", 'from ' + JSON.stringify(nativeUrl));
  const sense = await import(compile(senseSource + nonce));
  const load = () => sense.repository.load({ idOrPath: 1, oDataOptions: { select: ['Id', 'Title', 'DisplayName'] } });
  return { native, sense, load, rawCalls, rawWrites, aclCalls, childTypeCalls, nativeCalls, environment };
}
let checks = 0;
async function test(name, run) { await run(); checks++; process.stdout.write('PASS ' + name + '\n'); }
async function main() {
  const writeOperations = ['update', 'create', 'upload', 'delete'].map(action => ({ target: 1, action, ...(action === 'create' ? { contentType: 'MediaItem' } : {}) }));
  for (const operation of writeOperations) await test('anonymous ' + operation.action + ' checks stop before all readiness, ACL and write requests', async () => {
    const f = await fixture({ discovery: 'ready', token: '' });
    assert.equal(await f.sense.canOperations([operation]), false);
    await assert.rejects(f.sense.assertOperations([operation]), /Permission denied/);
    const dispatch = {
      update: () => f.sense.repository.patch({ idOrPath: 1, content: { Title: 'No write' } }),
      create: () => f.sense.repository.post({ parentPath: 1, contentType: 'MediaItem', content: { Title: 'No write' } }),
      upload: () => f.sense.uploadBinary(1, f.environment.repositoryUrl + '/odata.svc/content(5)/upload', new FormData()),
      delete: () => f.sense.repository.delete({ idOrPath: 1 }),
    };
    await assert.rejects(dispatch[operation.action](), /Permission denied/);
    assert.equal(f.nativeCalls.length, 0);
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.childTypeCalls.length, 0);
    assert.equal(f.rawCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('anonymous Open proves the exact backend GET and retains native snapshot reads', async () => {
    const f = await fixture({ discovery: 'ready', token: '' });
    assert.equal((await f.load()).d.Title, 'Native title');
    assert.equal(f.rawCalls.length, 2);
    assert.equal(new URL(f.rawCalls[0].url).pathname, '/odata.svc/content(1)');
    assert.equal(new URL(f.rawCalls[0].url).searchParams.get('$select'), 'Id');
    assert.ok(f.rawCalls.every(call => call.method === 'GET' && call.token === undefined));
    assert.ok(f.nativeCalls.some(call => call.path.endsWith('/lookup')));
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.childTypeCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('anonymous permitted collection reads retain native batch snapshots', async () => {
    const f = await fixture({ discovery: 'ready', token: '' });
    const result = await f.sense.repository.loadCollection({ path: '/Root/Content/timelines/MediaLibrary' });
    assert.equal(result.d.results[0].Title, 'Native title');
    assert.ok(f.nativeCalls.some(call => call.path.endsWith('/snapshots')));
    assert.ok(f.rawCalls.every(call => call.method === 'GET' && call.token === undefined));
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('anonymous Open fails closed when the exact backend GET is denied', async () => {
    const f = await fixture({ discovery: 'ready', token: '', readAllowed: false });
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'read' }]), false);
    await assert.rejects(f.load(), /Permission denied/);
    assert.ok(f.rawCalls.every(call => call.method === 'GET' && new URL(call.url).searchParams.get('$select') === 'Id'));
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  for (const writeAllowed of [true, false]) await test('authenticated write checks preserve backend ACL ' + (writeAllowed ? 'approval' : 'denial'), async () => {
    const f = await fixture({ discovery: 'ready', writeAllowed });
    for (const operation of writeOperations) {
      assert.equal(await f.sense.canOperations([operation]), writeAllowed);
      if (writeAllowed) await f.sense.assertOperations([operation]);
      else await assert.rejects(f.sense.assertOperations([operation]), /Permission denied/);
    }
    assert.deepEqual(f.aclCalls.map(call => call.permissions), [['Save'], ['Save'], ['AddNew'], ['AddNew'], ['Save'], ['Save'], ['Delete'], ['Delete']]);
    assert.ok(f.aclCalls.every(call => call.token === 'fixture-backend-jwt'));
    assert.ok(f.nativeCalls.some(call => call.path.endsWith('/lookup')));
    assert.equal(f.childTypeCalls.length, writeAllowed ? 2 : 0);
    assert.equal(f.rawCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  for (const discovery of ['html', '404', 'unavailable']) await test('ordinary reads remain available for confirmed ' + discovery + ' gateway absence', async () => {
    const f = await fixture({ discovery }); assert.equal((await f.load()).d.Title, 'Raw permitted title');
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    await assert.rejects(f.sense.repository.patch({ idOrPath: 1, content: { Title: 'No write' } }));
    assert.ok(f.rawCalls.every(call => call.method === 'GET' && call.token === 'fixture-backend-jwt'));
    assert.ok(f.aclCalls.every(call => call.permissions.includes('Open')));
  });
  await test('collection reads preserve raw permitted content when gateway is absent', async () => {
    const f = await fixture(); const data = await f.sense.repository.loadCollection({ path: '/Root/Content/timelines/MediaLibrary' });
    assert.equal(data.d.results[0].Title, 'Raw permitted title'); assert.ok(f.rawCalls.every(call => call.method === 'GET'));
  });
  for (const discovery of ['401', '403', 'mismatch', 'protocol-mismatch', 'tls', 'invalid']) await test(discovery + ' discovery failure never falls back to raw content', async () => {
    const f = await fixture({ discovery }); await assert.rejects(f.load()); assert.equal(f.rawCalls.length, 0);
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
  });
  for (const lookupError of [{ status: 401, code: 'grant_revoked' }, { status: 403, code: 'permission_denied' }, { status: 404, code: 'target_unavailable' }]) {
    await test(lookupError.code + ' target failure never permits fallback', async () => {
      const f = await fixture({ discovery: 'ready', lookupError }); await assert.rejects(f.load(), error => error.code === lookupError.code);
      assert.equal(f.rawCalls.length, 0);
    });
  }
  await test('confirmed gateway outage preserves ordinary reads and disables writes', async () => {
    const f = await fixture({ discovery: 'ready', lookupError: { status: 503, code: 'native_gateway_unavailable' } });
    assert.equal((await f.load()).d.Title, 'Raw permitted title'); assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    assert.ok(f.aclCalls.every(call => call.permissions.includes('Open')));
  });
  await test('a backend capability error is not evidence of an absent application gateway', async () => {
    const f = await fixture({ discovery: 'ready', lookupError: { status: 503, code: 'backend_capability_unavailable' } });
    await assert.rejects(f.load(), error => error.code === 'backend_capability_unavailable'); assert.equal(f.rawCalls.length, 0);
  });
  for (const discovery of ['html', '404', 'unavailable']) await test('M0 requires its gateway for ' + discovery + ' absence', async () => {
    const f = await fixture({ mode: 'm0-local', discovery }); await assert.rejects(f.load()); assert.equal(f.rawCalls.length, 0);
  });
  await test('M0 confirmed gateway outage also remains fail closed', async () => {
    const f = await fixture({ mode: 'm0-local', discovery: 'ready', lookupError: { status: 503, code: 'native_gateway_unavailable' } });
    await assert.rejects(f.load()); assert.equal(f.rawCalls.length, 0);
  });
  await test('ready gateway retains native revision scalar data', async () => {
    const f = await fixture({ discovery: 'ready' }); const data = await f.load();
    assert.equal(data.d.Title, 'Native title'); assert.equal(data.d.revision, 'gw:fixture-hash:4');
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), true);
    assert.ok(f.aclCalls.some(call => call.permissions.includes('Save')));
  });
  await test('quoted exact SDK reads with default top retain their pre-read revision baseline', async () => {
    const f = await fixture({ discovery: 'ready' });
    const result = await f.sense.repository.fetch('https://repo.test/odata.svc/Root/Content/timelines/MediaLibrary/(\'media1\')?$select=Id,Title&$top=1000');
    const content = (await result.json()).d;
    assert.equal(content.revision, 'gw:fixture-hash:4'); assert.equal(content.Title, 'Native title');
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
    assert.ok(!f.nativeCalls.some(call => call.path.endsWith('/snapshots')));
  });
  await test('read-only gateway rejects Save before the backend Save ACL probe', async () => {
    const f = await fixture({ discovery: 'ready', readOnly: true }); assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    assert.equal(f.aclCalls.length, 0);
  });
  await test('discovery is cached across concurrent reads and invalidated on identity change', async () => {
    const f = await fixture(); await Promise.all([f.load(), f.load()]);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 1);
    f.sense.setRepositoryAccessToken('fixture-other-jwt'); await f.load();
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 2);
    f.sense.setRepositoryAccessToken(''); await f.load();
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 3);
  });
  await test('an absent gateway never bypasses the real read ACL', async () => {
    const f = await fixture({ readAllowed: false }); await assert.rejects(f.load(), /Permission denied/); assert.equal(f.rawCalls.length, 0);
  });
  await test('cache refresh cannot replace an explicit editor revision', async () => {
    const f = await fixture({ discovery: 'ready', mode: 'm0-local' });
    const editor = (await f.load()).d;
    const loaded = f.native.cachedNativeSnapshot(1), previousFetch = globalThis.fetch, plans = [], applies = [];
    let latestRevision = 'gw:unrelated-read:5';
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      if (path.endsWith('/lookup')) return response({ data: { ...loaded, revision: latestRevision } });
      if (path === '/api/v1/plans') {
        const command = JSON.parse(init.body).commands[0]; plans.push(command);
        if (command.expectedRevision !== latestRevision) return response({ code: 'revision_conflict', message: 'The edited content changed.' }, 409);
        return response({ id: 'pinned-update' });
      }
      if (path === '/api/v1/plans/pinned-update/apply') {
        applies.push(path); latestRevision = 'gw:approved-save:6';
        return response({ ok: true, completed: [{ result: { id: 1, revision: latestRevision } }] });
      }
      return previousFetch(url, init);
    };
    await f.native.nativeSnapshot(1, { refresh: true });
    assert.equal(f.native.cachedNativeSnapshot(1).revision, 'gw:unrelated-read:5');
    await assert.rejects(f.sense.patchContentWithRevision(1, { Description: 'Approved editor field' }, editor.revision),
      error => error.code === 'revision_conflict' && error.status === 409);
    assert.equal(plans[0].expectedRevision, 'gw:fixture-hash:4'); assert.equal(applies.length, 0);
    const saved = await f.sense.patchContentWithRevision(1, { Description: 'Approved editor field' }, 'gw:unrelated-read:5');
    assert.equal(saved.d.revision, 'gw:approved-save:6'); assert.equal(applies.length, 1);
    assert.deepEqual(plans[1].fields, { Description: 'Approved editor field' });
    assert.ok(f.rawCalls.every(call => call.method === 'GET'), 'Pinned updates must never dispatch raw repository mutations');
  });
  await test('numeric SDK string IDs use numeric API targets and preserve the editor baseline', async () => {
    const f = await fixture({ discovery: 'ready', mode: 'm0-local' });
    const editor = (await f.load()).d, original = globalThis.fetch, readinessTargets = [];
    globalThis.fetch = async (url, init) => { if (new URL(url).pathname.endsWith('/lookup')) { readinessTargets.push(JSON.parse(init.body).target); return response({ data: { ...editor, revision: 'gw:readiness-newer:5' } }); } return original(url, init); };
    await f.native.requireNativeWriteReadiness('1');
    assert.deepEqual(readinessTargets, [1]);
    assert.equal(f.native.cachedNativeSnapshot(1).revision, editor.revision);
    const sent = [];
    globalThis.fetch = async (url, init) => { if (new URL(url).pathname.endsWith('/lookup')) sent.push(JSON.parse(init.body).target); return original(url, init); };
    await f.native.nativeSnapshot('2', { refresh: true }); assert.deepEqual(sent, [2]);
    await assert.rejects(f.native.nativeSnapshot('9007199254740992'), error => error.code === 'invalid_native_target');
    assert.deepEqual(sent, [2]); assert.equal(f.rawCalls.filter(call => call.method !== 'GET').length, 0);
  });
  process.stdout.write(checks + ' native read availability checks passed\n');
}
await main().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
