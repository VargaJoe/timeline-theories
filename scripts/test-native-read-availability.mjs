import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
let fixtureCount = 0;
async function fixture({ mode = 'production', discovery = 'html', lookupError, readOnly = false, readAllowed = true, writeAllowed = true, token = 'fixture-backend-jwt', coverRows, actions, childTypes = [{ Name: 'MediaItem' }], permissionRows, canonicalContent } = {}) {
  const environment = { mode, repositoryUrl: 'https://repo.test', authority: 'https://auth.test', projectRoot: '/Root/Content/timelines', writable: true };
  globalThis.window = { location: { origin: 'https://ui.test' } };
  globalThis.__availabilityEnvironment = environment;
  const rawCalls = [], rawWrites = [], aclCalls = [], childTypeCalls = [], nativeCalls = [];
  const permissionState = { readAllowed, writeAllowed, actions, childTypes, permissionRows, beforeBatch: undefined, beforeContent: undefined };
  const snapshot = id => ({ Id: id, ParentId: 5, Name: 'media' + id, Path: environment.projectRoot + '/MediaLibrary/media' + id,
    Type: 'MediaItem', revision: 'gw:fixture-hash:4', Title: 'Native title', DisplayName: 'Native title', Description: '',
    ...(canonicalContent?.Id === id ? canonicalContent : {}) });
  const canonicalTarget = target => canonicalContent && (target === canonicalContent.Id || typeof target === 'string' && target.toLowerCase() === canonicalContent.Path.toLowerCase());
  const targetFromUrl = url => {
    const path = decodeURIComponent(url.pathname).replace(/^\/odata\.svc/i, '');
    const id = path.match(/^\/content\(([0-9]+)\)$/i)?.[1];
    return id ? Number(id) : path.replace(/\/?\('((?:[^']|'')*)'\)$/, (_whole, name) => '/' + name.replaceAll("''", "'"));
  };
  const exactUrl = target => {
    const url = new URL(environment.repositoryUrl);
    if (typeof target === 'number' || /^[1-9][0-9]*$/.test(target)) url.pathname = '/odata.svc/content(' + target + ')';
    else { const slash = target.lastIndexOf('/'); url.pathname = '/odata.svc' + target.slice(0, slash) + "('" + target.slice(slash + 1).replaceAll("'", "''") + "')"; }
    return url.href;
  };
  const capabilities = () => ({ repository: environment.repositoryUrl, authority: environment.authority, project: environment.projectRoot,
    readOnly, operations: ['lookup', 'snapshots', 'plans', 'plans/{id}/apply'], backendProtocolRequired: 'gateway-coordinated-v1' });
  const permissionContent = target => ({ ...snapshot(canonicalTarget(target) ? canonicalContent.Id : typeof target === 'number' ? target : 1),
    ...(typeof target === 'string' && !canonicalTarget(target) ? { Path: target } : {}),
    Actions: permissionState.actions === undefined ? ['Edit', 'Add', 'Delete'].map(Name => ({ Name, Forbidden: !permissionState.writeAllowed })) : permissionState.actions,
    EffectiveAllowedChildTypes: permissionState.childTypes });
  const permissionBatch = url => {
    const query = url.searchParams.get('query') || '';
    const targets = [...query.matchAll(/\bId:([0-9]+)/g)].map(match => Number(match[1]));
    targets.push(...[...query.matchAll(/\bPath:("(?:\\.|[^"\\])*")/g)].map(match => JSON.parse(match[1])));
    const rows = targets.map(permissionContent);
    return permissionState.permissionRows === undefined ? rows : typeof permissionState.permissionRows === 'function' ? permissionState.permissionRows(rows) : permissionState.permissionRows;
  };
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
    if (path.endsWith('/lookup')) { const body = JSON.parse(init.body); return response({ data: snapshot(canonicalTarget(body.target) ? canonicalContent.Id : typeof body.target === 'string' && /^\/root\//i.test(body.target) ? 1 : Number(body.target)) }); }
    if (path.endsWith('/snapshots')) return response({ data: JSON.parse(init.body).ids.map(snapshot) });
    throw new Error('Unexpected native write');
  };
  class MockRepository {
    constructor() {
      this.configuration = { repositoryUrl: environment.repositoryUrl, token: token || undefined };
      this.security = { hasPermission: async (target, permissions) => {
        aclCalls.push({ target, permissions, token: this.configuration.token }); throw new Error('HasPermission must never be requested');
      } };
      this.allowedChildTypes = { get: async target => { childTypeCalls.push(target); throw new Error('Child types must come from the compound descriptor'); } };
    }
    async awaitReadyState() {}
    async fetch(url, init = {}) {
      const parsed = new URL(url), call = { url, method: init.method || 'GET', token: this.configuration.token };
      rawCalls.push(call);
      if (call.method !== 'GET' && call.method !== 'HEAD') { rawWrites.push(call); throw new Error('Unexpected raw write'); }
      if (!permissionState.readAllowed) return response({ error: 'Forbidden' }, 403);
      if (parsed.searchParams.get('$expand') === 'Actions,EffectiveAllowedChildTypes') {
        if (parsed.searchParams.has('query')) {
          await permissionState.beforeBatch?.(call);
          return response({ d: { results: permissionBatch(parsed) } });
        }
        const target = decodeURIComponent(parsed.pathname).match(/^\/odata\.svc\/content\(([0-9]+)\)$/)?.[1];
        return response({ d: permissionContent(target ? Number(target) : environment.projectRoot + '/MediaLibrary/media1') });
      }
      await permissionState.beforeContent?.(call);
      const value = { ...snapshot(canonicalTarget(targetFromUrl(parsed)) ? canonicalContent.Id : 1), revision: undefined, Title: 'Raw permitted title', DisplayName: 'Raw permitted title' };
      if (this.configuration.token) value.Actions = permissionContent(value.Id).Actions;
      return response({ d: new URL(url).searchParams.has('query') ? { results: coverRows ?? [value] } : value });
    }
    async json(url, init) { const result = await this.fetch(url, init); if (!result.ok) throw new Error('Permission denied by repository GET'); return result.json(); }
    async load(options) {
      return this.json(exactUrl(options.idOrPath) + '?$select=' + (options.oDataOptions?.select || []).join(',') + '&$top=1000', { method: 'GET' });
    }
    async loadCollection(options) {
      return this.json(environment.repositoryUrl + '/odata.svc' + options.path + '?query=TypeIs%3AMediaItem&$top=100', { method: 'GET' });
    }
    async patch(options) {
      return this.json(environment.repositoryUrl + '/odata.svc/content(' + options.idOrPath + ')', { method: 'PATCH', body: JSON.stringify(options.content) });
    }
    async post(options) { return this.json(environment.repositoryUrl + '/odata.svc/content(' + options.parentPath + ')', { method: 'POST', body: JSON.stringify({ __ContentType: options.contentType, ...options.content }) }); }
    async delete(options) { return this.json(environment.repositoryUrl + '/odata.svc/Root/Content/DeleteBatch', { method: 'POST', body: JSON.stringify({ paths: [].concat(options.idOrPath), permanent: false }) }); }
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
    .replace("from './displayPermissions.mjs'", 'from ' + JSON.stringify(new URL('client/services/displayPermissions.mjs', root).href))
    .replace("from './permissionRequest.mjs'", 'from ' + JSON.stringify(new URL('client/services/permissionRequest.mjs', root).href))
    .replace("from '../domain/content.mjs'", 'from ' + JSON.stringify(new URL('client/domain/content.mjs', root).href))
    .replace("from './nativeApi'", 'from ' + JSON.stringify(nativeUrl));
  const sense = await import(compile(senseSource + nonce));
  const load = () => sense.repository.load({ idOrPath: 1, oDataOptions: { select: ['Id', 'Title', 'DisplayName'] } });
  return { native, sense, load, rawCalls, rawWrites, aclCalls, childTypeCalls, nativeCalls, environment, permissionState };
}
let checks = 0;
async function test(name, run) { await run(); checks++; process.stdout.write('PASS ' + name + '\n'); }
function assertCompound(call, targets) {
  const url = new URL(call.url), query = url.searchParams.get('query') || '';
  assert.equal(call.method, 'GET');
  assert.equal(decodeURIComponent(url.pathname), '/odata.svc/Root/Content/timelines');
  assert.equal(url.searchParams.get('$select'), 'Id,Path,Actions/Name,Actions/Forbidden,EffectiveAllowedChildTypes/Name');
  assert.equal(url.searchParams.get('$expand'), 'Actions,EffectiveAllowedChildTypes');
  assert.equal(url.searchParams.get('metadata'), 'no');
  assert.ok(Number(url.searchParams.get('$top')) >= targets.length);
  assert.match(query, /\.AUTOFILTERS:OFF \.LIFESPAN:OFF/);
  const actual = [...query.matchAll(/\bId:([0-9]+)/g)].map(match => Number(match[1]));
  actual.push(...[...query.matchAll(/\bPath:("(?:\\.|[^"\\])*")/g)].map(match => JSON.parse(match[1])));
  assert.deepEqual(actual.map(String).sort(), [...new Set(targets)].map(String).sort());
  assert.doesNotMatch(url.pathname, /HasPermission/i);
}
async function main() {
  await test('display-only covers use one exact authorized projection without editor snapshots or Open preflight', async () => {
    const root = '/Root/Content/timelines';
    const f = await fixture({ discovery: 'ready', token: '', coverRows: [{ Id: 3, Type: 'TimelineEntry', Path: root + '/Timelines/Conan the Barbarian/entry',
      MediaItem: { Id: 4, Type: 'MediaItem', Path: root + '/MediaLibrary/media', CoverImageUrl: 'https://covers.test/cover.jpg' } }] });
    const rows = await f.sense.readTimelineCoverReferences(f.environment.projectRoot + '/Timelines/Conan the Barbarian');
    assert.equal(rows.length, 1);
    assert.equal(f.rawCalls.length, 1, 'The projection GET itself enforces repository access');
    const url = new URL(f.rawCalls[0].url);
    assert.equal(decodeURIComponent(url.pathname), '/odata.svc' + f.environment.projectRoot + '/Timelines/Conan the Barbarian');
    assert.equal(url.searchParams.get('$top'), '50');
    assert.equal(url.searchParams.get('$expand'), 'MediaItem');
    assert.equal(url.searchParams.get('$select'), 'Id,Path,Name,Type,MediaItem/Id,MediaItem/Path,MediaItem/Type,MediaItem/CoverImageUrl,MediaItem/CoverImageBin');
    assert.equal(f.nativeCalls.length, 0);
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('cover projection rejects cross-project and wrong-type entries or expanded media', async () => {
    const root = '/Root/Content/timelines';
    const row = { Id: 3, Type: 'TimelineEntry', Path: root + '/Timelines/example/entry',
      MediaItem: { Id: 4, Type: 'MediaItem', Path: root + '/MediaLibrary/media' } };
    for (const entry of [
      { ...row, Path: root + '/Timelines/other/entry' },
      { ...row, Type: 'Folder' },
      { ...row, MediaItem: { ...row.MediaItem, Path: '/Root/Content/other/MediaLibrary/media' } },
      { ...row, MediaItem: { ...row.MediaItem, Type: 'Folder' } },
      { ...row, MediaItem: 4 },
    ]) {
      const f = await fixture({ discovery: 'ready', token: '', coverRows: [entry] });
      await assert.rejects(f.sense.readTimelineCoverReferences(root + '/Timelines/example'));
    }
  });
  await test('cover projection fails closed on denied GET, invalid path and aborted view', async () => {
    const f = await fixture({ discovery: 'ready', token: '', readAllowed: false });
    const target = f.environment.projectRoot + '/Timelines/example';
    await assert.rejects(f.sense.readTimelineCoverReferences(target));
    assert.equal(f.rawCalls.length, 1, 'The denied exact projection is the only request');
    assert.equal(new URL(f.rawCalls[0].url).searchParams.get('$expand'), 'MediaItem');
    const count = f.rawCalls.length;
    for (const path of [f.environment.projectRoot + '/MediaLibrary/example', target + '/child', target + '?query=x', target + '#fragment']) {
      await assert.rejects(f.sense.readTimelineCoverReferences(path), /Invalid timeline cover target/);
    }
    assert.equal(f.rawCalls.length, count);
    const allowed = await fixture({ discovery: 'ready', token: '' });
    const controller = new AbortController(); controller.abort();
    await assert.rejects(allowed.sense.readTimelineCoverReferences(target, controller.signal), error => error.name === 'AbortError');
    assert.equal(allowed.rawCalls.length, 0);
  });
  for (const change of ['identity', 'abort']) await test('cover projection discards an in-flight response after ' + change, async () => {
    const root = '/Root/Content/timelines', target = root + '/Timelines/example';
    const f = await fixture({ discovery: 'ready', coverRows: [{ Id: 3, Type: 'TimelineEntry', Path: target + '/entry' }] });
    const gate = deferred(), controller = new AbortController();
    f.permissionState.beforeContent = () => gate.promise;
    const pending = assert.rejects(f.sense.readTimelineCoverReferences(target, controller.signal),
      error => change === 'abort' ? error.name === 'AbortError' : /context changed/i.test(error.message));
    await tick(); assert.equal(f.rawCalls.length, 1);
    if (change === 'abort') controller.abort(); else f.sense.setRepositoryAccessToken('next-cover-identity');
    gate.resolve(); await pending;
    assert.equal(f.rawCalls.length, 1); assert.equal(f.aclCalls.length, 0); assert.equal(f.nativeCalls.length, 0);
  });
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
  await test('anonymous read uses the exact backend GET once and retains native snapshot reads', async () => {
    const f = await fixture({ discovery: 'ready', token: '' });
    assert.equal((await f.load()).d.Title, 'Native title');
    assert.equal(f.rawCalls.length, 1);
    assert.equal(new URL(f.rawCalls[0].url).pathname, '/odata.svc/content(1)');
    assert.equal(new URL(f.rawCalls[0].url).searchParams.get('$select'), 'Id,Title,DisplayName,Path');
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
  await test('anonymous read guard and actual backend GET both fail closed on denial', async () => {
    const f = await fixture({ discovery: 'ready', token: '', readAllowed: false });
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'read' }]), false);
    await assert.rejects(f.load(), /Permission denied/);
    assert.equal(f.rawCalls.length, 2, 'Explicit guard review and actual load each make their own GET');
    assert.ok(f.rawCalls.every(call => call.method === 'GET'));
    assert.equal(new URL(f.rawCalls[1].url).pathname, '/odata.svc/content(1)');
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.rawWrites.length, 0);
  });
  for (const writeAllowed of [true, false]) await test('fresh authenticated Actions preserve backend ' + (writeAllowed ? 'approval' : 'denial'), async () => {
    const f = await fixture({ discovery: 'ready', writeAllowed });
    for (const operation of writeOperations) {
      assert.equal(await f.sense.canOperations([operation]), writeAllowed);
      if (writeAllowed) await f.sense.assertOperations([operation]);
      else await assert.rejects(f.sense.assertOperations([operation]), /Permission denied/);
    }
    assert.equal(f.aclCalls.length, 0);
    assert.ok(f.rawCalls.every(call => call.token === 'fixture-backend-jwt'));
    assert.ok(f.nativeCalls.some(call => call.path.endsWith('/lookup')));
    assert.equal(f.childTypeCalls.length, 0);
    assert.equal(f.rawCalls.length, 8, 'Each explicit guard call must review a fresh compound response');
    for (const call of f.rawCalls) assertCompound(call, [1]);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('one compound GET reviews all 100 actual-operation targets with zero ACL calls', async () => {
    const f = await fixture({ discovery: 'ready' });
    const operations = Array.from({ length: 100 }, (_, index) => ({ target: index + 1, action: 'update' }));
    await f.sense.assertOperations(operations);
    assert.equal(f.rawCalls.length, 1);
    assertCompound(f.rawCalls[0], operations.map(operation => operation.target));
    assert.equal(f.aclCalls.length, 0); assert.equal(f.childTypeCalls.length, 0); assert.equal(f.rawWrites.length, 0);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
  });
  await test('concurrent display checks coalesce 32 concrete targets into one compound GET', async () => {
    const f = await fixture({ discovery: 'ready' });
    const targets = Array.from({ length: 32 }, (_, index) => index + 1);
    assert.deepEqual(await Promise.all(targets.map(target => f.sense.canDisplayOperations([{ target, action: 'update' }]))), targets.map(() => true));
    assert.equal(f.rawCalls.length, 1);
    assertCompound(f.rawCalls[0], targets);
    assert.equal(f.aclCalls.length, 0); assert.equal(f.childTypeCalls.length, 0); assert.equal(f.rawWrites.length, 0);
  });
  await test('a lowercase route accepts canonical mixed-case content and reuses its numeric Id without ACL calls', async () => {
    const canonicalContent = { Id: 4298, Path: '/Root/Content/timelines/Timelines/Conan the Barbarian', Name: 'Conan the Barbarian', Type: 'Timeline' };
    const route = canonicalContent.Path.toLowerCase(), f = await fixture({ discovery: 'ready', token: '', canonicalContent });
    assert.equal(await f.sense.canDisplayOperations([{ target: route, action: 'read' }]), true);
    assert.equal(f.rawCalls.length, 1); assertCompound(f.rawCalls[0], [route]);
    for (const target of [canonicalContent.Id, String(canonicalContent.Id), canonicalContent.Path]) {
      assert.equal(await f.sense.canDisplayOperations([{ target, action: 'read' }]), true);
    }
    assert.equal(f.rawCalls.length, 1, 'canonical Path and numeric Id aliases share the same loaded descriptor');
    assert.equal(await f.sense.canDisplayOperations([{ target: '/root/content/foreign/timelines/conan the barbarian', action: 'read' }]), false);
    assert.equal(f.rawCalls.length, 1, 'a foreign project is still rejected before transport');
    const result = await f.sense.repository.load({ idOrPath: route, oDataOptions: { select: ['Id', 'Path'] } });
    assert.equal(result.d.Id, canonicalContent.Id); assert.equal(result.d.Path, canonicalContent.Path);
    assert.equal(f.rawCalls.length, 2);
    assert.equal(decodeURIComponent(new URL(f.rawCalls[1].url).pathname), "/odata.svc/root/content/timelines/timelines('conan the barbarian')");
    assert.deepEqual(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).map(call => JSON.parse(call.init.body).target), [route]);
    assert.equal(f.aclCalls.length, 0); assert.equal(f.childTypeCalls.length, 0); assert.equal(f.rawWrites.length, 0);
  });
  await test('a fresh mutation review matches a mixed-case path to its canonical row and rejects another target', async () => {
    const canonicalContent = { Id: 4298, Path: '/Root/Content/timelines/Timelines/Conan the Barbarian', Name: 'Conan the Barbarian', Type: 'Timeline' };
    const route = '/rOoT/CoNtEnT/TIMELINES/tiMelines/conan the barbarian', f = await fixture({ discovery: 'ready', canonicalContent });
    const operation = { target: route, action: 'update' };
    await f.sense.assertOperations([operation]);
    assert.equal(f.rawCalls.length, 1); assertCompound(f.rawCalls[0], [route]);
    assert.equal(JSON.parse(f.nativeCalls.find(call => call.path.endsWith('/lookup')).init.body).target, route);
    f.permissionState.permissionRows = rows => rows.map(row => ({ ...row, Id: row.Id + 1, Path: row.Path.replace('Barbarian', 'Destroyer') }));
    await assert.rejects(f.sense.assertOperations([operation]), /Permission denied/);
    assert.equal(f.rawCalls.length, 2); assertCompound(f.rawCalls[1], [route]);
    assert.equal(f.aclCalls.length, 0); assert.equal(f.childTypeCalls.length, 0); assert.equal(f.rawWrites.length, 0);
  });
  await test('a cached display allow cannot authorize a write after fresh server denial', async () => {
    const f = await fixture({ discovery: 'ready' });
    await f.load();
    assert.equal(await f.sense.canDisplayOperations([{ target: 1, action: 'update' }]), true);
    assert.equal(f.rawCalls.length, 1, 'The real content Actions expansion supplies the display hint');
    f.permissionState.writeAllowed = false;
    assert.equal(await f.sense.canDisplayOperations([{ target: 1, action: 'update' }]), true, 'The existing UI hint remains cached for this assertion');
    await assert.rejects(f.sense.repository.patch({ idOrPath: 1, content: { Description: 'Denied after revocation' } }), /Permission denied/);
    assert.equal(f.rawCalls.length, 2);
    assertCompound(f.rawCalls[1], [1]);
    assert.equal(f.aclCalls.length, 0); assert.equal(f.rawWrites.length, 0);
    assert.ok(!f.nativeCalls.some(call => /\/plans(?:\/|$)/.test(call.path)));
  });
  await test('an identity change during the compound response invalidates every actual-operation result', async () => {
    const f = await fixture({ discovery: 'ready' }), gate = deferred();
    f.permissionState.beforeBatch = () => gate.promise;
    const pending = assert.rejects(f.sense.assertOperations([{ target: 1, action: 'update' }, { target: 2, action: 'delete' }]), /context changed|Identity or permissions changed/i);
    await tick(); assert.equal(f.rawCalls.length, 1);
    f.sense.setRepositoryAccessToken('next-identity'); gate.resolve(); await pending;
    assert.equal(f.rawWrites.length, 0); assert.equal(f.aclCalls.length, 0);
  });
  await test('Add requires the exact allowed child type in the same fresh response', async () => {
    const f = await fixture({ discovery: 'ready', actions: [{ Name: 'Add', Forbidden: false }], childTypes: [{ Name: 'MediaItem' }] });
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'create', contentType: 'MediaItem' }]), true);
    for (const contentType of ['Timeline', 'mediaitem', '']) {
      const operation = { target: 1, action: 'create', contentType };
      assert.equal(await f.sense.canOperations([operation]), false);
      await assert.rejects(f.sense.assertOperations([operation]), /Permission denied/);
      await assert.rejects(f.sense.repository.post({ parentPath: 1, contentType: contentType || 'Timeline', content: {} }));
    }
    f.permissionState.childTypes = undefined;
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'create', contentType: 'MediaItem' }]), false);
    assert.equal(f.rawWrites.length, 0); assert.equal(f.aclCalls.length, 0); assert.equal(f.childTypeCalls.length, 0);
  });
  for (const action of ['update', 'upload', 'delete', 'create']) await test('Forbidden=true ' + action + ' blocks the actual SDK dispatch', async () => {
    const f = await fixture({ discovery: 'ready', actions: ['Edit', 'Delete', 'Add'].map(Name => ({ Name, Forbidden: true })) });
    const operation = { target: 1, action, ...(action === 'create' ? { contentType: 'MediaItem' } : {}) };
    assert.equal(await f.sense.canOperations([operation]), false);
    const dispatch = {
      update: () => f.sense.repository.patch({ idOrPath: 1, content: { Description: 'Denied' } }),
      upload: () => f.sense.uploadBinary(1, f.environment.repositoryUrl + '/odata.svc/content(5)/upload', new FormData()),
      delete: () => f.sense.repository.delete({ idOrPath: 1 }),
      create: () => f.sense.repository.post({ parentPath: 1, contentType: 'MediaItem', content: {} }),
    };
    await assert.rejects(dispatch[action](), /Permission denied/);
    assert.equal(f.rawCalls.length, 2); f.rawCalls.forEach(call => assertCompound(call, [1]));
    assert.equal(f.rawWrites.length, 0); assert.equal(f.aclCalls.length, 0);
    assert.ok(!f.nativeCalls.some(call => /\/plans(?:\/|$)/.test(call.path)));
  });
  for (const actions of [null, [], {}, [{ Name: 'Edit' }], [{ Name: 'Edit', Forbidden: 'false' }], [{ Name: 'Edit', Forbidden: true }]]) await test('missing or malformed Actions fail closed: ' + JSON.stringify(actions), async () => {
    const f = await fixture({ discovery: 'ready', actions });
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    await assert.rejects(f.sense.repository.patch({ idOrPath: 1, content: { Description: 'Denied' } }), /Permission denied/);
    assert.equal(f.rawWrites.length, 0); assert.equal(f.aclCalls.length, 0);
  });
  for (const permissionRows of [[], rows => rows.map(({ Actions, ...row }) => ({ ...row, __metadata: { actions: Actions } })), rows => rows.map(row => ({ ...row, Id: row.Id + 100, Path: row.Path + '-other' }))]) await test('missing target or metadata-only actions cannot substitute for a caller-filtered descriptor', async () => {
    const f = await fixture({ discovery: 'ready', permissionRows });
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    assert.equal(f.rawCalls.length, 1); assert.equal(f.aclCalls.length, 0); assert.equal(f.rawWrites.length, 0);
  });
  for (const code of ['permission_denied', 'grant_revoked', 'unknown_role']) await test(code + ' native readiness failure blocks the actual write before any permission review', async () => {
    const f = await fixture({ discovery: 'ready', lookupError: { status: 403, code } });
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    await assert.rejects(f.sense.repository.patch({ idOrPath: 1, content: { Description: 'Denied native readiness' } }), error => error.code === code);
    assert.equal(f.rawCalls.length, 0); assert.equal(f.aclCalls.length, 0); assert.equal(f.rawWrites.length, 0);
  });
  await test('an unchecked SDK POST and raw fetch PATCH cannot reach either write transport', async () => {
    const f = await fixture({ discovery: 'ready' });
    await assert.rejects(f.sense.repository.post({ parentPath: 1, contentType: 'User', content: { DisplayName: 'Unsupported type' } }), /Unsupported mutation endpoint/);
    await assert.rejects(f.sense.repository.fetch(f.environment.repositoryUrl + '/odata.svc/content(1)', { method: 'PATCH', body: '{}' }), /checked domain operation/);
    assert.equal(f.rawCalls.length, 0); assert.equal(f.rawWrites.length, 0); assert.equal(f.nativeCalls.length, 0); assert.equal(f.aclCalls.length, 0);
  });
  for (const discovery of ['html', '404', 'unavailable']) await test('ordinary reads remain available for confirmed ' + discovery + ' gateway absence', async () => {
    const f = await fixture({ discovery }); assert.equal((await f.load()).d.Title, 'Raw permitted title');
    assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    await assert.rejects(f.sense.repository.patch({ idOrPath: 1, content: { Title: 'No write' } }));
    assert.ok(f.rawCalls.every(call => call.method === 'GET' && call.token === 'fixture-backend-jwt'));
    assert.equal(f.aclCalls.length, 0);
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
    assert.equal(f.aclCalls.length, 0);
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
    assert.equal(f.aclCalls.length, 0);
    assertCompound(f.rawCalls.at(-1), [1]);
  });
  await test('quoted exact SDK reads with default top retain their pre-read revision baseline', async () => {
    const f = await fixture({ discovery: 'ready' });
    const result = await f.sense.repository.fetch('https://repo.test/odata.svc/Root/Content/timelines/MediaLibrary/(\'media1\')?$select=Id,Title&$top=1000');
    const content = (await result.json()).d;
    assert.equal(content.revision, 'gw:fixture-hash:4'); assert.equal(content.Title, 'Native title');
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
    assert.ok(!f.nativeCalls.some(call => call.path.endsWith('/snapshots')));
  });
  await test('read-only gateway rejects writes before the compound permission review', async () => {
    const f = await fixture({ discovery: 'ready', readOnly: true }); assert.equal(await f.sense.canOperations([{ target: 1, action: 'update' }]), false);
    assert.equal(f.aclCalls.length, 0);
    assert.equal(f.rawCalls.length, 0);
  });
  await test('discovery is cached across concurrent reads and invalidated on identity change', async () => {
    const f = await fixture(); await Promise.all([f.load(), f.load()]);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 1);
    f.sense.setRepositoryAccessToken('fixture-other-jwt'); await f.load();
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 2);
    f.sense.setRepositoryAccessToken(''); await f.load();
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 3);
  });
  await test('six concurrent explicit guards share readiness and each reviews its own concrete target freshly', async () => {
    const f = await fixture({ discovery: 'ready' }), original = globalThis.fetch, gate = deferred();
    globalThis.fetch = async (url, init) => { const result = await original(url, init); if (new URL(url).pathname.endsWith('/lookup')) await gate.promise; return result; };
    const targets = [1, 1, 2, 2, 3, 4], checks = targets.map(target => f.sense.canOperations([{ target, action: 'update' }]));
    await tick();
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 1);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
    assert.equal(f.rawCalls.length, 0, 'Permission reviews must wait for readiness');
    gate.resolve(); assert.deepEqual(await Promise.all(checks), targets.map(() => true));
    assert.equal(f.rawCalls.length, 6);
    f.rawCalls.forEach((call, index) => assertCompound(call, [targets[index]]));
    assert.equal(f.aclCalls.length, 0);
    await f.sense.assertOperations([{ target: 5, action: 'update' }]);
    assert.equal(f.rawCalls.length, 7, 'Global readiness must not cache actual-operation permissions');
    assertCompound(f.rawCalls.at(-1), [5]);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('failed shared readiness clears so six retries perform one new lookup', async () => {
    const f = await fixture({ discovery: 'ready' }), original = globalThis.fetch, gate = deferred(); let fail = true;
    globalThis.fetch = async (url, init) => {
      const result = await original(url, init);
      if (new URL(url).pathname.endsWith('/lookup') && fail) { fail = false; await gate.promise; return response({ errorType: 'LambdaTimeoutError', errorMessage: 'Task timed out after 30.00 seconds' }, 500); }
      return result;
    };
    const checks = Promise.allSettled([1, 1, 2, 2, 3, 4].map(target => f.native.requireNativeWriteReadiness(target)));
    await tick(); assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
    gate.resolve();
    for (const result of await checks) { assert.equal(result.status, 'rejected'); assert.equal(result.reason.code, 'native_gateway_timeout'); }
    assert.equal(f.native.cachedNativeSnapshot(1), undefined);
    await Promise.all([1, 1, 2, 2, 3, 4].map(target => f.native.requireNativeWriteReadiness(target)));
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 2);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 1);
  });
  await test('identity switch starts separate readiness and old completion cannot clear or populate it', async () => {
    const f = await fixture({ discovery: 'ready' }), original = globalThis.fetch, gates = [];
    let token = 'fixture-backend-jwt'; f.native.configureNativeAuth(() => token);
    globalThis.fetch = async (url, init) => {
      const result = await original(url, init);
      if (new URL(url).pathname.endsWith('/lookup')) { const gate = deferred(); gates.push(gate); await gate.promise; }
      return result;
    };
    const old = f.native.requireNativeWriteReadiness(1), rejected = assert.rejects(old, error => error.code === 'identity_changed');
    await tick(); token = 'fixture-next-jwt';
    const next = f.native.requireNativeWriteReadiness(2);
    await tick(); assert.equal(gates.length, 2);
    gates[0].resolve(); await rejected;
    assert.equal(f.native.cachedNativeSnapshot(1), undefined);
    let joinedResolved = false;
    const joined = f.native.requireNativeWriteReadiness(3).then(() => { joinedResolved = true; });
    await tick(); assert.equal(gates.length, 2); assert.equal(joinedResolved, false, 'An old identity must not populate the new readiness cache');
    gates[1].resolve(); await Promise.all([next, joined]);
    assert.equal(f.native.cachedNativeSnapshot(1), undefined);
    assert.equal(f.native.cachedNativeSnapshot(2).Id, 2);
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/capabilities')).length, 2);
    assert.deepEqual(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).map(call => new Headers(call.init.headers).get('Authorization')), ['Bearer fixture-backend-jwt', 'Bearer fixture-next-jwt']);
  });
  for (const outage of [false, true]) await test((outage ? 'marking the gateway unavailable' : 'explicit invalidation') + ' discards in-flight readiness even for the same identity', async () => {
    const f = await fixture({ discovery: 'ready' }), original = globalThis.fetch, gate = deferred(); let held = true;
    globalThis.fetch = async (url, init) => {
      const result = await original(url, init);
      if (new URL(url).pathname.endsWith('/lookup') && held) { held = false; await gate.promise; }
      return result;
    };
    const pending = f.native.requireNativeWriteReadiness(1), rejected = assert.rejects(pending, error => error.code === 'native_readiness_changed');
    await tick();
    if (outage) f.native.markNativeGatewayUnavailable(new f.native.NativeApiError('Gateway stopped', 503, 'native_gateway_unavailable'));
    else f.native.invalidateNativeSnapshots();
    gate.resolve(); await rejected;
    assert.equal(f.native.cachedNativeSnapshot(1), undefined, 'A discarded readiness response must not repopulate snapshots');
    if (outage) {
      await assert.rejects(f.native.requireNativeWriteReadiness(2), error => error.code === 'native_gateway_unavailable');
      assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 1);
      f.native.invalidateNativeSnapshots();
    }
    await Promise.all([2, 2, 3, 3, 4, 5].map(target => f.native.requireNativeWriteReadiness(target)));
    assert.equal(f.nativeCalls.filter(call => call.path.endsWith('/lookup')).length, 2);
  });
  for (const errorType of ['TimeoutError', 'LambdaTimeoutError']) await test(errorType + ' preserves an uncertain apply and its exact plan/key for retry', async () => {
    const f = await fixture({ discovery: 'ready' }), original = globalThis.fetch, plans = [], applies = [];
    globalThis.fetch = async (url, init) => {
      const path = new URL(url).pathname;
      if (path === '/api/v1/plans') { plans.push(JSON.parse(init.body)); return response({ id: 'saved-timeout-plan' }); }
      if (path === '/api/v1/plans/saved-timeout-plan/apply') {
        applies.push({ path, body: init.body, key: new Headers(init.headers).get('Idempotency-Key') });
        return applies.length === 1 ? response({ errorType, errorMessage: 'Task timed out after 30.00 seconds', details: { uncertain: false } }, 500) : response({ ok: true, completed: [] });
      }
      return original(url, init);
    };
    const commands = [{ action: 'cover-presentation', targetId: 1, expectedRevision: 'saved-owner-revision', setId: 90 }];
    await assert.rejects(f.native.applyNativeCommands(commands), error => {
      assert.equal(error.code, 'native_gateway_timeout'); assert.equal(error.status, 500);
      assert.equal(error.message, 'The request timed out before its outcome could be confirmed.');
      assert.equal(error.details.uncertain, true); assert.equal(error.recoverable, true);
      assert.equal(error.planId, 'saved-timeout-plan'); assert.equal(error.idempotencyKey, applies[0].key);
      assert.equal(f.native.canUseLegacyRead(error), false); return true;
    });
    await f.native.applyNativeCommands(commands);
    assert.equal(plans.length, 1); assert.equal(applies.length, 2); assert.deepEqual(applies[0], applies[1]);
    assert.equal(f.rawWrites.length, 0);
  });
  await test('normal native errors retain their domain code, message and details', async () => {
    const f = await fixture({ discovery: 'ready' });
    const cases = [
      [{ error: { code: 'permission_denied', message: 'Exact target denied', details: { uncertain: false } } }, 403, 'permission_denied', 'Exact target denied'],
      [{ errorType: 'TimeoutError', errorMessage: 'Task timed out', code: 'revision_conflict', message: 'The owner changed', details: { uncertain: false } }, 409, 'revision_conflict', 'The owner changed'],
      [{ error: 'Explicit gateway error' }, 502, 'native_request_failed', 'Explicit gateway error'],
      [{ errorType: 'OtherRuntimeError', errorMessage: 'Private runtime details' }, 500, 'native_request_failed', 'The native gateway rejected the request.'],
    ];
    for (const [payload, status, code, message] of cases) {
      globalThis.fetch = async () => response(payload, status);
      await assert.rejects(f.native.nativeRequest('/lookup', { method: 'POST', body: '{}' }), error => {
        assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.message, message);
        assert.deepEqual(error.details, payload.error?.details ?? payload.details); return true;
      });
    }
  });
  await test('an absent gateway never bypasses the actual repository read denial', async () => {
    const f = await fixture({ readAllowed: false }); await assert.rejects(f.load(), /Permission denied/); assert.equal(f.rawCalls.length, 1);
    assert.equal(f.aclCalls.length, 0);
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
