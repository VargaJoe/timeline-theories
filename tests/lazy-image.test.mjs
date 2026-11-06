import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
function compile(path, imports) {
  let output = ts.transpileModule(fs.readFileSync(new URL('../client/' + path, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const [name, target] of Object.entries(imports)) output = output.replaceAll(`from '${name}'`, `from '${target}'`).replaceAll(`from "${name}"`, `from '${target}'`);
  return moduleUrl(output);
}
const react = moduleUrl(`
export const useState=value=>globalThis.__lazyHooks.state(value);
export const useRef=value=>globalThis.__lazyHooks.ref(value);
export const useEffect=(fn,deps)=>globalThis.__lazyHooks.effect(fn,deps);
export default {};
`);
const jsx = moduleUrl("export const jsx=(type,props)=>({type,props}); export const jsxs=jsx;");
const sensenet = moduleUrl(`
export const subscribePermissions=listener=>{globalThis.__lazyState.listeners.add(listener); return ()=>globalThis.__lazyState.listeners.delete(listener);};
export const captureOperationContext=()=>{const state=globalThis.__lazyState,epoch=state.epoch;return ()=>{if(epoch!==state.epoch)throw Error('context changed');};};
`);
const config = moduleUrl("export const repositoryUrl='https://repository.fixture.invalid'; export const siteConfig={imageCache:{concurrencyLimit:2}};");
const native = moduleUrl('export const nativeResponse=(...args)=>globalThis.__lazyState.fetch(...args);');
const loading = compile('utils/imageLoading.ts', { '../configuration': config, '../services/nativeApi': native });
const variants = compile('utils/imageVariants.ts', {});
const { LazyImage } = await import(compile('components/LazyImage.tsx', {
  react, 'react/jsx-runtime': jsx, '../services/sensenet': sensenet,
  '../context/useSharedAuth': moduleUrl('export const useSharedAuth=()=>globalThis.__lazyState.auth;'),
  '../utils/imageLoading': loading, '../utils/imageVariants': variants,
}));
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; }
function find(tree, type) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (tree.type === type) return tree;
  for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) { const result = find(child, type); if (result) return result; }
}
function host(Component, target) {
  const slots = [], effects = []; let cursor = 0, dirty = true, tree;
  const changed = (a, b) => !a || !b || a.length !== b.length || a.some((value, index) => !Object.is(value, b[index]));
  const hooks = {
    state(initial) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => {
        const value = typeof update === 'function' ? update(slots[index].value) : update;
        if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; }
      }];
    },
    ref(initial) { return slots[cursor++] ??= { current: initial }; },
    effect(fn, deps) {
      const index = cursor++;
      if (!slots[index] || changed(slots[index].deps, deps)) {
        const cleanup = slots[index]?.cleanup; slots[index] = { deps, cleanup };
        effects.push(() => { cleanup?.(); slots[index].cleanup = fn(); });
      }
    },
  };
  const ui = {
    render() { cursor = 0; globalThis.__lazyHooks = hooks; tree = Component(); if (tree.props?.ref) tree.props.ref.current = target; return tree; },
    flush() {
      for (let pass = 0; pass < 30; pass++) {
        dirty = false; ui.render(); while (effects.length) effects.shift()(); if (!dirty) return tree;
      }
      throw Error('image hook host did not settle');
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
  return ui;
}
function fixture() {
  const previous = { window: globalThis.window, document: globalThis.document, IntersectionObserver: globalThis.IntersectionObserver, ResizeObserver: globalThis.ResizeObserver, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  const windowEvents = new Map(), documentEvents = new Map(), timers = new Map(); let timerId = 0;
  const add = (events, name, listener) => { if (!events.has(name)) events.set(name, new Set()); events.get(name).add(listener); };
  const remove = (events, name, listener) => events.get(name)?.delete(listener);
  const state = {
    epoch: 0, listeners: new Set(), requests: [], observers: [], resizes: [], created: [], revoked: [],
    auth: { accessToken: 'owner-one', user: { sub: 'owner-one' }, isLoading: false },
    target: { width: 120, getBoundingClientRect() { return { width: this.width, top: 0, left: 0, right: this.width, bottom: 180 }; } },
    fetch(path, options) { const pending = deferred(); this.requests.push({ path, options, ...pending }); return pending.promise; },
    invalidate() { this.epoch++; for (const listener of this.listeners) listener(); },
    visible(value = true) { this.observers.at(-1).callback([{ isIntersecting: value }]); },
    focus() { for (const listener of [...(windowEvents.get('focus') ?? [])]) listener(); },
    poll() { for (const timer of [...timers.values()]) timer.listener(); },
    documentVisibility(value) { document.visibilityState = value; for (const listener of [...(documentEvents.get('visibilitychange') ?? [])]) listener(); },
    timers, windowEvents, documentEvents,
    restore() {
      globalThis.window = previous.window; globalThis.document = previous.document; globalThis.IntersectionObserver = previous.IntersectionObserver; globalThis.ResizeObserver = previous.ResizeObserver;
      URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke;
      delete globalThis.__lazyState; delete globalThis.__lazyHooks;
    },
  };
  globalThis.__lazyState = state;
  globalThis.window = { location: { origin: 'https://app.fixture.invalid' }, devicePixelRatio: 3,
    addEventListener: (name, listener) => add(windowEvents, name, listener), removeEventListener: (name, listener) => remove(windowEvents, name, listener),
    setInterval(listener, delay) { const id = ++timerId; timers.set(id, { listener, delay }); return id; }, clearInterval: id => timers.delete(id) };
  globalThis.document = { visibilityState: 'visible', addEventListener: (name, listener) => add(documentEvents, name, listener), removeEventListener: (name, listener) => remove(documentEvents, name, listener) };
  globalThis.IntersectionObserver = class { constructor(callback, options) { this.callback = callback; this.options = options; state.observers.push(this); } observe() {} disconnect() { this.disconnected = true; } };
  globalThis.ResizeObserver = class { constructor(callback) { this.callback = callback; state.resizes.push(this); } observe() {} disconnect() {} };
  URL.createObjectURL = () => { const url = 'blob:image-' + state.created.length; state.created.push(url); return url; };
  URL.revokeObjectURL = url => state.revoked.push(url);
  return state;
}
const generationId = '12345678-1234-4123-8123-123456789abc';
const descriptor = { state: 'active', generationId, variants: [160, 320, 640].map(width => ({ name: `w${width}`, width, height: width * 1.5, url: `/api/v1/images/1/${generationId}/w${width}` })) };
async function settle(ui) { await tick(); ui.flush(); await tick(); return ui.flush(); }

test('offscreen images never enqueue; first intersection chooses one DPR variant and only insufficient growing slots upgrade', async () => {
  const state = fixture(), ui = host(() => LazyImage({ image: descriptor, src: 'https://repository.fixture.invalid/original', alt: 'Poster' }), state.target);
  try {
    assert.equal(find(ui.flush(), 'img'), undefined); await tick(); assert.equal(state.requests.length, 0);
    assert.equal(state.observers[0].options.rootMargin, '0px');
    state.visible(false); await settle(ui); assert.equal(state.requests.length, 0);
    state.visible(); await settle(ui); assert.equal(state.requests.length, 1); assert.match(state.requests[0].path, /w320$/);
    state.requests[0].resolve(new Response('variant')); let tree = await settle(ui);
    assert.equal(find(tree, 'img').props.src, state.created[0]);
    find(tree, 'img').props.onLoad({}); tree = ui.flush(); assert.equal(tree.props['data-image-state'], 'loaded');
    state.target.width = 150; state.resizes[0].callback(); await settle(ui); assert.equal(state.requests.length, 1);
    state.target.width = 500; state.resizes[0].callback(); await settle(ui); assert.equal(state.requests.length, 2); assert.match(state.requests[1].path, /w640$/);
    state.requests[1].resolve(new Response('larger variant')); await settle(ui);
    state.target.width = 60; state.resizes[0].callback(); await settle(ui); assert.equal(state.requests.length, 2);
    state.target.width = 1500; state.resizes[0].callback(); await settle(ui); assert.equal(state.requests.length, 2);
    ui.unmount(); assert.deepEqual(state.revoked, state.created); assert(state.requests[0].options.signal.aborted);
  } finally { ui.unmount(); state.restore(); }
});

test('identity change aborts old bytes, masks old image synchronously and requires a fresh viewport observation', async () => {
  const state = fixture(), ui = host(() => LazyImage({ image: descriptor }), state.target);
  try {
    ui.flush(); state.visible(); await settle(ui); assert.equal(state.requests.length, 1);
    state.auth = { ...state.auth, accessToken: 'owner-two', user: { sub: 'owner-two' } }; state.invalidate();
    assert.equal(find(ui.render(), 'img'), undefined); ui.flush(); assert(state.requests[0].options.signal.aborted);
    state.requests[0].resolve(new Response('old-private-image')); await settle(ui); assert.deepEqual(state.created, []);
    assert.equal(state.requests.length, 1); state.visible(); await settle(ui); assert.equal(state.requests.length, 2);
    state.observers[0].callback([{ isIntersecting: true }]); await settle(ui); assert.equal(state.requests.length, 2, 'A queued observer callback from the old identity must be ignored.');
    state.requests[1].resolve(new Response('new-image')); await settle(ui); assert.equal(state.created.length, 1);
    state.invalidate(); assert.equal(find(ui.render(), 'img'), undefined); ui.flush(); assert.deepEqual(state.revoked, state.created);
  } finally { ui.unmount(); state.restore(); }
});

test('a DPR increase upgrades the same CSS slot and a DPR decrease keeps the larger raster', async () => {
  const state = fixture(), ui = host(() => LazyImage({ image: descriptor }), state.target);
  window.devicePixelRatio = 1;
  try {
    ui.flush(); state.visible(); await settle(ui); assert.match(state.requests[0].path, /w160$/);
    state.requests[0].resolve(new Response('one DPR')); await settle(ui);
    window.devicePixelRatio = 2; state.resizes[0].callback(); await settle(ui);
    assert.equal(state.requests.length, 2); assert.match(state.requests[1].path, /w320$/);
    state.requests[1].resolve(new Response('two DPR')); await settle(ui);
    window.devicePixelRatio = 1; state.resizes[0].callback(); await settle(ui); assert.equal(state.requests.length, 2);
  } finally { ui.unmount(); state.restore(); }
});

test('offscreen and loaded images send no idle, focus or visibility requests and register no refresh lifecycle', async () => {
  const state = fixture(), ui = host(() => LazyImage({ image: descriptor, src: 'private-original' }), state.target);
  try {
    ui.flush(); state.focus(); state.poll(); state.documentVisibility('hidden'); state.documentVisibility('visible');
    await settle(ui); assert.equal(state.requests.length, 0);
    state.visible(); await settle(ui);
    state.requests[0].resolve(new Response('private-composite')); let tree = await settle(ui);
    find(tree, 'img').props.onLoad({}); ui.flush();
    assert.equal(state.timers.size, 0); assert.equal(state.windowEvents.get('focus')?.size || 0, 0);
    assert.equal(state.documentEvents.get('visibilitychange')?.size || 0, 0);
    for (let cycle = 0; cycle < 3; cycle++) {
      state.focus(); state.poll(); state.documentVisibility('hidden'); state.documentVisibility('visible');
      tree = await settle(ui);
    }
    assert.equal(find(tree, 'img').props.src, state.created[0]); assert.equal(state.created.length, 1); assert.deepEqual(state.revoked, []);
    state.visible(false); ui.flush(); state.focus(); state.poll(); state.visible(); tree = await settle(ui);
    assert.equal(tree.props['data-image-state'], 'loaded'); assert.equal(state.requests.length, 1);
    assert.match(state.requests[0].path, /\/images\/.*\/w320$/);
  } finally { ui.unmount(); state.restore(); }
});

test('explicit permission invalidation revokes cached bytes and a denied fresh image GET fails closed', async () => {
  const state = fixture(), ui = host(() => LazyImage({ image: descriptor, src: 'private-original' }), state.target);
  try {
    ui.flush(); state.visible(); await settle(ui); state.requests[0].resolve(new Response('private-image')); await settle(ui);
    state.invalidate(); assert.equal(find(ui.render(), 'img'), undefined); ui.flush();
    assert(state.requests[0].options.signal.aborted); assert.deepEqual(state.revoked, state.created);
    assert.equal(state.requests.length, 1, 'invalidation requires a fresh viewport observation before another image fetch');
    state.visible(); await settle(ui); assert.equal(state.requests.length, 2);
    assert.equal(state.requests[1].path, state.requests[0].path); assert.equal(state.requests[1].options.cache, 'no-store');
    state.requests[1].resolve(new Response('{}', { status: 403 })); const tree = await settle(ui);
    assert.equal(find(tree, 'img'), undefined); assert.deepEqual(state.revoked, state.created); assert.equal(tree.props['data-image-state'], 'error');
    state.focus(); state.poll(); await settle(ui); assert.equal(state.requests.length, 2, 'a denial never fetches the original source');
  } finally { ui.unmount(); state.restore(); }
});

test('an explicit blocked, stale or missing descriptor masks and revokes a loaded composite without fallback', async () => {
  for (const status of ['blocked', 'stale', 'missing']) {
    const state = fixture(); let image = descriptor;
    const ui = host(() => LazyImage({ image, src: 'legacy-original' }), state.target);
    try {
      ui.flush(); state.visible(); await settle(ui); state.requests[0].resolve(new Response('old-composite')); await settle(ui);
      image = { ...descriptor, state: status };
      assert.equal(find(ui.render(), 'img'), undefined); const tree = await settle(ui);
      assert.equal(find(tree, 'img'), undefined); assert.deepEqual(state.revoked, state.created); assert.equal(state.requests.length, 1);
      assert(state.requests[0].options.signal.aborted); assert.equal(tree.props['data-image-state'], status);
    } finally { ui.unmount(); state.restore(); }
  }
});

test('an explicit replacement generation requires fresh viewport loading and never reuses the old Blob', async () => {
  const state = fixture(); let image = descriptor;
  const ui = host(() => LazyImage({ image, src: 'legacy-original' }), state.target);
  try {
    ui.flush(); state.visible(); await settle(ui); state.requests[0].resolve(new Response('old-composite')); await settle(ui);
    const nextGeneration = '87654321-1234-4123-8123-123456789abc';
    image = { ...descriptor, generationId: nextGeneration, variants: descriptor.variants.map(variant => ({ ...variant, url: variant.url.replace(generationId, nextGeneration) })) };
    assert.equal(find(ui.render(), 'img'), undefined); ui.flush();
    assert.deepEqual(state.revoked, state.created); assert(state.requests[0].options.signal.aborted);
    assert.equal(state.requests.length, 1);
    state.visible(); await settle(ui); assert.equal(state.requests.length, 2); assert(state.requests[1].path.includes(nextGeneration));
    state.requests[1].resolve(new Response('new-composite')); const tree = await settle(ui);
    assert.equal(find(tree, 'img').props.src, state.created[1]); assert.equal(state.revoked.length, 1);
  } finally { ui.unmount(); state.restore(); }
});

test('blocked, missing and stale descriptors never fetch the legacy source; 403 does not retry an original', async () => {
  const state = fixture(); let image = { ...descriptor, state: 'blocked' };
  const ui = host(() => LazyImage({ image, src: 'private-original' }), state.target);
  try {
    for (const status of ['blocked', 'missing', 'stale']) { image = { ...descriptor, state: status }; ui.flush(); await tick(); assert.equal(state.requests.length, 0); }
    image = descriptor; ui.flush(); state.visible(); await settle(ui); assert.equal(state.requests.length, 1);
    state.requests[0].resolve(new Response('{}', { status: 403 })); const tree = await settle(ui);
    assert.equal(tree.props['data-image-state'], 'error'); assert.equal(find(tree, 'img'), undefined); assert.equal(state.requests.length, 1);
  } finally { ui.unmount(); state.restore(); }
});

test('unmount before a queued image starts removes it from the shared two-worker queue', async () => {
  const state = fixture(), images = [1, 2, 3].map(id => host(() => LazyImage({ src: `/api/v1/images/${id}/one/w320` }), state.target));
  try {
    for (const ui of images) { ui.flush(); state.visible(); await settle(ui); }
    assert.equal(state.requests.length, 2); images[2].unmount();
    state.requests.forEach(request => request.resolve(new Response('image'))); await settle(images[0]); await settle(images[1]);
    assert.equal(state.requests.length, 2);
  } finally { images.forEach(ui => ui.unmount()); state.restore(); }
});
