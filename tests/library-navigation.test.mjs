import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

// Execute the real page and permission-hook code. Only React's lifecycle,
// leaf widgets, routing and asynchronous I/O are supplied by this small host.
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function compile(path, imports) {
  const source = fs.readFileSync(new URL('../client/' + path, import.meta.url), 'utf8');
  let output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const [name, target] of Object.entries(imports)) {
    output = output.replaceAll(`from '${name}'`, `from '${target}'`).replaceAll(`from "${name}"`, `from '${target}'`);
  }
  return moduleUrl(output);
}
const react = moduleUrl(`
export const useState=(value)=>globalThis.__libraryNavigationHooks.state(value);
export const useRef=(value)=>globalThis.__libraryNavigationHooks.ref(value);
export const useMemo=(fn,deps)=>globalThis.__libraryNavigationHooks.memo(fn,deps);
export const useCallback=(fn,deps)=>useMemo(()=>fn,deps);
export const useEffect=(fn,deps)=>globalThis.__libraryNavigationHooks.effect(fn,deps);
export default {};
`);
const jsx = moduleUrl(`
export const Fragment='Fragment';
export const jsx=(type,props,key)=>({type,props:{...props,key}});
export const jsxs=jsx;
`);
const widget = name => moduleUrl(`export const ${name}='${name}';`);
const config = moduleUrl(`export const repositoryUrl='https://repository.fixture.invalid';
export const siteConfig={timelineList:{allViewPageSize:2,enableAbcPagination:true,enableAllView:true},headerOverlayOpacity:0.4};`);
const paths = moduleUrl("export const timelinesPath='/Timelines',mediaLibraryPath='/MediaLibrary';");
const types = moduleUrl("export const TIMELINE_CONTENT_TYPE='Timeline',MEDIA_ITEM_CONTENT_TYPE='MediaItem';");
const auth = moduleUrl('export const useSharedAuth=()=>globalThis.__libraryNavigationFixture.auth;');
const router = moduleUrl(`export const Link='Link';
export const useNavigate=()=>()=>{};
export const useSearchParams=()=>{const state=globalThis.__libraryNavigationFixture;return [state.searchParams,value=>{state.searchParams=value;}];};`);
const checked = moduleUrl(`
export const subscribePermissions=listener=>{const state=globalThis.__libraryNavigationFixture;state.listeners.add(listener);return ()=>state.listeners.delete(listener);};
export const canDisplayOperations=(operations,options)=>globalThis.__libraryNavigationFixture.canDisplayOperations(operations,options);
export const canOperations=()=>{throw Error('UI display must not invoke the fresh write guard');};
export const captureOperationContext=()=>{const state=globalThis.__libraryNavigationFixture,epoch=state.epoch;return ()=>{if(epoch!==state.epoch)throw Error('identity or permissions changed');};};
export const loadBackgroundImage=async()=>null;
export const assertOperations=async()=>{};
`);
const permissionUrl = compile('hooks/usePermissions.ts', {
  react, '../context/useSharedAuth': auth, '../configuration': config, '../services/sensenet': checked,
});
const { usePermissionState, usePermissions } = await import(permissionUrl);
const media = moduleUrl(`export const MediaLibraryService={
getMediaItems:(...args)=>globalThis.__libraryNavigationFixture.request('media',args),getCoverImageUrl:()=>null};`);
const timelines = moduleUrl(`
export const getTimelines=(...args)=>globalThis.__libraryNavigationFixture.request('timeline',args);
export const getTimelineMediaCovers=async()=>[];
`);
const coverLoader = moduleUrl('export const createTimelineCoverLoader=()=>({enqueue(){},dispose(){}});');
const common = {
  react, 'react/jsx-runtime': jsx, 'react-router-dom': router,
  '../hooks/usePermissions': permissionUrl, '../services/sensenet': checked,
  '../configuration': config, '../projectPaths': paths, '../contentTypes': types,
  '../components/PageHeader': widget('PageHeader'),
  '../components/CollectionPlaceholder': widget('CollectionPlaceholder'),
  '../components/LazyImage': widget('LazyImage'),
};
const { default: MediaLibraryPage } = await import(compile('pages/MediaLibraryPage.tsx', {
  ...common, '../services/mediaLibraryService': media,
  '../components/LazyImage': widget('LazyImage'), '../components/BookImportDialog': widget('BookImportDialog'),
  '../components/MediaItemEditDialog': widget('MediaItemEditDialog'), '../components/PermissionContent': widget('PermissionContent'),
}));
const { TimelineListPage } = await import(compile('pages/TimelineListPage.tsx', {
  ...common, dompurify: moduleUrl('export default {sanitize:value=>value};'),
  '../context/useSharedAuth': auth, '../services/timelineService': timelines,
  '../services/timelineCoverLoader': coverLoader, '../components/MediaCoverMontage': widget('MediaCoverMontage'),
}));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function fixture() {
  const state = {
    auth: { isAuthenticated: true, isLoading: false, accessToken: 'owner-one', user: { sub: 'owner-one' } },
    epoch: 0, listeners: new Set(), permissions: [], requests: [], searchParams: new URLSearchParams('filter=a'),
    canDisplayOperations(operations, options) {
      if (operations.some(operation => operation.action !== 'read')) return Promise.resolve(false);
      const pending = deferred(); this.permissions.push({ operations, options, ...pending }); return pending.promise;
    },
    request(kind, args) {
      const pending = deferred(); this.requests.push({ kind, args, ...pending }); return pending.promise;
    },
    invalidate() { this.epoch++; for (const listener of this.listeners) listener(); },
  };
  globalThis.__libraryNavigationFixture = state;
  globalThis.window = { addEventListener() {}, removeEventListener() {}, setInterval() { return 1; }, clearInterval() {} };
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  return state;
}

