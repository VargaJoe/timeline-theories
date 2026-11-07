import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const react = moduleUrl(`
export const useState=value=>globalThis.__editorPreviewHooks.state(value);
export const useRef=value=>globalThis.__editorPreviewHooks.ref(value);
export const useEffect=(fn,deps)=>globalThis.__editorPreviewHooks.effect(fn,deps);
`);
const jsx = moduleUrl('export const jsx=(type,props,key)=>({type,props:{...props,key}});export const jsxs=jsx;export const Fragment="Fragment";');
const widget = name => moduleUrl(`export const ${name}='${name}';`);
const forbidden = '()=>{throw Error("Preview tests must not write or fetch image bytes");}';
const services = moduleUrl(`
export const imageCapabilities=async()=>({available:true});
export const imagePresentation=async()=>globalThis.__editorPreviewState.current;
export const imageSets=async()=>[];
export const sourceForGeneration=async id=>({id});
export const originalImageBlob=${forbidden},deleteImageSet=${forbidden},restoreOriginalPresentation=${forbidden};
export class ImagePublication{constructor(){throw Error('Publication is forbidden in preview tests');}}
export class OriginalImageUpload{constructor(){throw Error('Upload is forbidden in preview tests');}}
`);
const imports = {
  react, 'react/jsx-runtime': jsx, './LazyImage': widget('LazyImage'), './PosterFan': widget('PosterFan'), './TimelineCover': widget('TimelineCover'),
  '../services/imageVariantService': services,
  '../services/sensenet': moduleUrl(`export const captureOperationContext=()=>()=>{};export const invalidatePermissions=${forbidden};
export const subscribePermissions=listener=>{const state=globalThis.__editorPreviewState;state.listeners.add(listener);return()=>state.listeners.delete(listener);};`),
  '../context/useSharedAuth': moduleUrl('export const useSharedAuth=()=>({accessToken:"fixture-owner",user:{sub:"fixture-owner"},isLoading:false});'),
  '../utils/imageGenerator': moduleUrl('export const generateImageVariants=input=>globalThis.__editorPreviewState.generate(input);'),
  '../services/nativeApi': moduleUrl('export class NativeApiError extends Error{};export const nativeSnapshot=async Id=>({Id,revision:"fixture-revision"});'),
};
let compiled = ts.transpileModule(fs.readFileSync(new URL('../client/components/ImagePresentationEditor.tsx', import.meta.url), 'utf8')
  .replace("import './ImagePresentationEditor.css';", ''), { compilerOptions: {
    module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
for (const [name, target] of Object.entries(imports)) compiled = compiled.replaceAll(`from '${name}'`, `from '${target}'`).replaceAll(`from "${name}"`, `from '${target}'`);
const { ImagePresentationEditor } = await import(moduleUrl(compiled));
const tick = () => new Promise(resolve => setImmediate(resolve));
function find(tree, predicate) {
  if (!tree || typeof tree !== 'object') return undefined;
  if (!Array.isArray(tree) && predicate(tree)) return tree;
  for (const child of Array.isArray(tree) ? tree : [tree.props?.children]) { const result = find(child, predicate); if (result) return result; }
}
const preview = tree => find(tree, node => node.props?.className?.startsWith('image-editor-preview '));
const byType = (tree, type) => find(tree, node => node.type === type);
const button = (tree, label) => { const result = find(tree, node => node.type === 'button' && node.props.children === label); assert.ok(result, `missing ${label}`); assert.equal(result.props.disabled, false); return result; };

// The public component and its single stateful session run in order; leaf image
// widgets stay inert. Pending effects coalesce so render-before-effects is testable.
function host(props) {
  const slots = [], effects = new Map(); let cursor = 0, dirty = true;
  const hooks = {
    state(initial) { const index = cursor++; slots[index] ??= { value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, update => { const value = typeof update === 'function' ? update(slots[index].value) : update; if (!Object.is(value, slots[index].value)) { slots[index].value = value; dirty = true; } }]; },
    ref(initial) { return slots[cursor++] ??= { current: initial }; },
    effect(run, deps) { const index = cursor++; if (!slots[index] || deps.some((value, i) => !Object.is(value, slots[index].deps[i]))) {
      slots[index] = { ...slots[index], deps }; effects.set(index, run);
    } },
  };
  return {
    render() { cursor = 0; globalThis.__editorPreviewHooks = hooks; const session = ImagePresentationEditor(props); return session.type(session.props); },
    flush() { for (let pass = 0; pass < 20; pass++) { dirty = false; const tree = this.render(); const pending = [...effects]; effects.clear();
      for (const [index, run] of pending) { slots[index].cleanup?.(); slots[index].cleanup = run(); }
      if (!dirty) return tree;
    } throw Error('preview hook host did not settle'); },
    unmount() { for (const slot of slots) { slot?.cleanup?.(); if (slot) slot.cleanup = undefined; } },
  };
}
function fixture() {
  const previous = { create: URL.createObjectURL, revoke: URL.revokeObjectURL, fetch: globalThis.fetch };
  const state = { current: { state: 'active', generationId: 'published-set', recipe: { sourceIds: [11, 12] }, variants: [] },
    listeners: new Set(), generations: [], created: [], revoked: [],
    generate(input) { return new Promise(resolve => this.generations.push({ input, resolve })); },
    result(index) { const input = this.generations[index].input; return { recipe: { sourceIds: input.sources.map(source => source.id) },
      variants: [{ name: 'w1200', width: 1200, height: 600, mimeType: 'image/webp', byteLength: 4, blob: new Blob(['set' + index]) }] }; },
    restore() { URL.createObjectURL = previous.create; URL.revokeObjectURL = previous.revoke; globalThis.fetch = previous.fetch; delete globalThis.__editorPreviewState; delete globalThis.__editorPreviewHooks; },
  };
  URL.createObjectURL = blob => { const url = 'blob:preview-' + state.created.length; state.created.push({ blob, url }); return url; };
  URL.revokeObjectURL = url => state.revoked.push(url);
  globalThis.fetch = () => { throw Error('No network is allowed in preview tests'); };
  globalThis.__editorPreviewState = state;
  return state;
}

for (const kind of ['timeline-composite', 'media-sizes']) test(`${kind}: new generated sets mask the previous preview before effects and release its Blob`, async () => {
  const state = fixture(), media = kind === 'media-sizes', generatedType = media ? 'img' : 'PosterFan', publishedType = media ? 'LazyImage' : 'TimelineCover';
  const ui = host({ ownerId: 90, kind, candidates: [11, 12, 13].map(id => ({ id, title: 'Poster ' + id, url: '/original/' + id })), onSaved: () => { throw Error('Preview must not publish'); } });
  try {
    ui.flush(); await tick(); let tree = ui.flush();
    assert.equal(byType(preview(tree), publishedType).props.image, state.current);
    assert.equal(byType(preview(tree), media ? 'TimelineCover' : 'LazyImage'), undefined);
    button(tree, media ? 'Prepare sizes' : 'Generate preview').props.onClick(); await tick();
    const first = state.result(0); state.generations[0].resolve(first); await tick(); tree = ui.flush();
    const firstPreview = byType(preview(tree), generatedType), firstUrl = state.created[0].url;
    assert.equal(firstPreview.props[media ? 'src' : 'source'], firstUrl);
    if (!media) assert.equal(firstPreview.props.count, 2);
    if (!media) find(tree, node => node.type === 'input' && node.props.type === 'checkbox' && !node.props.checked).props.onChange();
    button(ui.render(), media ? 'Prepare sizes' : 'Generate preview').props.onClick();
    assert.equal(byType(preview(ui.render()), generatedType), undefined, 'starting a replacement masks the old URL synchronously');
    await tick(); const second = state.result(1); state.generations[1].resolve(second); await tick();
    tree = ui.render();
    assert.equal(byType(preview(tree), generatedType), undefined, 'a new generated object must not inherit the previous set URL before passive effects');
    assert.ok(byType(preview(tree), publishedType)); assert.deepEqual(state.revoked, []);
    tree = ui.flush();
    const nextPreview = byType(preview(tree), generatedType);
    assert.equal(nextPreview.props[media ? 'src' : 'source'], state.created[1].url);
    if (!media) assert.equal(nextPreview.props.count, 3);
    assert.equal(state.created[0].blob, first.variants[0].blob); assert.equal(state.created[1].blob, second.variants[0].blob);
    assert.deepEqual(state.revoked, [firstUrl]);
    ui.unmount(); assert.deepEqual(state.revoked, state.created.map(item => item.url)); assert.equal(state.listeners.size, 0);
  } finally { ui.unmount(); state.restore(); }
});
