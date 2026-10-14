'use strict';
// Real scoped HTTPS client + independent Chromium/OIDC UI. Only isolated local UUID fixtures may change.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = require('./m0-local-api.cjs');
const FRONTEND = 'https://localhost:8080', GATEWAY = 'https://localhost:8081', PROJECT = '/Root/Content/timelines';
const SCOPES = ['content:read', 'timelines:write', 'media:write', 'entries:write', 'covers:write', 'metadata:write', 'providers:read', 'exchange:read', 'exchange:write'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6kAAAAASUVORK5CYII=','base64');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const reference = value => Array.isArray(value) ? reference(value[0]) : value && typeof value === 'object' ? value.Id : value;

async function smoke() {
  assert.equal(local.REPOSITORY, 'https://localhost:41016'); assert.equal(local.AUTHORITY, 'https://localhost:41017');
  const inventory = JSON.parse(fs.readFileSync(path.join(local.ROOT, 'm1-inventory.json'), 'utf8'));
  assert.equal(inventory.state, 'ready'); assert.equal(inventory.repositoryUrl, local.REPOSITORY);
  assert.equal(inventory.authority, local.AUTHORITY); assert.equal(inventory.projectRoot, PROJECT); assert.equal(inventory.credential.mode, 'ApiKey');
  const accounts = local.readAccounts(), editor = accounts.editor;
  const id = crypto.randomUUID(), prefix = 'm1-browser-api-' + id;
  const directory = path.join(local.ROOT, 'm1-browser-api-smoke', id); fs.mkdirSync(directory, { recursive: true });
  const report = { version: 1, ranAt: new Date().toISOString(), frontend: FRONTEND, gateway: GATEWAY, repository: local.REPOSITORY,
    project: PROJECT, fixturePrefix: prefix, client: 'Independent node:https scoped native client plus actual Chromium/OIDC Editor', checks: [], cleanup: [], passed: false };
  const secrets = Object.values(accounts).flatMap(account => [account.password, account.apiKey, account.token]).filter(value => typeof value === 'string' && value.length > 7);
  secrets.push(inventory.credential.value);
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value))
    .replace(/([?&](?:code|auth_code|state|session_state|access_token|refresh_token|id_token)=)[^&"\s]+/gi, '$1[redacted]');
  const owned = new Map(), rawMutations = [], nativeApplies = [], nativePlans = [], nativeGets = [], nativeFailures = [], externalOrigins = [], blockedOptionalAssets = [];
  let browser, context, page, grant, timeline, media, first, second, primaryFailure;
  const { createClient } = await import('./m1-client.mjs');
  const native = createClient({ baseUrl: GATEWAY + '/api/v1', repository: local.REPOSITORY, authority: local.AUTHORITY,
    project: PROJECT, caFile: path.join(local.ROOT, 'certificates/localhost.pem') });
  const record = (name, details = {}) => { report.checks.push({ name, passed: true, ...details }); console.log(JSON.stringify({ check: name, passed: true, ...details })); };
  const remember = snapshot => {
    assert.ok(snapshot.Name.startsWith(prefix)); assert.ok(snapshot.Path.startsWith(PROJECT + '/'));
    assert.ok(Number.isSafeInteger(snapshot.Id)); owned.set(snapshot.Id, { id: snapshot.Id, name: snapshot.Name, type: snapshot.Type, path: snapshot.Path }); return snapshot;
  };
  const read = async target => (await native.request('/content/' + target, { token: grant.token })).data;
  const preview = async commands => {
    const plan = await native.request('/plans', { method: 'POST', token: grant.token, body: { commands } });
    assert.equal(plan.repositoryWrites, 0); return plan;
  };
  const apply = async plan => {
    const result = await native.request('/plans/' + plan.id + '/apply', { method: 'POST', token: grant.token, body: {}, idempotencyKey: crypto.randomUUID() });
    assert.equal(result.ok, true); return result;
  };
  const create = async (type, fields, parentId) => {
    assert.ok(fields.Name.startsWith(prefix));
    const result = await apply(await preview([{ action: 'create', type, fields, ...(parentId ? { parentId } : {}) }]));
    return remember(await read(result.completed[0].result.id));
  };
  const sourceCount = async () => {
    const response = await local.request(local.REPOSITORY + '/OData.svc' + PROJECT + '?' + new URLSearchParams({
      query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': 'Id', '$top': '0', '$inlinecount': 'allpages', metadata: 'no',
    }), { account: { apiKey: inventory.credential.value } });
    assert.equal(response.status, 200); const value = response.value?.d;
    const count = Number(value.__count); assert.ok(Number.isSafeInteger(count) && count >= 0); return count;
  };
  const modal = () => page.getByRole('heading', { name: 'Edit Timeline Entry', exact: true }).locator('..').locator('..');
  const rawRead = target => local.api(target, { account: editor, query: { '$select': 'Id,Name,Path,Notes,Position,MediaItem/Id', '$expand': 'MediaItem', metadata: 'no' } });
  const reloadTimeline = async () => {
    await page.goto(FRONTEND + '/timelines/' + timeline.Name);
    await page.getByText(timeline.DisplayName, { exact: true }).waitFor({ timeout: 60000 });
    await page.getByTitle('Edit Entry', { exact: true }).nth(1).waitFor({ timeout: 60000 });
    assert.equal(await page.getByTitle('Edit Entry', { exact: true }).count(), 2);
  };
  try {
    const capabilities = await native.verify(); assert.equal(capabilities.backendProtocolRequired, 'gateway-coordinated-v1');
    report.sourceCountBefore = await sourceCount();
    grant = await native.request('/grants', { method: 'POST', token: editor.apiKey, backendAuth: 'ApiKey', body: { scopes: SCOPES, expiresInSeconds: 3600 } });
    secrets.push(grant.token); assert.match(grant.token, /^tta_/);
    timeline = await create('Timeline', { Name: prefix + '-timeline', DisplayName: prefix + ' timeline', Description: 'Own native/browser parity fixture', IsVisible: false, SortOrder: 'chronological', TimelineType: 'chronological' });
    media = await create('MediaItem', { Name: prefix + '-media', DisplayName: prefix + ' shared media', Title: prefix + ' shared media', Description: 'Own shared media fixture', MediaType: 'movie' });
    await apply(await preview([{ action: 'cover', targetId: media.Id, expectedRevision: media.revision, bytesBase64: PNG.toString('base64'), mimeType: 'image/png', fileName: 'native-ui.png' }]));
    media = await read(media.Id);
    first = await create('TimelineEntry', { Name: prefix + '-first', DisplayName: 'First occurrence ' + id, MediaItem: media.Id, Position: 1, Notes: 'API occurrence one' }, timeline.Id);
    second = await create('TimelineEntry', { Name: prefix + '-second', DisplayName: 'Second occurrence ' + id, MediaItem: media.Id, Position: 2, Notes: 'API occurrence two' }, timeline.Id);
    assert.notEqual(first.Id, second.Id); assert.equal(reference(first.MediaItem), media.Id); assert.equal(reference(second.MediaItem), media.Id);
    const stalePlan = await preview([{ action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { Notes: 'Stale native notes must not overwrite UI' } }]);
    record('Independent scoped HTTPS client creates one timeline, one media and two distinct same-media occurrences', { timelineId: timeline.Id, mediaId: media.Id, entryIds: [first.Id, second.Id] });

    const playwright = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'));
    const chromium = process.env.M0_CHROMIUM_EXECUTABLE_PATH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe');
    browser = await playwright.chromium.launch({ headless: true, executablePath: chromium });
    context = await browser.newContext({ viewport: { width: 1440, height: 1050 } }); page = await context.newPage();
    await context.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.href === 'https://unpkg.com/delayed-scroll-restoration-polyfill@0.1.1/index.js' && route.request().method() === 'GET' && route.request().resourceType() === 'script') {
        const headers = await route.request().allHeaders(); assert.equal(headers.authorization, undefined); assert.equal(headers.cookie, undefined);
        blockedOptionalAssets.push(url.href); return route.abort(); // Existing optional index.html asset stays offline.
      }
      if (![FRONTEND, GATEWAY, local.REPOSITORY, local.AUTHORITY].includes(url.origin)) { externalOrigins.push(url.origin); return route.abort(); }
      return route.continue();
    });
    page.on('request', request => {
      const url = new URL(request.url()), method = request.method();
      if (url.origin === local.REPOSITORY && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) rawMutations.push({ method, path: url.pathname });
      if ([FRONTEND, GATEWAY].includes(url.origin) && method === 'GET' && url.pathname.startsWith('/api/v1/content/')) nativeGets.push({ path: url.pathname, clientOrigin: request.headers()['x-timeline-client-origin'] });
      if ([FRONTEND, GATEWAY].includes(url.origin) && method === 'POST') {
        if (/^\/api\/v1\/plans\/[^/]+\/apply$/.test(url.pathname)) nativeApplies.push({ path: url.pathname });
        if (url.pathname === '/api/v1/plans') nativePlans.push(request.postDataJSON());
      }
    });
    page.on('response', async response => {
      const url = new URL(response.url());
      if ([FRONTEND, GATEWAY].includes(url.origin) && url.pathname.startsWith('/api/v1/') && response.status() >= 400) {
        const body = await response.json().catch(() => null);
        nativeFailures.push({ path: url.pathname, status: response.status(), code: body?.error?.code || body?.code, message: redact(body?.error?.message || body?.message || '') });
      }
    });
    page.on('dialog', dialog => dialog.accept());
    await page.goto(FRONTEND + '/timelines');
    await page.getByRole('button', { name: /Login with/ }).click();
    await page.waitForURL(url => url.origin === local.AUTHORITY);
    await page.locator('input[name="Username"], input[type="email"]').first().fill(editor.loginUsername || editor.username);
    await page.locator('input[type="password"]').fill(editor.password);
    await page.getByRole('button', { name: /^Login$|^Log in$|^Sign in$/i }).click();
    await page.waitForURL(url => url.origin === FRONTEND, { timeout: 60000 });
    await page.getByRole('button', { name: /Logout/ }).waitFor({ timeout: 60000 });
    assert.equal(rawMutations.length, 0, 'Login sent raw repository mutation requests'); assert.equal(externalOrigins.length, 0, 'Login requested a blocked external origin');
    await reloadTimeline(); await page.reload();
    await page.getByTitle('Edit Entry', { exact: true }).nth(1).waitFor({ timeout: 60000 });
    record('Actual Chromium Editor authenticates through OIDC and reloads the exact native-created occurrences', { rawRepositoryMutations: rawMutations.length });

    const nativeModule = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).reverse().find(url => new URL(url).pathname === '/services/nativeApi.ts'));
    assert.ok(nativeModule, 'The actual loaded native API module is required for browser GET proof');
    const browserRead = await page.evaluate(async ({ moduleUrl, target }) => {
      const api = await import(moduleUrl);
      const snapshot = await api.nativeRequest('/content/' + target);
      const cover = await api.nativeResponse('/content/' + target + '/cover');
      return { id: snapshot.Id, status: cover.status, type: cover.headers.get('content-type'), bytes: Array.from(new Uint8Array(await cover.arrayBuffer())) };
    }, { moduleUrl: nativeModule, target: media.Id });
    assert.equal(browserRead.id, media.Id); assert.equal(browserRead.status, 200); assert.equal(browserRead.type, 'image/png'); assert.deepEqual(Buffer.from(browserRead.bytes), PNG);
    assert.ok(nativeGets.some(request => request.path === '/api/v1/content/' + media.Id && request.clientOrigin === FRONTEND));
    assert.ok(nativeGets.some(request => request.path === '/api/v1/content/' + media.Id + '/cover' && request.clientOrigin === FRONTEND));
    assert.equal(rawMutations.length, 0);
    record('Real browser native GET content and binary cover use bound session routing and exact bytes', { mediaId: media.Id, status: 200, coverBytes: PNG.length, rawRepositoryMutations: 0 });

    const notes = 'UI saved exact first occurrence ' + id, applyMark = nativeApplies.length;
    await page.getByTitle('Edit Entry', { exact: true }).first().click();
    assert.equal(await page.getByPlaceholder('Optional notes about this entry...').inputValue(), 'API occurrence one');
    await page.getByPlaceholder('Optional notes about this entry...').fill(notes);
    const appliedResponse = page.waitForResponse(response => response.request().method() === 'POST' && /^\/api\/v1\/plans\/[^/]+\/apply$/.test(new URL(response.url()).pathname));
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const response = await appliedResponse; assert.equal(response.status(), 200);
    const receipt = await response.json(); assert.equal(receipt.ok, true); assert.equal(receipt.completed[0].result.id, first.Id);
    await page.getByRole('heading', { name: 'Edit Timeline Entry', exact: true }).waitFor({ state: 'hidden' });
    assert.equal(nativeApplies.length, applyMark + 1); assert.equal(rawMutations.length, 0);
    assert.ok(nativePlans.some(plan => plan.commands.some(command => command.targetId === first.Id && command.fields?.Notes === notes)));
    const changed = await read(first.Id), untouched = await read(second.Id), backend = await rawRead(first.Id);
    assert.equal(changed.Notes, notes); assert.equal(backend.Notes, notes); assert.equal(untouched.Notes, 'API occurrence two');
    assert.notEqual(changed.revision, first.revision); assert.equal(reference(changed.MediaItem), media.Id); assert.equal(reference(untouched.MediaItem), media.Id);
    record('UI note edit uses one native apply, persists in the independent repository and leaves the second occurrence distinct', { targetId: first.Id, nativeApplyPosts: nativeApplies.length - applyMark, rawRepositoryMutations: rawMutations.length });

    await assert.rejects(native.request('/plans/' + stalePlan.id + '/apply', { method: 'POST', token: grant.token, body: {}, idempotencyKey: crypto.randomUUID() }), error => error.status === 409 && error.code === 'revision_conflict');
    assert.equal((await read(first.Id)).Notes, notes); assert.equal((await rawRead(first.Id)).Notes, notes);
    await reloadTimeline(); await page.getByTitle('Edit Entry', { exact: true }).first().click();
    assert.equal(await page.getByPlaceholder('Optional notes about this entry...').inputValue(), notes);
    await modal().getByRole('button', { name: 'Cancel', exact: true }).click();
    record('The older independent native plan returns 409 and preserves the real UI-saved notes', { status: 409, targetId: first.Id });

    await page.getByTitle('Edit Entry', { exact: true }).first().click();
    assert.equal(await page.getByPlaceholder('Optional notes about this entry...').inputValue(), notes);
    const beforeConcurrent = await read(first.Id), concurrentNotes = 'New independent client notes ' + id;
    await apply(await preview([{ action: 'update', targetId: first.Id, expectedRevision: beforeConcurrent.revision, fields: { Notes: concurrentNotes } }]));
    await page.evaluate(async ({ moduleUrl, target }) => (await import(moduleUrl)).nativeSnapshot(target, { refresh: true }), { moduleUrl: nativeModule, target: first.Id });
    const staleUiApplyMark = nativeApplies.length;
    await page.getByPlaceholder('Optional notes about this entry...').fill('Stale UI notes must never overwrite the independent client');
    const conflictResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/plans');
    await page.getByRole('button', { name: 'Save Changes', exact: true }).click();
    const rejected = await conflictResponse; assert.equal(rejected.status(), 409); assert.equal((await rejected.json()).error.code, 'revision_conflict');
    await modal().getByText('Target changed; reload and preview again.', { exact: true }).waitFor();
    assert.equal(nativeApplies.length, staleUiApplyMark); assert.equal(rawMutations.length, 0);
    assert.equal((await read(first.Id)).Notes, concurrentNotes); assert.equal((await rawRead(first.Id)).Notes, concurrentNotes);
    await modal().getByRole('button', { name: 'Cancel', exact: true }).click(); await reloadTimeline();
    record('An unrelated browser cache refresh cannot replace the open editor revision or overwrite a newer native save', { status: 409, targetId: first.Id, browserApplyPosts: 0, rawRepositoryMutations: 0 });

    const reorderMark = nativeApplies.length;
    await page.getByTitle('Reorder Entries', { exact: true }).click();
    await page.locator('[data-rbd-drag-handle-draggable-id]').nth(1).waitFor();
    const handle = page.locator('[data-rbd-drag-handle-draggable-id]').first();
    await handle.focus(); await handle.press('Space'); await handle.press('ArrowDown'); await wait(350); await handle.press('Space');
    await page.getByTitle('Save New Order', { exact: true }).click();
    await page.getByTitle('Reorder Entries', { exact: true }).waitFor({ timeout: 60000 });
    const ordered = (await native.request('/entries?' + new URLSearchParams({ timelineId: String(timeline.Id), top: '100' }), { token: grant.token })).items;
    assert.deepEqual(ordered.sort((a, b) => a.Position - b.Position).map(entry => entry.Id), [second.Id, first.Id]);
    assert.equal(nativeApplies.length, reorderMark + 1); assert.equal(rawMutations.length, 0);
    assert.ok(nativePlans.some(plan => plan.commands.some(command => command.action === 'order' && command.timelineId === timeline.Id && command.entries.length === 2)));
    record('UI keyboard reorder submits one complete native order command without raw PATCH requests', { nativeApplyPosts: nativeApplies.length - reorderMark, rawRepositoryMutations: rawMutations.length });
    await page.screenshot({ path: path.join(directory, 'native-ui-parity.png'), fullPage: true });
    assert.equal(externalOrigins.length, 0); report.rawRepositoryMutations = rawMutations.length; report.browserNativeApplyPosts = nativeApplies.length;
    report.passed = true;
  } catch (error) {
    primaryFailure = redact(error.message); report.failure = primaryFailure; report.passed = false;
    if (page) {
      report.browserFailureText = await page.locator('body').innerText().then(text => redact(text).slice(0, 4000)).catch(() => 'Browser text unavailable');
      await page.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {});
    }
  }
  finally {
    report.rawRepositoryRequests = rawMutations;
    report.nativeFailures = nativeFailures;
    report.blockedOptionalAssets = [...new Set(blockedOptionalAssets)];
    report.blockedExternalOrigins = [...new Set(externalOrigins)];
    if (context) await context.close().catch(() => {}); if (browser) await browser.close().catch(() => {});
    // Native cleanup uses the same explicitly scoped editor, never a repository administrator fallback.
    if (grant) {
      for (const item of [...owned.values()].sort((a, b) => a.type === 'Timeline' ? -1 : b.type === 'Timeline' ? 1 : a.type === 'MediaItem' ? 1 : -1)) {
        try {
          const current = await read(item.id); assert.equal(current.Name, item.name); assert.ok(current.Name.startsWith(prefix));
          await apply(await preview([{ action: 'delete', targetId: current.Id, expectedRevision: current.revision }]));
          report.cleanup.push({ id: item.id, type: item.type, removedFromProject: true });
        } catch (error) {
          if ([403, 404].includes(error.status) && ['project_boundary', 'target_unavailable'].includes(error.code)) report.cleanup.push({ id: item.id, alreadyRemovedFromProject: true });
          else { report.cleanup.push({ id: item.id, error: redact(error.message) }); report.passed = false; }
        }
      }
      try { await native.request('/grants/' + grant.id + '/revoke', { method: 'POST', token: grant.token, body: {} }); }
      catch (error) { report.cleanup.push({ grantRevocationFailed: true, error: redact(error.message) }); report.passed = false; }
    }
    try {
      report.sourceCountAfter = await sourceCount();
      for (let attempt = 0; attempt < 40 && report.sourceCountAfter !== report.sourceCountBefore; attempt++) {
        await wait(250); report.sourceCountAfter = await sourceCount();
      }
      if (report.sourceCountAfter !== report.sourceCountBefore) { report.passed = false; report.failure = report.failure || 'Local source count changed after UUID native cleanup'; }
    }
    catch (error) { report.passed = false; report.failure = report.failure || redact(error.message); }
    fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    fs.writeFileSync(path.join(local.ROOT, 'm1-browser-api-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  }
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, rawRepositoryMutations: report.rawRepositoryMutations,
    browserNativeApplyPosts: report.browserNativeApplyPosts, report: path.join(directory, 'report.json'), ...(report.failure ? { failure: report.failure } : {}) }));
  if (!report.passed) throw new Error(primaryFailure || report.failure || 'Native/browser smoke cleanup failed');
  return report;
}
module.exports = { smoke };
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
