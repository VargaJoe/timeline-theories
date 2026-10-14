import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const local = require('./m0-local-api.cjs');
const GATEWAY = 'https://localhost:8081';
const PROJECT = '/Root/Content/timelines';
const STATE = path.join(local.ROOT, 'm1-restart-state.json');
const REPORT = path.join(local.ROOT, 'm1-restart-report.json');
const PENDING_REPORT = path.join(local.ROOT, 'm1-pending-recovery-report.json');
const DATABASE = path.join(local.ROOT, 'm1-gateway/gateway.sqlite');
const BINDING = { 'X-Timeline-Repository': local.REPOSITORY, 'X-Timeline-Authority': local.AUTHORITY, 'X-Timeline-Project': PROJECT };
const SCOPES = ['content:read', 'timelines:write', 'media:write', 'entries:write'];

/** Independent HTTPS client. It cannot change origins, follow redirects, or disable TLS. */
function request(route, { method = 'GET', token, headers = {}, body, discardResponse = false } = {}) {
  const target = new URL('/api/v1/' + route, GATEWAY);
  if (target.origin !== GATEWAY || !target.pathname.startsWith('/api/v1/') || target.username || target.password) throw new Error('Restart smoke local endpoint guard failed');
  const outbound = { ...BINDING, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers };
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  if (bytes) { outbound['Content-Type'] = 'application/json'; outbound['Content-Length'] = String(bytes.length); }
  return new Promise((resolve, reject) => {
    let discarded = false;
    const req = https.request(target, { method, headers: outbound, ca: fs.readFileSync(path.join(local.ROOT, 'certificates/localhost.pem')) }, res => {
      // A real client disconnect after response headers deliberately drops
      // the result body. The separate own-row reset models the uncertain
      // gateway completion window after the backend commit; it is fault
      // injection into test-owned SQLite rows, not a claim of a power loss.
      if (discardResponse && res.statusCode >= 200 && res.statusCode < 300) {
        discarded = true; resolve({ status: res.statusCode, discarded: true }); res.destroy(); req.destroy(); return;
      }
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 20 * 1024 * 1024) req.destroy(new Error('Restart smoke response limit exceeded')); else chunks.push(chunk); });
      res.on('end', () => { let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { value = null; } resolve({ status: res.statusCode, value }); });
    });
    req.setTimeout(60000, () => req.destroy(new Error('Restart smoke request timed out')));
    req.on('error', error => { if (!discarded) reject(error); }); req.end(bytes);
  });
}

function success(response) {
  if (response.status < 200 || response.status >= 300) throw new Error('Restart request HTTP ' + response.status + ': ' + (response.value?.error?.code || 'unexpected_response'));
  return response.value;
}
function saveState(state) { fs.writeFileSync(STATE, JSON.stringify(state, null, 2), { mode: 0o600 }); }
function loadState() {
  const state = JSON.parse(fs.readFileSync(STATE, 'utf8'));
  assert.ok([1, 2].includes(state.version)); assert.equal(state.gateway, GATEWAY); assert.equal(state.repository, local.REPOSITORY); assert.equal(state.project, PROJECT);
  assert.match(state.prefix, /^m1-restart-[0-9a-f-]{36}$/); assert.ok(Array.isArray(state.fixtures) && Array.isArray(state.reservations));
  return state;
}
function processIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'Supply the explicitly tracked local gateway PID');
  const command = `$taskRestartProcess=Get-Process -Id ${pid} -ErrorAction Stop; if($taskRestartProcess.ProcessName -ne 'node'){throw 'Tracked gateway process is not Node'}; @{pid=$taskRestartProcess.Id;startedAt=$taskRestartProcess.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`;
  const value = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8', windowsHide: true }).trim());
  assert.equal(value.pid, pid); assert.ok(typeof value.startedAt === 'string'); return value;
}
async function sourceCount() {
  const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': 'Id', '$top': '1', '$inlinecount': 'allpages', metadata: 'no' }), { account: local.readAccounts().admin });
  assert.equal(response.status, 200); const count = Number(response.value?.d?.__count); assert.ok(Number.isSafeInteger(count)); return count;
}
const sourceIds = () => new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT, 'restore-journal.json'), 'utf8')).idMap));
const referenceId = value => Array.isArray(value) ? referenceId(value[0]) : value && typeof value === 'object' ? value.Id : value;
const read = async (state, id) => success(await request('content/' + id, { token: state.grant.token })).data;
const list = async state => success(await request('entries?' + new URLSearchParams({ timelineId: String(state.timelineId), top: '100', includeHidden: 'true' }), { token: state.grant.token })).items;
async function preview(state, commands) {
  const plan = success(await request('plans', { method: 'POST', token: state.grant.token, body: { commands } }));
  assert.equal(plan.repositoryWrites, 0); return plan;
}
async function apply(state, plan, key, discardResponse = false) {
  const response = await request('plans/' + plan.id + '/apply', { method: 'POST', token: state.grant.token, headers: { 'Idempotency-Key': key }, body: {}, discardResponse });
  if (discardResponse) { assert.equal(response.status, 200); assert.equal(response.discarded, true); return; }
  const result = success(response); assert.equal(result.ok, true); return result;
}
function remember(state, content) {
  assert.ok(!sourceIds().has(content.Id), 'A fixture resolved to a source ID');
  assert.ok(content.Name.startsWith(state.prefix) && content.Path.startsWith(PROJECT + '/'), 'Fixture UUID path ownership failed');
  const existing = state.fixtures.find(fixture => fixture.id === content.Id);
  const fixture = { id: content.Id, name: content.Name, path: content.Path, type: content.Type };
  if (existing) Object.assign(existing, fixture); else state.fixtures.push(fixture); saveState(state); return content;
}
function reserveName(state, type, name, parentPath) {
  assert.ok(name.startsWith(state.prefix)); state.reservations.push({ type, name, path: parentPath + '/' + name }); saveState(state);
}
async function assertGateway() {
  const capabilities = success(await request('capabilities'));
  assert.equal(capabilities.repository, local.REPOSITORY); assert.equal(capabilities.authority, local.AUTHORITY); assert.equal(capabilities.project, PROJECT);
}

