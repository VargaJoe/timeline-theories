import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import ts from '../client/node_modules/typescript/lib/typescript.js';

// Run the actual TypeScript services, checked SDK adapter and native client.
// Only configuration and the HTTP boundary are fixtures; no repository is used.
const file = path => new URL('../client/' + path, import.meta.url).href;
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function compile(path, imports) {
  let source = fs.readFileSync(new URL('../client/' + path, import.meta.url), 'utf8');
  for (const [name, target] of Object.entries(imports)) source = source.replaceAll("from '" + name + "'", "from '" + target + "'");
  source = source.replace(/import\.meta\.env\.[A-Z_]+/g, 'undefined');
  return moduleUrl(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText);
}
const environment = { repositoryUrl: 'https://repository.fixture.invalid', authority: 'https://authority.fixture.invalid', projectRoot: '/Root/Fixture', writable: true, mode: 'm0-local' };
globalThis.__creationEnvironment = environment;
const config = moduleUrl('export const environment=globalThis.__creationEnvironment; export const repositoryUrl=environment.repositoryUrl; export const siteConfig={};');
const paths = compile('projectPaths.ts', { './configuration': config });
const types = compile('contentTypes.ts', {});
const values = compile('services/contentValues.ts', {});
const nativeUrl = compile('services/nativeApi.ts', { '../configuration': config });
let active;
const http = async (input, init) => active.dispatch(input instanceof Request ? input : new Request(input, init));
globalThis.window = { location: { origin: 'https://ui.fixture.invalid' }, fetch: http };
globalThis.fetch = http;
const checkedUrl = compile('services/sensenet.ts', {
  '@sensenet/client-core': file('node_modules/@sensenet/client-core/dist/cjs/index.js'), '../configuration': config,
  './operationGuard.mjs': file('services/operationGuard.mjs'), '../domain/content.mjs': file('domain/content.mjs'), './nativeApi': nativeUrl,
});
const common = { './sensenet': checkedUrl, '../projectPaths': paths, '../contentTypes': types, '../configuration': config, './contentValues': values, './nativeApi': nativeUrl };
const mediaUrl = compile('services/mediaLibraryService.ts', common);
const entryUrl = compile('services/timelineEntryService.ts', common);
const timelineUrl = compile('services/timelineService.ts', { ...common, './timelineEntryService': entryUrl, './mediaLibraryService': mediaUrl });
const native = await import(nativeUrl), checked = await import(checkedUrl);
const { MediaLibraryService } = await import(mediaUrl), { TimelineEntryService } = await import(entryUrl), { createTimeline } = await import(timelineUrl);
const root = '/Root/Fixture', library = root + '/MediaLibrary', timeline = root + '/Timelines/example';
const revision = 'sha256:' + 'a'.repeat(64);
const web = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function fixture(options = {}) {
  const records = new Map(), plans = new Map(), receipts = new Map(), requests = [], applies = [];
  const insert = (Id, Path, Type, fields = {}) => records.set(Id, { Id, Path, ParentId: 1, Name: Path.split('/').at(-1), Type, revision, ...fields });
  insert(10, root + '/Timelines', 'Folder'); insert(11, library, 'Folder'); insert(12, timeline, 'Timeline'); insert(20, library + '/existing', 'MediaItem', { DisplayName: 'Existing', MediaType: 'movie' });
  let next = 100, faulted = false;
  const find = target => records.get(Number(target)) || [...records.values()].find(row => row.Path === target);
  const state = { records, plans, receipts, requests, applies, creations: 0, options, async dispatch(request) {
    const url = new URL(request.url), body = request.method === 'GET' ? undefined : JSON.parse(await request.text());
    requests.push({ url, method: request.method, body });
    if (url.origin === environment.repositoryUrl) {
      assert.equal(request.method, 'GET', 'the SDK must not send raw repository mutations');
      if (/\/HasPermission$/.test(url.pathname)) return new Response('true');
      if (/\/(?:Effective)?AllowedChildTypes$/.test(url.pathname)) return web({ d: { results: ['Timeline','MediaItem','BookMediaItem','TimelineEntry'].map(Name => ({ Name })) } });
      const id = Number(url.pathname.match(/content\((\d+)\)/)?.[1]);
      const target = id || decodeURIComponent(url.pathname.replace('/odata.svc', '')).replace(/\('([^']+)'\)$/, '/$1');
      const row = find(target); assert.ok(row, `unexpected SDK target ${target}`);
      if (id >= 100 && options.fault === 'readback' && !faulted && state.creations >= (options.faultAt || 1)) { faulted = true; throw new TypeError('injected lost readback'); }
      if (id >= 100 && options.fault === 'readback403' && !faulted && state.creations >= (options.faultAt || 1)) { faulted = true; return web({ error: {} }, 403); }
      return web({ d: row });
    }
    assert.equal(url.origin, window.location.origin);
    assert.equal(request.headers.get('authorization'), `Bearer ${checked.repository.configuration.token}`);
    if (url.pathname === '/api/v1/capabilities') return web({ repository: environment.repositoryUrl, authority: environment.authority, project: root, readOnly: false, operations: ['lookup','snapshots','plans','plans/{id}/apply'], backendProtocolRequired: 'gateway-coordinated-v1' });
    if (url.pathname === '/api/v1/providers/books/search') return web({ data: options.books });
    if (url.pathname === '/api/v1/providers/trakt/list') return web({ data: options.trakt });
    if (url.pathname === '/api/v1/lookup') { const row = find(body.target); assert.ok(row, `unexpected native target ${body.target}`); return web(row); }
    if (url.pathname === '/api/v1/plans') {
      if (options.previewError && !faulted) { faulted = true; return web({ error: { code: 'invalid_field', message: 'Correct the field.' } }, 400); }
      const id = randomUUID(); plans.set(id, body.commands); return web({ id });
    }
    const planId = url.pathname.match(/^\/api\/v1\/plans\/([^/]+)\/apply$/)?.[1];
    if (planId) {
      const key = request.headers.get('idempotency-key'); applies.push({ planId, key });
      const commands = plans.get(planId); assert.ok(commands);
      if (options.applyError && !faulted) { faulted = true; return web(options.applyError, options.applyStatus || 409); }
      if (!receipts.has(planId)) {
        const completed = commands.map(command => {
          assert.equal(command.action, 'create');
          const Id = next++, parent = records.get(command.parentId); state.creations++;
          insert(Id, parent.Path + '/' + command.fields.Name, command.type, { ...command.fields, ParentId: parent.Id });
          return { result: { id: Id, revision } };
        });
        receipts.set(planId, { ok: true, completed, notApplied: [] });
      } else assert.equal(applies.find(item => item.planId === planId).key, key, 'receipt retry must use original key');
      if (options.fault === 'apply' && !faulted && state.creations >= (options.faultAt || 1)) { faulted = true; throw new TypeError('injected response loss after commit'); }
      return web(receipts.get(planId));
    }
    assert.fail(`unexpected request ${url.pathname}`);
  } };
  active = state; native.invalidateNativeSnapshots(); checked.invalidatePermissions(); checked.repository.configuration.token = 'fixture-owner';
  return state;
}
const mediaData = { DisplayName: 'Same movie', Title: 'Same movie', MediaType: 'movie', Description: '' };
const entryData = { displayName: 'Same occurrence', timelineId: 12, position: 1, mediaItem: { Id: 20, Name: 'existing', DisplayName: 'Existing' } };
// Service diagnostics are intentionally suppressed: failed imports must not dump
// transpiled data URLs or request bodies into test output.
const quietly = async run => { const log = console.log, error = console.error; console.log = console.error = () => {}; try { return await run(); } finally { console.log = log; console.error = error; } };

