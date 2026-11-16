'use strict';
// Local Docker UI acceptance. The old session journal is an explicitly seeded
// test fixture; backend ACL, recovery, fresh publication and file reads are real.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const local = require('./m0-local-api.cjs');
const { permissions, READ_PERMISSIONS, WRITE_PERMISSIONS } = require('./m0-acl.cjs');
const { png, sha256 } = require('./helpers/image-variant-fixture.cjs');
const playwright = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const executablePath = process.env.M0_CHROMIUM_EXECUTABLE_PATH || path.join(process.env.LOCALAPPDATA, 'ms-playwright/chromium-1234/chrome-win64/chrome.exe');
const FRONTEND = 'https://localhost:8080', ROOT = '/Root/Content/timelines', CONTAINER = 'timeline-local-app-1';
const transientReads = process.argv.includes('--transient-image-reads');
const docker = (args, input) => execFileSync('docker', args, { input, encoding: 'utf8', windowsHide: true, timeout: 120000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
const uuid = crypto.randomUUID(), prefix = 'q-pending-image-' + uuid;
const directory = path.join(local.ROOT, 'pending-image-recovery', uuid);
fs.mkdirSync(directory, { recursive: true });
const report = { version: 1, startedAt: new Date().toISOString(), passed: false, prefix,
  limitations: 'A synthetic stopped old-session journal fixture, not a real interrupted cloud write. Real Docker gateway, OIDC, current SenseNet ACL, recovery and publication.', checks: [] };
const fixtures = [], accounts = local.readAccounts();
let browser, page, seeded = false, recovered = false;
let storeDirectory;
const save = () => fs.writeFileSync(path.join(directory, 'report.json'), JSON.stringify(report, null, 2));
function localStateIsIdle() {
  const read = key => {
    try { const file = path.join(storeDirectory, key); assert.ok(fs.statSync(file).size <= 20 * 1024 * 1024); return JSON.parse(fs.readFileSync(file, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  };
  const writer = read('writer'), pending = read('pending-mutations');
  return (!writer || writer.state === 'released') && Object.keys(pending?.entries || {}).length === 0;
}
const count = async () => Number((await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + ROOT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', $top: '1', $inlinecount: 'allpages', $select: 'Id', metadata: 'no' }), { account: accounts.admin })).value.d.__count);
async function create(parent, type, suffix, fields) {
  const result = await local.api(parent, { method: 'POST', account: accounts.admin, body: { __ContentType: type, Name: prefix + '-' + suffix, ...fields }, query: { metadata: 'no' } });
  assert.equal(result.Path, parent + '/' + prefix + '-' + suffix); fixtures.push(result); return result;
}
async function api(route, method = 'GET', body) {
  const moduleUrl = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name).find(url => new URL(url).pathname === '/services/nativeApi.ts'));
  assert.ok(moduleUrl);
  return page.evaluate(async ({ moduleUrl, route, method, body }) => (await import(moduleUrl)).nativeRequest(route, { method, ...(body ? { body: JSON.stringify(body) } : {}) }), { moduleUrl, route, method, body });
}
async function openEditor(timeline) {
  await page.goto(FRONTEND + '/timelines/' + encodeURIComponent(timeline.Name));
  await page.getByTitle('Edit Timeline', { exact: true }).click();
  const panel = page.locator('section.image-editor');
  await panel.getByRole('button', { name: 'Generate preview', exact: true }).waitFor(); return panel;
}
async function preview(panel) {
  await panel.locator('.image-editor-candidates input').first().check();
  await panel.getByRole('button', { name: 'Generate preview', exact: true }).click();
  await panel.locator('[data-poster-fan][aria-label="Generated image preview"]').waitFor();
}
async function run() {
  local.assertLocal(local.REPOSITORY);
  const inspect = JSON.parse(docker(['inspect', '--format', '{"project":"{{index .Config.Labels "com.docker.compose.project"}}","service":"{{index .Config.Labels "com.docker.compose.service"}}","image":"{{.Config.Image}}","running":{{.State.Running}}}', CONTAINER]));
  assert.deepEqual(inspect, { project: 'timeline-local', service: 'app', image: 'timeline-theories-app:local', running: true });
  const { appBinding } = await import('../client/api/store.mjs');
  storeDirectory = path.join(local.ROOT, 'netlify-app-blobs', 'entries', 'timeline-theories-m0-local', process.platform === 'win32' ? 'site\uF03Atimeline-app-state-v1' : 'site:timeline-app-state-v1', 'v1', appBinding({ repositoryUrl: local.REPOSITORY, authority: local.AUTHORITY, projectRoot: ROOT }));
  assert.ok(fs.statSync(storeDirectory).isDirectory()); assert.ok(localStateIsIdle(), 'Preserve a pre-existing held or uncertain application write.');
  report.initialCount = await count(); save();
  try {
    const oldTimeline = await create(ROOT + '/Timelines', 'Timeline', 'old', { DisplayName: 'Unfinished cover ' + uuid, IsVisible: true, SortOrder: 'chronological' });
    const newTimeline = await create(ROOT + '/Timelines', 'Timeline', 'new', { DisplayName: 'Fresh cover ' + uuid, IsVisible: true, SortOrder: 'chronological' });
    const media = await create(ROOT + '/MediaLibrary', 'MediaItem', 'poster', { DisplayName: 'Recovery test poster', Title: 'Recovery test poster', MediaType: 'movie' });
    const original = png(700, 1000, 7);
    await local.upload(ROOT + '/MediaLibrary', { name: media.Name + '.png', contentType: 'MediaItem', contentId: media.Id, field: 'CoverImageBin', bytes: original, mime: 'image/png', account: accounts.admin });
    for (const item of [oldTimeline, newTimeline, media]) await permissions(item.Id, [{ identity: '/Root/IMS/BuiltIn/Portal/Visitor', ...READ_PERMISSIONS }, { identity: accounts.editor.path, ...WRITE_PERMISSIONS }]);
    for (const item of [oldTimeline, newTimeline]) await create(item.Path, 'TimelineEntry', item.Id + '-entry', { DisplayName: 'Poster', Position: 1, MediaItem: [media.Id] });
    browser = await playwright.chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext({ ignoreHTTPSErrors: false, viewport: { width: 1440, height: 1100 } }); page = await context.newPage();
    const wire = []; let hasPermissionRequests = 0;
    page.on('request', request => { const url = new URL(request.url()); if (/\/HasPermission$/i.test(url.pathname)) hasPermissionRequests++; if (url.origin === FRONTEND && url.pathname.startsWith('/api/')) wire.push({ method: request.method(), path: url.pathname }); });
    const metadataPattern = '**/api/v1/images/preview-sources', sourcePattern = '**/api/v1/content/' + media.Id + '/cover';
    const faults = { metadata: 0, original: 0 };
    const gatewayFailure = route => route.fulfill({ status: 520, contentType: 'application/json', body: JSON.stringify({ type: 'https://developers.cloudflare.com/support/troubleshooting/http-status-codes/cloudflare-5xx-errors/error-520/', status: 520, error_code: 520, cloudflare_error: true }) });
    if (transientReads) {
      await page.route(metadataPattern, route => faults.metadata++ === 0 ? gatewayFailure(route) : route.continue());
      await page.route(sourcePattern, route => faults.original++ === 0 ? gatewayFailure(route) : route.continue());
    }
    await page.goto(FRONTEND + '/timelines'); await page.getByRole('button', { name: /Login with/ }).click();
    await page.waitForURL(url => url.origin === local.AUTHORITY);
    await page.locator('input[name="Username"],input[type="email"]').first().fill(accounts.editor.loginUsername || accounts.editor.username);
    await page.locator('input[type="password"]').fill(accounts.editor.password); await page.getByRole('button', { name: /^Login$|^Log in$|^Sign in$/i }).click();
    await page.waitForURL(url => url.origin === FRONTEND); await page.getByRole('button', { name: /Logout/ }).waitFor();
    let panel = await openEditor(newTimeline);
    assert.equal(wire.filter(item => item.path === '/api/v1/images/recovery/pending').length, 0, 'Editor mount must not request recovery discovery.');
    const owner = await api('/content/' + oldTimeline.Id);
    const identity = await local.api(accounts.editor.path, { account: accounts.admin, query: { $select: 'Id', metadata: 'no' } });
    // Find the already running local launcher's emulator configuration INSIDE
    // its container. Neither its token nor any user credential leaves stdout.
    // Use the real Store/Coordinator CAS API, never edit live journal files.
    const seedCode = `import fs from 'node:fs';import {Store,hash} from './client/api/store.mjs';import {Coordinator} from './client/api/coordinator.mjs';import {loadConfig} from './client/api/config.mjs';import {imageOperationId} from './client/api/image-assets.mjs';
const input=JSON.parse(fs.readFileSync(0,'utf8'));let found;for(const pid of fs.readdirSync('/proc').filter(p=>/^\\d+$/.test(p))){try{const pairs=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\\0'),env=Object.fromEntries(pairs.filter(p=>p.includes('=')).map(p=>[p.slice(0,p.indexOf('=')),p.slice(p.indexOf('=')+1)]));if(env.TIMELINE_LOCAL_BLOB_ENDPOINT&&env.TIMELINE_LOCAL_PROFILE==='true'){found=env;break;}}catch{}}
if(!found)throw Error('Existing local emulator unavailable');Object.assign(process.env,found);const config=loadConfig();if(!config.local||config.repositoryUrl!=='https://localhost:41016'||config.authority!=='https://localhost:41017'||config.blobOptions.siteID!=='timeline-theories-m0-local')throw Error('Local fixture binding rejected');
if(!input.owner.Name.startsWith('q-pending-image-')||input.owner.Path!=='/Root/Content/timelines/Timelines/'+input.owner.Name)throw Error('Fixture owner rejected');
const store=new Store(config),coordinator=new Coordinator(config);if((await store.pendingMutations()).length||(await coordinator.inspect()).state==='held')throw Error('Pre-existing pending writer must be preserved');
const principal='session:'+input.identity+':'+hash(input.oldSession),operationId=imageOperationId(principal,input.generationId+':draft','image-draft');
const payload={operationId,action:'image-draft',targetId:input.owner.Id,generationId:input.generationId,expectedRevision:input.owner.revision,manifest:{schemaVersion:1,kind:'timeline-composite',projectPath:config.projectRoot,ownerId:input.owner.Id,generationId:input.generationId,sourceIds:[input.sourceId],recipe:{template:'poster-strip-v1',sourceIds:[input.sourceId],seed:1},sourceStamps:[{id:input.sourceId,stamp:hash('local-fixture')}],variants:[]}};payload.requestHash=hash(payload);
await coordinator.run(async()=>{if((await store.pendingMutations()).length)throw Error('Concurrent pending writer');await store.prepareMutation(principal,payload,{owner:input.owner});},{requestId:input.requestId,identity:input.identity,principal,operationId});
await coordinator.run(async()=>{},{requestId:input.laterRequestId,identity:input.identity,principal:'session:'+input.identity+':'+hash('later-local-fixture')});
console.log(JSON.stringify({operationId,requestId:input.requestId,repositoryWrites:0}));`;
    const seedInput = { owner, identity: identity.Id, sourceId: media.Id, generationId: crypto.randomUUID(), requestId: crypto.randomUUID(), laterRequestId: crypto.randomUUID(), oldSession: crypto.randomUUID() };
    // Persist the exact intent BEFORE dispatch. A lost seed acknowledgement
    // must preserve the fixture rather than delete a potentially pending owner.
    report.seedIntent = seedInput; seeded = true; save();
    report.seed = JSON.parse(docker(['exec', '-i', CONTAINER, 'node', '--input-type=module', '-e', seedCode], JSON.stringify(seedInput))); save();
    await preview(panel);
    if (transientReads) {
      await panel.locator('.image-editor-candidates [data-image-state="loaded"]').waitFor();
      const beforeRepeat = wire.filter(item => item.path === '/api/v1/content/' + media.Id + '/cover').length;
      await preview(panel);
      assert.equal(wire.filter(item => item.path === '/api/v1/content/' + media.Id + '/cover').length, beforeRepeat, 'Successful originals are reused after fresh metadata.');
      assert.ok(faults.metadata >= 3 && faults.original >= 2, 'Both failed reads must have been retried.');
      report.checks.push('Transient 520 metadata/original failures recover once; repeated preview reuses verified original bytes');
      await panel.screenshot({ path: path.join(directory, 'transient-read-recovered.png') });
      let entered, resume;
      const started = new Promise(resolve => { entered = resolve; });
      const stalled = route => new Promise(resolve => { resume = async () => { await route.abort().catch(() => {}); resolve(); }; entered(); });
      await page.route(metadataPattern, stalled);
      await panel.getByRole('button', { name: 'Generate preview', exact: true }).click(); await started;
      await panel.getByRole('button', { name: 'Cancel preview', exact: true }).click();
      assert.equal(await panel.getByRole('button', { name: 'Generate preview', exact: true }).isEnabled(), true);
      await resume(); await page.unroute(metadataPattern, stalled);
      report.checks.push('A stalled preview can be cancelled without locking selection or publishing');
      await preview(panel);
    }
    await panel.getByRole('button', { name: 'Publish', exact: true }).click();
    await panel.getByRole('alert').filter({ hasText: 'blocked before writing' }).waitFor({ timeout: 120000 });
    assert.equal(await panel.getByRole('button', { name: 'Retry publication', exact: true }).count(), 0);
    assert.equal(await panel.locator('.image-editor-candidates input').first().isEnabled(), true);
    report.checks.push('Older pending draft blocks a different timeline without a false current-operation lock');
    const recovery = panel.locator('details.image-editor-recovery'); await recovery.locator('summary').click();
    await recovery.getByRole('button', { name: 'Check my unfinished publications', exact: true }).click();
    await recovery.getByRole('combobox').waitFor({ timeout: 120000 });
    assert.equal(await recovery.getByRole('combobox').inputValue(), report.seed.operationId);
    assert.ok((await recovery.getByRole('combobox').textContent()).includes(oldTimeline.DisplayName));
    const requestField = recovery.getByRole('textbox', { name: 'Original server request' });
    await requestField.fill(report.seed.requestId);
    assert.equal(await recovery.getByRole('button', { name: 'Close original failed attempt', exact: true }).isEnabled(), false);
    await recovery.getByRole('button', { name: 'Check original saved outcome', exact: true }).click();
    await recovery.getByRole('status').filter({ hasText: 'still unconfirmed' }).waitFor({ timeout: 120000 });
    const beforeClose = wire.length;
    await recovery.getByRole('checkbox').check();
    await recovery.getByRole('button', { name: 'Close original failed attempt', exact: true }).click();
    await recovery.getByRole('status').filter({ hasText: 'failed attempt is closed' }).waitFor({ timeout: 120000 }); recovered = true;
    assert.equal(await panel.getByRole('alert').count(), 0, 'Successful original recovery clears the old error.');
    assert.deepEqual(wire.slice(beforeClose).filter(item => item.method !== 'GET'), [{ method: 'POST', path: '/api/v1/images/recovery' }]);
    const afterOwner = await api('/content/' + oldTimeline.Id); assert.equal(afterOwner.revision, owner.revision);
    report.checks.push('Renewed owner session discovers the original draft; exact registered request closure changes no owner content and sends no upload');
    await panel.screenshot({ path: path.join(directory, 'recovered.png') });
    await page.reload(); await page.getByTitle('Edit Timeline', { exact: true }).click(); panel = page.locator('section.image-editor');
    await panel.getByRole('button', { name: 'Generate preview', exact: true }).waitFor();
    await preview(panel); await panel.getByRole('button', { name: 'Publish', exact: true }).click();
    await panel.locator('.image-editor-state').filter({ hasText: /^Published$/ }).waitFor({ timeout: 180000 });
    const presentation = await api('/content/' + newTimeline.Id + '/image-presentation/editor'); assert.equal(presentation.state, 'active'); assert.equal(presentation.variants.length, 3);
    const result = await local.request(local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: String(media.Id), propertyname: 'CoverImageBin' }), { account: accounts.admin });
    assert.equal(sha256(result.bytes), sha256(original));
    assert.equal(hasPermissionRequests, 0); report.hasPermissionRequests = hasPermissionRequests;
    report.checks.push('Fresh real publication succeeds after recovery; all three native variants exist and original bytes remain unchanged');
    await panel.screenshot({ path: path.join(directory, 'published.png') });
    report.passed = true;
  } catch (error) { report.error = error.message; await page?.screenshot({ path: path.join(directory, 'failure.png'), fullPage: true }).catch(() => {}); throw error; }
  finally {
    await browser?.close();
    report.fixtures = fixtures.map(item => ({ id: item.Id, path: item.Path }));
    if ((!seeded || recovered) && localStateIsIdle()) {
      // Only delete this run's UUID fixtures in the dedicated local repository.
      for (const item of fixtures.filter(item => ['Timeline', 'MediaItem'].includes(item.Type)).sort((a, b) => Number(b.Type === 'Timeline') - Number(a.Type === 'Timeline'))) {
        const current = await local.api(item.Id, { account: accounts.admin, query: { $select: 'Id,Name,Path,Type', metadata: 'no' } });
        assert.equal(current.Path, item.Path); assert.ok(current.Name.startsWith(prefix));
        await local.api(item.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } });
      }
      report.finalCount = await count(); assert.equal(report.finalCount, report.initialCount); report.cleanupPassed = true;
    } else report.preservedForRecovery = true;
    save(); console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, cleanupPassed: report.cleanupPassed, report: path.join(directory, 'report.json') }));
  }
}
run().catch(error => { console.error(error.message || `${error.name || 'Error'} (${error.code || 'no code'}) at ${String(error.stack || '').split('\n')[1] || 'startup'}`); process.exitCode = 1; });