function resetOwnCompletions(state, resetMutationReceipts = false) {
  assert.ok(fs.existsSync(DATABASE), 'Owned gateway SQLite store is missing');
  const db = new DatabaseSync(DATABASE); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
  try {
    const grant = db.prepare('SELECT identity,revoked FROM grants WHERE id=?').get(state.grant.id);
    assert.equal(grant.identity, state.grant.identity); assert.equal(grant.revoked, 0);
    const ownIds = new Set(state.fixtures.map(fixture => fixture.id));
    for (const step of state.lost) {
      const plan = db.prepare('SELECT principal,request_hash,body FROM plans WHERE id=?').get(step.plan.id);
      assert.equal(plan.principal, state.principal); assert.equal(plan.request_hash, step.plan.requestHash);
      const privatePlan = JSON.parse(plan.body); assert.equal(privatePlan.id, step.plan.id);
      for (const entry of privatePlan.steps) {
        const payload = entry.payload;
        if (payload.action === 'create') { assert.ok(payload.fields.Name.startsWith(state.prefix)); assert.equal(payload.type, 'MediaItem'); }
        else assert.ok(ownIds.has(payload.targetId), 'Fault injection targeted a nonfixture plan');
        if (payload.action === 'order') assert.ok(payload.entries.every(entry => ownIds.has(entry.id)));
        const mutation = db.prepare('SELECT state,result,request_hash,before_state FROM mutations WHERE principal=? AND operation_id=?').get(state.principal, payload.operationId);
        assert.equal(mutation.request_hash, payload.requestHash); assert.equal(mutation.state, 'completed'); assert.ok(mutation.result, 'Durable application mutation receipt is missing');
        if (resetMutationReceipts) {
          assert.equal(payload.action, 'create', 'Pending-receipt injection is restricted to the own unrenamed create');
          const committed = JSON.parse(mutation.result), before = JSON.parse(mutation.before_state);
          assert.equal(committed.id, state.mediaId); assert.ok(ownIds.has(committed.id));
          assert.equal(before.path, state.fixtures.find(fixture => fixture.id === committed.id).path);
          const changed = db.prepare("UPDATE mutations SET result=NULL,state='pending' WHERE principal=? AND operation_id=? AND request_hash=? AND state='completed'").run(state.principal, payload.operationId, payload.requestHash);
          assert.equal(changed.changes, 1);
        }
      }
      const operation = db.prepare('SELECT * FROM operations WHERE principal=? AND key=?').get(state.principal, step.key);
      assert.equal(operation.plan_id, step.plan.id); assert.equal(operation.request_hash, step.plan.requestHash); assert.equal(operation.state, 'completed');
      const completed = JSON.parse(operation.result); assert.equal(completed.ok, true);
      for (const result of completed.completed) {
        if (result.result.id) assert.ok(ownIds.has(result.result.id));
        if (result.result.completed) assert.ok(result.result.completed.every(entry => ownIds.has(entry.id)));
      }
      const changed = db.prepare("UPDATE operations SET result=NULL,state='pending',updated=? WHERE principal=? AND key=? AND plan_id=? AND request_hash=? AND state='completed'").run(Date.now(), state.principal, step.key, step.plan.id, step.plan.requestHash);
      assert.equal(changed.changes, 1);
    }
    db.exec('COMMIT;');
  } catch (error) { db.exec('ROLLBACK;'); throw error; } finally { db.close(); }
}