for (const [label, data, create, prefix] of [
  ['media', mediaData, (data, intent) => MediaLibraryService.createMediaItem(data, intent), ''],
  ['entry', entryData, (data, intent) => TimelineEntryService.createTimelineEntry(data, timeline, intent), 'entry-'],
  ['timeline', { name: 'named-timeline', displayName: 'Named timeline' }, createTimeline, ''],
]) {
  for (const fault of ['apply', 'readback', 'readback403']) test(`${label}: ${fault} loss retries one saved create with identical Name, plan and key`, async () => quietly(async () => {
    const state = fixture({ fault }), intent = new native.NativeCreationIntent(prefix);
    await assert.rejects(create(data, intent), error => error instanceof native.NativeApiError && !!error.planId && !!error.idempotencyKey && error.recoverable === true);
    const result = await create(structuredClone(data), intent);
    assert.ok(result.Id || result.id); assert.equal(state.creations, 1); assert.equal(state.plans.size, 1); assert.equal(state.applies.length, 2);
    assert.deepEqual(state.applies[0], state.applies[1]);
    const count = state.requests.length;
    assert.deepEqual(await create(data, intent), result); assert.equal(state.requests.length, count, 'completed import row is cached');
  }));
}

test('deliberate identical media and entry occurrences use separate names, plans, keys and IDs', async () => quietly(async () => {
  const state = fixture();
  const media1 = await MediaLibraryService.createMediaItem(mediaData), media2 = await MediaLibraryService.createMediaItem(mediaData);
  const entry1 = await TimelineEntryService.createTimelineEntry(entryData, timeline), entry2 = await TimelineEntryService.createTimelineEntry(entryData, timeline);
  assert.notEqual(media1.Id, media2.Id); assert.notEqual(media1.Name, media2.Name); assert.notEqual(entry1.id, entry2.id);
  const commands = [...state.plans.values()].map(rows => rows[0]);
  assert.notEqual(commands[2].fields.Name, commands[3].fields.Name);
  assert.equal(state.creations, 4); assert.equal(new Set(state.applies.map(item => item.key)).size, 4);
}));

