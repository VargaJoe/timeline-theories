'use strict';

// Actual local editor/Visitor proof. Generated UUID fixtures only; never mocks or production.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = require('./m0-local-api.cjs');
const { permissions, READ_PERMISSIONS, WRITE_PERMISSIONS } = require('./m0-acl.cjs');
const { png, sha256 } = require('./helpers/image-variant-fixture.cjs');
const playwright = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache', 'codex-runtimes', 'codex-primary-runtime', 'dependencies', 'node', 'node_modules', 'playwright'));
const chromiumParts = ['ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'];
const localChromium = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), ...chromiumParts);
const chromium = process.env.M0_CHROMIUM_EXECUTABLE_PATH || (fs.existsSync(localChromium) ? localChromium : path.join(os.homedir(), 'AppData', 'Local', ...chromiumParts));
const FRONTEND = 'https://localhost:8080', ROOT = '/Root/Content/timelines';
const IMAGE_PROTOCOL = 'timeline-image-assets-v1', STORAGE = 'stock-owner-images-systemfolder-v1';
const VISITOR = '/Root/IMS/BuiltIn/Portal/Visitor';
const keepDemo = process.argv.includes('--keep-demo');
const resumeIndex = process.argv.indexOf('--resume');
const resumePath = resumeIndex >= 0 ? process.argv[resumeIndex + 1] : undefined;
const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function smoke() {
  local.assertLocal(local.REPOSITORY);
  if (resumeIndex >= 0 && !resumePath) throw new Error('--resume needs the absolute preserved report.json path.');
  let previousReport, previousPath;
  if (resumePath) {
    assert(path.isAbsolute(resumePath)); previousPath = fs.realpathSync(resumePath);
    const evidenceRoot = fs.realpathSync(path.join(local.ROOT, 'image-ui-smoke')) + path.sep;
    assert(previousPath.toLowerCase().startsWith(evidenceRoot.toLowerCase()) && path.basename(previousPath) === 'report.json', 'Resume must use project-local UI proof.');
    previousReport = JSON.parse(fs.readFileSync(previousPath, 'utf8'));
    assert.equal(previousReport.storage, STORAGE, 'Resume requires proof from the same SystemFolder storage layout.');
    assert(/^q-m0-image-ui-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(previousReport.fixturePrefix));
    assert(previousReport.preservedForRecovery && Array.isArray(previousReport.fixtureOwners), 'Resume needs the preserved owned fixture inventory.');
  }
  const accounts = local.readAccounts(), id = previousReport ? previousReport.fixturePrefix.slice('q-m0-image-ui-'.length) : crypto.randomUUID(), prefix = 'q-m0-image-ui-' + id;
  const output = previousReport ? path.join(local.ROOT, 'image-ui-smoke', id, 'continuations', crypto.randomUUID()) : path.join(local.ROOT, 'image-ui-smoke', id);
  fs.mkdirSync(output, { recursive: true });
  const report = { version: 3, storage: STORAGE, ranAt: new Date().toISOString(), fixturePrefix: prefix, frontend: FRONTEND, checks: [], passed: false, keepDemo, ...(previousPath ? { resumeOf: previousPath } : {}) };
  if (previousReport?.controlledLostResponse?.passed) report.controlledLostResponse = { ...previousReport.controlledLostResponse, carriedFrom: previousPath };
  const secrets = Object.values(accounts).flatMap(account => [account.password, account.apiKey, account.token]).filter(value => typeof value === 'string' && value.length > 7);
  const redact = value => secrets.reduce((result, secret) => result.replaceAll(secret, '[redacted]'), String(value))
    .replace(/([?&](?:code|state|session_state|access_token|refresh_token|id_token)=)[^&"\s]+/gi, '$1[redacted]');
  const fixtures = [], owners = [], originals = [], sessions = [];
  const checkpoint = () => {
    report.wire = sessions.map(session => session.wire); report.nativeResponses = sessions.map(session => session.responses);
    report.generatedUploads = sessions.flatMap(session => session.uploads);
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  };
  const repositoryCount = async () => {
    const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + ROOT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', $top: '1', $inlinecount: 'allpages', $select: 'Id', metadata: 'no' }), { account: accounts.admin });
    assert.equal(response.status, 200); return Number(response.value.d.__count);
  };
  report.initialCount = await repositoryCount(); checkpoint();
  let browser, editor, visitor, timeline, media;
  const selected = target => local.api(target, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type,IsSystemContent,Description', metadata: 'no' } });
  const queryContents = async (parentPath, query) => {
    assert(parentPath.startsWith(ROOT + '/'));
    const url = new URL(local.REPOSITORY); url.pathname = '/OData.svc' + parentPath.split('/').map(encodeURIComponent).join('/');
    url.search = new URLSearchParams({ query, $select: 'Id,Name,Path,Type,IsSystemContent,Description', $top: '100', metadata: 'no' }).toString();
    const response = await local.request(url.href, { account: accounts.admin });
    assert.equal(response.status, 200); assert(Array.isArray(response.value.d.results)); assert(response.value.d.results.length < 100, 'Never accept a truncated managed tree.');
    return response.value.d.results;
  };
  const children = async parent => {
    const content = await selected(parent);
    return queryContents(content.Path, '+ParentId:' + content.Id + ' .AUTOFILTERS:OFF .LIFESPAN:OFF');
  };
  const safeMetadata = value => Array.isArray(value) ? value.map(safeMetadata) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:bytesBase64|authorization|cookie|access_token|refresh_token|id_token|credential)$/i.test(key)).map(([key, item]) => [key, safeMetadata(item)])) : value;
  const checked = async (name, action) => {
    const accepted = previousReport?.checks.find(check => check.name === name && check.passed);
    if (accepted && !name.startsWith('Real editor OIDC') && !name.startsWith('Reuse preserved')) {
      report.checks.push({ ...accepted, carriedFrom: previousPath }); console.log(JSON.stringify({ check: name, carriedFromVerifiedProof: true })); return accepted.detail;
    }
    console.log(JSON.stringify({ check: name, state: 'running' }));
    try { const detail = await action(); report.checks.push({ name, passed: true, ...(detail ? { detail } : {}) }); console.log(JSON.stringify({ check: name, passed: true })); }
    catch (error) { report.checks.push({ name, passed: false, error: redact(error.message) }); throw error; }
  };
  async function create(parent, type, suffix, fields = {}) {
    const name = prefix + '-' + suffix;
    const content = await local.api(parent, { method: 'POST', account: accounts.admin, query: { metadata: 'no' }, body: { __ContentType: type, Name: name, ...fields } });
    assert(Number.isSafeInteger(content.Id) && content.Path.startsWith(ROOT + '/') && content.Name === name);
    fixtures.push(content); if (['Timeline', 'MediaItem'].includes(type)) owners.push(content);
    return content;
  }
  async function attachOriginal(content, seed) {
    const bytes = png(900, 1200, seed);
    await local.upload(ROOT + '/MediaLibrary', { name: content.Name + '.png', contentType: 'MediaItem', contentId: content.Id, field: 'CoverImageBin', bytes, mime: 'image/png', account: accounts.admin });
    const metadata = await local.api(content.Id, { account: accounts.admin, query: { $select: 'Id,Name,Path,CoverImageBin', metadata: 'no' } });
    assert.equal(metadata.Name, content.Name, 'Binary filename must not rename its owner.'); assert.equal(metadata.Path, content.Path);
    assert.equal(metadata.CoverImageBin?.__mediaresource?.content_type, 'image/png', 'Fixture binary MIME must match its real PNG bytes.');
    const actual = await original(content.Id); assert.equal(sha256(actual), sha256(bytes));
    originals.push({ id: content.Id, sha256: sha256(bytes), byteLength: bytes.length, contentType: metadata.CoverImageBin.__mediaresource.content_type, ownerNamePreserved: true });
  }
  async function original(contentId) {
    const result = await local.request(local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: String(contentId), propertyname: 'CoverImageBin' }), { account: accounts.admin });
    assert.equal(result.status, 200); return result.bytes;
  }
  async function reuseFixtures() {
    const inventory = previousReport.fixtureOwners;
    const restoreOwner = async record => {
      assert(record && Number.isSafeInteger(record.Id) && record.Name.startsWith(prefix));
      const current = await local.api(record.Id, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type,DisplayName,CoverImageBin', metadata: 'no' } });
      assert.equal(current.Name, record.Name); assert.equal(current.Path, record.Path);
      assert(['Timeline', 'MediaItem'].includes(current.Type)); assert(current.Path.startsWith(ROOT + '/'));
      owners.push(current); fixtures.push(current); return current;
    };
    timeline = await restoreOwner(inventory.find(owner => owner.Name === prefix + '-timeline'));
    assert.equal(timeline.Type, 'Timeline'); assert.equal(timeline.Path, ROOT + '/Timelines/' + timeline.Name);
    media = [];
    for (let index = 0; index < 4; index++) {
      const item = await restoreOwner(inventory.find(owner => owner.Name === prefix + '-media-' + index));
      assert.equal(item.Type, 'MediaItem'); assert.equal(item.Path, ROOT + '/MediaLibrary/' + item.Name);
      assert.equal(item.DisplayName, 'Q image poster ' + index + ' ' + id); assert.equal(item.CoverImageBin?.__mediaresource?.content_type, 'image/png');
      const bytes = png(900, 1200, index + 1); assert.equal(sha256(await original(item.Id)), sha256(bytes));
      originals.push({ id: item.Id, sha256: sha256(bytes), byteLength: bytes.length, contentType: 'image/png', ownerNamePreserved: true }); media.push(item);
      const entry = await local.api(timeline.Path + '/' + prefix + '-entry-' + index, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type,Position,MediaItem/Id', $expand: 'MediaItem', metadata: 'no' } });
      assert.equal(entry.Type, 'TimelineEntry'); assert.equal(entry.Path, timeline.Path + '/' + prefix + '-entry-' + index); assert.equal(entry.Position, index + 1);
      const reference = Array.isArray(entry.MediaItem) ? entry.MediaItem[0] : entry.MediaItem?.results?.[0] || entry.MediaItem;
      assert.equal(reference.Id, item.Id); fixtures.push(entry);
    }
    for (const extra of inventory.filter(owner => !owners.some(item => item.Id === owner.Id))) {
      assert.equal(extra.Name, prefix + '-empty-media');
      const item = await restoreOwner(extra); assert.equal(item.Type, 'MediaItem');
      const contentType = item.CoverImageBin?.__mediaresource?.content_type;
      assert(!contentType || contentType === 'image/png', 'Never overwrite an unexpected existing fixture original.');
      if (item.CoverImageBin?.__mediaresource?.content_type === 'image/png') {
        const bytes = png(700, 1000, 5); assert.equal(sha256(await original(item.Id)), sha256(bytes));
        originals.push({ id: item.Id, sha256: sha256(bytes), byteLength: bytes.length, contentType: 'image/png', ownerNamePreserved: true });
      }
    }
    report.resumeVerified = true;
    return { timelineId: timeline.Id, mediaIds: media.map(item => item.Id), currentOriginalHashesVerified: originals.length, previousProof: previousPath };
  }
  async function session(viewport = { width: 1440, height: 1050 }, dpr = 1) {
    const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport, deviceScaleFactor: dpr });
    const page = await context.newPage(); page.setDefaultTimeout(90000);
    const state = { page, context, requests: [], responses: [], wire: [], wireRequests: new WeakMap(), uploads: [], requestTimes: new WeakMap(), pendingWrites: new Set(), uncertainWrite: false, rawMutations: [], external: [], errors: [] }; sessions.push(state);
    const mutating = request => request.method() === 'POST' && /^\/api\/v1\/(?:images\/drafts(?:\/|$)|plans\/[^/]+\/apply$)/.test(new URL(request.url()).pathname);
    await context.route('**/*', route => {
      const target = new URL(route.request().url());
      if (!['https://localhost:8080', local.REPOSITORY, local.AUTHORITY].includes(target.origin)) { state.external.push(target.origin); return route.abort(); }
      return route.continue();
    });
    page.on('request', request => {
      const target = new URL(request.url());
      state.requestTimes.set(request, Date.now());
      if (target.origin === FRONTEND && mutating(request)) state.pendingWrites.add(request);
      if (target.origin === FRONTEND && request.method() === 'POST' && /^\/api\/v1\/(?:images\/drafts|plans)(?:\/|$)/.test(target.pathname)) {
        const raw = request.postData() || ''; let body; try { body = JSON.parse(raw); } catch {}
        const wire = { method: request.method(), path: target.pathname, key: request.headers()['idempotency-key'] || null, bodySha256: sha256(Buffer.from(raw)), ...(body ? { body: safeMetadata(body) } : {}) };
        state.wire.push(wire); state.wireRequests.set(request, wire); checkpoint();
      }
      if ([FRONTEND, local.REPOSITORY].includes(target.origin)) state.requests.push({ method: request.method(), origin: target.origin, path: target.pathname, query: target.search });
      if (target.origin === local.REPOSITORY && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method())) state.rawMutations.push({ method: request.method(), path: target.pathname });
      const variantRoute = target.origin === FRONTEND && target.pathname.match(/^\/api\/v1\/images\/drafts\/(\d+)\/variants\/(w[1-9][0-9]{0,3})$/);
      if (variantRoute && request.method() === 'POST') {
        let payload; try { payload = request.postDataJSON(); } catch { return; }
        if (owners.some(owner => owner.Id === payload?.ownerId && owner.Name.startsWith(prefix)) && payload.variant?.name === variantRoute[2] && ['image/png', 'image/webp'].includes(payload.variant?.mimeType) && typeof payload.bytesBase64 === 'string') {
          const bytes = Buffer.from(payload.bytesBase64, 'base64');
          if (bytes.length <= 1024 * 1024 && bytes.length === payload.variant.byteLength && sha256(bytes) === payload.variant.sha256) {
            const file = `set-${variantRoute[1]}-${variantRoute[2]}.${payload.variant.mimeType === 'image/png' ? 'png' : 'webp'}`;
            fs.writeFileSync(path.join(output, file), bytes);
            state.uploads.push({ ownerId: payload.ownerId, setId: Number(variantRoute[1]), file, ...payload.variant });
          }
        }
      }
    });
    page.on('pageerror', error => state.errors.push(redact(error.message)));
    page.on('requestfailed', request => { if (mutating(request)) { state.pendingWrites.delete(request); state.uncertainWrite = true; } });
    page.on('response', async response => {
      const target = new URL(response.url());
      if (target.origin !== FRONTEND || !target.pathname.startsWith('/api/v1/')) return;
      const json = response.headers()['content-type']?.includes('json');
      const value = json ? await response.json().catch(() => null) : null;
      if (mutating(response.request())) {
        state.pendingWrites.delete(response.request());
        if (response.status() >= 500 || response.status() >= 400 && !json || value?.error?.details?.uncertain === true || value?.uncertainTargets?.length) state.uncertainWrite = true;
      }
      if (value?.error?.details?.uncertain === true || value?.uncertainTargets?.length) state.uncertainWrite = true;
      const sample = !json && response.status() >= 400 ? redact(await response.text().catch(() => ''))
        .replace(/(?:Authorization|ApiKey|Cookie|Set-Cookie)\s*[:=][^\r\n<]+/gi, '[credential redacted]')
        .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[JWT redacted]')
        .replace(/[A-Za-z0-9+/=_-]{80,}/g, '[encoded value redacted]').slice(0, 300) : undefined;
      const detail = { method: response.request().method(), path: target.pathname, status: response.status(), elapsedMs: Date.now() - (state.requestTimes.get(response.request()) || Date.now()),
        ...(sample ? { bodySample: sample } : {}), ...(value?.job?.id ? { jobId: value.job.id } : {}),
        ...(value?.error ? { error: { code: value.error.code, message: redact(value.error.message || value.error) } } : {}) };
      state.responses.push(detail);
      const wire = state.wireRequests.get(response.request());
      if (wire) Object.assign(wire, detail, value ? { response: safeMetadata(value) } : {});
      checkpoint();
      if (response.status() >= 400 && /\/api\/v1\/(images\/drafts|plans\/|jobs\/)/.test(target.pathname)) console.log(JSON.stringify({ apiFailure: detail }));
    });
    return state;
  }
  async function goto(page, suffix) {
    const target = FRONTEND + suffix;
    try { await page.goto(target); }
    catch (error) { if (!error.message.includes('interrupted by another navigation to "' + target + '"')) throw error; await page.waitForURL(target); }
  }
  async function nativeRead(page, route) {
    const moduleUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).reverse().find(url => new URL(url).pathname === '/services/nativeApi.ts'));
    assert(moduleUrl, 'Use the actual loaded native API module.');
    return page.evaluate(async ({ moduleUrl, route }) => (await import(moduleUrl)).nativeRequest(route), { moduleUrl, route });
  }
  async function login(page) {
    await goto(page, '/timelines');
    await page.getByRole('button', { name: /Login with/ }).click();
    await page.waitForURL(url => url.origin === local.AUTHORITY);
    await page.locator('input[name="Username"],input[type="email"]').first().fill(accounts.editor.loginUsername || accounts.editor.username);
    await page.locator('input[type="password"]').fill(accounts.editor.password);
    await page.getByRole('button', { name: /^Login$|^Log in$|^Sign in$/i }).click();
    await page.waitForURL(url => url.origin === FRONTEND);
    await page.getByRole('button', { name: /Logout/ }).waitFor();
  }
  async function openTimelineEditor() {
    await goto(editor.page, '/timelines/' + timeline.Name);
    await editor.page.getByTitle('Edit Timeline', { exact: true }).click();
    const panel = editor.page.locator('section.image-editor').filter({ has: editor.page.getByRole('heading', { name: 'List cover', exact: true }) });
    await panel.getByRole('button', { name: 'Generate preview', exact: true }).waitFor();
    await panel.locator('input[type="checkbox"]').nth(3).waitFor();
    return panel;
  }
  async function waitForPublication(panel, ownerId, previousGeneration) {
    await editor.page.waitForFunction(() => {
      const section = document.querySelector('section.image-editor');
      return section && (section.querySelector('[role="alert"]') || !section.querySelector('img[alt="Generated image preview"]') && section.querySelector('.image-editor-state')?.textContent === 'Published' && section.getAttribute('aria-busy') !== 'true');
    }, undefined, { polling: 200, timeout: 180000 });
    if (await panel.getByRole('alert').count()) throw new Error(await panel.getByRole('alert').textContent());
    await panel.locator('.image-editor-state').filter({ hasText: /^Published$/ }).waitFor();
    const presentation = await nativeRead(editor.page, `/content/${ownerId}/image-presentation/editor`);
    assert(presentation?.state === 'active' && presentation.generationId !== previousGeneration, 'One independent read must confirm the new active generation after UI completion.');
    return presentation;
  }
  async function generateAndPublish(panel, button, ownerId, forcePng = false, loseResponse = false) {
    const previous = await nativeRead(editor.page, `/content/${ownerId}/image-presentation/editor`);
    if (forcePng) await editor.page.evaluate(() => {
      globalThis.__imageSmokeCanvasEncoder = HTMLCanvasElement.prototype.toBlob;
      HTMLCanvasElement.prototype.toBlob = function(callback, _type, quality) { globalThis.__imageSmokeCanvasEncoder.call(this, callback, 'image/png', quality); };
    });
    try {
      await panel.getByRole('button', { name: button, exact: true }).click();
      await editor.page.waitForFunction(() => document.querySelector('section.image-editor img[alt="Generated image preview"]') || document.querySelector('section.image-editor [role="alert"]'));
      if (await panel.getByRole('alert').count()) throw new Error(await panel.getByRole('alert').textContent());
      await panel.getByRole('img', { name: 'Generated image preview', exact: true }).waitFor();
      console.log(JSON.stringify({ stage: 'preview-ready', ownerId, forcePng }));
    } finally {
      if (forcePng) await editor.page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = globalThis.__imageSmokeCanvasEncoder; delete globalThis.__imageSmokeCanvasEncoder; });
    }
    const pattern = '**/api/v1/images/drafts/*/variants/w400';
    const lost = { aborted: false, retried: false };
    const fileSnapshot = async filePath => {
      const file = await local.api(filePath, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type,Version,ModificationDate,Binary', metadata: 'no' } });
      assert.equal(file.Type, 'File'); assert.equal(file.Path, filePath);
      return { id: file.Id, path: file.Path, version: file.Version, modificationDate: file.ModificationDate,
        binaryToken: file.Binary?.__mediaresource?.media_etag ?? file.Binary?.__mediaresource?.media_src };
    };
    const dropSuccessfulAck = async route => {
      const request = route.request(), payload = request.postDataJSON();
      const response = await route.fetch({ timeout: 120000, maxRedirects: 0 });
      if (!lost.aborted && payload.ownerId === ownerId && response.ok()) {
        try {
          const result = await response.json(), setId = Number(new URL(request.url()).pathname.match(/drafts\/(\d+)/)[1]);
          const set = await local.api(setId, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type', metadata: 'no' } });
          const owner = owners.find(item => item.Id === ownerId);
          assert.equal(set.Type, 'Folder'); assert(set.Path.startsWith(owner.Path + '/(images)/'));
          const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[payload.variant.mimeType];
          lost.file = await fileSnapshot(set.Path + '/w400.' + extension); assert.equal(lost.file.id, result.data.id);
          lost.url = request.url(); lost.requestHash = sha256(Buffer.from(request.postData()));
          lost.keyHash = sha256(Buffer.from(request.headers()['idempotency-key']));
          lost.aborted = true;
          console.log(JSON.stringify({ stage: 'controlled-response-lost', ownerId, fileId: lost.file.id }));
          await route.abort('failed');
        } catch (error) { lost.diagnosticError = redact(error.message); await route.fulfill({ response }); }
      } else await route.fulfill({ response });
    };
    if (loseResponse) await editor.page.route(pattern, dropSuccessfulAck);
    try {
      await panel.getByRole('button', { name: 'Publish', exact: true }).click();
      console.log(JSON.stringify({ stage: 'publication-requested', ownerId }));
      let result;
      try { result = await waitForPublication(panel, ownerId, previous.generationId); }
      catch (error) {
        if (!loseResponse || !lost.aborted) throw error;
        // The actual mutation already returned HTTP200. Only its browser acknowledgement was lost.
        // Retry the exact live intent once; an actual server deadline/error is never retried by this host.
        await editor.page.unroute(pattern, dropSuccessfulAck);
        const acknowledged = editor.page.waitForResponse(response => response.url() === lost.url && response.request().method() === 'POST');
        await panel.getByRole('button', { name: 'Retry publication', exact: true }).click(); lost.retried = true;
        const response = await acknowledged; assert.equal(response.status(), 200);
        const replay = response.request(), value = await response.json();
        assert.equal(sha256(Buffer.from(replay.postData())), lost.requestHash); assert.equal(sha256(Buffer.from(replay.headers()['idempotency-key'])), lost.keyHash);
        assert.equal(value.data.id, lost.file.id);
        console.log(JSON.stringify({ stage: 'same-key-retry-acknowledged', ownerId, fileId: value.data.id }));
        result = await waitForPublication(panel, ownerId, previous.generationId);
        const after = await fileSnapshot(lost.file.path); assert.deepEqual(after, lost.file, 'Same-key acknowledgement recovery must not overwrite the native image file.');
        report.controlledLostResponse = { passed: true, fileId: after.id, fileVersion: after.version, modificationDate: after.modificationDate, sameFileTimestamp: true, sameRequestHash: true, sameIdempotencyKey: true };
      }
      if (loseResponse) assert(lost.aborted && lost.retried, 'Controlled response-loss case must exercise the real Retry publication button.' + (lost.diagnosticError ? ' ' + lost.diagnosticError : ''));
      return result;
    } finally { if (loseResponse) await editor.page.unroute(pattern, dropSuccessfulAck); }
  }
  try {
    browser = await playwright.chromium.launch({ headless: true, executablePath: chromium });
    editor = await session();
    await checked('Real editor OIDC login and standard local image capability', async () => {
      await login(editor.page);
      const capability = await nativeRead(editor.page, '/images/capabilities');
      assert.equal(capability.available, true, 'The existing app API must support stock SystemFolder/Folder/File images before running this proof.');
      assert.equal(editor.rawMutations.length, 0);
      return { protocol: capability.protocol };
    });
    if (previousReport) await checked('Reuse preserved UUID fixtures and verify current original hashes', reuseFixtures);
    else await checked('Create isolated public timeline and four preserved generated originals', async () => {
      timeline = await create(ROOT + '/Timelines', 'Timeline', 'timeline', { DisplayName: 'Q image UI ' + id, IsVisible: true, SortOrder: 'chronological' });
      await permissions(timeline.Id, [{ identity: VISITOR, ...READ_PERMISSIONS }, { identity: accounts.reader.path, ...READ_PERMISSIONS }, { identity: accounts.editor.path, ...WRITE_PERMISSIONS }]);
      media = [];
      for (let index = 0; index < 4; index++) {
        const item = await create(ROOT + '/MediaLibrary', 'MediaItem', 'media-' + index, { DisplayName: 'Q image poster ' + index + ' ' + id, Title: 'Q image poster ' + index + ' ' + id, MediaType: 'movie', Description: 'Generated image smoke fixture ' + id });
        await attachOriginal(item, index + 1); media.push(item);
        await create(timeline.Path, 'TimelineEntry', 'entry-' + index, { DisplayName: 'Poster ' + index, Position: index + 1, MediaItem: [item.Id] });
      }
      return { timelineId: timeline.Id, mediaIds: media.map(item => item.Id), originalBytes: originals.reduce((sum, item) => sum + item.byteLength, 0) };
    });
    let panel = await openTimelineEditor();
    for (let count = 1; count <= 4; count++) await checked(`Actual timeline editor prepares and publishes ${count} selected poster${count > 1 ? 's' : ''}`, async () => {
      await panel.locator('input[type="checkbox"]').nth(count - 1).check();
      await generateAndPublish(panel, 'Generate preview', timeline.Id, count === 1, count === 2);
      const presentation = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`);
      assert.equal(presentation.state, 'active'); assert.equal(presentation.recipe.sourceIds.length, count);
      assert.deepEqual(presentation.variants.map(variant => variant.width), [400, 800, 1200]);
      assert(presentation.variants.every(variant => variant.mimeType === (count === 1 ? 'image/png' : 'image/webp')));
      await panel.screenshot({ path: path.join(output, `timeline-${count}-published.png`) });
      return { generationId: presentation.generationId, forcedBrowserPngEncoder: count === 1, sizes: presentation.variants.map(({ width, byteLength, mimeType }) => ({ width, byteLength, mimeType })) };
    });
    await checked('Reopening restores ordered selection; Random selection previews and publishes a saved recipe', async () => {
      const previous = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`);
      panel = await openTimelineEditor();
      assert.equal(await panel.locator('input[type="checkbox"]:checked').count(), 4);
      await panel.getByRole('button', { name: 'Random selection', exact: true }).click();
      await panel.getByRole('img', { name: 'Generated image preview', exact: true }).waitFor();
      await panel.getByRole('button', { name: 'Publish', exact: true }).click();
      const saved = await waitForPublication(panel, timeline.Id, previous.generationId);
      assert.equal(saved.recipe.sourceIds.length, 4); assert(Number.isInteger(saved.recipe.seed)); assert.notEqual(saved.generationId, previous.generationId);
      panel = await openTimelineEditor(); assert.equal(await panel.locator('input[type="checkbox"]:checked').count(), 4);
      const order = await panel.locator('.image-editor-order li').allTextContents();
      assert.deepEqual(order.map(text => media.find(item => text.includes(item.DisplayName)).Id), saved.recipe.sourceIds);
      return { orderedSourceIds: saved.recipe.sourceIds, seed: saved.recipe.seed };
    });
    await checked('Delete unused copies removes old generated sets through the editor and preserves the active set', async () => {
      const before = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`);
      const sets = await nativeRead(editor.page, `/content/${timeline.Id}/image-sets`);
      assert.equal(sets.filter(set => set.state === 'active').length, 1); assert(sets.some(set => set.deletable));
      editor.page.once('dialog', dialog => dialog.accept());
      await panel.getByRole('button', { name: 'Delete unused copies', exact: true }).click();
      await panel.getByRole('status').filter({ hasText: 'Unused generated copies deleted.' }).waitFor({ timeout: 180000 });
      const remaining = await nativeRead(editor.page, `/content/${timeline.Id}/image-sets`);
      assert.equal(remaining.length, 1); assert.equal(remaining[0].state, 'active'); assert.equal(remaining[0].deletable, false);
      const after = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`); assert.equal(after.generationId, before.generationId);
      return { deletedInactiveSets: sets.length - remaining.length, activeSetKept: true };
    });
    await checked('The (images) SystemFolder is hidden by default queries, visible with OFF, and excluded from entry occurrences', async () => {
      const direct = await children(timeline.Id), entries = direct.filter(item => item.Type === 'TimelineEntry');
      assert.equal(entries.length, 4); assert.deepEqual(entries.map(item => item.Id).sort((a, b) => a - b), fixtures.filter(item => item.Type === 'TimelineEntry').map(item => item.Id).sort((a, b) => a - b));
      const imageRoot = direct.find(item => item.Name === '(images)'); assert.equal(imageRoot?.Type, 'SystemFolder'); assert.equal(imageRoot.Path, timeline.Path + '/(images)'); assert.equal(imageRoot.IsSystemContent, true);
      const treeQuery = '+InTree:' + timeline.Path;
      const defaults = await queryContents(timeline.Path, treeQuery), unfiltered = await queryContents(timeline.Path, treeQuery + ' .AUTOFILTERS:OFF .LIFESPAN:OFF');
      const generated = unfiltered.filter(item => item.Path === imageRoot.Path || item.Path.startsWith(imageRoot.Path + '/'));
      assert(generated.some(item => item.Id === imageRoot.Id)); assert(generated.some(item => item.Type === 'Folder')); assert(generated.some(item => item.Type === 'File'));
      assert(generated.every(item => item.IsSystemContent === true), 'Stock SystemFolder must mark every generated descendant as system content.');
      assert(defaults.every(item => !generated.some(generatedItem => generatedItem.Id === item.Id)), 'Default autofilters must hide the root, generations and variant files.');
      assert.deepEqual(defaults.filter(item => item.Type === 'TimelineEntry').map(item => item.Id).sort((a, b) => a - b), entries.map(item => item.Id).sort((a, b) => a - b));
      const pointer = JSON.parse(imageRoot.Description); assert.equal(pointer.protocol, IMAGE_PROTOCOL); assert.equal(pointer.ownerId, timeline.Id); assert.equal(pointer.projectPath, ROOT);
      const current = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`); assert.equal(pointer.activeSetId, current.setId);
      await goto(editor.page, '/timelines/' + timeline.Name); await editor.page.locator('.entry-card').nth(3).waitFor(); assert.equal(await editor.page.locator('.entry-card').count(), 4);
      return { entryOccurrences: 4, excludedSystemFolderId: imageRoot.Id, defaultQueryGeneratedItems: 0, offQueryGeneratedItems: generated.length, activeSetId: current.setId };
    });
    await checked('Actual editor blocks public publication from a currently private source', async () => {
      const before = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`);
      await permissions(media[0].Id, [{ identity: VISITOR, Open: 'deny', OpenMinor: 'deny' }]);
      try {
        panel = await openTimelineEditor();
        const boxes = panel.locator('input[type="checkbox"]'); for (let index = 0; index < 4; index++) await boxes.nth(index).setChecked(index === 0);
        await panel.getByRole('button', { name: 'Generate preview', exact: true }).click(); await panel.getByRole('img', { name: 'Generated image preview', exact: true }).waitFor();
        const denied = editor.page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/images/drafts' && response.request().method() === 'POST');
        await panel.getByRole('button', { name: 'Publish', exact: true }).click(); const response = await denied;
        assert.equal(response.status(), 403); assert.equal((await response.json()).error.code, 'image_source_not_public'); await panel.getByRole('alert').waitFor();
        const after = await nativeRead(editor.page, `/content/${timeline.Id}/image-presentation/editor`); assert.equal(after.setId, before.setId); assert.equal(after.generationId, before.generationId);
      } finally { await permissions(media[0].Id, [{ identity: VISITOR, ...READ_PERMISSIONS }]); }
      return { privateSourcePublicationDenied: true, previousStaticCopyKept: true };
    });
    await checked('Actual media detail editor prepares and publishes 160/320/640 sizes', async () => {
      await goto(editor.page, '/media-library/' + media[0].Name);
      const mediaPanel = editor.page.locator('section.image-editor').filter({ has: editor.page.getByRole('heading', { name: 'Image sizes', exact: true }) });
      await generateAndPublish(mediaPanel, 'Prepare sizes', media[0].Id);
      const descriptor = await nativeRead(editor.page, `/content/${media[0].Id}/image-presentation/editor`);
      assert.equal(descriptor.state, 'active'); assert.deepEqual(descriptor.variants.map(variant => variant.width), [160, 320, 640]);
      await mediaPanel.screenshot({ path: path.join(output, 'media-sizes-published.png') });
      return { generationId: descriptor.generationId, sizes: descriptor.variants.map(({ width, byteLength }) => ({ width, byteLength })) };
    });
    await checked('Entry picker selected-media preview uses the generated 160px variant at its 60px slot', async () => {
      const mark = editor.requests.length;
      await goto(editor.page, '/timelines/' + timeline.Name + '/add-entry');
      await editor.page.getByPlaceholder('Search media...').fill(id);
      await editor.page.getByText(media[0].DisplayName, { exact: true }).locator('..').getByRole('button', { name: 'Select', exact: true }).click();
      await editor.page.getByRole('heading', { name: 'Configure Timeline Entry', exact: true }).waitFor();
      const preview = editor.page.locator('[data-image-state]'); await preview.scrollIntoViewIfNeeded();
      await editor.page.locator('[data-image-state="loaded"]').waitFor();
      const requests = editor.requests.slice(mark).filter(request => request.path.startsWith(`/api/v1/images/${media[0].Id}/`));
      assert.equal(requests.length, 1); assert(requests[0].path.endsWith('/w160'));
      const box = await preview.boundingBox(); assert.equal(box.width, 60); assert.equal(box.height, 90);
      await editor.page.screenshot({ path: path.join(output, 'entry-picker-generated-preview.png') });
      return { slotWidth: 60, slotHeight: 90, dpr: 1, selectedWidth: 160, imageFetches: 1, entryCreated: false };
    });
    await checked('Media with no original accepts an exact original file through the editor and then publishes its sizes', async () => {
      const item = owners.find(owner => owner.Name === prefix + '-empty-media') || await create(ROOT + '/MediaLibrary', 'MediaItem', 'empty-media', { DisplayName: 'Q uploaded original ' + id, Title: 'Q uploaded original ' + id, MediaType: 'movie' });
      await goto(editor.page, '/media-library/' + item.Name);
      const mediaPanel = editor.page.locator('section.image-editor').filter({ has: editor.page.getByRole('heading', { name: 'Image sizes', exact: true }) });
      const bytes = png(700, 1000, 5);
      if (!originals.some(original => original.id === item.Id)) {
        await mediaPanel.locator('input[type="file"]').waitFor();
        assert.equal(await mediaPanel.getByRole('button', { name: 'Prepare sizes', exact: true }).isDisabled(), true);
        await mediaPanel.locator('input[type="file"]').setInputFiles({ name: 'generated-original.png', mimeType: 'image/png', buffer: bytes });
      }
      await editor.page.waitForFunction(() => document.querySelector('section.image-editor [role="alert"]') || Array.from(document.querySelectorAll('section.image-editor button')).some(button => button.textContent === 'Prepare sizes' && !button.disabled));
      if (await mediaPanel.getByRole('alert').count()) throw new Error(await mediaPanel.getByRole('alert').textContent());
      const metadata = await local.api(item.Id, { account: accounts.admin, query: { $select: 'Id,Name,Path,CoverImageBin', metadata: 'no' } });
      assert.equal(metadata.Name, item.Name); assert.equal(metadata.Path, item.Path); assert.equal(metadata.CoverImageBin.__mediaresource.content_type, 'image/png');
      assert.equal(sha256(await original(item.Id)), sha256(bytes));
      if (!originals.some(original => original.id === item.Id)) originals.push({ id: item.Id, sha256: sha256(bytes), byteLength: bytes.length, contentType: 'image/png', ownerNamePreserved: true });
      await generateAndPublish(mediaPanel, 'Prepare sizes', item.Id);
      const descriptor = await nativeRead(editor.page, `/content/${item.Id}/image-presentation/editor`);
      assert.equal(descriptor.state, 'active'); assert.deepEqual(descriptor.variants.map(variant => variant.width), [160, 320, 640]);
      await mediaPanel.screenshot({ path: path.join(output, 'original-upload-and-sizes.png') });
      return { mediaId: item.Id, originalWidth: 700, originalHeight: 1000, originalSha256: sha256(bytes), exactOriginalPreserved: true };
    });
    visitor = await session({ width: 1280, height: 400 }, 2);
    await checked('Visitor offscreen generated card fetches zero bytes, then exactly one appropriate image and no source pool', async () => {
      await goto(visitor.page, '/timelines?filter=q');
      const card = visitor.page.locator(`a[href="/timelines/${timeline.Name}"]`);
      await card.waitFor({ state: 'attached' });
      const image = card.locator('[data-image-state]'); await image.waitFor({ state: 'attached' });
      const box = await image.boundingBox(); assert(box && box.y >= 400, 'Small viewport must place the generated card outside the viewport.');
      await sleep(750);
      const ownImages = () => visitor.requests.filter(request => request.path.startsWith(`/api/v1/images/${timeline.Id}/`));
      assert.equal(ownImages().length, 0, 'Offscreen image must not join the fetch queue.');
      await image.scrollIntoViewIfNeeded(); await image.locator('img').waitFor();
      await visitor.page.waitForFunction(selector => document.querySelector(selector)?.dataset.imageState === 'loaded', `a[href="/timelines/${timeline.Name}"] [data-image-state]`);
      assert.equal(ownImages().length, 1);
      const width = (await image.boundingBox()).width;
      const chosenWidth = Number(ownImages()[0].path.match(/w(\d+)$/)[1]);
      assert.equal(chosenWidth, [400, 800, 1200].find(value => value >= width * 2) || 1200);
      assert.equal(visitor.requests.filter(request => request.origin === local.REPOSITORY && decodeURIComponent(request.path).includes(timeline.Name)).length, 0, 'Active card must not request its legacy OData entry-cover pool.');
      assert.equal(visitor.requests.filter(request => media.some(item => request.path === `/api/v1/content/${item.Id}/cover` || request.query.includes('nodeid=' + item.Id))).length, 0, 'Active card must not fetch original source images.');
      await visitor.page.screenshot({ path: path.join(output, 'visitor-timeline-desktop.png') });
      return { slotWidth: width, dpr: 2, selectedWidth: chosenWidth, imageFetches: 1, originalFetches: 0, entryPoolFetches: 0 };
    });
    await checked('Visitor media library chooses the thumbnail variant and detail chooses the larger needed variant', async () => {
      await visitor.page.setViewportSize({ width: 1280, height: 900 });
      await goto(visitor.page, '/media-library');
      await visitor.page.getByPlaceholder('Search titles, descriptions...').fill(id);
      await visitor.page.getByRole('button', { name: 'Search', exact: true }).click();
      const heading = visitor.page.getByRole('heading', { name: media[0].DisplayName, exact: true }); await heading.waitFor();
      const item = heading.locator('..').locator('..'); await item.locator('[data-image-state="loaded"]').waitFor();
      const thumbnail = visitor.requests.filter(request => request.path.startsWith(`/api/v1/images/${media[0].Id}/`)).at(-1);
      assert(thumbnail.path.endsWith('/w320'), '120px DPR2 thumbnail should use320.');
      const mark = visitor.requests.length;
      await goto(visitor.page, '/media-library/' + media[0].Name);
      await visitor.page.locator('[data-image-state="loaded"]').first().waitFor();
      const detail = visitor.requests.slice(mark).filter(request => request.path.startsWith(`/api/v1/images/${media[0].Id}/`));
      assert.equal(detail.length, 1); assert(detail[0].path.endsWith('/w640'), '260px DPR2 detail should use640.');
      await visitor.page.screenshot({ path: path.join(output, 'visitor-media-detail.png') });
      return { thumbnail: 320, detail: 640, detailImageFetches: detail.length };
    });
    await checked('Generated timeline card remains contained on a mobile viewport', async () => {
      await visitor.page.setViewportSize({ width: 390, height: 844 });
      await goto(visitor.page, '/timelines?filter=q');
      const card = visitor.page.locator(`a[href="/timelines/${timeline.Name}"]`), image = card.locator('[data-image-state]');
      await image.scrollIntoViewIfNeeded(); await image.locator('img').waitFor();
      await visitor.page.waitForFunction(selector => document.querySelector(selector)?.dataset.imageState === 'loaded', `a[href="/timelines/${timeline.Name}"] [data-image-state]`);
      const box = await image.boundingBox(); assert(box.width <= 390 && box.x >= 0 && box.x + box.width <= 390);
      assert.equal(await image.locator('img').evaluate(element => getComputedStyle(element).objectFit), 'contain');
      await visitor.page.screenshot({ path: path.join(output, 'visitor-timeline-mobile.png') });
      return { viewport: 390, slotWidth: box.width, objectFit: 'contain' };
    });
    await checked('Published static copy survives source ACL changes while owner revocation masks loaded bytes', async () => {
      const card = visitor.page.locator(`a[href="/timelines/${timeline.Name}"]`), image = card.locator('[data-image-state]');
      await image.scrollIntoViewIfNeeded(); await card.locator('[data-image-state="loaded"]').waitFor();
      const byteRequests = () => visitor.requests.filter(request => request.path.startsWith(`/api/v1/images/${timeline.Id}/`)).length;
      const before = byteRequests();
      const unchanged = visitor.page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/content/${timeline.Id}/image-presentation`);
      await visitor.page.evaluate(() => window.dispatchEvent(new Event('focus'))); assert.equal((await unchanged).status(), 200);
      await card.locator('[data-image-state="loaded"]').waitFor(); assert.equal(byteRequests(), before);
      await permissions(media[0].Id, [{ identity: VISITOR, Open: 'deny', OpenMinor: 'deny' }]);
      try {
        const unchangedSource = visitor.page.waitForResponse(response => new URL(response.url()).pathname === `/api/v1/content/${timeline.Id}/image-presentation`);
        await visitor.page.evaluate(() => window.dispatchEvent(new Event('focus'))); assert.equal((await unchangedSource).status(), 200);
        await card.locator('[data-image-state="loaded"]').waitFor(); assert.equal(byteRequests(), before, 'Static publication follows owner visibility, without source re-fetches.');
        await goto(visitor.page, '/timelines?filter=q'); await image.scrollIntoViewIfNeeded(); await card.locator('[data-image-state="loaded"]').waitFor();
        await visitor.page.screenshot({ path: path.join(output, 'visitor-static-copy-source-private.png') });
      } finally { await permissions(media[0].Id, [{ identity: VISITOR, ...READ_PERMISSIONS }]); }
      const pointer = JSON.parse((await selected(timeline.Path + '/(images)')).Description), generation = JSON.parse((await selected(pointer.activeSetId)).Description);
      const fileId = generation.manifest.variants.find(variant => variant.name === 'w400').id;
      const beforeOwnerDenial = byteRequests(); await permissions(timeline.Id, [{ identity: VISITOR, Open: 'deny', OpenMinor: 'deny' }]);
      try {
        await visitor.page.evaluate(() => window.dispatchEvent(new Event('focus')));
        await visitor.page.waitForFunction(selector => !document.querySelector(selector) || document.querySelector(selector)?.dataset.imageState === 'blocked', `a[href="/timelines/${timeline.Name}"] [data-image-state]`);
        assert.equal(await card.locator('img').count(), 0); assert.equal(byteRequests(), beforeOwnerDenial);
        const binary = await local.request(local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: String(fileId), propertyname: 'Binary' }));
        assert([403, 404].includes(binary.status), 'Standard File bytes must inherit current owner denial for Visitor.');
        await visitor.page.screenshot({ path: path.join(output, 'visitor-owner-revoked.png') });
      } finally { await permissions(timeline.Id, [{ identity: VISITOR, ...READ_PERMISSIONS }]); }
      await goto(visitor.page, '/timelines?filter=q');
      await image.scrollIntoViewIfNeeded(); await card.locator('[data-image-state="loaded"]').waitFor();
      return { unchangedGenerationAdditionalBytes: 0, sourcePrivateStaticCopyVisible: true, revokedOwnerHidden: true, restoredByFreshView: true };
    });
    await checked('Use original presentation restores the legacy reference through the editor without modifying the original', async () => {
      await goto(editor.page, '/media-library/' + media[0].Name);
      const mediaPanel = editor.page.locator('section.image-editor').filter({ has: editor.page.getByRole('heading', { name: 'Image sizes', exact: true }) });
      await mediaPanel.getByRole('button', { name: 'Use original presentation', exact: true }).click();
      await editor.page.waitForFunction(() => {
        const section = document.querySelector('section.image-editor');
        return section && (section.querySelector('[role="alert"]') || section.querySelector('.image-editor-state')?.textContent === 'Original presentation' && Array.from(section.querySelectorAll('button')).some(button => button.textContent === 'Prepare sizes' && !button.disabled));
      }, undefined, { polling: 200 });
      if (await mediaPanel.getByRole('alert').count()) throw new Error(await mediaPanel.getByRole('alert').textContent());
      const restored = await nativeRead(editor.page, `/content/${media[0].Id}/image-presentation/editor`);
      assert.equal(restored?.state, 'legacy'); assert.equal(sha256(await original(media[0].Id)), originals[0].sha256);
      await generateAndPublish(mediaPanel, 'Prepare sizes', media[0].Id);
      return { originalRestored: true, originalSha256: originals[0].sha256, republishedForDemo: true };
    });
    await checked('Original byte hashes remain unchanged and browser mutations stay on the native gateway', async () => {
      for (const image of originals) assert.equal(sha256(await original(image.id)), image.sha256);
      assert.equal(editor.rawMutations.length, 0); assert.equal(visitor.rawMutations.length, 0);
      assert.equal(editor.errors.length, 0, 'Editor page must have no uncaught errors.'); assert.equal(visitor.errors.length, 0, 'Visitor page must have no uncaught errors.');
      return { originalHashes: originals, rawRepositoryMutations: 0 };
    });
    report.passed = true;
  } catch (error) {
    report.failure = redact(error.message);
    console.log(JSON.stringify({ failed: true, error: report.failure, report: path.join(output, 'report.json') }));
    for (const [index, session] of sessions.entries()) await session.page.screenshot({ path: path.join(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
  } finally {
    if (browser) await browser.close();
    report.fixtureOwners = owners.map(({ Id, Name, Path }) => ({ Id, Name, Path })); report.cleanup = [];
    const preserveUncertain = !report.passed && sessions.some(session => session.uncertainWrite || session.pendingWrites.size);
    if (preserveUncertain || previousReport && !report.passed) {
      report.cleanupDeferred = true; report.preservedForRecovery = true;
      report.recoveryReason = preserveUncertain ? 'An exact application write has an uncertain outcome. Preserve its UUID fixtures until its saved journal request has been durably reconciled; do not replay it with a new key.' : 'Focused continuation stopped. Preserve the verified owned fixtures and prior proof for the next reviewed continuation.';
    } else if (!keepDemo) {
      try {
        for (const owner of owners) {
          const folderPath = owner.Path + '/(images)';
          let folder;
          try { folder = await selected(folderPath); } catch (error) { if (error.status === 404) continue; throw error; }
          assert.equal(folder.Path, folderPath); assert.equal(folder.Name, '(images)'); assert.equal(folder.Type, 'SystemFolder'); assert.equal(folder.IsSystemContent, true);
          const pointer = JSON.parse(folder.Description); assert.equal(pointer.protocol, IMAGE_PROTOCOL); assert.equal(pointer.ownerId, owner.Id); assert.equal(pointer.projectPath, ROOT);
          await local.api(folder.Id, { account: accounts.admin, method: 'PATCH', query: { $select: 'Id', metadata: 'no' }, body: { Description: JSON.stringify({ ...pointer, activeSetId: null, generationId: null, selectionRevision: crypto.randomUUID() }) } });
          for (const set of await children(folder.Id)) {
            assert.equal(set.Type, 'Folder'); assert.equal(set.Path, folderPath + '/' + set.Name); assert(/^[0-9a-f-]{36}$/.test(set.Name));
            const generation = JSON.parse(set.Description); assert.equal(generation.protocol, IMAGE_PROTOCOL); assert.equal(generation.manifest.ownerId, owner.Id); assert.equal(generation.manifest.projectPath, ROOT); assert.equal(generation.manifest.generationId, set.Name);
            for (const file of await children(set.Id)) { assert.equal(file.Type, 'File'); assert.equal(file.Path, set.Path + '/' + file.Name); assert(/^w[1-9][0-9]{0,3}\.(?:png|jpg|webp)$/.test(file.Name)); }
            await local.api(set.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); report.cleanup.push(set.Id);
          }
          await local.api(folder.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); report.cleanup.push(folder.Id);
        }
        for (const fixture of [...fixtures].reverse()) {
          const current = await selected(fixture.Id); assert.equal(current.Path, fixture.Path); assert(current.Name.startsWith(prefix));
          await local.api(fixture.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); report.cleanup.push(fixture.Id);
        }
        report.cleanupPassed = true;
      } catch (error) { report.cleanupPassed = false; report.passed = false; report.cleanupError = redact(error.message); }
    } else report.demoUrls = timeline ? { timeline: FRONTEND + '/timelines/' + timeline.Name, media: media?.map(item => FRONTEND + '/media-library/' + item.Name) } : {};
    report.browserErrors = sessions.map(session => session.errors);
    report.nativeResponses = sessions.map(session => session.responses);
    report.wire = sessions.map(session => session.wire);
    report.generatedUploads = sessions.flatMap(session => session.uploads);
    report.finalCount = await repositoryCount();
    if (!keepDemo && report.cleanupPassed && report.finalCount !== report.initialCount) { report.passed = false; report.cleanupPassed = false; report.cleanupError = `Own fixture cleanup changed repository count ${report.initialCount}→${report.finalCount}.`; }
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    fs.writeFileSync(path.join(local.ROOT, 'image-ui-smoke.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, cleaned: report.cleanup.length, report: path.join(output, 'report.json'), ...(report.failure ? { failure: report.failure } : {}), ...(report.cleanupError ? { cleanupError: report.cleanupError } : {}) }));
  if (!report.passed) throw new Error(report.failure || report.cleanupError);
  return report;
}

module.exports = { smoke };
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
