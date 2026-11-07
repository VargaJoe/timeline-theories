import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';
import { posterStripLayout } from '../client/utils/posterStripLayout.mjs';

const component = fs.readFileSync(new URL('../client/components/PosterFan.tsx', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../client/components/PosterFan.css', import.meta.url), 'utf8');
const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const jsx = moduleUrl('export const jsx=(type,props)=>({type,props});export const jsxs=jsx;');
const compiled = ts.transpileModule(component.replace("import './PosterFan.css';", '')
  .replace("from '../utils/posterStripLayout.mjs'", `from '${new URL('../client/utils/posterStripLayout.mjs', import.meta.url).href}'`),
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  .replace('from "react/jsx-runtime"', `from '${jsx}'`);
const { PosterFan } = await import(moduleUrl(compiled));
const source = 'blob:https://app.fixture.invalid/already-authorized-strip';
const percentage = value => parseFloat(value) / 100;
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);

test('every saved poster is cropped in order from the same authorized Blob without creating or fetching assets', () => {
  const originalFetch = globalThis.fetch, originalCreate = URL.createObjectURL;
  globalThis.fetch = () => { throw Error('PosterFan must not fetch'); };
  URL.createObjectURL = () => { throw Error('PosterFan must not create another asset'); };
  try {
    for (let count = 1; count <= 4; count++) {
      const tree = PosterFan({ source, count, label: 'Timeline posters' });
      assert.equal(tree.props['data-poster-fan'], '');
      assert.equal(tree.props.style['--poster-fan-source'], `url(${JSON.stringify(source)})`);
      assert.equal(tree.props.role, 'img'); assert.equal(tree.props['aria-label'], 'Timeline posters');
      const slots = posterStripLayout(count), cards = tree.props.children;
      assert.equal(cards.length, count);
      cards.forEach((card, index) => {
        assert.equal(card.props['data-poster-index'], index); assert.equal(card.props['aria-hidden'], 'true');
        assert.equal(card.type, 'span'); assert.equal(card.props.tabIndex, undefined);
        const face = card.props.children;
        assert.equal(face.type, 'span'); assert.equal(face.props.className, 'poster-fan__surface'); assert.equal(face.props.src, undefined); assert.equal(face.props.tabIndex, undefined);
        const cardWidth = percentage(card.props.style.width) * 400, cardHeight = percentage(card.props.style.height) * 200;
        const [widthScale, heightScale] = face.props.style.backgroundSize.split(' ').map(percentage);
        const [x, y] = face.props.style.backgroundPosition.split(' ').map(percentage);
        const bitmapWidth = widthScale * cardWidth, bitmapHeight = heightScale * cardHeight;
        near(bitmapWidth / 400, bitmapHeight / 200);
        near(cardWidth / bitmapWidth * 400, slots[index].width - 4);
        near(cardHeight / bitmapHeight * 200, slots[index].height - 4);
        near((bitmapWidth - cardWidth) * x / bitmapWidth * 400, slots[index].x + 2);
        near((bitmapHeight - cardHeight) * y / bitmapHeight * 200, slots[index].y + 2);
      });
    }
    assert.equal((css.match(/background-image:/g) || []).length, 1);
    assert.match(css, /background-image:\s*var\(--poster-fan-source\)/);
    assert.doesNotMatch(css, /url\(/);
  } finally { globalThis.fetch = originalFetch; URL.createObjectURL = originalCreate; }
});

test('fan poses overlap in the original order and keep normal and raised faces inside responsive stages', () => {
  for (let count = 1; count <= 4; count++) {
    const cards = PosterFan({ source, count, label: '' }).props.children;
    const layers = cards.map(card => card.props.style['--poster-fan-layer']);
    const front = layers.indexOf(Math.max(...layers));
    assert.ok(Math.abs(front - (count - 1) / 2) <= 0.5, 'a middle card is in front');
    for (const stageWidth of [240, 320, 400]) {
      const stageHeight = stageWidth / 2;
      cards.forEach((card, index) => {
        const style = card.props.style, width = percentage(style.width) * stageWidth, height = percentage(style.height) * stageHeight;
        const x = percentage(style.left) * stageWidth, y = percentage(style.top) * stageHeight;
        const angle = parseFloat(style['--poster-fan-angle']) * Math.PI / 180;
        const halfWidth = (width * Math.cos(angle) + height * Math.abs(Math.sin(angle))) / 2;
        const halfHeight = (height * Math.cos(angle) + width * Math.abs(Math.sin(angle))) / 2;
        assert.ok(x - halfWidth >= 0 && x + halfWidth <= stageWidth);
        assert.ok(y - halfHeight >= 0 && y + halfHeight <= stageHeight);
        assert.ok(y - height * 0.06 - height * 1.035 / 2 >= 0, 'a lifted face fits without clipping');
        const original = posterStripLayout(count)[index];
        assert.ok(width * 1.035 / ((original.width - 4) * stageWidth / 400) <= 1.5, 'upfront 1.5 resolution scale covers the largest hover pose');
        if (index) {
          const previous = cards[index - 1].props.style;
          assert.ok(percentage(style.left) > percentage(previous.left));
          assert.ok((percentage(style.left) - percentage(previous.left)) * stageWidth < width, 'neighboring cards overlap');
        }
      });
    }
  }
  assert.match(css, /aspect-ratio:\s*2\s*\/\s*1/); assert.match(css, /overflow:\s*visible/);
  assert.match(css, /@media\s*\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
  assert.match(css, /\.poster-fan__card:hover\s*\{\s*z-index:\s*10/);
  assert.match(css, /pointer-events:\s*none/);
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*transition:\s*none/);
  assert.doesNotMatch(css, /@keyframes|animation:/);
});

test('unsupported counts or a missing authorized source render no image windows', () => {
  for (const count of [0, -1, 1.5, 5, NaN]) assert.equal(PosterFan({ source, count, label: '' }), null);
  assert.equal(PosterFan({ source: '', count: 3, label: '' }), null);
});
