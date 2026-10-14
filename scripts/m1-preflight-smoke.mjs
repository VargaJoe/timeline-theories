import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { followNativeResponse } from './m1-client.mjs';

const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const GATEWAY = 'https://localhost:8080', PROJECT = '/Root/Content/timelines';
const BINDING = { 'X-Timeline-Repository': local.REPOSITORY, 'X-Timeline-Authority': local.AUTHORITY, 'X-Timeline-Project': PROJECT };
const SCOPES = ['content:read', 'timelines:write', 'media:write', 'entries:write', 'metadata:write'];
const REPORT = path.join(local.ROOT, 'm1-preflight-report.json');

function rawRequest(route, { method = 'GET', token, owner = false, body, idempotencyKey } = {}) {
  const url = new URL('/api/v1/' + route.replace(/^\//, ''), GATEWAY);
  assert.equal(url.origin, GATEWAY); assert.ok(url.pathname.startsWith('/api/v1/'));
  const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
  const headers = { ...BINDING, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(owner ? { 'X-Timeline-Backend-Auth': 'ApiKey' } : {}), ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}), ...(bytes ? { 'Content-Type': 'application/json', 'Content-Length': String(bytes.length) } : {}) };
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method, headers, ca: fs.readFileSync(path.join(local.ROOT, 'certificates/localhost.pem')) }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) req.destroy(new Error('Preflight response exceeded the local test limit')); else chunks.push(chunk); });
      res.on('end', () => { const body = Buffer.concat(chunks); let value; try { value = JSON.parse(body.toString('utf8')); } catch { value = null; } resolve({ status: res.statusCode, headers: res.headers, body, value }); });
      res.on('error', () => reject(new Error('Preflight HTTP response was interrupted')));
    });
    req.setTimeout(60000, () => req.destroy(new Error('Preflight local HTTPS request timed out')));
    req.on('error', reject); req.end(bytes);
  });
}
async function request(route, options = {}) {
  const auth = { token: options.token, owner: options.owner };
  return followNativeResponse(await rawRequest(route, options), (nextRoute, nextOptions) => rawRequest(nextRoute, { ...nextOptions, ...auth }));
}
const success = response => {
  if (response.status < 200 || response.status >= 300) throw new Error('Preflight HTTPS ' + response.status + ': ' + (response.value?.error?.code || 'unexpected_response'));
  return response.value;
};

