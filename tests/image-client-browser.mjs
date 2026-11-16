// Optional real-browser raster proof; uses generated fixtures and a fresh headless profile.
// Start the local Compose app first, then: node tests/image-client-browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fixtures from '../scripts/helpers/image-variant-fixture.cjs';

const require = createRequire(import.meta.url);
const playwright = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'));
const chromiumParts = ['ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'];
const localChromium = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), ...chromiumParts);
const executablePath = process.env.M0_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(localChromium) ? localChromium : path.join(os.homedir(), 'AppData', 'Local', ...chromiumParts));
const frontend = process.env.IMAGE_PROBE_FRONTEND || 'https://localhost:8080';
assert(['localhost', '127.0.0.1'].includes(new URL(frontend).hostname), 'Browser raster proof must target the local app.');
const output = path.resolve('deployment/.local/image-client-browser');
fs.mkdirSync(output, { recursive: true });
const browser = await playwright.chromium.launch({ headless: true, executablePath });
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 880, height: 600 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  // A deliberately blank probe document omits the app entry's injected public profile.
  await page.addInitScript(() => { globalThis.__TIMELINE_PROFILE__ = { repositoryUrl: 'https://localhost:41016', projectRoot: '/Root/Content/timelines', authority: 'https://localhost:41016', clientId: 'raster-probe', authType: 'oidc', mode: 'm0-local' }; });
  await page.route('**/__image_raster_probe__', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }));
  await page.goto(frontend + '/__image_raster_probe__');
  const inputs = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, base64: fixtures.png(360, 480, index + 1).toString('base64') }));
  const result = await page.evaluate(async inputs => {
    const { default: refresh } = await import('/@react-refresh');
    refresh.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const { generateImageVariants, posterStripLayout } = await import('/utils/imageGenerator.ts');
    const { PosterFan } = await import('/components/PosterFan.tsx');
    const mount = tree => {
      const node = document.createElement(tree.type);
      for (const [name, value] of Object.entries(tree.props)) {
        if (name === 'children' || value === undefined) continue;
        if (name === 'style') for (const [property, setting] of Object.entries(value)) {
          if (property.startsWith('--')) node.style.setProperty(property, String(setting)); else node.style[property] = setting;
        } else node.setAttribute(name === 'className' ? 'class' : name, String(value));
      }
      for (const child of [tree.props.children].flat().filter(Boolean)) node.append(typeof child === 'object' ? mount(child) : document.createTextNode(String(child)));
      return node;
    };
    const toBase64 = async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); };
    const blobs = await Promise.all(inputs.map(async input => {
      const original = new Blob([Uint8Array.from(atob(input.base64), value => value.charCodeAt(0))], { type: 'image/png' });
      const bitmap = await createImageBitmap(original), canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 480;
      const rendering = canvas.getContext('2d'); rendering.drawImage(bitmap, 0, 0); bitmap.close();
      // A broad, distinct center fiducial survives both cover downsampling and
      // WebP chroma filtering; the surrounding gradient still exercises both.
      rendering.fillStyle = `rgb(${(180 + input.id * 53) % 256},${(240 + input.id * 29) % 256},${((180 ^ 240) + input.id * 37) % 256})`;
      rendering.fillRect(120, 180, 120, 120);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); canvas.width = 0; canvas.height = 0;
      input.base64 = await toBase64(blob); return blob;
    }));
    const faceMeans = (rendering, count) => posterStripLayout(count).map(slot => {
      const pixels = rendering.getImageData(Math.floor(slot.x + slot.width / 2) - 8, Math.floor(slot.y + slot.height / 2) - 8, 16, 16).data;
      return [0, 1, 2].map(channel => {
        let total = 0; for (let index = channel; index < pixels.length; index += 4) total += pixels[index];
        return total / 256;
      });
    });
    const sets = [];
    for (const count of [1, 2, 3, 4, 5, 8, 12]) {
      const options = { kind: 'timeline-composite', sources: inputs.slice(0, count).map(input => ({ id: input.id, url: '/fixture/' + input.id, stamp: 'fixed' })), fetchSource: async source => blobs[source.id - 1], seed: 42 };
      const beforeEncoding = [], beforeEncodingMeans = [], originalToBlob = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(...args) {
        if (this.width === 400) {
          const rendering = this.getContext('2d');
          beforeEncoding.push(posterStripLayout(count).map(slot => Array.from(rendering.getImageData(Math.floor(slot.x + slot.width / 2), Math.floor(slot.y + slot.height / 2), 1, 1).data)));
          beforeEncodingMeans.push(faceMeans(rendering, count));
        }
        originalToBlob.apply(this, args);
      };
      let generated, repeated;
      try { generated = await generateImageVariants(options); repeated = await generateImageVariants(options); }
      finally { HTMLCanvasElement.prototype.toBlob = originalToBlob; }
      const small = generated.variants[0], bitmap = await createImageBitmap(small.blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const rendering = canvas.getContext('2d'); rendering.drawImage(bitmap, 0, 0); bitmap.close();
      const slots = posterStripLayout(count), firstSlot = slots[0];
      const cornerAlpha = rendering.getImageData(0, 0, 1, 1).data[3], centerAlpha = rendering.getImageData(Math.floor(firstSlot.x + firstSlot.width / 2), Math.floor(firstSlot.y + firstSlot.height / 2), 1, 1).data[3];
      const faceSamples = slots.map(slot => Array.from(rendering.getImageData(Math.floor(slot.x + slot.width / 2), Math.floor(slot.y + slot.height / 2), 1, 1).data));
      const preview = document.createElement('div'); preview.className = 'preview'; preview.innerHTML = `<span>${count} selected poster${count > 1 ? 's' : ''}</span>`;
      const image = document.createElement('img'); image.src = URL.createObjectURL(small.blob); image.className = 'saved-atlas'; preview.appendChild(image);
      const fan = mount(PosterFan({ source: image.src, count, label: `${count} selected posters` })); fan.dataset.probeCount = String(count); preview.appendChild(fan); document.body.appendChild(preview);
      sets.push({ count, cornerAlpha, centerAlpha, faceSamples, faceMeans: faceMeans(rendering, count), beforeEncoding: beforeEncoding[0], beforeEncodingMeans: beforeEncodingMeans[0], sources: generated.sources, inputUnchanged: options.sources.every(source => source.stamp === 'fixed'), deterministic: generated.variants.every((variant, index) => variant.sha256 === repeated.variants[index].sha256), variants: await Promise.all(generated.variants.map(async ({ blob, ...variant }) => ({ ...variant, base64: await toBase64(blob) }))) });
    }
    const style = document.createElement('style'); style.textContent = 'body{margin:20px;display:grid;grid-template-columns:repeat(2,400px);gap:20px;font:15px sans-serif;background:#eef2f8}.preview{height:445px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(135deg,#3e72b5,#243963);color:white}.preview>span{height:25px}.preview img{width:400px;height:200px;object-fit:contain}.poster-fan{flex:none;margin:0}'; document.head.appendChild(style);
    await Promise.all(Array.from(document.images, image => image.decode()));
    const nativeToBlob = HTMLCanvasElement.prototype.toBlob;
    const pngChunks = async blob => {
      const bytes = new Uint8Array(await blob.arrayBuffer()), view = new DataView(bytes.buffer), names = [];
      for (let offset = 8; offset < bytes.length; offset += view.getUint32(offset) + 12) names.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
      return names;
    };
    let pngFallback;
    try {
      // Exercise the browser's real PNG encoder, including metadata, as an unsupported-WebP browser would.
      HTMLCanvasElement.prototype.toBlob = function(callback, _type, quality) { nativeToBlob.call(this, callback, 'image/png', quality); };
      const generated = await generateImageVariants({ kind: 'timeline-composite', sources: [{ id: 1, url: '/fixture/1', stamp: 'fixed' }], fetchSource: async () => blobs[0], seed: 42 });
      pngFallback = await Promise.all(generated.variants.map(async ({ blob, ...variant }) => {
        const image = await createImageBitmap(blob); const decoded = image.width === variant.width && image.height === variant.height; image.close();
        return { ...variant, decoded, chunks: await pngChunks(blob), base64: await toBase64(blob) };
      }));
    } finally { HTMLCanvasElement.prototype.toBlob = nativeToBlob; }
    return { userAgent: navigator.userAgent, fixtureInputs: inputs, sets, pngFallback };
  }, inputs);
  for (const set of result.sets) {
    assert(set.deterministic, 'Repeated generation must have the same hashes in this browser.');
    assert(set.inputUnchanged, 'Generating a preview must not mutate source descriptors.');
    assert.deepEqual(set.sources.map(source => source.stamp), result.fixtureInputs.slice(0, set.count).map(input => createHash('sha256').update(Buffer.from(input.base64, 'base64')).digest('hex')));
    assert.equal(set.cornerAlpha, 0, 'Composition must preserve transparent outer space.');
    assert.equal(set.centerAlpha, 255, 'Poster strip must remain visible.');
    for (let index = 0; index < set.faceSamples.length; index++) {
      const alpha = set.faceSamples[index][3], [red, green] = set.beforeEncoding[index], id = inputs[index].id;
      assert.equal(alpha, 255, `poster ${index + 1} of ${set.count} has a complete opaque face`);
      const expected = [(180 + id * 53) % 256, (240 + id * 29) % 256];
      // Verify source identity before lossy encoding. A single WebP chroma
      // sample can shift at this fixture's wrapped-gradient boundaries.
      assert.ok(Math.abs(red - expected[0]) < 8 && Math.abs(green - expected[1]) < 8, `poster ${index + 1} of ${set.count} remains in source order: actual ${red},${green}; expected ${expected}`);
      assert.ok(set.faceMeans[index].every((value, channel) => Math.abs(value - set.beforeEncodingMeans[index][channel]) < 8), `poster ${index + 1} of ${set.count} preserves its encoded face: actual ${set.faceMeans[index]}; expected ${set.beforeEncodingMeans[index]}`);
    }
    assert.deepEqual(set.variants.map(variant => variant.width), [400, 800, 1200]);
    for (const variant of set.variants) {
      assert.equal(variant.mimeType, 'image/webp');
      const bytes = Buffer.from(variant.base64, 'base64');
      assert.equal(bytes.length, variant.byteLength); assert(bytes.length <= 1024 * 1024);
      fs.writeFileSync(path.join(output, `${set.count}-${variant.name}.webp`), bytes);
      delete variant.base64;
    }
  }
  for (const variant of result.pngFallback) {
    assert.equal(variant.mimeType, 'image/png'); assert(variant.decoded);
    assert(variant.chunks.every(name => ['IHDR', 'IDAT', 'IEND'].includes(name)));
    fs.writeFileSync(path.join(output, 'fallback-' + variant.name + '.png'), Buffer.from(variant.base64, 'base64')); delete variant.base64;
  }
  result.fixtureInputs = result.fixtureInputs.map(({ id, base64 }) => ({ id, sha256: createHash('sha256').update(Buffer.from(base64, 'base64')).digest('hex') }));
  const hoverChecks = [];
  for (const count of [5, 8, 12]) {
    const fan = page.locator(`[data-probe-count="${count}"]`); await fan.scrollIntoViewIfNeeded();
    const targets = await fan.evaluate(stage => Array.from(stage.querySelectorAll('.poster-fan__card'), card => {
      const bounds = card.getBoundingClientRect();
      for (let y = bounds.top + 3; y < bounds.bottom; y += 3) for (let x = bounds.left + 3; x < bounds.right; x += 3) {
        if (document.elementFromPoint(x, y)?.closest('.poster-fan__card') === card) return { x, y };
      }
      return null;
    }));
    assert.ok(targets.every(Boolean), `each of ${count} cards has a stable hover target`);
    for (let index = 0; index < targets.length; index++) {
      await page.mouse.move(0, 0);
      await page.mouse.move(targets[index].x, targets[index].y); await page.waitForTimeout(200);
      const card = fan.locator('.poster-fan__card').nth(index);
      assert.equal(await card.evaluate(node => node.matches(':hover')), true);
      assert.equal(await card.evaluate(node => getComputedStyle(node).zIndex), '20');
      const pose = await card.evaluate(node => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(node.querySelector('.poster-fan__surface')).transform);
        return { scale: matrix.a, skewX: matrix.b, skewY: matrix.c, lift: matrix.f };
      });
      assert.ok(Math.abs(pose.scale - 1.035) < 0.001 && Math.abs(pose.skewX) < 0.001 && Math.abs(pose.skewY) < 0.001 && pose.lift < 0, 'hover raises and straightens the complete face');
    }
    hoverChecks.push({ count, reachableCards: targets.length }); await page.mouse.move(0, 0);
  }
  await page.waitForTimeout(220);
  await page.screenshot({ path: path.join(output, 'poster-strip-1-12.png'), fullPage: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), frontend, ...result, hoverChecks }, null, 2));
  console.log(JSON.stringify({ passed: true, sets: result.sets.length, outputs: result.sets.reduce((total, set) => total + set.variants.length, 0), output }));
} finally { await browser.close(); }