function host(Component) {
  const slots = []; let cursor = 0, dirty = true, tree;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, i) => !Object.is(value, b[i]));
  const effects = [];
  const hooks = {
    state(initial) {
      const index = cursor++;
      if (!slots[index]) slots[index] = { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        const value = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    ref(initial) { const index = cursor++; return slots[index] ??= { current: initial }; },
    memo(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) slots[index] = { value: fn(), deps };
      return slots[index].value;
    },
    effect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup;
        slots[index] = { deps, cleanup };
        effects.push(() => { cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  const ui = {
    // A render without passive effects checks that private rows are masked
    // immediately when identity/permission state changes.
    render() { cursor = 0; globalThis.__libraryNavigationHooks = hooks; tree = Component(); return tree; },
    flush() {
      for (let pass = 0; pass < 30; pass++) {
        dirty = false; ui.render();
        while (effects.length) effects.shift()();
        if (!dirty) return tree;
      }
      throw Error('hook host failed to settle');
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  return ui;
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node)
  : !node ? '' : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (!Array.isArray(tree) && predicate(tree)) return tree;
  for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) {
    const result = find(child, predicate); if (result) return result;
  }
}
function button(tree, label) {
  const result = find(tree, node => node.type === 'button' && text(node).trim() === label);
  assert.ok(result, `missing ${label} button`); return result;
}
const settle = async ui => { await new Promise(resolve => setImmediate(resolve)); return ui.flush(); };
async function allowRead(state, ui) {
  assert.ok(state.permissions.length, 'the real permission hook must request read access');
  state.permissions.at(-1).resolve(true); return settle(ui);
}
function assertChrome(tree, kind) {
  assert.ok(find(tree, node => node.type === 'PageHeader' && node.props.title === (kind === 'media' ? 'Media Library' : 'Timeline Library')));
  assert.ok(button(tree, 'B')); assert.ok(button(tree, 'C'));
  assert.ok(find(tree, node => kind === 'media' ? node.type === 'input' : node.type === 'select'));
}
function item(kind, title) {
  return kind === 'media'
    ? { Id: title, Name: title, DisplayName: title, MediaType: 'movie', CreationDate: '2026-01-01' }
    : { id: title, name: title, title, displayName: title, description: '', isVisible: true, coverImageUrl: 'fixture.jpg' };
}
const pages = [['media', MediaLibraryPage], ['timeline', TimelineListPage]];

test('permission tri-state stays checking while pending and never reuses an earlier identity result', async () => {
  const state = fixture();
  const ui = host(() => ({ props: { children: usePermissionState([{ target: '/MediaLibrary', action: 'read' }]) } }));
  try {
    assert.equal(text(ui.render()), 'checking');
    assert.equal(text(ui.flush()), 'checking', 'an unresolved access check is not a denial');
    await allowRead(state, ui); assert.equal(text(ui.render()), 'allowed');
    state.auth = { ...state.auth, accessToken: 'owner-two', user: { sub: 'owner-two' } };
    state.invalidate();
    assert.equal(text(ui.render()), 'checking'); ui.flush();
    state.permissions.at(-1).resolve(false); await settle(ui);
    assert.equal(text(ui.render()), 'denied');
  } finally { ui.unmount(); }
});

test('the boolean permission wrapper stays fail-closed until a successful check', async () => {
  const state = fixture(), ui = host(() => ({ props: { children: String(usePermissions([{ target: '/MediaLibrary', action: 'read' }])) } }));
  try {
    assert.equal(text(ui.flush()), 'false');
    await allowRead(state, ui); assert.equal(text(ui.render()), 'true');
    state.invalidate(); assert.equal(text(ui.render()), 'false');
  } finally { ui.unmount(); }
});

test('a late allowed permission response cannot authorize the next identity', async () => {
  const state = fixture();
  const ui = host(() => ({ props: { children: usePermissionState([{ target: '/MediaLibrary', action: 'read' }]) } }));
  try {
    ui.flush(); const earlierIdentity = state.permissions[0];
    state.auth = { ...state.auth, accessToken: 'next-user', user: { sub: 'next-user' } };
    state.invalidate(); assert.equal(text(ui.flush()), 'checking');
    assert.equal(state.permissions.length, 2);
    state.permissions[1].resolve(false); await settle(ui);
    assert.equal(text(ui.render()), 'denied');
    earlierIdentity.resolve(true); await settle(ui);
    assert.equal(text(ui.render()), 'denied');
  } finally { ui.unmount(); }
});

test('20 permission consumers make no idle/focus/visibility refresh and still honor explicit invalidation', async () => {
  function lifecycleFixture() {
    const state = fixture(), intervals = new Map(), windowEvents = new Map(), documentEvents = new Map();
    const added = { interval: 0, focus: 0, visibilitychange: 0 };
    const add = (events, type, listener) => { if (!events.has(type)) events.set(type, new Set()); events.get(type).add(listener); added[type]++; };
    const remove = (events, type, listener) => events.get(type)?.delete(listener);
    globalThis.window = {
      addEventListener: (type, listener) => add(windowEvents, type, listener),
      removeEventListener: (type, listener) => remove(windowEvents, type, listener),
      setInterval: (run, delay) => { const id = ++added.interval; intervals.set(id, { run, delay }); return id; },
      clearInterval: id => intervals.delete(id),
    };
    globalThis.document = { visibilityState: 'visible',
      addEventListener: (type, listener) => add(documentEvents, type, listener),
      removeEventListener: (type, listener) => remove(documentEvents, type, listener) };
    const emit = (events, type) => { for (const listener of events.get(type) || []) listener(); };
    const assertResources = count => {
      assert.equal(intervals.size, count); assert.equal(windowEvents.get('focus')?.size || 0, count);
      assert.equal(documentEvents.get('visibilitychange')?.size || 0, count);
    };
    return { state, intervals, added, assertResources, focus: () => emit(windowEvents, 'focus'), visible: () => emit(documentEvents, 'visibilitychange') };
  }
  const session = lifecycleFixture(), mounted = new Set(), originalNow = Date.now;
  try {
    for (let target = 1; target <= 20; target++) {
      const ui = host(() => ({ props: { children: String(usePermissions([{ target, action: 'read' }])) } }));
      mounted.add(ui); ui.flush();
    }
    assert.equal(session.state.permissions.length, 20);
    session.assertResources(0); assert.deepEqual(session.added, { interval: 0, focus: 0, visibilitychange: 0 });
    for (const pending of session.state.permissions) pending.resolve(true);
    for (const ui of mounted) await settle(ui);
    Date.now = () => 86_500_000;
    for (let event = 0; event < 3; event++) {
      session.focus(); session.visible();
      for (const timer of session.intervals.values()) timer.run();
      for (const ui of mounted) await settle(ui);
    }
    assert.equal(session.state.permissions.length, 20, 'a loaded content view is not a live service');
    session.state.invalidate();
    for (const ui of mounted) ui.flush();
    assert.equal(session.state.permissions.length, 40, 'explicit app invalidation still rechecks each mounted consumer');
    assert.deepEqual(session.state.permissions.slice(20).map(call => call.operations[0].target), Array.from({ length: 20 }, (_, index) => index + 1));
    const consumers = [...mounted];
    for (const ui of consumers.slice(0, -1)) { ui.unmount(); mounted.delete(ui); }
    session.assertResources(0); assert.equal(session.state.listeners.size, 1);
    consumers.at(-1).unmount(); mounted.clear();
    session.assertResources(0); assert.equal(session.state.listeners.size, 0);

    const next = lifecycleFixture(), remounted = host(() => ({ props: { children: String(usePermissions([{ target: 99, action: 'read' }])) } }));
    mounted.add(remounted); remounted.flush(); next.assertResources(0);
    assert.deepEqual(next.added, { interval: 0, focus: 0, visibilitychange: 0 });
    next.focus(); assert.equal(next.state.permissions.length, 1, 'the next fixture must not inherit earlier consumers');
    remounted.unmount(); mounted.clear(); next.assertResources(0);
  } finally {
    for (const ui of mounted) ui.unmount();
    Date.now = originalNow;
  }
});

for (const [kind, Component] of pages) {
  test(`${kind}: header and filters survive pending permission and initial data requests`, async () => {
    const state = fixture(), ui = host(Component);
    try {
      let tree = ui.flush(); assertChrome(tree, kind);
      assert.match(text(tree), /Checking access/);
      assert.equal(state.requests.length, 0, 'data must wait for read permission');
      await allowRead(state, ui); tree = ui.render(); assertChrome(tree, kind);
      assert.equal(state.requests.length, 1);
      assert.ok(find(tree, node => node.type === 'CollectionPlaceholder'));
      assert.ok(find(tree, node => node.props?.['aria-busy'] === true));
    } finally { ui.unmount(); }
  });

  test(`${kind}: cards remain during filtering and late responses cannot replace the latest filter`, async () => {
    const state = fixture(), ui = host(Component);
    try {
      ui.flush(); await allowRead(state, ui);
      state.requests[0].resolve([item(kind, 'Original approved card')]); await settle(ui);
      assert.match(text(ui.render()), /Original approved card/);
      button(ui.render(), 'B').props.onClick(); let tree = ui.flush();
      assertChrome(tree, kind); assert.match(text(tree), /Original approved card/);
      assert.ok(find(tree, node => node.props?.['aria-busy'] === true));
      button(tree, 'C').props.onClick(); tree = ui.flush();
      assert.match(text(tree), /Original approved card/);
      assert.equal(state.requests.length, 3);
      assert.equal(state.requests[1].args[kind === 'media' ? 0 : 1], 'b');
      assert.equal(state.requests[2].args[kind === 'media' ? 0 : 1], 'c');
      state.requests[2].resolve([item(kind, 'Latest C card')]); await settle(ui);
      state.requests[1].resolve([item(kind, 'Stale B card')]); tree = await settle(ui);
      assertChrome(tree, kind); assert.match(text(tree), /Latest C card/);
      assert.doesNotMatch(text(tree), /Original approved card|Stale B card/);
      assert.equal(find(tree, node => node.props?.['aria-busy'] !== undefined).props['aria-busy'], false);
    } finally { ui.unmount(); }
  });

  test(`${kind}: checking and denial mask previous cards before effects and discard in-flight results`, async () => {
    const state = fixture(), ui = host(Component);
    try {
      ui.flush(); await allowRead(state, ui);
      state.requests[0].resolve([item(kind, 'Private previous identity')]); await settle(ui);
      assert.match(text(ui.render()), /Private previous identity/);
      button(ui.render(), 'B').props.onClick(); ui.flush();
      state.auth = { ...state.auth, accessToken: 'different-user', user: { sub: 'different-user' } };
      state.invalidate();
      let tree = ui.render(); assertChrome(tree, kind);
      assert.match(text(tree), /Checking access/);
      assert.doesNotMatch(text(tree), /Private previous identity/);
      ui.flush();
      state.requests[1].resolve([item(kind, 'Late private response')]);
      tree = await settle(ui); assert.doesNotMatch(text(tree), /Private previous identity|Late private response/);
      state.permissions.at(-1).resolve(false); tree = await settle(ui);
      assertChrome(tree, kind); assert.match(text(tree), /unavailable with your current permissions/);
      assert.doesNotMatch(text(tree), /Private previous identity|Late private response/);
      state.invalidate(); ui.flush(); await allowRead(state, ui);
      tree = ui.render(); assert.doesNotMatch(text(tree), /Private previous identity|Late private response/);
      assert.ok(find(tree, node => node.type === 'CollectionPlaceholder'), 'regaining access must await fresh data');
    } finally { ui.unmount(); }
  });

  test(`${kind}: a failed filter keeps previous cards and cannot paginate them with the failed query`, async () => {
    const state = fixture(), ui = host(Component), originalError = console.error;
    try {
      ui.flush(); await allowRead(state, ui);
      state.requests[0].resolve([item(kind, 'Previous card one'), item(kind, 'Previous card two')]); await settle(ui);
      button(ui.render(), 'B').props.onClick(); ui.flush();
      console.error = () => {};
      state.requests[1].reject(Error('filter unavailable'));
      const tree = await settle(ui); assertChrome(tree, kind);
      assert.match(text(tree), /Previous card one/);
      assert.match(text(tree), /Failed to load/);
      const more = find(tree, node => node.type === 'button' && /Load More/.test(text(node)));
      if (more) { assert.equal(more.props.disabled, true); await more.props.onClick(); }
      assert.equal(state.requests.length, 2);
    } finally { console.error = originalError; ui.unmount(); }
  });
}