/** Real stock-repository tests. Run only after other local fixture writers stop. */
export async function smoke() {
  assert.equal(local.REPOSITORY, 'https://localhost:41016'); assert.equal(local.AUTHORITY, 'https://localhost:41017');
  const accounts = local.readAccounts(), prefix = 'm1-preflight-' + randomUUID(), owned = new Map(), grants = [], checks = [], cleanup = [];
  const secrets = Object.values(accounts).flatMap(account => ['apiKey', 'token', 'password'].map(name => account[name])).filter(value => typeof value === 'string' && value);
  const scrub = value => secrets.reduce((text, secret) => text.replaceAll(secret, '[redacted]'), String(value));
  const report = { version: 1, ranAt: new Date().toISOString(), gateway: GATEWAY, repository: local.REPOSITORY, project: PROJECT, fixturePrefix: prefix, checks, cleanup, passed: false };
  let editor, deniedChild, failure;
  const record = (name, details = {}) => { const item = { name, passed: true, ...details }; checks.push(item); console.log(JSON.stringify(item)); };
  const issue = async (scopes = SCOPES) => {
    const grant = success(await request('grants', { method: 'POST', token: accounts.editor.apiKey, owner: true, body: { scopes, expiresInSeconds: 3600 } }));
    assert.match(grant.token, /^tta_[A-Za-z0-9_-]{43}$/); secrets.push(grant.token); grants.push(grant); return grant;
  };
  const read = async id => success(await request('content/' + id, { token: editor.token })).data;
  const previewResponse = commands => request('plans', { method: 'POST', token: editor.token, body: { commands } });
  const preview = async commands => { const plan = success(await previewResponse(commands)); assert.equal(plan.repositoryWrites, 0); return plan; };
  const applyResponse = async plan => {
    // Idempotency keys are generated only for this owned plan; requests remain
    // an independent HTTPS client rather than direct planner invocations.
    return request('plans/' + plan.id + '/apply', { method: 'POST', token: editor.token, idempotencyKey: randomUUID(), body: {} });
  };
  const apply = async plan => { const value = success(await applyResponse(plan)); assert.equal(value.ok, true); return value; };
  const create = async (type, suffix, fields = {}, parentId) => {
    const Name = prefix + '-' + suffix, plan = await preview([{ action: 'create', type, ...(parentId ? { parentId } : {}), fields: { Name, DisplayName: Name, ...fields } }]), result = await apply(plan);
    const id = result.completed[0].result.id; assert.ok(Number.isSafeInteger(id));
    const content = await read(id); assert.equal(content.Name, Name); assert.ok(content.Path.startsWith(PROJECT + '/')); owned.set(id, { id, name: content.Name, path: content.Path, type: content.Type }); return content;
  };
  const update = (content, marker) => ({ action: 'update', targetId: content.Id, expectedRevision: content.revision, fields: { Title: marker } });
  const unchanged = async before => { const after = await read(before.Id); assert.equal(after.revision, before.revision, 'Earlier mixed-plan target was saved'); assert.equal(after.Title, before.Title); };
  const deny = (response, status, code) => { assert.equal(response.status, status, 'Unexpected preflight HTTP ' + response.status + ' (' + (response.value?.error?.code || 'no_error_code') + ')'); assert.ok((Array.isArray(code) ? code : [code]).includes(response.value?.error?.code), 'Unexpected preflight error code'); assert.equal(response.value?.completed, undefined, 'Preflight denial must precede the write loop'); };
  const setDenied = async state => {
    if (!deniedChild) return;
    const item = await local.api(deniedChild.id, { account: accounts.admin, query: { '$select': 'Id,Name,Path', metadata: 'no' } });
    assert.equal(item.Name, deniedChild.name); assert.equal(item.Path, deniedChild.path); assert.ok(item.Name.startsWith(prefix));
    await local.api(item.Id, { operation: 'SetPermissions', method: 'POST', account: accounts.admin, body: { r: [{ identity: accounts.editor.path, localOnly: false, ...Object.fromEntries(['See', 'Open', 'OpenMinor', 'Save', 'Delete'].map(permission => [permission, state ? 'deny' : 'undefined'])) }] } });
  };
  const count = async () => {
    const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': 'Id', '$top': '1', '$inlinecount': 'allpages', metadata: 'no' }), { account: accounts.admin });
    assert.equal(response.status, 200); const value = Number(response.value?.d?.__count); assert.ok(Number.isSafeInteger(value)); return value;
  };
  try {
    report.initialCount = await count(); fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
    const capabilities = success(await request('capabilities')); assert.equal(capabilities.project, PROJECT); assert.equal(capabilities.repository, local.REPOSITORY); assert.equal(capabilities.inventory.configured, true);
    editor = await issue(); const delegate = await issue(['content:read']), sibling = await issue(['content:read']);
    const cross = await request('grants/' + sibling.id + '/revoke', { method: 'POST', token: delegate.token, body: {} });
    deny(cross, 403, 'grant_admin_denied'); assert.equal((await request('timelines?top=1', { token: sibling.token })).status, 200);
    record('A delegated read credential cannot revoke another grant of the same backend owner');
    assert.equal((await request('grants/' + sibling.id + '/revoke', { method: 'POST', token: accounts.editor.apiKey, owner: true, body: {} })).status, 200);
    assert.equal((await request('timelines?top=1', { token: sibling.token })).status, 401);
    record('Current backend owner can revoke the sibling grant; next native request rejects it');

    const sentinel = await create('MediaItem', 'sentinel', { Title: 'Untouched mixed-plan sentinel', MediaType: 'movie' });
    const media = await create('MediaItem', 'media', { Title: 'Initially unreferenced media', MediaType: 'movie' });
    const timeline = await create('Timeline', 'timeline', { IsVisible: true });
    const linkTimeline = await create('Timeline', 'links', { IsVisible: false });
    const first = await create('TimelineEntry', 'first', { MediaItem: sentinel.Id, Position: 1 }, timeline.Id);
    const second = await create('TimelineEntry', 'second', { MediaItem: sentinel.Id, Position: 2 }, timeline.Id);

    const gained = await preview([update(sentinel, 'must not save before shared-reference rejection'), { action: 'delete', targetId: media.Id, expectedRevision: media.revision }]);
    await create('TimelineEntry', 'gained-reference', { MediaItem: media.Id, Position: 1 }, linkTimeline.Id);
    assert.equal((await read(media.Id)).revision, media.revision, 'Relation creation unexpectedly changed the media snapshot');
    deny(await applyResponse(gained), 409, 'shared_reference_conflict'); await unchanged(sentinel); assert.equal((await read(media.Id)).Id, media.Id);
    record('Media gaining an occurrence after preview rejects the entire mixed plan before its earlier update', { repositoryWrites: 0 });

    const emptyMetadata = await previewResponse([update(sentinel, 'must not save before empty metadata rejection'), { action: 'metadata', targetId: media.Id, expectedRevision: media.revision, proposal: { fields: { Title: 'Ignored proposal for an existing manual Title' }, sources: [{ url: 'https://openlibrary.org/works/OL27448W', note: 'Synthetic preflight proposal; no provider request or provider verification is claimed.', confidence: 0.1 }] } }]);
    deny(emptyMetadata, 400, 'empty_change'); await unchanged(sentinel); assert.equal((await read(media.Id)).Title, media.Title);
    record('Empty accepted metadata rejects a mixed preview before its earlier update', { repositoryWrites: 0 });

    const beforeTimeline = await read(timeline.Id), beforeFirst = await read(first.Id), beforeSecond = await read(second.Id);
    const orderCommand = { action: 'order', timelineId: timeline.Id, entries: [{ id: second.Id, revision: beforeSecond.revision }, { id: first.Id, revision: beforeFirst.revision }] };
    const deleteCommand = { action: 'delete', targetId: timeline.Id, expectedRevision: beforeTimeline.revision };
    const orderPlan = await preview([update(sentinel, 'must not save before hidden-child order rejection'), orderCommand]);
    const deletePlan = await preview([update(sentinel, 'must not save before hidden-child delete rejection'), deleteCommand]);
    deniedChild = owned.get(second.Id); await setDenied(true);
    const filtered = success(await request('entries?' + new URLSearchParams({ timelineId: timeline.Id, top: '100', includeHidden: 'true' }), { token: editor.token }));
    assert.equal(filtered.items.length, 1); assert.equal(filtered.items[0].Id, first.Id);
    record('Caller collection really hides the denied child while read-only inventory preserves complete membership');
    for (const [purpose, command, plan] of [['order', orderCommand, orderPlan], ['delete', deleteCommand, deletePlan]]) {
      const previewDenied = await previewResponse([update(sentinel, 'must not save in hidden-child preview'), command]);
      await unchanged(sentinel); deny(previewDenied, 403, ['permission_denied', 'backend_denied']); assert.equal(previewDenied.value.error.details, undefined);
      const applyDenied = await applyResponse(plan); await unchanged(sentinel); deny(applyDenied, 403, ['permission_denied', 'backend_denied']); assert.equal(applyDenied.value.error.details, undefined);
      record('Hidden child blocks mixed ' + purpose + ' preview and saved apply without leaking its identifiers', { repositoryWrites: 0, previewCode: previewDenied.value.error.code, applyCode: applyDenied.value.error.code });
    }
    await setDenied(false); deniedChild = null;
    assert.equal((await read(first.Id)).revision, beforeFirst.revision); assert.equal((await read(second.Id)).revision, beforeSecond.revision); assert.equal((await read(timeline.Id)).revision, beforeTimeline.revision);

    const duplicate = await previewResponse([update(sentinel, 'must not save before existing Name rejection'), { action: 'create', type: 'MediaItem', fields: { Name: media.Name, DisplayName: 'Duplicate reserved Name', Title: 'must not create', MediaType: 'movie' } }]);
    deny(duplicate, 409, 'name_conflict'); await unchanged(sentinel); assert.equal((await read(media.Id)).Name, media.Name);
    record('Existing Name rejects a mixed create preview before any earlier target is saved', { repositoryWrites: 0 });

    const reserved = prefix + '-raced-name', racedPlan = await preview([update(sentinel, 'must not save before apply Name collision'), { action: 'create', type: 'MediaItem', fields: { Name: reserved, DisplayName: reserved, Title: 'Reserved fixture', MediaType: 'movie' } }]);
    const collision = await create('MediaItem', 'raced-name', { Title: 'Competing gateway creation', MediaType: 'movie' });
    deny(await applyResponse(racedPlan), 409, 'name_conflict'); await unchanged(sentinel); assert.equal((await read(collision.Id)).Title, 'Competing gateway creation');
    record('Name claimed by a later gateway plan rejects the whole saved mixed apply before its first write', { repositoryWrites: 0 });
  } catch (error) { failure = error; report.error = scrub(error.message); }
  finally {
    try { await setDenied(false); } catch (error) { failure ??= error; report.aclCleanupError = scrub(error.message); }
    const fixtures = [...owned.values()].sort((a, b) => ({ TimelineEntry: 0, Timeline: 1, MediaItem: 2 }[a.type] ?? 3) - ({ TimelineEntry: 0, Timeline: 1, MediaItem: 2 }[b.type] ?? 3));
    for (const fixture of fixtures) {
      try {
        const current = await local.api(fixture.id, { account: accounts.admin, query: { '$select': 'Id,Name,Path', metadata: 'no' } });
        assert.equal(current.Name, fixture.name); assert.equal(current.Path, fixture.path); assert.ok(current.Name.startsWith(prefix));
        let via = 'native';
        try { const snapshot = await read(fixture.id); await apply(await preview([{ action: 'delete', targetId: fixture.id, expectedRevision: snapshot.revision }])); }
        catch { via = 'guarded-local-cleanup'; failure ??= new Error('Native cleanup failed for an owned UUID fixture'); await local.api(fixture.id, { method: 'DELETE', query: { permanent: 'true' }, account: accounts.admin }); }
        assert.equal((await local.request(local.endpoint(fixture.id), { account: accounts.admin })).status, 404); cleanup.push({ id: fixture.id, deleted: true, via });
      } catch (error) { cleanup.push({ id: fixture.id, deleted: false, error: scrub(error.message) }); failure ??= error; }
    }
    for (const grant of grants) {
      try { assert.equal((await request('grants/' + grant.id + '/revoke', { method: 'POST', token: accounts.editor.apiKey, owner: true, body: {} })).status, 200); }
      catch (error) { failure ??= error; }
    }
    try { report.finalCount = await count(); assert.equal(report.finalCount, report.initialCount, 'Own fixture cleanup changed source count'); } catch (error) { failure ??= error; }
    if (!failure) { record('All owned UUID fixtures and temporary grants cleaned; original source count preserved', { cleaned: cleanup.length, sourceCount: report.finalCount }); report.passed = true; }
    else report.error = scrub(failure.message);
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, cleaned: cleanup.filter(item => item.deleted).length, report: REPORT }));
  if (failure) throw new Error(scrub(failure.message));
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
