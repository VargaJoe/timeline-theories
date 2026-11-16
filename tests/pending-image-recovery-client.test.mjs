import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const url = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = (file, imports) => {
  let source = ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  for (const [name, target] of Object.entries(imports)) source = source.replaceAll(`from '${name}'`, `from '${target}'`).replaceAll(`from "${name}"`, `from '${target}'`);
  return import(url(source));
};
const publication = () => ({ operationId: crypto.randomUUID(), ownerId: 90, title: 'Original timeline', action: 'image-draft',
  idempotencyKey: crypto.randomUUID() + ':draft', requestIds: [crypto.randomUUID()] });
const native = url(`export const nativeRequest=(...args)=>globalThis.__pendingImage.nativeRequest(...args);
export const nativeResponse=(...args)=>globalThis.__pendingImage.nativeResponse(...args);`);
const sense = url('export const captureOperationContext=()=>()=>{if(globalThis.__pendingImage.changed)throw Error("identity changed");};');
const service = await compile('../client/services/imageRecoveryService.ts', { './nativeApi': native, './sensenet': sense });

test('recovery discovery and retry preserve original operation/key and never dispatch images', async () => {
  const item = publication(), calls = [], abort = new AbortController(); let lost = true;
  globalThis.__pendingImage = { nativeRequest: async (...args) => { calls.push(args); return [item]; }, nativeResponse: async (...args) => {
    calls.push(args); if (lost) { lost = false; throw Error('lost response'); }
    return Response.json({ operationId: item.operationId, pending: false, abandoned: true, failure: { code: 'image_publication_abandoned' }, repositoryWrites: 0 });
  } };
  assert.deepEqual(await service.pendingImagePublications(abort.signal), [item]);
  assert.equal(calls[0][0], '/images/recovery/pending'); assert.equal(calls[0][1].cache, 'no-store');
  await assert.rejects(service.recoverPendingImage(item, abort.signal, { abandon: true }), /Verify the original/);
  assert.equal(calls.length, 1, 'missing explicit stop proof must not reach the API');
  const options = { requestId: item.requestIds[0], confirmStopped: true, abandon: true };
  await assert.rejects(service.recoverPendingImage(item, abort.signal, options), /lost response/);
  const result = await service.recoverPendingImage(item, abort.signal, options); assert.equal(result.abandoned, true);
  for (const call of calls.slice(1)) {
    assert.equal(call[0], '/images/recovery'); assert.equal(call[1].headers['Idempotency-Key'], item.idempotencyKey);
    assert.deepEqual(JSON.parse(call[1].body), { operationId: item.operationId, stoppedRequestId: item.requestIds[0], confirmStopped: true, abandon: true });
    assert.equal(call[2].pendingImageRecoveryId, item.operationId);
  }
  assert.equal(calls[1][1].body, calls[2][1].body);
});

test('malformed recovery discovery is rejected before it reaches panel rendering', async () => {
  for (const value of [{}, [null], [{ ...publication(), requestIds: null }], [{ ...publication(), idempotencyKey: 'different-key' }]]) {
    globalThis.__pendingImage = { nativeRequest: async () => value };
    await assert.rejects(service.pendingImagePublications(new AbortController().signal), /references could not be read/);
  }
});

const react = url('export const useState=v=>globalThis.__pendingHooks.state(v);export const useRef=v=>globalThis.__pendingHooks.ref(v);export const useEffect=(f,d)=>globalThis.__pendingHooks.effect(f,d);');
const jsx = url('export const jsx=(type,props,key)=>({type,props:{...props,key}});export const jsxs=jsx;export const Fragment="Fragment";');
const services = url(`export const pendingImagePublications=(...args)=>globalThis.__pendingPanel.discover(...args);
export const recoverPendingImage=(...args)=>globalThis.__pendingPanel.recover(...args);`);
const { PendingImageRecovery } = await compile('../client/components/PendingImageRecovery.tsx', { react, 'react/jsx-runtime': jsx, '../services/imageRecoveryService': services });
function nodes(tree, predicate, found = []) {
  if (!tree || typeof tree !== 'object') return found;
  if (!Array.isArray(tree) && predicate(tree)) found.push(tree);
  for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) nodes(child, predicate, found);
  return found;
}
function host() {
  let cursor = 0; const slots = [], effects = [];
  const hooks = {
    state(v) { const i = cursor++; slots[i] ??= { value: v }; return [slots[i].value, next => { slots[i].value = typeof next === 'function' ? next(slots[i].value) : next; }]; },
    ref(v) { return slots[cursor++] ??= { current: v }; },
    effect(f) { const i = cursor++; if (!slots[i]) { slots[i] = {}; effects.push(f); } },
  };
  return { render(disabled = false) { globalThis.__pendingHooks = hooks; cursor = 0; const tree = PendingImageRecovery({ disabled });
    for (const effect of effects.splice(0)) effect(); return tree; } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
const button = (tree, label) => nodes(tree, n => n.type === 'button' && n.props.children === label)[0];

test('panel makes no automatic request and requires exact-request stop confirmation for closure', async () => {
  const item = publication(), calls = []; let reads = 0;
  globalThis.__pendingPanel = { discover: async () => { reads++; return [item]; }, recover: async (...args) => { calls.push(args);
    return { operationId: item.operationId, pending: calls.length === 1, ...(calls.length > 1 ? { confirmed: true, failure: { code: 'backend_denied' } } : {}), repositoryWrites: 0 }; } };
  const ui = host(); let tree = ui.render(); assert.equal(reads, 0); ui.render(); assert.equal(reads, 0);
  button(tree, 'Check my unfinished publications').props.onClick(); await tick(); tree = ui.render(); assert.equal(reads, 1);
  assert.equal(button(tree, 'Close original failed attempt').props.disabled, true);
  button(tree, 'Check original saved outcome').props.onClick(); await tick(); tree = ui.render();
  assert.deepEqual(calls[0][2], {}); assert.equal(button(tree, 'Close original failed attempt').props.disabled, true);
  nodes(tree, n => n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } }); tree = ui.render();
  assert.equal(button(tree, 'Close original failed attempt').props.disabled, false);
  // Changing the request invalidates the attestation; it cannot drift to another invocation.
  nodes(tree, n => n.type === 'input' && n.props.type === 'text')[0].props.onChange({ target: { value: crypto.randomUUID() } }); tree = ui.render();
  assert.equal(button(tree, 'Close original failed attempt').props.disabled, true);
  nodes(tree, n => n.type === 'input' && n.props.type === 'text')[0].props.onChange({ target: { value: item.requestIds[0] } }); tree = ui.render();
  nodes(tree, n => n.type === 'input' && n.props.type === 'checkbox')[0].props.onChange({ target: { checked: true } }); tree = ui.render();
  button(tree, 'Close original failed attempt').props.onClick(); await tick(); tree = ui.render();
  assert.deepEqual(calls[1][2], { requestId: item.requestIds[0], confirmStopped: true, abandon: true });
  assert.equal(button(tree, 'Close original failed attempt'), undefined); assert.equal(reads, 1);
  const status = nodes(tree, n => n.props?.role === 'status')[0].props.children;
  assert.match(status, /failed attempt is closed/); assert.doesNotMatch(status, /saved step is confirmed/);
});
