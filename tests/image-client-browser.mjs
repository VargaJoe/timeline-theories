// Optional real-browser raster proof; uses generated fixtures and a fresh headless profile.
// Start the local Vite app first, then: node tests/image-client-browser.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
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
  const inputs = [1, 2, 3, 4].map(id => ({ id, base64: fixtures.png(360, 480, id).toString('base64') }));
  const result = await page.evaluate(async inputs => {
    const { generateImageVariants, posterStripLayout } = await import('/utils/imageGenerator.ts');
    const blobs = inputs.map(input => new Blob([Uint8Array.from(atob(input.base64), value => value.charCodeAt(0))], { type: 'image/png' }));
    const toBase64 = async blob => { const bytes = new Uint8Array(await blob.arrayBuffer()); let value = ''; for (const byte of bytes) value += String.fromCharCode(byte); return btoa(value); };
    const sets = [];
    for (let count = 1; count <= 4; count++) {
      const options = { kind: 'timeline-composite', sources: inputs.slice(0, count).map(input => ({ id: input.id, url: '/fixture/' + input.id, stamp: 'fixed' })), fetchSource: async source => blobs[source.id - 1], seed: 42 };
      const generated = await generateImageVariants(options), repeated = await generateImageVariants(options);
      const small = generated.variants[0], bitmap = await createImageBitmap(small.blob);
      const canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      const rendering = canvas.getContext('2d'); rendering.drawImage(bitmap, 0, 0); bitmap.close();
      const firstSlot = posterStripLayout(count)[0];
      const cornerAlpha = rendering.getImageData(0, 0, 1, 1).data[3], centerAlpha = rendering.getImageData(Math.floor(firstSlot.x + firstSlot.width / 2), 100, 1, 1).data[3];
      const preview = document.createElement('div'); preview.className = 'preview'; preview.innerHTML = `<span>${count} selected poster${count > 1 ? 's' : ''}</span>`;
      const image = document.createElement('img'); image.src = URL.createObjectURL(small.blob); preview.appendChild(image); document.body.appendChild(preview);
      sets.push({ count, cornerAlpha, centerAlpha, deterministic: generated.variants.every((variant, index) => variant.sha256 === repeated.variants[index].sha256), variants: await Promise.all(generated.variants.map(async ({ blob, ...variant }) => ({ ...variant, base64: await toBase64(blob) }))) });
    }
    const style = document.createElement('style'); style.textContent = 'body{margin:20px;display:grid;grid-template-columns:repeat(2,400px);gap:20px;font:15px sans-serif;background:#eef2f8}.preview{height:245px;display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:12px;background:linear-gradient(135deg,#3e72b5,#243963);color:white}.preview span{height:25px}.preview img{width:400px;height:200px;object-fit:contain}'; document.head.appendChild(style);
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
    return { userAgent: navigator.userAgent, sets, pngFallback };
  }, inputs);
  for (const set of result.sets) {
    assert(set.deterministic, 'Repeated generation must have the same hashes in this browser.');
    assert.equal(set.cornerAlpha, 0, 'Composition must preserve transparent outer space.');
    assert.equal(set.centerAlpha, 255, 'Poster strip must remain visible.');
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
  await page.screenshot({ path: path.join(output, 'poster-strip-1-4.png'), fullPage: true });
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ checkedAt: new Date().toISOString(), frontend, ...result }, null, 2));
  console.log(JSON.stringify({ passed: true, sets: result.sets.length, outputs: result.sets.reduce((total, set) => total + set.variants.length, 0), output }));
} finally { await browser.close(); }