test('changed uncertain input and changed identity block reuse without another plan or apply', async () => quietly(async () => {
  const state = fixture({ fault: 'apply' }), intent = new native.NativeCreationIntent();
  await assert.rejects(MediaLibraryService.createMediaItem(mediaData, intent));
  await assert.rejects(MediaLibraryService.createMediaItem({ ...mediaData, DisplayName: 'Changed' }, intent), error => error.code === 'creation_intent_changed');
  checked.repository.configuration.token = 'other-owner';
  await assert.rejects(MediaLibraryService.createMediaItem(mediaData, intent), error => error.code === 'identity_changed');
  assert.equal(state.plans.size, 1); assert.equal(state.applies.length, 1); assert.equal(state.creations, 1);
}));

test('the original permission context blocks reuse even when the token is unchanged', async () => quietly(async () => {
  const state = fixture({ fault: 'apply' }), intent = new native.NativeCreationIntent();
  await assert.rejects(MediaLibraryService.createMediaItem(mediaData, intent));
  checked.invalidatePermissions();
  await assert.rejects(MediaLibraryService.createMediaItem(mediaData, intent), error => error.code === 'operation_context_changed');
  assert.equal(state.applies.length, 1); assert.equal(state.plans.size, 1);
}));

test('caller mutation after submit cannot alter the reviewed creation fields', async () => quietly(async () => {
  const state = fixture(), intent = new native.NativeCreationIntent(), data = { ...mediaData };
  const submitted = MediaLibraryService.createMediaItem(data, intent);
  data.DisplayName = 'Changed after submit';
  const created = await submitted;
  assert.equal(created.DisplayName, mediaData.DisplayName);
  assert.equal([...state.plans.values()][0][0].fields.DisplayName, mediaData.DisplayName);
}));

test('local validation and failed preview permit corrected input before any apply dispatch', async () => quietly(async () => {
  const state = fixture(), intent = new native.NativeCreationIntent();
  await assert.rejects(MediaLibraryService.createMediaItem({ ...mediaData, DisplayName: '' }, intent));
  assert.equal(intent.hasStartedApply, false); assert.equal(state.plans.size, 0);
  await MediaLibraryService.createMediaItem(mediaData, intent); assert.equal(state.creations, 1);
  const second = fixture({ previewError: true }), previewIntent = new native.NativeCreationIntent();
  await assert.rejects(MediaLibraryService.createMediaItem(mediaData, previewIntent));
  assert.equal(previewIntent.hasStartedApply, false); assert.equal(second.applies.length, 0);
  await MediaLibraryService.createMediaItem({ ...mediaData, DisplayName: 'Corrected' }, previewIntent); assert.equal(second.creations, 1);
}));

