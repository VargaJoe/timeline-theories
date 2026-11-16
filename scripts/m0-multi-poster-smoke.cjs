'use strict';

// Real Docker app acceptance. Direct repository writes are confined to this
// invocation's UUID fixture setup/cleanup; every publication uses the native UI.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const local = require('./m0-local-api.cjs');
const { permissions, READ_PERMISSIONS, WRITE_PERMISSIONS } = require('./m0-acl.cjs');
const { png, sha256 } = require('./helpers/image-variant-fixture.cjs');
const chromium = process.env.M0_CHROMIUM_EXECUTABLE_PATH || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData/Local'), 'ms-playwright/chromium-1234/chrome-win64/chrome.exe');
const FRONTEND = 'https://localhost:8080', ROOT = '/Root/Content/timelines';
const VISITOR = '/Root/IMS/BuiltIn/Portal/Visitor', PROTOCOL = 'timeline-image-assets-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^sha256:[0-9a-f]{64}$/;

function mutationJobSucceeded(job) {
  const expected = job.acknowledgedPath === '/api/v1/images/drafts' ? 201
    : /^\/api\/v1\/(?:images\/drafts\/[1-9][0-9]*\/(?:seal|delete|variants\/w[1-9][0-9]{0,3})|plans\/[0-9a-f-]{36}\/apply)$/.test(job.acknowledgedPath) ? 200 : undefined;
  return expected !== undefined && job.terminalStatus === expected;
}
const unexpectedMutationSuccess = jobs => jobs.some(job => job.terminalStatus >= 200 && job.terminalStatus < 300 && !mutationJobSucceeded(job));

function dockerApp() {
  const raw = execFileSync('docker', ['compose', '-f', path.resolve(__dirname, '../compose.local.yaml'), 'ps', 'app', '--format', 'json'], { encoding: 'utf8', windowsHide: true }).trim();
  let rows; try { const value = JSON.parse(raw); rows = Array.isArray(value) ? value : [value]; } catch { rows = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  const app = rows.find(row => row.Service === 'app');
  assert(app && app.State === 'running' && app.Publishers?.some(port => port.PublishedPort === 8080 && port.URL === '127.0.0.1'), 'The existing Docker app must own localhost:8080. This script never starts a host app server.');
  return { id: app.ID, service: app.Service, image: app.Image, state: app.State, health: app.Health };
}
function safeMetadata(value) {
  if (Array.isArray(value)) return value.map(safeMetadata);
  return value && typeof value === 'object' ? Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/^(?:bytesBase64|authorization|cookie|access_token|refresh_token|id_token|credential)$/i.test(key)).map(([key, item]) => [key, safeMetadata(item)])) : value;
}

// A repository 5xx may follow a committed write. A failed readback/contract
// check is also uncertain even when that later check itself returned a 4xx.
async function runFixtureSetupWrite(intent, dispatch, { validate = () => {}, persist = () => {}, redact = String } = {}) {
  intent.state = 'prepared'; persist();
  intent.state = 'dispatched'; persist();
  let validating = false;
  try {
    const result = await dispatch(intent); validating = true;
    await validate(result, intent); intent.state = 'confirmed'; persist(); return result;
  } catch (error) {
    const status = Number(error.status);
    const rejected = !validating && Number.isInteger(status) && status >= 400 && status < 500 && !error.transportFailure && error.details?.uncertain !== true;
    intent.state = rejected ? 'rejected' : 'uncertain';
    if (Number.isInteger(status) && status > 0) intent.responseStatus = status;
    intent.failure = redact(error.message); persist(); throw error;
  }
}

