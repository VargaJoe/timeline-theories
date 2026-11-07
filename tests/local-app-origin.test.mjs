import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from '../client/node_modules/typescript/lib/typescript.js';

const moduleUrl = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const compile = file => ts.transpileModule(fs.readFileSync(new URL('../client/' + file, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 }
}).outputText;
const helperUrl = moduleUrl(compile('utils/localAppOrigin.ts'));
const { canonicalLocalAppUrl } = await import(helperUrl);

test('local numeric aliases preserve the complete route on the API/OIDC localhost origin', () => {
  for (const hostname of ['127.0.0.1', '[::1]']) {
    for (const route of ['/', '/timelines?filter=t#cards', '/media-library?search=A%20B#cover',
      '/authentication/callback?code=opaque%2Bvalue&state=opaque%2Fstate', '/timelines/escaped%20title?x=1&x=2#item%203']) {
      assert.equal(canonicalLocalAppUrl(`https://${hostname}:8080${route}`, true), `https://localhost:8080${route}`);
    }
  }
});

test('canonical, hosted, foreign, malformed and other local origins are left alone', () => {
  for (const href of ['https://localhost:8080/timelines', 'https://timeline-theories.netlify.app/timelines',
    'https://127.0.0.1.evil.invalid:8080/timelines', 'https://localhost.evil.invalid:8080/',
    'https://127.0.0.2:8080/', 'https://127.0.0.1:41016/', 'https://127.0.0.1/',
    'http://127.0.0.1:8080/', 'https://user:password@127.0.0.1:8080/', '/timelines', 'invalid']) {
    assert.equal(canonicalLocalAppUrl(href, true), undefined, href);
  }
  assert.equal(canonicalLocalAppUrl('https://127.0.0.1:8080/timelines', false), undefined);
});

async function bootstrap(href, { dev = false, mode = 'development' } = {}) {
  const previousWindow = globalThis.window, previousEvents = globalThis.__localBootstrapEvents;
  const events = [], url = new URL(href);
  globalThis.__localBootstrapEvents = events;
  globalThis.window = { location: { href, origin: url.origin, replace: target => events.push({ type: 'replace', target }) } };
  // Execute the real entry module, replacing only browser/build dependencies.
  // The render import stands for the App/auth dependency graph and must never
  // be evaluated at the alias, even if location.replace returns immediately.
  const configurationUrl = moduleUrl(`export const environment = ${JSON.stringify({ mode })};`);
  const renderUrl = moduleUrl(`globalThis.__localBootstrapEvents.push({type: 'render', origin: window.location.origin}); // ${href}`);
  const source = compile('main.tsx')
    .replaceAll("'./configuration'", JSON.stringify(configurationUrl))
    .replaceAll("'./utils/localAppOrigin'", JSON.stringify(helperUrl))
    .replaceAll("'./renderApp'", JSON.stringify(renderUrl))
    .replaceAll('import.meta.env.DEV', JSON.stringify(dev));
  try {
    await import(moduleUrl(source + '\n// ' + href));
    await new Promise(resolve => setImmediate(resolve));
    return events;
  } finally {
    globalThis.window = previousWindow;
    globalThis.__localBootstrapEvents = previousEvents;
  }
}

test('entry redirects before evaluating App/auth at local numeric aliases', async () => {
  assert.deepEqual(await bootstrap('https://127.0.0.1:8080/timelines?filter=t#cards', { dev: true }), [
    { type: 'replace', target: 'https://localhost:8080/timelines?filter=t#cards' }
  ]);
  assert.deepEqual(await bootstrap('https://[::1]:8080/media-library', { mode: 'm0-local' }), [
    { type: 'replace', target: 'https://localhost:8080/media-library' }
  ]);
});

test('entry renders once on canonical local and hosted addresses without redirecting', async () => {
  for (const [href, options] of [
    ['https://localhost:8080/timelines', { dev: true }],
    ['https://localhost:8080/media-library', { mode: 'm0-local' }],
    ['https://preview.fixture.invalid/timelines', {}],
    ['https://127.0.0.1:8080/timelines', {}]
  ]) {
    assert.deepEqual(await bootstrap(href, options), [{ type: 'render', origin: new URL(href).origin }]);
  }
});