test('structured apply errors preserve recovery details and freeze even a terminal 403 after dispatch', async () => quietly(async () => {
  const details = { uncertain: true, planId: 'saved-plan', stoppedRequestId: randomUUID() };
  const state = fixture({ applyStatus: 403, applyError: { error: { code: 'current_access_denied', message: 'Readback denied.', details } } }), intent = new native.NativeCreationIntent();
  await assert.rejects(MediaLibraryService.createMediaItem(mediaData, intent), error => error instanceof native.NativeApiError && error.code === 'current_access_denied' && error.status === 403 && assert.deepEqual(error.details, details) === undefined);
  assert.equal(intent.hasStartedApply, true);
  await assert.rejects(MediaLibraryService.createMediaItem({ ...mediaData, DisplayName: 'Changed' }, intent), error => error.code === 'creation_intent_changed');
  assert.equal(state.applies.length, 1);
}));

test('concurrent same-intent submissions share the complete create and readback', async () => quietly(async () => {
  const state = fixture(), intent = new native.NativeCreationIntent();
  const [first, second] = await Promise.all([MediaLibraryService.createMediaItem(mediaData, intent), MediaLibraryService.createMediaItem(mediaData, intent)]);
  assert.deepEqual(first, second); assert.equal(state.creations, 1); assert.equal(state.applies.length, 1);
}));

// Exercise real dialog event handlers and refs without a DOM. The small hook
// host supplies only React lifecycle/state; all imported services stay real.
const react = moduleUrl(`
export const useState=(initial)=>globalThis.__creationHooks.state(initial);
export const useRef=(initial)=>globalThis.__creationHooks.ref(initial);
export const useEffect=(fn,deps)=>globalThis.__creationHooks.effect(fn,deps);
export default {createElement:(type,props,...children)=>({type,props:{...props,children}})};
`);
const permissions = moduleUrl('export const usePermissions=()=>true;');
const bookUrl = compile('services/bookImportService.ts', { './nativeApi': nativeUrl });
const traktUrl = compile('services/traktService.ts', { './nativeApi': nativeUrl });
const dialogImports = { react, '../services/nativeApi': nativeUrl, '../services/sensenet': checkedUrl, '../services/mediaLibraryService': mediaUrl,
  '../services/timelineEntryService': entryUrl, '../projectPaths': paths, '../contentTypes': types, '../hooks/usePermissions': permissions };
