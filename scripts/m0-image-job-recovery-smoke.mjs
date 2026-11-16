import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient, followNativeResponse } from './m1-client.mjs';
import { appBinding, hash } from '../client/api/store.mjs';
import { imageOperationId } from '../client/api/image-assets.mjs';

const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const { png, sha256 } = require('./helpers/image-variant-fixture.cjs');
const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GATEWAY = 'https://localhost:8080', PROJECT = '/Root/Content/timelines', CONTAINER = 'timeline-local-app-1';
const BINDING = appBinding({ repositoryUrl: local.REPOSITORY, authority: local.AUTHORITY, projectRoot: PROJECT });
// getStore adds the site: namespace. Docker writes Linux colon names; Docker
// Desktop exposes that colon as U+F03A through the Windows bind-mount view.
// The older host launcher percent-escaped namespace is deliberately rejected.
const STORE = process.platform === 'win32' ? 'site\uF03Atimeline-app-state-v1' : 'site:timeline-app-state-v1';
const BLOBS = path.join(local.ROOT, 'netlify-app-blobs', 'entries', 'timeline-theories-m0-local', STORE, 'v1', BINDING);
const CONTAINER_BLOBS = '/app/deployment/.local/netlify-app-blobs/entries/timeline-theories-m0-local/site:timeline-app-state-v1/v1/' + BINDING;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const uuid = value => assert.match(value, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const docker = args => execFileSync('docker', args, { encoding: 'utf8', windowsHide: true, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const responseValue = response => JSON.parse(response.body.toString());
function success(response) {
  const value = response.value ?? responseValue(response);
  assert.ok(response.status >= 200 && response.status < 300 && value.ok !== false, `Native request rejected: ${response.status}/${value.error?.code || 'unknown'}`);
  return value;
}
function hostPath(value) {
  value = value.replaceAll('\\', '/').replace(/^\/(?:run\/desktop\/mnt\/host|host_mnt)\/([a-z])\//i, '$1:/');
  return value.replace(/\/$/, '').toLowerCase();
}
/** Same fixed Compose ownership boundary as m1-restart-smoke; no env is read. */
function inspect(id = CONTAINER, running = true) {
  assert.ok(id === CONTAINER || /^[0-9a-f]{64}$/.test(id));
  const template = '{"id":"{{.Id}}","startedAt":"{{.State.StartedAt}}","finishedAt":"{{.State.FinishedAt}}","status":"{{.State.Status}}","health":"{{if .State.Health}}{{.State.Health.Status}}{{end}}","project":"{{index .Config.Labels "com.docker.compose.project"}}","service":"{{index .Config.Labels "com.docker.compose.service"}}","image":"{{.Config.Image}}","imageId":"{{.Image}}","ports":{{json .HostConfig.PortBindings}},"mounts":{{json .Mounts}}}';
  const value = JSON.parse(docker(['inspect', '--type', 'container', '--format', template, id]));
  assert.match(value.id, /^[0-9a-f]{64}$/); assert.ok(Number.isFinite(Date.parse(value.startedAt)));
  assert.equal(value.project, 'timeline-local'); assert.equal(value.service, 'app'); assert.equal(value.image, 'timeline-theories-app:local');
  assert.match(value.imageId, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(value.ports?.['8080/tcp'], [{ HostIp: '127.0.0.1', HostPort: '8080' }]);
  const mount = value.mounts.find(row => row.Destination === '/app/deployment/.local/netlify-app-blobs');
  assert.equal(mount?.Type, 'bind'); assert.equal(hostPath(mount.Source), hostPath(path.join(local.ROOT, 'netlify-app-blobs')));
  if (running) assert.equal(value.status, 'running');
  delete value.mounts; delete value.ports; return value;
}
/** Observability only: never edit app Blobs or start another Blobs server. */
function blob(key) {
  assert.ok(fs.statSync(BLOBS).isDirectory(), 'The exact active Docker store directory must already exist.');
  assert.match(key, /^[A-Za-z0-9_/-]+$/); assert.ok(!key.includes('..'));
  const file = path.resolve(BLOBS, ...key.split('/'));
  assert.ok(file.startsWith(BLOBS + path.sep));
  try { assert.ok(fs.statSync(file).size <= 20 * 1024 * 1024); return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function hostStoreProvenance() {
  assert.ok(fs.statSync(BLOBS).isDirectory());
  const files = {};
  for (const key of ['writer', 'pending-mutations']) {
    const file = path.join(BLOBS, key);
    try {
      assert.ok(fs.statSync(file).size <= 20 * 1024 * 1024);
      const bytes = fs.readFileSync(file); files[key] = sha256(bytes);
      if (key === 'writer') assert.equal(JSON.parse(bytes).binding, BINDING);
    } catch (error) { if (error.code === 'ENOENT' && key !== 'writer') files[key] = null; else throw error; }
  }
  return { binding: BINDING, files };
}
/** Read-only Docker Node exec cross-checks the actual live container namespace
 * against its host bind mount. No token/env/metadata content is returned. */
function verifyActiveStore(containerId) {
  assert.match(containerId, /^[0-9a-f]{64}$/);
  const code = `const fs=require('node:fs'),crypto=require('node:crypto'),path=require('node:path');const root=process.argv[1],binding=process.argv[2],files={};if(!fs.statSync(root).isDirectory())throw Error('Store directory absent');for(const key of ['writer','pending-mutations']){try{const file=path.join(root,key);if(fs.statSync(file).size>20971520)throw Error('Store record too large');const bytes=fs.readFileSync(file);if(key==='writer'&&JSON.parse(bytes).binding!==binding)throw Error('Writer binding mismatch');files[key]=crypto.createHash('sha256').update(bytes).digest('hex')}catch(error){if(error.code==='ENOENT'&&key!=='writer')files[key]=null;else throw error}}process.stdout.write(JSON.stringify({binding,files}));`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = hostStoreProvenance();
    const inside = JSON.parse(docker(['exec', containerId, 'node', '-e', code, CONTAINER_BLOBS, BINDING]));
    const after = hostStoreProvenance();
    if (hash(before) === hash(after) && hash(inside) === hash(after)) return { containerId, hostDirectory: BLOBS, containerDirectory: CONTAINER_BLOBS, ...after, matchingReadOnlyHashes: true };
  }
  throw new Error('Active Docker store provenance did not match stable host bytes; do not interrupt this app.');
}
function idle() {
  const writer = blob('writer'); assert.ok(!writer || writer.binding === BINDING && writer.state === 'released', 'Pre-existing app writer is held; preserve it.');
  assert.equal(Object.keys(blob('pending-mutations')?.entries ?? {}).length, 0, 'Pre-existing uncertain write must be recovered by its original caller.');
}
function onlyOwnInterruptedWriter(state) {
  const writer = blob('writer'), pending = Object.values(blob('pending-mutations')?.entries ?? {});
  assert.ok(!writer || writer.binding === BINDING);
  if (writer?.state === 'held') {
    assert.equal(writer.owner?.requestId, state.requestId); assert.equal(writer.owner?.operationId, state.operationId);
    assert.equal(writer.owner?.principal, state.principal); assert.equal(writer.owner?.identity, state.grant.identity); assert.equal(writer.owner?.jobId, state.jobId);
  } else assert.ok(!writer || writer.state === 'released');
  for (const row of pending) { assert.equal(row.operation_id, state.operationId); assert.equal(row.principal, state.principal); }
  return { writer, pending: pending.map(row => ({ operationId: row.operation_id, state: row.state })) };
}
function savePrivate(file, state) {
  assert.ok(file.startsWith(path.join(local.ROOT, 'image-job-recovery') + path.sep));
  execFileSync('git', ['check-ignore', '--quiet', file], { cwd: WORKSPACE, stdio: 'ignore', windowsHide: true });
  const temporary = file + '.' + randomUUID() + '.tmp', fd = fs.openSync(temporary, 'wx', 0o600);
  try {
    if (process.platform === 'win32') {
      const owner = process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' + process.env.USERNAME : process.env.USERNAME;
      assert.ok(owner); execFileSync('icacls.exe', [temporary, '/inheritance:r', '/grant:r', owner + ':(F)'], { stdio: 'ignore', windowsHide: true });
    }
    fs.writeFileSync(fd, JSON.stringify(state, null, 2)); fs.fsyncSync(fd);
  } catch (error) { fs.closeSync(fd); fs.unlinkSync(temporary); throw error; }
  fs.closeSync(fd); fs.renameSync(temporary, file);
}
async function count(account, query = '+InTree:' + PROJECT) {
  const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: query + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$top': '0', '$inlinecount': 'allpages', metadata: 'no' }), { method: 'GET', account });
  assert.equal(response.status, 200); const value = Number(response.value?.d?.__count); assert.ok(Number.isSafeInteger(value) && value >= 0); return value;
}
async function managedDraftNodes(account, timeline, generationId) {
  const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:"' + timeline.Path + '" .AUTOFILTERS:OFF .LIFESPAN:OFF', '$top': '10', '$inlinecount': 'allpages', '$select': 'Id,Name,Path,ParentId,Type,IsSystemContent', metadata: 'no' }), { method: 'GET', account });
  assert.equal(response.status, 200); const rows = response.value?.d?.results;
  assert.ok(Array.isArray(rows)); assert.equal(Number(response.value.d.__count), rows.length);
  const managed = rows.filter(row => row.Id !== timeline.Id); assert.ok(managed.length <= 2, 'A draft may create only its root and exact generation, without variants.');
  const root = managed.find(row => row.ParentId === timeline.Id);
  if (root) { assert.equal(root.Name, '(images)'); assert.equal(root.Path, timeline.Path + '/(images)'); assert.equal(root.Type, 'SystemFolder'); assert.equal(root.IsSystemContent, true); }
  for (const row of managed.filter(row => row !== root)) { assert.ok(root); assert.equal(row.ParentId, root.Id); assert.equal(row.Name, generationId); assert.equal(row.Path, root.Path + '/' + generationId); assert.equal(row.Type, 'Folder'); }
  return managed.map(row => ({ id: row.Id, parentId: row.ParentId, path: row.Path, type: row.Type }));
}

export async function runAcceptance() {
  assert.equal(local.REPOSITORY, 'https://localhost:41016'); assert.equal(local.AUTHORITY, 'https://localhost:41017');
  const before = inspect(), activeStoreBefore = verifyActiveStore(before.id); idle();
  const directory = path.join(local.ROOT, 'image-job-recovery', randomUUID()); fs.mkdirSync(directory, { recursive: true });
  const stateFile = path.join(directory, 'state.json'), reportFile = path.join(directory, 'report.json');
  const state = { version: 1, prefix: 'm0-image-job-' + randomUUID(), gateway: GATEWAY, repository: local.REPOSITORY, authority: local.AUTHORITY, project: PROJECT, containerBefore: before, fixtures: [], operations: [], phase: 'preparing' };
  const report = { version: 1, startedAt: new Date().toISOString(), passed: false, interrupted: false, branch: null, activeStoreBefore, rawRepositoryMethods: ['GET'], limitations: 'One real local worker interruption; the observed checkpoint is not deterministic. This does not prove a remote upstream commit or Netlify cloud behavior.', stateFile, checks: [] };
  const save = () => savePrivate(stateFile, state);
  const api = createClient({ baseUrl: GATEWAY + '/api/v1', repository: local.REPOSITORY, authority: local.AUTHORITY, project: PROJECT, caFile: path.join(local.ROOT, 'certificates/localhost.pem') });
  const accounts = local.readAccounts(); let resolved = false, stopAttempted = false;
  const native = (route, options = {}) => api.request(route, { ...options, token: state.grant.token });
  const raw = (route, options = {}) => api.rawRequest(route, { ...options, token: state.grant.token });
  const read = async id => (await native('/content/' + id)).data;
  const own = content => {
    const expected = state.fixtures.find(row => row.id === content.Id);
    assert.ok(expected && content.Path === expected.path && content.Name === expected.name && content.Type === expected.type);
    assert.ok(content.Name.startsWith(state.prefix) && content.Path.startsWith(PROJECT + '/')); return content;
  };
  async function apply(commands) {
    const step = { commands, key: randomUUID() }; state.operations.push(step); save();
    step.plan = await native('/plans', { method: 'POST', body: { commands } }); assert.equal(step.plan.repositoryWrites, 0); save();
    const result = success(await followNativeResponse(await raw('/plans/' + step.plan.id + '/apply', { method: 'POST', body: {}, idempotencyKey: step.key }), (route, options) => raw(route, options)));
    assert.equal(result.ok, true); step.result = result; step.completed = true; save(); return result;
  }
  async function create(type, fields) {
    const result = await apply([{ action: 'create', type, fields }]), content = await read(result.completed[0].result.id);
    const parent = PROJECT + (type === 'Timeline' ? '/Timelines/' : '/MediaLibrary/');
    assert.equal(content.Name, fields.Name); assert.equal(content.Path, parent + fields.Name); assert.equal(content.Type, type);
    const protectedIds = Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT, 'restore-journal.json'), 'utf8')).idMap).map(Number);
    assert.ok(!protectedIds.includes(content.Id)); state.fixtures.push({ id: content.Id, path: content.Path, name: content.Name, type }); save(); return content;
  }
  async function verifyApp() {
    const value = await api.verify(); assert.equal(value.runtime, 'Netlify Functions in the Timeline app'); assert.equal(value.backendProtocolRequired, 'gateway-coordinated-v1'); return value;
  }
  async function restore() {
    const stopped = inspect(before.id, false); assert.equal(stopped.id, before.id); assert.equal(stopped.imageId, before.imageId);
    docker(['start', before.id]);
    const deadline = Date.now() + 240000;
    while (Date.now() < deadline) {
      try {
        const current = inspect(before.id); assert.equal(current.imageId, before.imageId);
        if (current.health === 'healthy') { await verifyApp(); if (state.stopped) assert.notEqual(current.startedAt, before.startedAt); report.activeStoreAfter = verifyActiveStore(before.id); state.containerAfter = current; state.phase = 'app_restored'; save(); return; }
      } catch { /* Bounded readiness only; time never proves an operation stopped. */ }
      await pause(1000);
    }
    throw new Error('The exact owned app did not restore health; retain saved state.');
  }
  try {
    save(); await verifyApp(); idle();
    state.initialCount = await count(accounts.admin); save();
    state.grant = await api.request('/grants', { method: 'POST', token: accounts.editor.apiKey, backendAuth: 'ApiKey', body: { scopes: ['content:read', 'timelines:write', 'media:write', 'covers:write'], expiresInSeconds: 3600 } }); save();
    const timeline = await create('Timeline', { Name: state.prefix + '-timeline', DisplayName: 'Owned image worker recovery fixture', IsVisible: true });
    let media = await create('MediaItem', { Name: state.prefix + '-media', DisplayName: 'Owned generated cover', Title: 'Local image recovery fixture', MediaType: 'movie' });
    const original = png(400, 600, 17); state.original = { id: media.Id, sha256: sha256(original), byteLength: original.length }; save();
    await apply([{ action: 'cover', targetId: media.Id, expectedRevision: media.revision, bytesBase64: original.toString('base64'), mimeType: 'image/png', fileName: state.prefix + '.png' }]);
    media = own(await read(media.Id)); assert.equal(sha256(await native('/content/' + media.Id + '/cover', { binary: true })), state.original.sha256);
    assert.equal(await count(accounts.admin), state.initialCount + 2); idle();
    state.timelineId = timeline.Id; state.mediaId = media.Id; state.generationId = randomUUID(); state.key = randomUUID();
    state.principal = 'grant:' + state.grant.id; state.operationId = imageOperationId(state.principal, state.key, 'image-draft');
    state.input = { ownerId: timeline.Id, generationId: state.generationId, expectedRevision: (await read(timeline.Id)).revision, manifest: { schemaVersion: 1, kind: 'timeline-composite', projectPath: PROJECT, ownerId: timeline.Id, generationId: state.generationId, sourceIds: [media.Id], sourceStamps: [{ id: media.Id, stamp: state.original.sha256 }], recipe: { template: 'poster-strip-v1', sourceIds: [media.Id], seed: 17 }, variants: [] } };
    state.phase = 'draft_saved_before_dispatch'; save();
    const queued = await raw('/images/drafts', { method: 'POST', body: state.input, idempotencyKey: state.key });
    assert.equal(queued.status, 202); state.jobId = responseValue(queued).job.id; uuid(state.jobId); save();
    let captured = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (blob(`jobs/${state.jobId}/result`)) break;
      const claim = blob(`jobs/${state.jobId}/claim`), input = blob(`jobs/${state.jobId}/input`);
      const pendingOwnMutation = Object.values(blob('pending-mutations')?.entries ?? {}).some(row => row.operation_id === state.operationId && row.principal === state.principal);
      if (claim && input && pendingOwnMutation) {
        assert.equal(claim.id, state.jobId); assert.equal(claim.principal, state.principal); assert.equal(claim.identity, state.grant.identity);
        assert.equal(input.binding, 'v1/' + BINDING + '/'); assert.equal(input.principal, state.principal); assert.equal(input.identity, state.grant.identity);
        assert.equal(input.image.operationId, state.operationId); assert.equal(input.headers['idempotency-key'], state.key); uuid(input.requestId); uuid(claim.nonce);
        assert.equal(input.method, 'POST'); assert.equal(input.path, '/api/v1/images/drafts'); assert.equal(hash(JSON.parse(Buffer.from(input.body, 'base64'))), hash(state.input));
        assert.equal(blob('image-job-operations/' + state.operationId)?.id, state.jobId);
        state.requestId = input.requestId; state.claimHash = hash(claim); state.jobInputHash = hash(input); state.phase = 'prepared_pending_before_stop';
        state.observedBeforeStop = onlyOwnInterruptedWriter(state); save();
        const current = inspect(before.id); assert.equal(current.startedAt, before.startedAt); assert.equal(current.imageId, before.imageId);
        onlyOwnInterruptedWriter(state);
        if (blob(`jobs/${state.jobId}/result`)) break;
        captured = true; break;
      }
      await pause(10);
    }
    if (!captured) { state.phase = report.branch = 'capture_missed'; save(); throw Object.assign(new Error('The draft completed before an actual claimed/pending worker interruption; no interruption proof was claimed.'), { code: 'capture_missed' }); }
    try {
      // Literal docker argument arrays; target is the exact freshly verified ID.
      stopAttempted = true; state.phase = 'stop_requested'; save(); docker(['stop', '--time', '0', before.id]);
      const stopped = inspect(before.id, false); assert.equal(stopped.status, 'exited'); assert.equal(stopped.startedAt, before.startedAt); assert.ok(Number.isFinite(Date.parse(stopped.finishedAt)));
      state.stopped = stopped; state.phase = 'own_container_stop_observed';
      // The worker could finish between the last pending read and Docker stop.
      // Only inspect these persistent bytes while the container is STILL exited.
      const terminalWhileStopped = blob(`jobs/${state.jobId}/result`);
      state.terminalWhileStopped = terminalWhileStopped ? { status: terminalWhileStopped.status, completedAt: terminalWhileStopped.completedAt, bodySha256: sha256(Buffer.from(terminalWhileStopped.body, 'base64')) } : null;
      if (terminalWhileStopped) {
        state.phase = report.branch = 'capture_missed'; save();
        throw Object.assign(new Error('The stopped container already has a terminal job result; preserve the fixture and do not claim interrupted-worker acceptance.'), { code: 'capture_missed' });
      }
      report.interrupted = true; save();
    } finally { if (stopAttempted) await restore(); }
    assert.equal(hash(blob(`jobs/${state.jobId}/claim`)), state.claimHash); assert.equal(hash(blob(`jobs/${state.jobId}/input`)), state.jobInputHash);
    state.afterStop = { writer: blob('writer'), pendingOperations: Object.values(blob('pending-mutations')?.entries ?? {}).map(row => row.operation_id), jobHadResult: !!blob(`jobs/${state.jobId}/result`) }; save();
    assert.ok(state.stopped && report.interrupted, 'Only the observed stopped container authorizes confirmStopped.');
    const recover = async abandon => {
      const body = { operationId: state.operationId, stoppedRequestId: state.requestId, confirmStopped: true, ...(abandon ? { abandon: true } : {}) };
      state.recoveryRequest = body; save();
      const response = await api.rawRequest('/images/recovery', { method: 'POST', token: accounts.editor.apiKey, backendAuth: 'ApiKey', idempotencyKey: state.key, body });
      return { status: response.status, value: responseValue(response) };
    };
    let recovered = await recover(false);
    if (recovered.status === 409 && recovered.value.pending === true && recovered.value.error?.code === 'uncertain_image_mutation') recovered = await recover(true);
    state.recovery = recovered; save(); assert.equal(recovered.status, 200); assert.equal(recovered.value.pending, false); assert.equal(recovered.value.repositoryWrites, 0);
    if (recovered.value.notPrepared) report.branch = 'claimed_job_not_prepared';
    else if (recovered.value.abandoned) { assert.equal(recovered.value.confirmed, false); assert.equal(recovered.value.failure?.code, 'image_publication_abandoned'); report.branch = 'prepared_unknown_explicitly_abandoned'; }
    else { assert.equal(recovered.value.confirmed, true); assert.equal(recovered.value.result?.id, timeline.Id); assert.equal(recovered.value.result?.generationId, state.generationId); report.branch = 'native_completion_confirmed_receipt'; }
    idle(); resolved = true;
    const mapping = blob('image-job-operations/' + state.operationId); assert.equal(mapping.principal, state.principal); uuid(mapping.id);
    const finalJob = await raw('/jobs/' + mapping.id), finalValue = responseValue(finalJob);
    assert.equal(finalJob.status, report.branch === 'native_completion_confirmed_receipt' ? 201 : 409);
    if (finalJob.status === 409) assert.equal(finalValue.error?.code, report.branch === 'claimed_job_not_prepared' ? 'image_publication_not_prepared' : 'image_publication_abandoned');
    report.jobFinal = { id: mapping.id, status: finalJob.status, code: finalValue.error?.code ?? null };
    const afterSha = sha256(await native('/content/' + media.Id + '/cover', { binary: true }));
    assert.equal(afterSha, state.original.sha256); report.original = { id: media.Id, sha256Before: state.original.sha256, sha256After: afterSha, byteLength: state.original.byteLength }; report.originalShaPreserved = true;
    report.managedDraftNodes = await managedDraftNodes(accounts.admin, timeline, state.generationId);
    report.counts = { initial: state.initialCount, fixtures: 2, managedDraftNodes: report.managedDraftNodes.length, afterRecovery: await count(accounts.admin) };
    assert.equal(report.counts.afterRecovery, state.initialCount + 2 + report.managedDraftNodes.length);
    for (const fixture of state.fixtures) own(await read(fixture.id));
    for (const fixture of state.fixtures) { const current = own(await read(fixture.id)); await apply([{ action: 'delete', targetId: current.Id, expectedRevision: current.revision }]); }
    report.counts.afterCleanup = await count(accounts.admin); assert.equal(report.counts.afterCleanup, state.initialCount); idle();
    await api.request('/grants/' + state.grant.id + '/revoke', { method: 'POST', token: accounts.editor.apiKey, backendAuth: 'ApiKey', body: {} }); state.grant.token = null;
    state.phase = 'completed'; report.passed = true; save();
  } catch (error) {
    state.phase = 'preserved_failure'; state.error = { code: error.code || error.name, status: error.status ?? null, message: String(error.message).slice(0, 500) }; save();
    report.error = state.error; report.preserved = { reason: resolved ? 'Verification or native cleanup did not complete; preserve remaining fixture/state.' : 'Outcome unresolved; no cleanup or redispatch attempted.', fixtureIds: state.fixtures.map(row => row.id), jobId: state.jobId ?? null };
  } finally {
    // The immediate stop block restores in finally before any recovery/cleanup.
    // A second bounded attempt covers a failed first restore without rebuilding.
    if (stopAttempted && !state.containerAfter) {
      try { await restore(); } catch { report.appRestoreFailed = true; }
    }
    report.containerBefore = before; report.containerAfter = state.containerAfter ?? null; report.endedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, interrupted: report.interrupted, branch: report.branch, report: reportFile, state: stateFile }));
  if (!report.passed) throw new Error('Owned local image-job recovery acceptance did not complete; inspect the sanitized report and preserved private state.');
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.length !== 3 || process.argv[2] !== '--run') {
    console.error('Explicit local interruption only: node scripts/m0-image-job-recovery-smoke.mjs --run'); process.exitCode = 1;
  } else runAcceptance().catch(() => { console.error('image_job_recovery_acceptance_failed'); process.exitCode = 1; });
}