/** Prepare creates only UUID fixtures, drops three HTTP result bodies and resets only their verified gateway rows. It never stops a process. */
export async function prepare(pid) {
  if (fs.existsSync(STATE)) assert.ok(['completed', 'cleaned'].includes(loadState().phase), 'A previous restart fixture is still pending; resume or clean it first');
  const state = { version: 2, architecture: 'standard-sensenet-shared-application-coordinator', phase: 'preparing', preparedAt: new Date().toISOString(), prefix: 'm1-restart-' + randomUUID(), gateway: GATEWAY, repository: local.REPOSITORY, project: PROJECT, processBefore: processIdentity(pid), fixtures: [], reservations: [], lost: [], checks: [] };
  saveState(state);
  try {
    await assertGateway(); state.initialCount = await sourceCount(); saveState(state);
    const grant = success(await request('grants', { method: 'POST', token: local.readAccounts().editor.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' }, body: { scopes: SCOPES, expiresInSeconds: 3600 } }));
    state.grant = grant; state.principal = 'grant:' + grant.id; saveState(state);
    const timelineName = state.prefix + '-timeline'; reserveName(state, 'Timeline', timelineName, PROJECT + '/Timelines');
    const timelinePlan = await preview(state, [{ action: 'create', type: 'Timeline', fields: { Name: timelineName, DisplayName: 'Restart proof timeline', Description: 'Own UUID restart fixture', IsVisible: false } }]);
    const timelineResult = await apply(state, timelinePlan, randomUUID()); state.timelineId = timelineResult.completed[0].result.id; remember(state, await read(state, state.timelineId));

    const mediaName = state.prefix + '-media'; reserveName(state, 'MediaItem', mediaName, PROJECT + '/MediaLibrary');
    const mediaPlan = await preview(state, [{ action: 'create', type: 'MediaItem', fields: { Name: mediaName, DisplayName: 'Restart proof media', Title: 'Own UUID media', MediaType: 'movie' } }]);
    const mediaKey = state.prefix + '-create'; state.lost.push({ kind: 'create', plan: mediaPlan, key: mediaKey }); saveState(state);
    await apply(state, mediaPlan, mediaKey, true);
    const media = success(await request('lookup', { method: 'POST', token: state.grant.token, body: { target: PROJECT + '/MediaLibrary/' + mediaName } })).data;
    assert.ok(typeof media.revision === 'string' && media.revision.length > 0 && media.revision.length <= 200, 'Stock content needs an opaque application revision');
    state.checks.push({name:'Standard repository content supplies opaque application revisions; no backend rowversion format assumed',passed:true});
    state.mediaId = media.Id; remember(state, media);

    const entryNames = [state.prefix + '-first', state.prefix + '-second']; entryNames.forEach(name => reserveName(state, 'TimelineEntry', name, PROJECT + '/Timelines/' + timelineName));
    const occurrences = await preview(state, entryNames.map((Name, index) => ({ action: 'create', type: 'TimelineEntry', parentId: state.timelineId, fields: { Name, DisplayName: 'Restart occurrence ' + (index + 1), MediaItem: state.mediaId, Position: index + 1, Notes: 'Own occurrence ' + (index + 1) } })));
    const occurrenceResult = await apply(state, occurrences, randomUUID());
    state.entryIds = occurrenceResult.completed.map(result => result.result.id); assert.equal(new Set(state.entryIds).size, 2);
    for (const id of state.entryIds) remember(state, await read(state, id));
    let first = await read(state, state.entryIds[0]);
    const updatePlan = await preview(state, [{ action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { Notes: 'Notes survive lost response and gateway restart' } }]);
    const updateKey = state.prefix + '-update'; state.lost.push({ kind: 'update', plan: updatePlan, key: updateKey }); saveState(state); await apply(state, updatePlan, updateKey, true);
    first = await read(state, state.entryIds[0]); const second = await read(state, state.entryIds[1]);
    const orderPlan = await preview(state, [{ action: 'order', timelineId: state.timelineId, entries: [{ id: second.Id, revision: second.revision }, { id: first.Id, revision: first.revision }] }]);
    const orderKey = state.prefix + '-order'; state.lost.push({ kind: 'order', plan: orderPlan, key: orderKey }); saveState(state); await apply(state, orderPlan, orderKey, true);
    // Another coordinated application mutation after the create response was lost. Recovery
    // must follow the committed create ID rather than recreate its old Name.
    const renamedName = state.prefix + '-media-renamed';
    const beforeRename = await read(state, state.mediaId);
    const renamePlan = await preview(state, [{action:'update',targetId:state.mediaId,expectedRevision:beforeRename.revision,fields:{Name:renamedName}}]);
    await apply(state,renamePlan,randomUUID());
    remember(state, await read(state, state.mediaId));
    const beforeCompeting = await read(state, state.entryIds[1]);
    state.stalePlan = await preview(state,[{action:'update',targetId:beforeCompeting.Id,expectedRevision:beforeCompeting.revision,fields:{Notes:'Stale saved edit must not replace competing app edit'}}]);
    const competing = await preview(state,[{action:'update',targetId:beforeCompeting.Id,expectedRevision:beforeCompeting.revision,fields:{Notes:'Competing coordinated application edit survives restart'}}]);
    await apply(state,competing,randomUUID());
    state.baseline = {};
    for (const fixture of state.fixtures) { const current = await read(state, fixture.id); state.baseline[fixture.id] = { revision: current.revision, name: current.Name }; }
    const entries = await list(state); assert.equal(entries.length, 2); assert.ok(entries.every(entry => referenceId(entry.MediaItem) === state.mediaId));
    assert.equal((await read(state, first.Id)).Position, 2); assert.equal((await read(state, second.Id)).Position, 1);
    assert.equal(await sourceCount(), state.initialCount + state.fixtures.length);
    resetOwnCompletions(state); state.phase = 'prepared'; state.rowsReset = state.lost.length; saveState(state);
    console.log(JSON.stringify({ phase: state.phase, stateFile: 'deployment/.local/m1-restart-state.json', ledgerRowsReset: state.rowsReset, ownedFixtures: state.fixtures.length, sourceCount: state.initialCount, readyForGatewayRestart: true }));
  } catch (error) { state.phase = 'prepare_failed'; state.error = error.message; saveState(state); throw error; }
}

async function cleanup(state, { allowFallback = true } = {}) {
  const results = [], accounts = local.readAccounts(), protectedIds = sourceIds();
  // Recover only explicitly reserved UUID Names if a response was dropped
  // before the normal client could remember its generated ID.
  for (const reservation of state.reservations) {
    const response = await local.request(local.endpoint(reservation.path) + '?' + new URLSearchParams({ '$select': 'Id,Name,Path,Type', metadata: 'no' }), { account: accounts.admin });
    if (response.status === 404) continue;
    assert.equal(response.status, 200); const content = response.value.d;
    assert.equal(content.Name, reservation.name); assert.equal(content.Path, reservation.path); assert.equal(content.Type, reservation.type);
    if (!state.fixtures.some(fixture => fixture.id === content.Id)) remember(state, content);
  }
  const sorted = [...state.fixtures].sort((a, b) => ({ TimelineEntry: 0, Timeline: 1, MediaItem: 2 }[a.type] - { TimelineEntry: 0, Timeline: 1, MediaItem: 2 }[b.type]));
  for (const fixture of sorted) {
    assert.ok(!protectedIds.has(fixture.id) && fixture.name.startsWith(state.prefix) && fixture.path.startsWith(PROJECT + '/'));
    const exact = await local.request(local.endpoint(fixture.id) + '?' + new URLSearchParams({ '$select': 'Id,Name,Path,Type', metadata: 'no' }), { account: accounts.admin });
    if (exact.status === 404) continue;
    assert.equal(exact.status, 200); assert.equal(exact.value.d.Name, fixture.name); assert.equal(exact.value.d.Path, fixture.path); assert.equal(exact.value.d.Type, fixture.type);
    let fallback = false;
    try {
      const current = await read(state, fixture.id);
      const plan = await preview(state, [{ action: 'delete', targetId: fixture.id, expectedRevision: current.revision }]); await apply(state, plan, randomUUID());
    } catch {
      if (!allowFallback) throw new Error('Native UUID cleanup failed; preserve the fixture and journal for recovery');
      // Cleanup is explicitly privileged and restricted to the verified own
      // UUID IDs/paths above. It never substitutes admin for proof operations.
      fallback = true; await local.api(fixture.id, { method: 'DELETE', account: accounts.admin, query: { permanent: 'true' } });
    }
    assert.equal((await local.request(local.endpoint(fixture.id), { account: accounts.admin })).status, 404); results.push({ type: fixture.type, fallback });
  }
  if (state.grant?.token) {
    const revoked = await request('grants/' + state.grant.id + '/revoke', { method: 'POST', token: state.grant.token, body: {} });
    assert.equal(revoked.status, 200); state.grant.token = null;
  }
  if (state.initialCount !== undefined) assert.equal(await sourceCount(), state.initialCount);
  state.cleanup = results; saveState(state); return results;
}

/** Models only the verified own commit-before-receipt window; no external request is resent. */
export async function pendingRecovery() {
  if (fs.existsSync(STATE)) assert.ok(['completed', 'cleaned'].includes(loadState().phase), 'Previous restart fixtures must be completed or cleaned first');
  const state = { version: 2, architecture: 'standard-sensenet-shared-application-coordinator', phase: 'pending_preparing', preparedAt: new Date().toISOString(), prefix: 'm1-restart-' + randomUUID(), gateway: GATEWAY, repository: local.REPOSITORY, project: PROJECT, fixtures: [], reservations: [], lost: [], checks: [] };
  const report = { version: 1, architecture: state.architecture, ranAt: new Date().toISOString(), repository: local.REPOSITORY, project: PROJECT, checks: [], passed: false, instrumentation: 'Only the known completed mutation and operation receipt rows for one verified own unrenamed UUID create are reset to pending. Actual repository postconditions and actual 60-second credential expiry are checked through HTTPS. No unowned rows or global state are changed.' };
  let failure;
  const record = name => { report.checks.push({ name, passed: true }); console.log(JSON.stringify(report.checks.at(-1))); };
  const ownerRecover = async () => success(await request('recovery', { method: 'POST', token: local.readAccounts().editor.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' }, body: { planId: state.lost[0].plan.id } }));
  saveState(state); fs.writeFileSync(PENDING_REPORT, JSON.stringify(report, null, 2));
  try {
    await assertGateway(); state.initialCount = await sourceCount(); report.initialCount = state.initialCount;
    state.grant = success(await request('grants', { method: 'POST', token: local.readAccounts().editor.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' }, body: { scopes: SCOPES, expiresInSeconds: 60 } }));
    state.principal = 'grant:' + state.grant.id; saveState(state);
    const name = state.prefix + '-pending-media'; reserveName(state, 'MediaItem', name, PROJECT + '/MediaLibrary');
    const plan = await preview(state, [{ action: 'create', type: 'MediaItem', fields: { Name: name, DisplayName: 'Own pending recovery fixture', Title: 'Unrenamed UUID recovery media', Description: 'Original approved create postcondition', MediaType: 'movie' } }]);
    const key = randomUUID(), result = await apply(state, plan, key); state.mediaId = result.completed[0].result.id;
    const media = remember(state, await read(state, state.mediaId)); state.lost = [{ kind: 'create', plan, key }]; saveState(state);
    const unrelated = await preview(state, [{ action: 'update', targetId: media.Id, expectedRevision: media.revision, fields: { Description: 'Blocked unrelated plan must never save' } }]);
    resetOwnCompletions(state, true); state.phase = 'pending_receipt'; saveState(state);
    const denied = await request('plans/' + unrelated.id + '/apply', { method: 'POST', token: state.grant.token, headers: { 'Idempotency-Key': randomUUID() }, body: {} });
    assert.equal(denied.status, 409); assert.equal(denied.value.error.code, 'pending_recovery_required'); assert.equal((await read(state, media.Id)).revision, media.revision);
    record('Pending own create receipt fences an unrelated application apply before any repository write');
    const reconciled = await apply(state, plan, key); assert.equal(reconciled.completed[0].result.id, media.Id); assert.equal(reconciled.completed[0].replayed, true); assert.equal(reconciled.completed[0].result.reconciled, true);
    assert.equal((await read(state, media.Id)).revision, media.revision); assert.equal(await sourceCount(), state.initialCount + 1);
    record('Original saved plan/key reconciles the reserved unrenamed postcondition to the same ID with zero saves or duplicate creates');
    resetOwnCompletions(state, true); state.phase = 'pending_expiry'; saveState(state);
    const expiry = Date.parse(state.grant.expiresAt); assert.ok(Number.isFinite(expiry)); report.grantLifetimeSeconds = 60;
    while (Date.now() <= expiry + 100) await new Promise(resolve => setTimeout(resolve, Math.min(20000, expiry + 101 - Date.now())));
    const expired = await request('content/' + media.Id, { token: state.grant.token }); assert.equal(expired.status, 401); assert.equal(expired.value.error.code, 'invalid_credential');
    record('The original scoped credential expires after its actual minimum 60-second lifetime');
    const recovery = await ownerRecover(); assert.equal(recovery.repositoryWrites, 0); assert.equal(recovery.pending, false); assert.equal(recovery.operations.length, 1); assert.equal(recovery.operations[0].confirmed, true); assert.equal(recovery.operations[0].result.id, media.Id);
    const raw = await local.api(media.Id, { account: local.readAccounts().editor, query: { '$select': 'Id,Name,Description', metadata: 'no' } }); assert.equal(raw.Name, media.Name); assert.equal(raw.Description, media.Description);
    assert.equal(await sourceCount(), state.initialCount + 1);
    record('Same backend owner POST/recovery confirms the expired-grant create receipt with zero repository writes');
    state.expiredGrant = { id: state.grant.id, identity: state.grant.identity, expiresAt: state.grant.expiresAt };
    state.grant = success(await request('grants', { method: 'POST', token: local.readAccounts().editor.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' }, body: { scopes: SCOPES, expiresInSeconds: 3600 } })); saveState(state);
    assert.equal((await read(state, media.Id)).revision, media.revision);
  } catch (error) { failure = error; report.error = error.message; }
  try {
    if (state.lost.length) { const recovery = await ownerRecover(); assert.equal(recovery.pending, false, 'Own pending receipt must reconcile before cleanup'); }
    if (state.grant && Date.parse(state.grant.expiresAt) <= Date.now()) {
      state.grant = success(await request('grants', { method: 'POST', token: local.readAccounts().editor.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' }, body: { scopes: SCOPES, expiresInSeconds: 3600 } })); saveState(state);
    }
    report.cleanup = await cleanup(state, { allowFallback: false }); report.finalCount = await sourceCount();
    state.phase = failure ? 'cleaned' : 'completed'; saveState(state);
  } catch (error) { failure ??= error; report.error ??= error.message; state.phase = 'cleanup_failed'; saveState(state); }
  report.passed = !failure; fs.writeFileSync(PENDING_REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, sourceCountBefore: report.initialCount, sourceCountAfter: report.finalCount, nativeCleanup: report.cleanup?.length ?? 0 }));
  if (failure) throw failure; return report;
}

/** Resume verifies a different actual process, retries unchanged plans/keys via HTTPS, then removes only own fixtures. */
export async function resume(pid) {
  const state = loadState(); assert.equal(state.version,2); assert.equal(state.phase, 'prepared');
  const processAfter = processIdentity(pid);
  assert.notDeepEqual(processAfter, state.processBefore, 'The gateway process was not restarted');
  const report = { version: 2, architecture:state.architecture,ranAt: new Date().toISOString(), gateway: GATEWAY, repository: local.REPOSITORY, project: PROJECT, processBefore: state.processBefore, processAfter, simulatedUncertainLedgerRows: state.rowsReset, droppedResponseBodies: state.lost.length, initialCount: state.initialCount, checks: [...state.checks], passed: false,
    limitation: 'Actual response-body loss and process restart recover completed durable application receipts. Only the verified own operations cache rows are reset; mutation receipts remain committed. This does not simulate an unknown upstream commit before its mutation receipt, automatic partial-order resume, direct raw repository writers, or a multi-node transaction.' };
  let failure;
  try {
    await assertGateway();
    const db = new DatabaseSync(DATABASE, { readOnly: true });
    try { for (const step of state.lost) { const row = db.prepare('SELECT state,result,plan_id FROM operations WHERE principal=? AND key=?').get(state.principal, step.key); assert.equal(row.state, 'pending'); assert.equal(row.result, null); assert.equal(row.plan_id, step.plan.id); } } finally { db.close(); }
    for (const step of state.lost) {
      const result = await apply(state, step.plan, step.key); assert.ok(result.completed.length && result.completed.every(item => item.replayed === true), 'Retry did not use durable application receipt recovery');
      if (step.kind === 'create') assert.equal(result.completed[0].result.id, state.mediaId);
      report.checks.push({ name: step.kind + ' lost-response replay recovers the committed application receipt', passed: true });
    }
    for (const fixture of state.fixtures) { const current = await read(state, fixture.id); assert.equal(current.revision, state.baseline[fixture.id].revision); assert.equal(current.Name, state.baseline[fixture.id].name); }
    const entries = await list(state); assert.equal(entries.length, 2); assert.equal(new Set(entries.map(entry => entry.Id)).size, 2); assert.ok(entries.every(entry => referenceId(entry.MediaItem) === state.mediaId));
    assert.equal((await read(state, state.entryIds[0])).Notes, 'Notes survive lost response and gateway restart'); assert.equal((await read(state, state.entryIds[0])).Position, 2); assert.equal((await read(state, state.entryIds[1])).Position, 1);
    const oldName = state.reservations.find(reservation => reservation.type === 'MediaItem').path;
    assert.equal((await local.request(local.endpoint(oldName), { account: local.readAccounts().admin })).status, 404);
    assert.equal(await sourceCount(), state.initialCount + state.fixtures.length);
    report.checks.push({ name: 'Create rename is preserved; two occurrences retain one media ID; update/order retries cause zero new saves', passed: true });
    const stale = await request('plans/'+state.stalePlan.id+'/apply',{method:'POST',token:state.grant.token,headers:{'Idempotency-Key':randomUUID()},body:{}});
    assert.equal(stale.status,409);assert.equal(stale.value.error.code,'revision_conflict');assert.equal((await read(state,state.entryIds[1])).Notes,'Competing coordinated application edit survives restart');
    report.checks.push({name:'A stale saved edit fails after restart and preserves the competing application writer',passed:true});
  } catch (error) { failure = error; report.error = error.message; }
  try {
    report.cleanup = await cleanup(state); report.finalCount = await sourceCount();
    report.cleanupFallbacks = report.cleanup.filter(item => item.fallback).length;
    if (report.cleanupFallbacks) { failure ??= new Error('Restart smoke needed privileged cleanup fallback'); report.error ??= failure.message; }
    state.phase = failure ? 'cleaned' : 'completed'; state.processAfter = processAfter; saveState(state);
  } catch (error) { failure ??= error; report.error ??= error.message; state.phase = 'cleanup_failed'; saveState(state); }
  report.passed = !failure; fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, actualGatewayRestart: true, ledgerRowsReset: state.rowsReset, cleanupFallbacks: report.cleanupFallbacks, sourceCountBefore: report.initialCount, sourceCountAfter: report.finalCount }));
  if (failure) throw failure;
  return report;
}

async function main() {
  const args = process.argv.slice(2); const phase = args[0]; const index = args.indexOf('--gateway-pid');
  if (!['--prepare', '--resume', '--cleanup', '--pending'].includes(phase) || args.some((value, i) => i > 0 && value !== '--gateway-pid' && i !== index + 1)) throw new Error('Use --prepare or --resume --gateway-pid <tracked PID>, --pending, or --cleanup');
  const pid = index >= 0 ? Number(args[index + 1]) : undefined;
  if (phase === '--prepare') await prepare(pid);
  else if (phase === '--resume') await resume(pid);
  else if (phase === '--pending') await pendingRecovery();
  else { const state = loadState(); const result = await cleanup(state); state.phase = 'cleaned'; saveState(state); console.log(JSON.stringify({ phase: state.phase, cleaned: result.length, cleanupFallbacks: result.filter(item => item.fallback).length })); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error.message); process.exitCode = 1; });