const { BookImportDialog } = await import(compile('components/BookImportDialog.tsx', { ...dialogImports, '../services/bookImportService': bookUrl }));
const { TraktImportDialog } = await import(compile('components/TraktImportDialog.tsx', { ...dialogImports, '../services/traktService': traktUrl }));
function host(Component, props) {
  const slots = [], effects = []; let cursor = 0;
  const hooks = {
    state(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    ref(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    effect(fn, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => slots[index][i] !== value)) { slots[index] = deps; effects.push(fn); } },
  };
  return { render(next = props) { props = next; cursor = 0; globalThis.__creationHooks = hooks; const tree = Component(props); while (effects.length) effects.shift()(); return tree; } };
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
function element(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (!Array.isArray(tree) && predicate(tree)) return tree;
  for (const child of Array.isArray(tree) ? tree : tree.props?.children || []) { const found = element(child, predicate); if (found) return found; }
}
const button = (tree, label) => { const found = element(tree, node => node.type === 'button' && text(node).trim() === label); assert.ok(found, `missing ${label}`); return found; };

test('Book dialog retries its saved batch after the second commit loses its response; reopening creates a fresh occurrence', async () => quietly(async () => {
  const books = ['one','two'].map(externalId => ({ externalId, source: 'openlibrary', title: 'Book ' + externalId }));
  const state = fixture({ books, fault: 'apply', faultAt: 2 }); let complete = 0, closed = 0;
  const props = { isOpen: true, onClose: () => { closed++; }, onImportComplete: () => { complete++; } }, ui = host(BookImportDialog, props);
  async function selectBoth() {
    let tree = ui.render(); element(tree, node => node.type === 'input').props.onChange({ target: { value: 'Books' } });
    await button(ui.render(), 'Search').props.onClick();
    for (const book of books) { const tree = ui.render(), row = element(tree, node => node.props?.key === 'openlibrary-' + book.externalId); assert.ok(row, text(tree)); row.props.onClick(); }
  }
  await selectBoth(); await button(ui.render(), 'Import Selected Books').props.onClick();
  assert.equal(complete, 0); assert.equal(closed, 0); assert.equal(state.creations, 2);
  await button(ui.render(), 'Import Selected Books').props.onClick();
  assert.equal(complete, 1); assert.equal(closed, 1); assert.equal(state.creations, 2); assert.equal(state.plans.size, 2);
  assert.deepEqual(state.applies[1], state.applies[2]);
  ui.render({ ...props, isOpen: false }); ui.render(props);
  await selectBoth(); await button(ui.render(), 'Import Selected Books').props.onClick();
  assert.equal(state.creations, 4); assert.equal(complete, 2);
}));

test('Trakt dialog retains media and entry progress and the source list across a later lost response', async () => quietly(async () => {
  const trakt = ['one','two'].map((id, index) => ({ type: 'movie', title: 'Movie ' + id, formattedTitle: 'Movie ' + id, ids: { trakt: 101 + index, tmdb: 201 + index, imdb: 'tt-' + id } }));
  const state = fixture({ trakt, fault: 'apply', faultAt: 4 }); let complete = 0;
  const ui = host(TraktImportDialog, { timelineName: 'example', onImportComplete: () => { complete++; } });
  element(ui.render(), node => node.type === 'button').props.onClick();
  element(ui.render(), node => node.type === 'input').props.onChange({ target: { value: 'https://trakt.tv/users/owner/lists/list' } });
  await button(ui.render(), 'Import').props.onClick();
  assert.equal(complete, 0); assert.equal(state.creations, 4, text(ui.render()));
  await button(ui.render(), 'Import').props.onClick();
  assert.equal(complete, 1); assert.equal(state.creations, 4); assert.equal(state.plans.size, 4);
  assert.deepEqual(state.applies[3], state.applies[4]);
  const importedMedia = [...state.plans.values()].flat().filter(command => command.type === 'MediaItem');
  assert.deepEqual(importedMedia.map(command => JSON.parse(command.fields.ExternalLinks)), [{ trakt: '101', tmdb: '201', imdb: 'tt-one' }, { trakt: '102', tmdb: '202', imdb: 'tt-two' }]);
  assert.equal(state.requests.filter(item => item.url.pathname === '/api/v1/providers/trakt/list').length, 1);
  await button(ui.render(), 'Import').props.onClick();
  assert.equal(state.creations, 8); assert.equal(complete, 2, 'a deliberate new import owns fresh intents');
}));

test('Trakt consumer callback failure retains completed imports for a safe callback retry', async () => quietly(async () => {
  const trakt = [{ type: 'movie', title: 'One movie', formattedTitle: 'One movie', ids: { trakt: 101, imdb: 'tt-one' } }];
  const state = fixture({ trakt }); let callbacks = 0;
  const ui = host(TraktImportDialog, { timelineName: 'example', onImportComplete: () => { if (++callbacks === 1) throw new Error('consumer callback failed'); } });
  element(ui.render(), node => node.type === 'button').props.onClick();
  element(ui.render(), node => node.type === 'input').props.onChange({ target: { value: 'https://trakt.tv/users/owner/lists/list' } });
  await button(ui.render(), 'Import').props.onClick();
  assert.equal(callbacks, 1); assert.match(text(ui.render()), /consumer callback failed/); assert.equal(state.creations, 2);
  await button(ui.render(), 'Import').props.onClick();
  assert.equal(callbacks, 2); assert.equal(state.creations, 2); assert.equal(state.plans.size, 2); assert.equal(state.applies.length, 2);
  assert.equal(state.requests.filter(item => item.url.pathname === '/api/v1/providers/trakt/list').length, 1);
}));