async function smoke() {
  local.assertLocal(local.REPOSITORY); local.assertLocal(local.AUTHORITY);
  const runtime = dockerApp(), accounts = local.readAccounts(), id = crypto.randomUUID(), prefix = 'q-m0-multi-poster-' + id;
  const output = path.join(local.ROOT, 'multi-poster-smoke', id); fs.mkdirSync(output, { recursive: true });
  const reportPath = path.join(output, 'report.json');
  const report = { version: 1, startedAt: new Date().toISOString(), frontend: FRONTEND, runtime, fixturePrefix: prefix, checks: [], passed: false, grantsCreated: 0 };
  const secrets = Object.values(accounts).flatMap(account => [account.password, account.apiKey, account.token]).filter(value => typeof value === 'string' && value.length > 7);
  const redact = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value))
    .replace(/([?&](?:code|state|session_state|access_token|refresh_token|id_token)=)[^&"\s]+/gi, '$1[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT redacted]');
  const fixtures = [], owners = [], originals = [], sessions = [], fixtureIntents = [], setupWrites = [];
  let browser, editor, timeline, media = [], fixtureUncertain = false;
  const checkpoint = () => {
    report.fixtureOwners = owners.map(({ Id, Name, Path }) => ({ Id, Name, Path })); report.fixtureIntents = fixtureIntents; report.setupWrites = setupWrites;
    report.originals = originals; report.sessions = sessions.map(state => ({ requests: state.requests, responses: state.responses, wire: state.wire,
      jobs: [...state.jobs.values()], pendingJobs: [...state.pendingJobs], pendingWrites: state.pendingWrites.size, uncertainWrite: state.uncertainWrite,
      rawMutations: state.rawMutations, external: state.external, errors: state.errors, generatedUploads: state.uploads }));
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  };
  const checked = async (name, action) => {
    console.log(JSON.stringify({ check: name, state: 'running' }));
    try { const detail = await action(); report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) }); checkpoint(); console.log(JSON.stringify({ check: name, passed: true })); return detail; }
    catch (error) { report.checks.push({ name, passed: false, error: redact(error.message) }); checkpoint(); throw error; }
  };
  const selected = target => local.api(target, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type,IsSystemContent,Description', metadata: 'no' } });
  const repositoryCount = async () => {
    const result = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + ROOT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', $top: '1', $inlinecount: 'allpages', $select: 'Id', metadata: 'no' }), { account: accounts.admin });
    assert.equal(result.status, 200); const count = Number(result.value.d.__count); assert(Number.isSafeInteger(count) && count > 0); return count;
  };
  async function fixtureWrite(intent, dispatch, validate) {
    intent.request_id = crypto.randomUUID(); intent.principal = 'local-admin'; setupWrites.push(intent);
    try { return await runFixtureSetupWrite(intent, dispatch, { validate, persist: checkpoint, redact }); }
    catch (error) { if (intent.state === 'uncertain') fixtureUncertain = true; checkpoint(); throw error; }
  }
  async function create(parent, type, suffix, fields) {
    assert(parent.startsWith(ROOT + '/')); const name = prefix + '-' + suffix;
    const intent = { kind: 'create', method: 'POST', target: parent, parent, type, name, path: parent + '/' + name, query: { metadata: 'no' }, body: { __ContentType: type, Name: name, ...structuredClone(fields) } };
    fixtureIntents.push(intent);
    const row = await fixtureWrite(intent, request => local.api(request.target, { method: request.method, account: accounts.admin, query: request.query, body: request.body }), result => {
      intent.returnedContract = result && { Id: result.Id, Name: result.Name, Path: result.Path, Type: result.Type };
      assert(result && Number.isSafeInteger(result.Id) && result.Id > 0 && result.Name === name && result.Path === intent.path && result.Type === type, 'Create acknowledgement did not confirm this exact owned UUID fixture. Preserve its saved intent.');
      intent.id = result.Id;
    });
    fixtures.push(row); if (['Timeline', 'MediaItem'].includes(type)) owners.push(row); checkpoint(); return row;
  }
  const setFixtureAcl = owner => fixtureWrite({ kind: 'acl', method: 'POST', target: owner.Id, targetPath: owner.Path, operation: 'SetPermissions',
    body: { r: [{ identity: VISITOR, ...READ_PERMISSIONS }, { identity: accounts.reader.path, ...READ_PERMISSIONS }, { identity: accounts.editor.path, ...WRITE_PERMISSIONS }] } },
  request => permissions(request.target, request.body.r));
  async function original(contentId) {
    const result = await local.request(local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: String(contentId), propertyname: 'CoverImageBin' }), { account: accounts.admin });
    assert.equal(result.status, 200); return result.bytes;
  }
  async function children(target) {
    const parent = await selected(target); assert(parent.Path.startsWith(ROOT + '/') && owners.some(owner => parent.Path === owner.Path || parent.Path.startsWith(owner.Path + '/')));
    const url = new URL(local.REPOSITORY); url.pathname = '/OData.svc' + parent.Path.split('/').map(encodeURIComponent).join('/');
    url.search = new URLSearchParams({ query: '+ParentId:' + parent.Id + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', $select: 'Id,Name,Path,Type,IsSystemContent,Description', $top: '100', metadata: 'no' });
    const result = await local.request(url.href, { account: accounts.admin }); assert.equal(result.status, 200);
    const rows = result.value?.d?.results; assert(Array.isArray(rows) && rows.length < 100, 'Never delete a truncated fixture tree.'); return rows;
  }
  async function drain(state) { await Promise.allSettled([...state.events]); }
  async function session(viewport = { width: 1440, height: 1050 }, mobile = false) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile });
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    const state = { page, context, requests: [], responses: [], wire: [], jobs: new Map(), terminalJobs: new Map(), pendingJobs: new Set(), pendingWrites: new Set(), events: new Set(), uncertainWrite: false, rawMutations: [], external: [], errors: [], uploads: [], requestTimes: new WeakMap() };
    sessions.push(state);
    const mutating = request => request.method() === 'POST' && /^\/api\/v1\/(?:images\/drafts(?:\/|$)|plans\/[^/]+\/apply$)/.test(new URL(request.url()).pathname);
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (![FRONTEND, local.REPOSITORY, local.AUTHORITY].includes(url.origin)) {
        const headers = await request.allHeaders();
        state.external.push({ origin: url.origin, path: url.pathname, hasQuery: !!url.search, method: request.method(), resourceType: request.resourceType(), hasBody: !!request.postData(),
          hasAuthorization: !!headers.authorization, hasApiKey: !!headers.apikey || !!headers['api-key'], hasCookie: !!headers.cookie });
        return route.abort();
      }
      if (url.origin === local.REPOSITORY && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) { state.rawMutations.push({ method: request.method(), path: url.pathname }); return route.abort(); }
      if (url.origin === FRONTEND && request.method() === 'POST' && (/^\/api\/v1\/images\/drafts(?:\/|$)/.test(url.pathname) || url.pathname === '/api/v1/plans')) {
        let input; try { input = request.postDataJSON(); } catch { return route.abort(); }
        const targets = input.commands ? input.commands.map(command => command.action === 'cover-presentation' ? command.targetId : null) : [input.ownerId];
        if (!targets.length || targets.some(target => !owners.some(owner => owner.Id === target && owner.Name.startsWith(prefix)))) { state.errors.push('Refused a native mutation outside this invocation UUID owners.'); return route.abort(); }
      }
      return route.continue();
    });
    page.on('request', request => {
      try {
      const url = new URL(request.url()); state.requestTimes.set(request, Date.now());
      if (url.origin === FRONTEND && mutating(request)) state.pendingWrites.add(request);
      if (![FRONTEND, local.REPOSITORY].includes(url.origin)) return;
      const row = { method: request.method(), origin: url.origin, path: url.pathname, ...(url.pathname.endsWith('/binaryhandler.ashx') ? { nodeId: Number(url.searchParams.get('nodeid')) } : {}) };
      state.requests.push(row);
      if (url.origin === FRONTEND && request.method() === 'POST' && /^\/api\/v1\/(?:images\/(?:drafts|preview-sources)|plans)(?:\/|$)/.test(url.pathname)) {
        const raw = request.postData() || ''; let body; try { body = request.postDataJSON(); } catch {}
        state.wire.push({ method: request.method(), path: url.pathname, key: request.headers()['idempotency-key'] || null, bodySha256: sha256(Buffer.from(raw)), body: safeMetadata(body) });
        const variant = url.pathname.match(/^\/api\/v1\/images\/drafts\/(\d+)\/variants\/(w[1-9][0-9]{0,3})$/);
        if (variant && typeof body?.bytesBase64 === 'string' && owners.some(owner => owner.Id === body.ownerId)) {
          const bytes = Buffer.from(body.bytesBase64, 'base64');
          assert(bytes.length <= 1024 * 1024 && bytes.length === body.variant?.byteLength && sha256(bytes) === body.variant.sha256);
          const file = `owner-${body.ownerId}-set-${variant[1]}-${variant[2]}.${body.variant.mimeType === 'image/png' ? 'png' : 'webp'}`;
          fs.writeFileSync(path.join(output, file), bytes); state.uploads.push({ ownerId: body.ownerId, setId: Number(variant[1]), file, ...body.variant });
        }
        checkpoint();
      }
      } catch (error) { state.errors.push(redact(error.message)); state.uncertainWrite = true; checkpoint(); }
    });
    page.on('requestfailed', request => { if (mutating(request)) { state.pendingWrites.delete(request); state.uncertainWrite = true; checkpoint(); } });
    page.on('pageerror', error => state.errors.push(redact(error.message)));
    page.on('response', response => {
      const task = (async () => {
        const url = new URL(response.url()); if (url.origin !== FRONTEND || !url.pathname.startsWith('/api/v1/')) return;
        const value = response.headers()['content-type']?.includes('json') ? await response.json().catch(() => null) : null;
        const detail = { method: response.request().method(), path: url.pathname, status: response.status(), elapsedMs: Date.now() - (state.requestTimes.get(response.request()) || Date.now()),
          ...(value?.error ? { error: { code: value.error.code, message: redact(value.error.message || value.error), details: safeMetadata(value.error.details) } } : {}) };
        if (url.pathname === '/api/v1/images/preview-sources' && value?.data) detail.sourceBatch = { ownerRevision: value.data.owner?.revision, sourceIds: value.data.sources?.map(source => source.id), sourceVersions: value.data.sources?.map(source => source.version) };
        if (mutating(response.request())) {
          state.pendingWrites.delete(response.request());
          if (response.status() >= 500 || response.status() >= 400 && !value) state.uncertainWrite = true;
          if (response.status() === 202) {
            assert.equal(value?.pending, true); assert(UUID.test(value.job?.id || ''));
            const job = { id: value.job.id, acknowledgedPath: url.pathname, acknowledgedStatus: 202, ...(state.terminalJobs.get(value.job.id) || {}) };
            state.jobs.set(job.id, job); if (!job.terminalStatus) state.pendingJobs.add(job.id);
          }
        }
        const jobMatch = url.pathname.match(/^\/api\/v1\/jobs\/([0-9a-f-]{36})$/i);
        if (jobMatch && response.status() !== 202) {
          const terminal = { terminalStatus: response.status(), ...(value?.error?.code ? { terminalCode: value.error.code } : {}) };
          state.terminalJobs.set(jobMatch[1], terminal); if (state.jobs.has(jobMatch[1])) Object.assign(state.jobs.get(jobMatch[1]), terminal);
          state.pendingJobs.delete(jobMatch[1]); if (response.status() >= 500) state.uncertainWrite = true;
        }
        if (value?.error?.details?.uncertain === true || value?.uncertainTargets?.length || value?.error?.details?.uncertainTargets?.length) state.uncertainWrite = true;
        state.responses.push(detail); checkpoint();
      })().catch(error => { state.errors.push(redact(error.message)); state.uncertainWrite = true; checkpoint(); });
      state.events.add(task); void task.finally(() => state.events.delete(task));
    });
    return state;
  }
  const goto = async (page, suffix) => {
    const target = FRONTEND + suffix;
    try { await page.goto(target); } catch (error) { if (!error.message.includes('interrupted by another navigation to "' + target + '"')) throw error; await page.waitForURL(target); }
  };
  async function nativeRead(page, route) {
    assert(/^\/(?:capabilities|images\/capabilities|content\/\d+\/image-(?:presentation\/editor|sets))$/.test(route), 'Browser helper only permits capability/image metadata GETs.');
    await page.waitForFunction(() => performance.getEntriesByType('resource').some(entry => new URL(entry.name).pathname === '/services/nativeApi.ts'));
    return page.evaluate(async route => {
      const moduleUrl = performance.getEntriesByType('resource').map(entry => entry.name).reverse().find(url => new URL(url).pathname === '/services/nativeApi.ts');
      return (await import(moduleUrl)).nativeRequest(route);
    }, route);
  }
  async function login() {
    await goto(editor.page, '/timelines'); await editor.page.getByRole('button', { name: /Login with/ }).click();
    await editor.page.waitForURL(url => url.origin === local.AUTHORITY);
    await editor.page.locator('input[name="Username"],input[type="email"]').first().fill(accounts.editor.loginUsername || accounts.editor.username);
    await editor.page.locator('input[type="password"]').fill(accounts.editor.password);
    await editor.page.getByRole('button', { name: /^Login$|^Log in$|^Sign in$/i }).click();
    await editor.page.waitForURL(url => url.origin === FRONTEND); await editor.page.getByRole('button', { name: /Logout/ }).waitFor();
  }
  async function timelinePanel() {
    await goto(editor.page, '/timelines/' + timeline.Name); await editor.page.getByTitle('Edit Timeline', { exact: true }).click();
    const panel = editor.page.locator('section.image-editor').filter({ has: editor.page.getByRole('heading', { name: 'List cover', exact: true }) });
    await panel.getByRole('button', { name: 'Generate preview', exact: true }).waitFor(); await panel.locator('input[type="checkbox"]').nth(9).waitFor(); return panel;
  }
  async function waitForPreview(panel) {
    await editor.page.waitForFunction(() => document.querySelector('section.image-editor [role="alert"]') || Array.from(document.querySelectorAll('section.image-editor [role="status"]')).some(node => node.textContent.startsWith('Preview ready.')), undefined, { timeout: 180000 });
    if (await panel.getByRole('alert').count()) throw Error(await panel.getByRole('alert').textContent());
    await panel.getByRole('img', { name: 'Generated image preview', exact: true }).waitFor(); await drain(editor);
  }
  const isOriginal = request => media.some(item => request.path === `/api/v1/content/${item.Id}/cover` || request.nodeId === item.Id);
  async function generate(panel, button = 'Generate preview') {
    const requests = editor.requests.length, responses = editor.responses.length, began = Date.now();
    await panel.getByRole('button', { name: button, exact: true }).click(); await waitForPreview(panel);
    const reads = editor.requests.slice(requests), batches = editor.responses.slice(responses).filter(row => row.path === '/api/v1/images/preview-sources');
    assert.equal(batches.length, 1); assert.equal(batches[0].status, 200); assert(HASH.test(batches[0].sourceBatch.ownerRevision));
    assert.equal(reads.filter(row => ['/api/v1/lookup', '/api/v1/snapshots'].includes(row.path)).length, 0, 'Preview must not perform serial full owner/source lookups.');
    return { elapsedMs: Date.now() - began, metadataBatches: batches.length, ...batches[0].sourceBatch, originalGets: reads.filter(isOriginal).map(row => row.path) };
  }
  async function publish(panel, ownerId, previousGeneration) {
    await panel.getByRole('button', { name: 'Publish', exact: true }).click();
    await editor.page.waitForFunction(() => {
      const section = document.querySelector('section.image-editor');
      return section && (section.querySelector('[role="alert"]') || section.querySelector('.image-editor-state')?.textContent === 'Published' && section.getAttribute('aria-busy') !== 'true' && !section.querySelector('[aria-label="Generated image preview"],img[alt="Generated image preview"]'));
    }, undefined, { polling: 250, timeout: 15 * 60 * 1000 });
    if (await panel.getByRole('alert').count()) throw Error(await panel.getByRole('alert').textContent());
    const saved = await nativeRead(editor.page, `/content/${ownerId}/image-presentation/editor`); await drain(editor);
    assert.equal(saved.state, 'active'); assert.notEqual(saved.generationId, previousGeneration); assert.equal(editor.pendingJobs.size, 0); assert.equal(editor.pendingWrites.size, 0);
    assert([...editor.jobs.values()].every(mutationJobSucceeded), 'Every observed 202 mutation must have its exact correlated terminal status: draft 201, other mutation steps 200.'); return saved;
  }
  async function visitorCard(state, filename) {
    await goto(state.page, '/timelines?filter=q');
    const card = state.page.locator(`a[href="/timelines/${timeline.Name}"]`), image = card.locator('[data-image-state]');
    await card.waitFor({ state: 'attached' }); await image.scrollIntoViewIfNeeded(); await card.locator('[data-image-state="loaded"]').waitFor(); await drain(state);
    const fan = card.locator('[data-poster-fan]'); assert.equal(await fan.locator('.poster-fan__card').count(), 12);
    const atlas = state.requests.filter(row => row.path.startsWith(`/api/v1/images/${timeline.Id}/`)); assert.equal(atlas.length, 1, 'Visitor list loads exactly one authorized atlas.');
    assert.equal(state.requests.filter(isOriginal).length, 0, 'An active twelve-poster list card must not read original source bytes.');
    const backgrounds = await fan.locator('.poster-fan__surface').evaluateAll(nodes => [...new Set(nodes.map(node => getComputedStyle(node).backgroundImage))]);
    assert.equal(backgrounds.length, 1); assert(backgrounds[0].includes('blob:'), 'All twelve decorative faces use the one private in-memory authorized image URL.');
    await state.page.screenshot({ path: path.join(output, filename), fullPage: true }); return { card, image, fan, atlas: atlas[0].path };
  }

  try {
    report.initialCount = await repositoryCount(); checkpoint();
    const playwright = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
    browser = await playwright.chromium.launch({ headless: true, executablePath: chromium }); editor = await session();
    await checked('Actual Editor OIDC session uses the already-running Docker app', async () => {
      await login(); const binding = await nativeRead(editor.page, '/capabilities');
      assert.equal(binding.repository, local.REPOSITORY); assert.equal(binding.authority, local.AUTHORITY); assert.equal(binding.project, ROOT); assert.equal(binding.readOnly, false);
      assert(binding.operations?.includes('images/preview-sources'), 'The rebuilt Docker app must expose the preview batching follow-up.');
      const value = await nativeRead(editor.page, '/images/capabilities'); assert.equal(value.available, true); return { protocol: value.protocol, localRepositoryBindingVerified: true };
    });
    await checked('Create isolated public timeline with thirteen UUID poster originals and entries', async () => {
      timeline = await create(ROOT + '/Timelines', 'Timeline', 'timeline', { DisplayName: 'Q multi poster ' + id, Description: 'Multi-poster acceptance fixture ' + id, IsVisible: true, SortOrder: 'chronological' });
      await setFixtureAcl(timeline);
      for (let index = 0; index < 13; index++) {
        const title = 'Q multi poster ' + String(index + 1).padStart(2, '0') + ' ' + id;
        const item = await create(ROOT + '/MediaLibrary', 'MediaItem', 'media-' + index, { DisplayName: title, Title: title, MediaType: 'movie', Description: 'Synthetic poster ' + id }); media.push(item);
        await setFixtureAcl(item);
        const bytes = png(360, 540, index + 1);
        const bytesFile = path.join(output, `fixture-original-${item.Id}.png`), digest = sha256(bytes); fs.writeFileSync(bytesFile, bytes);
        await fixtureWrite({ kind: 'original-upload', method: 'POST', target: ROOT + '/MediaLibrary', targetPath: item.Path, operation: 'Upload', encoding: 'multipart/form-data',
          body: { name: item.Name + '.png', contentType: 'MediaItem', contentId: item.Id, field: 'CoverImageBin', mime: 'image/png', bytesFile, byteLength: bytes.length, sha256: digest } }, request => {
          const savedBytes = fs.readFileSync(request.body.bytesFile); assert.equal(sha256(savedBytes), request.body.sha256); assert.equal(savedBytes.length, request.body.byteLength);
          return local.upload(request.target, { ...request.body, bytes: savedBytes, account: accounts.admin });
        }, async () => {
          const metadata = await local.api(item.Id, { account: accounts.admin, query: { $select: 'Id,Name,Path,CoverImageBin', metadata: 'no' } });
          assert.equal(metadata.Name, item.Name); assert.equal(metadata.Path, item.Path); assert.equal(metadata.CoverImageBin?.__mediaresource?.content_type, 'image/png');
          assert.equal(sha256(await original(item.Id)), digest);
        });
        originals.push({ id: item.Id, sha256: digest, byteLength: bytes.length, width: 360, height: 540 });
        await create(timeline.Path, 'TimelineEntry', 'entry-' + index, { DisplayName: 'Poster ' + (index + 1), Position: index + 1, MediaItem: [item.Id] });
      }
      return { timelineId: timeline.Id, mediaIds: media.map(item => item.Id), entries: 13, originalHashesVerified: originals.length };
    });
    let panel;
    await checked('Real editor selects twelve posters across pages and blocks the thirteenth', async () => {
      panel = await timelinePanel(); await panel.locator('.image-editor-candidates').scrollIntoViewIfNeeded(); await panel.locator('.image-editor-candidates [data-image-state="loaded"]').nth(9).waitFor();
      for (let index = 0; index < 10; index++) await panel.locator('input[type="checkbox"]').nth(index).check();
      await panel.getByRole('button', { name: 'Next', exact: true }).click(); await panel.locator('.image-editor-candidates').scrollIntoViewIfNeeded(); await panel.locator('.image-editor-candidates [data-image-state="loaded"]').nth(2).waitFor();
      await panel.locator('input[type="checkbox"]').nth(0).check(); await panel.locator('input[type="checkbox"]').nth(1).check();
      assert.equal(await panel.locator('input[type="checkbox"]').nth(2).isDisabled(), true); assert.equal(await panel.locator('.image-editor-order li').count(), 12);
      const labels = await panel.locator('.image-editor-order li').allTextContents(); assert(labels.every((text, index) => text.includes(media[index].DisplayName)), 'Selected order must match the first twelve real entry posters.');
      await panel.screenshot({ path: path.join(output, 'editor-twelve-selected-thirteenth-blocked.png') }); return { selected: 12, blockedThirteenth: true };
    });
    let first, second;
    await checked('Two real previews use one fresh metadata batch each and reuse all twelve unchanged originals', async () => {
      first = await generate(panel); assert.deepEqual(first.sourceIds, media.slice(0, 12).map(item => item.Id)); assert.equal(first.originalGets.length, 12); assert.equal(new Set(first.originalGets).size, 12);
      assert.equal(await panel.locator('.image-editor-preview .poster-fan__card').count(), 12);
      // A fixture-only external edit proves that cached bytes do not freeze the
      // owner's optimistic publication revision. No source original is changed.
      await fixtureWrite({ kind: 'owner-revision-patch', method: 'PATCH', target: timeline.Id, targetPath: timeline.Path, query: { $select: 'Id', metadata: 'no' }, body: { Description: 'Fresh owner revision probe ' + crypto.randomUUID() } },
        request => local.api(request.target, { account: accounts.admin, method: request.method, query: request.query, body: request.body }), async (_result, request) => {
          const current = await selected(request.target); assert.equal(current.Path, request.targetPath); assert.equal(current.Name, timeline.Name); assert.equal(current.Description, request.body.Description);
        });
      second = await generate(panel); assert.equal(second.originalGets.length, 0); assert.notEqual(second.ownerRevision, first.ownerRevision); assert.deepEqual(second.sourceVersions, first.sourceVersions);
      await panel.screenshot({ path: path.join(output, 'editor-twelve-preview.png') }); return { first, second, freshOwnerRevisionVerified: true };
    });
    let timelineSaved;
    await checked('Publish twelve posters through native UI and await correlated terminal metadata jobs', async () => {
      timelineSaved = await publish(panel, timeline.Id); assert.deepEqual(timelineSaved.recipe.sourceIds, media.slice(0, 12).map(item => item.Id));
      const draft = editor.wire.find(row => row.path === '/api/v1/images/drafts' && row.body?.ownerId === timeline.Id);
      assert.equal(draft.body.expectedRevision, second.ownerRevision); assert.deepEqual(draft.body.manifest.sourceStamps, originals.slice(0, 12).map(row => ({ id: row.id, stamp: row.sha256 })));
      assert.deepEqual(timelineSaved.variants.map(variant => variant.width), [400, 800, 1200]);
      panel = await timelinePanel(); assert.equal(await panel.locator('.image-editor-order li').count(), 12);
      assert.equal(await panel.locator('input[type="checkbox"]:checked').count(), 10); await panel.getByRole('button', { name: 'Next', exact: true }).click();
      assert.equal(await panel.locator('input[type="checkbox"]:checked').count(), 2); assert.equal(await panel.locator('input[type="checkbox"]').nth(2).isDisabled(), true);
      return { generationId: timelineSaved.generationId, setId: timelineSaved.setId, savedRecipeCount: timelineSaved.recipe.sourceIds.length, metadataJobs: [...editor.jobs.values()] };
    });
    await checked('Visitor list uses one atlas, zero originals, and twelve individually reachable hover faces', async () => {
      const visitor = await session({ width: 1280, height: 900 }); const { fan, atlas } = await visitorCard(visitor, 'visitor-twelve-desktop.png');
      const targets = await fan.evaluate(stage => Array.from(stage.querySelectorAll('.poster-fan__card'), card => {
        const box = card.getBoundingClientRect();
        for (let y = box.top + 3; y < box.bottom; y += 3) for (let x = box.left + 3; x < box.right; x += 3) if (document.elementFromPoint(x, y)?.closest('.poster-fan__card') === card) return { x, y };
        return null;
      }));
      assert.equal(targets.length, 12); assert(targets.every(Boolean), 'Each actual list-card poster must have a stable exposed hover hit target.');
      for (let index = 0; index < targets.length; index++) {
        await visitor.page.mouse.move(0, 0); await visitor.page.mouse.move(targets[index].x, targets[index].y); await visitor.page.waitForTimeout(220);
        const card = fan.locator('.poster-fan__card').nth(index); assert.equal(await card.evaluate(node => node.matches(':hover')), true); assert.equal(await card.evaluate(node => getComputedStyle(node).zIndex), '20');
      }
      await visitor.page.screenshot({ path: path.join(output, 'visitor-twelve-hover.png'), fullPage: true }); return { atlas, originalGets: 0, reachableFaces: targets.length };
    });
    await checked('Real mobile Visitor list contains all twelve poster faces', async () => {
      const mobile = await session({ width: 390, height: 844 }, true); const { image, fan, atlas } = await visitorCard(mobile, 'visitor-twelve-mobile.png');
      const bounds = await fan.boundingBox(); assert(bounds && bounds.x >= -0.5 && bounds.x + bounds.width <= 390.5);
      const faces = await fan.locator('.poster-fan__surface').evaluateAll(nodes => nodes.map(node => { const box = node.getBoundingClientRect(); return { left: box.left, right: box.right }; }));
      assert(faces.every(box => box.left >= -0.5 && box.right <= 390.5), 'Every rotated mobile face stays within the viewport.');
      assert.equal(await image.locator('img').evaluate(node => getComputedStyle(node).objectFit), 'contain');
      assert(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); return { viewport: 390, atlas, containedFaces: faces.length, fanWidth: bounds.width };
    });
    await checked('Actual media editor publishes sizes from one unchanged 360 by 540 original', async () => {
      await goto(editor.page, '/media-library/' + media[0].Name);
      const mediaPanel = editor.page.locator('section.image-editor').filter({ has: editor.page.getByRole('heading', { name: 'Image sizes', exact: true }) });
      await mediaPanel.getByRole('button', { name: 'Prepare sizes', exact: true }).waitFor();
      const preview = await generate(mediaPanel, 'Prepare sizes'); assert.deepEqual(preview.sourceIds, [media[0].Id]);
      const saved = await publish(mediaPanel, media[0].Id); assert.deepEqual(saved.recipe.sourceIds, [media[0].Id]); assert.deepEqual(saved.variants.map(variant => variant.width), [160, 320]);
      await mediaPanel.screenshot({ path: path.join(output, 'media-single-original-sizes.png') }); return { generationId: saved.generationId, sizes: saved.variants.map(({ width, height }) => ({ width, height })) };
    });
    await checked('Every synthetic original byte hash survives both real UI publications', async () => {
      for (const row of originals) assert.equal(sha256(await original(row.id)), row.sha256);
      for (const state of sessions) { await drain(state); assert.equal(state.rawMutations.length, 0); assert.equal(state.external.length, 0); assert.equal(state.errors.length, 0); }
      return { originals: originals.length, originalBytesUnchanged: true, browserRepositoryMutations: 0 };
    });
    report.passed = true;
  } catch (error) {
    report.failure = redact(error.message); console.log(JSON.stringify({ failed: true, error: report.failure, report: reportPath }));
    for (const [index, state] of sessions.entries()) await state.page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
  } finally {
    if (browser) await browser.close(); for (const state of sessions) await drain(state);
    report.originalIntegrity = { verified: 0, unchanged: true };
    try {
      for (const row of originals) {
        const bytes = await original(row.id), actual = sha256(bytes);
        if (actual !== row.sha256) { fs.writeFileSync(path.join(output, `changed-original-${row.id}.png`), bytes); throw Error('Synthetic original SHA changed for fixture ' + row.id); }
        report.originalIntegrity.verified++;
      }
    } catch (error) { report.passed = false; report.originalIntegrity.unchanged = false; report.originalIntegrity.error = redact(error.message); }
    report.cleanup = [];
    const uncertain = fixtureUncertain || sessions.some(state => state.uncertainWrite || state.pendingWrites.size || state.pendingJobs.size || unexpectedMutationSuccess([...state.jobs.values()]));
    if (uncertain) {
      report.passed = false; report.cleanupDeferred = true; report.preservedForRecovery = true;
      report.recoveryReason = 'An owned setup or native publication request has an uncertain or pending outcome. Preserve these exact UUID fixtures and request keys until its saved outcome is reconciled; do not replay or delete an active writer.';
    } else {
      try {
        for (const owner of owners) {
          const folderPath = owner.Path + '/(images)'; let folder;
          try { folder = await selected(folderPath); } catch (error) { if (error.status === 404) continue; throw error; }
          assert.equal(folder.Path, folderPath); assert.equal(folder.Name, '(images)'); assert.equal(folder.Type, 'SystemFolder'); assert.equal(folder.IsSystemContent, true);
          const pointer = JSON.parse(folder.Description); assert.equal(pointer.protocol, PROTOCOL); assert.equal(pointer.ownerId, owner.Id); assert.equal(pointer.projectPath, ROOT);
          await local.api(folder.Id, { account: accounts.admin, method: 'PATCH', query: { $select: 'Id', metadata: 'no' }, body: { Description: JSON.stringify({ ...pointer, activeSetId: null, generationId: null, selectionRevision: crypto.randomUUID() }) } });
          for (const set of await children(folder.Id)) {
            assert.equal(set.Type, 'Folder'); assert.equal(set.Path, folderPath + '/' + set.Name); assert(UUID.test(set.Name));
            const generation = JSON.parse(set.Description); assert.equal(generation.protocol, PROTOCOL); assert.equal(generation.manifest.ownerId, owner.Id); assert.equal(generation.manifest.projectPath, ROOT); assert.equal(generation.manifest.generationId, set.Name);
            assert(generation.manifest.sourceIds.every(sourceId => media.some(item => item.Id === sourceId)), 'Managed set must reference only this invocation source fixtures.');
            for (const file of await children(set.Id)) { assert.equal(file.Type, 'File'); assert.equal(file.Path, set.Path + '/' + file.Name); assert(/^w[1-9][0-9]{0,3}\.(?:png|jpg|webp)$/.test(file.Name)); }
            await local.api(set.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); report.cleanup.push(set.Id);
          }
          await local.api(folder.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); report.cleanup.push(folder.Id);
        }
        for (const fixture of [...fixtures].reverse()) {
          const current = await selected(fixture.Id); assert.equal(current.Path, fixture.Path); assert.equal(current.Name, fixture.Name); assert(current.Name.startsWith(prefix));
          await local.api(fixture.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); report.cleanup.push(fixture.Id);
        }
        report.cleanupPassed = true;
      } catch (error) { report.cleanupPassed = false; report.passed = false; report.cleanupError = redact(error.message); report.preservedForRecovery = true; }
    }
    try { report.finalCount = await repositoryCount(); } catch (error) { report.passed = false; report.finalCountError = redact(error.message); }
    if (report.cleanupPassed && report.finalCount !== report.initialCount) { report.passed = false; report.cleanupPassed = false; report.cleanupError = `Own fixture cleanup did not restore repository count ${report.initialCount} to ${report.finalCount}.`; }
    report.completedAt = new Date().toISOString(); checkpoint(); fs.writeFileSync(path.join(local.ROOT, 'multi-poster-smoke.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, initialCount: report.initialCount, finalCount: report.finalCount, cleanupPassed: report.cleanupPassed, preservedForRecovery: !!report.preservedForRecovery, report: reportPath }));
  if (!report.passed) throw Error(report.failure || report.cleanupError || report.recoveryReason || 'Multi-poster acceptance failed.'); return report;
}

module.exports = { smoke, runFixtureSetupWrite, mutationJobSucceeded, unexpectedMutationSuccess };
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
