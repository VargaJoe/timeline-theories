import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { decodeArchive } from '../server/exchange.mjs';
const require = createRequire(import.meta.url);
const local = require('./m0-local-api.cjs');
const GATEWAY = 'https://localhost:8081', PROJECT = '/Root/Content/timelines';
const BINDING = { 'X-Timeline-Repository': local.REPOSITORY, 'X-Timeline-Authority': local.AUTHORITY, 'X-Timeline-Project': PROJECT };
const SCOPES = ['content:read', 'timelines:write', 'media:write', 'entries:write', 'covers:write', 'metadata:write', 'providers:read', 'exchange:read', 'exchange:write'];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ6kAAAAASUVORK5CYII=', 'base64');
const REPORT = path.join(local.ROOT, 'm1-native-report.json');

/** Independent HTTPS client. Redirects, arbitrary origins and disabled TLS are unavailable. */
function request(route, { method = 'GET', token, headers = {}, body } = {}) {
  const target = new URL('/api/v1/' + route, GATEWAY);
  if (target.origin !== GATEWAY || !target.pathname.startsWith('/api/v1/') || target.username || target.password) throw new Error('Native smoke localhost guard rejected URL');
  const outbound = { ...BINDING, ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers };
  let bytes;
  if (body !== undefined) {
    bytes = Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body));
    if (!outbound['Content-Type']) outbound['Content-Type'] = 'application/json';
    outbound['Content-Length'] = String(bytes.length);
  }
  return new Promise((resolve, reject) => {
    const req = https.request(target, { method, headers: outbound, ca: fs.readFileSync(path.join(local.ROOT, 'certificates/localhost.pem')) }, res => {
      const chunks = []; let size = 0;
      res.on('data', chunk => { size += chunk.length; if (size > 64 * 1024 * 1024) req.destroy(new Error('Native response exceeds smoke limit')); else chunks.push(chunk); });
      res.on('end', () => { const bytes = Buffer.concat(chunks); let value; try { value = JSON.parse(bytes.toString('utf8')); } catch { value = null; } resolve({ status: res.statusCode, headers: res.headers, value, bytes }); });
    });
    req.setTimeout(60000, () => req.destroy(new Error('Native local request timed out'))); req.on('error', reject); req.end(bytes);
  });
}
const succeed = response => {
  if (response.status < 200 || response.status >= 300) throw new Error('Native request HTTP ' + response.status + ': ' + (response.value?.error?.code || 'unexpected_response'));
  return response.value;
};
const referenceId = value => Array.isArray(value) ? referenceId(value[0]) : typeof value === 'object' && value ? value.Id : value;

export async function smoke({ providers = false } = {}) {
  const prefix = 'm1-native-' + randomUUID(), accounts = local.readAccounts();
  const checks = [], owned = new Map(), grants = [], cleanup = [];
  const report = { version: 1, ranAt: new Date().toISOString(), gateway: GATEWAY, repository: local.REPOSITORY, project: PROJECT, fixturePrefix: prefix, client: 'Independent node:https scoped-credential client with strict local CA TLS; no browser session or administrator gateway fallback.', checks, cleanup, providerValidation: { ran: false, reason: 'Use --providers for one real keyless Open Library search; adapter checks alone are not live provider evidence.' }, passed: false };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  let editor, primaryFailure;
  const record = (name, details = {}) => { checks.push({ name, ...details, passed: true }); console.log(JSON.stringify({ check: name, ...details, passed: true })); };
  const remember = content => { assert.ok(content.Name.startsWith(prefix), 'Fixture Name ownership failed'); assert.ok(content.Path.startsWith(PROJECT + '/'), 'Fixture path ownership failed'); owned.set(content.Id, { id: content.Id, name: content.Name, path: content.Path, type: content.Type }); return content; };
  const read = async id => succeed(await request('content/' + id, { token: editor.token })).data;
  const list = async timelineId => succeed(await request('entries?' + new URLSearchParams({ timelineId: String(timelineId), top: '100', includeHidden: 'true' }), { token: editor.token })).items;
  const issue = async (account, scopes = SCOPES, expiresInSeconds = 3600) => { const grant = succeed(await request('grants', { method: 'POST', token: account.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' }, body: { scopes, expiresInSeconds } })); assert.match(grant.token, /^tta_[A-Za-z0-9_-]{43}$/); grants.push({ id: grant.id, token: grant.token, account }); return grant; };
  const preview = async commands => { const plan = succeed(await request('plans', { method: 'POST', token: editor.token, body: { commands } })); assert.equal(plan.repositoryWrites, 0); assert.ok(plan.id && Array.isArray(plan.diff)); return plan; };
  const apply = async (plan, key = randomUUID()) => { const response = await request('plans/' + plan.id + '/apply', { method: 'POST', token: editor.token, headers: { 'Idempotency-Key': key }, body: {} }); const result = succeed(response); assert.equal(result.ok, true, 'Native apply did not fully complete'); return { key, result }; };
  const create = async (type, fields, parentId) => { const plan = await preview([{ action: 'create', type, ...(parentId ? { parentId } : {}), fields }]); const { result } = await apply(plan); const id = result.completed[0].result.id; assert.ok(Number.isSafeInteger(id)); return remember(await read(id)); };
  const mutate = async (content, fields) => { const plan = await preview([{ action: 'update', targetId: content.Id, expectedRevision: content.revision, fields }]); await apply(plan); return read(content.Id); };
  const sourceCount = async () => {
    const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$top': '0', '$inlinecount': 'allpages', metadata: 'no' }), { account: accounts.admin });
    assert.equal(response.status, 200); const value = response.value.d;
    const count = Number(value.__count); assert.ok(Number.isSafeInteger(count) && count >= 0); return count;
  };
  let initialCount;
  try {
    initialCount = await sourceCount(); report.initialCount = initialCount;
    const capabilities = succeed(await request('capabilities'));
    assert.equal(capabilities.repository, local.REPOSITORY); assert.equal(capabilities.authority, local.AUTHORITY); assert.equal(capabilities.project, PROJECT); assert.equal(capabilities.authentication.scopedCredentials, true);
    const openapi = succeed(await request('openapi.json')); assert.ok(openapi.openapi && openapi.paths);
    record('Public capabilities and OpenAPI expose the exact isolated target and scoped native contract');
    editor = await issue(accounts.editor); const reader = await issue(accounts.reader, ['content:read']); const readerWithWriteScope = await issue(accounts.reader); const expiring = await issue(accounts.editor, ['content:read'], 60);
    record('Owner-authenticated grants issue explicit scopes and independent native credentials', { roles: ['editor', 'reader'], grantLifetimeSeconds: 3600 });
    for (const [name, options, status, code] of [
      ['Unknown native credential is denied', { token: 'tta_' + 'A'.repeat(43) }, 401, 'invalid_credential'],
      ['Wrong project binding is denied', { token: editor.token, headers: { 'X-Timeline-Project': '/Root/Content/other' } }, 403, 'target_binding_mismatch'],
      ['Raw backend credential cannot substitute for a native grant', { token: accounts.editor.apiKey, headers: { 'X-Timeline-Backend-Auth': 'ApiKey' } }, 401, 'scoped_credential_required'],
    ]) { const response = await request('timelines', options); assert.equal(response.status, status); assert.equal(response.value.error.code, code); record(name, { status, code }); }

    const timeline = await create('Timeline', { Name: prefix + '-timeline', DisplayName: prefix + ' timeline', IsVisible: true, SortOrder: 'chronological', TimelineType: 'chronological' });
    let book = await create('BookMediaItem', { Name: prefix + '-book', DisplayName: prefix + ' book', Title: 'Manual book title', Description: 'Manual source description', MediaType: 'book', Author: 'Manual author', PublicationYear: 2020, BookSeriesNumber: 1 });
    const repeatedPlan = await preview([
      { action: 'create', type: 'TimelineEntry', parentId: timeline.Id, fields: { Name: prefix + '-first', DisplayName: 'First occurrence', MediaItem: book.Id, Position: 1, Notes: 'First manual notes', ChronologicalDate: '2020-01-01', ChronologicalDescription: 'First chronology', EntryLabel: 'mainstory', Importance: 'essential' } },
      { action: 'create', type: 'TimelineEntry', parentId: timeline.Id, fields: { Name: prefix + '-second', DisplayName: 'Second occurrence', MediaItem: book.Id, Position: 2, Notes: 'Second manual notes', ChronologicalDate: '2021-01-01', EntryLabel: 'flashback', Importance: 'optional' } },
    ]);
    assert.equal((await list(timeline.Id)).length, 0); const repeatedResult = await apply(repeatedPlan);
    let first = remember(await read(repeatedResult.result.completed[0].result.id)), second = remember(await read(repeatedResult.result.completed[1].result.id));
    assert.notEqual(first.Id, second.Id); assert.notEqual(first.Name, second.Name); assert.equal(referenceId(first.MediaItem), book.Id); assert.equal(referenceId(second.MediaItem), book.Id);
    record('Real native create persists timeline, book and distinct occurrences reusing one local media ID');

    const beforePreview = await read(first.Id);
    const editPlan = await preview([{ action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { Notes: 'Native edited notes', ChronologicalDate: '2020-02-03', ChronologicalDescription: 'Native edited chronology' } }]);
    const afterPreview = await read(first.Id); assert.equal(afterPreview.revision, beforePreview.revision); assert.equal(afterPreview.Notes, beforePreview.Notes); assert.ok(editPlan.diff[0].fields.some(field => field.field === 'Notes'));
    record('Native dry-run diff changes zero repository fields or revisions', { repositoryWrites: editPlan.repositoryWrites, changedFields: editPlan.counts.changedFields });
    const edited = await apply(editPlan); first = await read(first.Id); assert.equal(first.Notes, 'Native edited notes'); assert.ok(first.ChronologicalDate.startsWith('2020-02-03'));
    const replayed = succeed(await request('plans/' + editPlan.id + '/apply', { method: 'POST', token: editor.token, headers: { 'Idempotency-Key': edited.key }, body: {} }));
    assert.deepEqual(replayed, edited.result); assert.equal((await read(first.Id)).revision, first.revision);
    record('Identical Idempotency-Key retry returns the stored result without another save');
    const otherPlan = await preview([{ action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { Notes: 'must not apply' } }]);
    const conflicting = await request('plans/' + otherPlan.id + '/apply', { method: 'POST', token: editor.token, headers: { 'Idempotency-Key': edited.key }, body: {} });
    assert.equal(conflicting.status, 409); assert.equal(conflicting.value.error.code, 'idempotency_conflict');
    const changedPayload = await request('plans/' + editPlan.id + '/apply', { method: 'POST', token: editor.token, headers: { 'Idempotency-Key': randomUUID() }, body: { fields: { Notes: 'must not apply' } } });
    assert.equal(changedPayload.status, 400); assert.equal((await read(first.Id)).Notes, first.Notes);
    record('A reused key with a different plan and an injected apply payload both fail without changes');

    for (const ChronologicalDate of ['0000-01-01', '2024-03-01T24:00:00Z', '2025-02-29']) {
      const rejected = await request('plans', { method: 'POST', token: editor.token, body: { commands: [
        { action: 'update', targetId: book.Id, expectedRevision: book.revision, fields: { Description: 'must not save before invalid date' } },
        { action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { ChronologicalDate } }
      ] } });
      assert.equal(rejected.status, 400); assert.equal(rejected.value.error.code, 'invalid_field');
      assert.equal((await read(book.Id)).revision, book.revision); assert.equal((await read(first.Id)).revision, first.revision);
    }
    record('Unsupported year, midnight rollover and invalid calendar dates reject the whole mixed preview with zero writes');
    second = await mutate(second, { ChronologicalDate: '2024-03-01T00:00:00+05:00' });
    assert.equal(new Date(second.ChronologicalDate).toISOString(), '2024-02-29T19:00:00.000Z');
    record('Accepted zoned chronology persists and reads back as the same canonical UTC instant');

    const metadataPlan = await preview([{ action: 'metadata', targetId: book.Id, expectedRevision: book.revision, proposal: { fields: { Title: 'Provider proposed title', Author: 'Provider proposed author', Description: 'Provider proposed description', Publisher: 'Proposed publisher' }, sources: [{ url: 'https://openlibrary.org/works/OL27448W', note: 'Synthetic smoke proposal with explicit provenance; this is not a claim of live provider verification.', confidence: 0.7 }] } }]);
    await apply(metadataPlan); book = await read(book.Id); assert.equal(book.Title, 'Manual book title'); assert.equal(book.Author, 'Manual author'); assert.equal(book.Description, 'Manual source description'); assert.equal(book.Publisher, 'Proposed publisher'); assert.equal((await read(first.Id)).Notes, first.Notes);
    record('Metadata proposal fills missing data and preserves manual title, author, description and occurrence notes');
    const editorialMetadata = await request('plans', { method: 'POST', token: editor.token, body: { commands: [{ action: 'metadata', targetId: book.Id, expectedRevision: book.revision, proposal: { fields: { ChronologicalDate: '2022-01-01' }, sources: [{ url: 'https://openlibrary.org/works/OL27448W', note: 'Protected editorial smoke', confidence: 0.5 }] } }] } });
    assert.equal(editorialMetadata.status, 400); assert.equal(editorialMetadata.value.error.code, 'protected_editorial_field'); record('Metadata enrichment cannot overwrite manual chronology');

    first = await read(first.Id); second = await read(second.Id);
    const incomplete = await request('plans', { method: 'POST', token: editor.token, body: { commands: [{ action: 'order', timelineId: timeline.Id, entries: [{ id: first.Id, revision: first.revision }] }] } });
    assert.equal(incomplete.status, 409, 'Incomplete order response: ' + JSON.stringify({ status: incomplete.status, error: incomplete.value?.error })); assert.equal(incomplete.value.error.code, 'order_membership_conflict');
    const orderPlan = await preview([{ action: 'order', timelineId: timeline.Id, entries: [{ id: second.Id, revision: second.revision }, { id: first.Id, revision: first.revision }] }]);
    await apply(orderPlan); first = await read(first.Id); second = await read(second.Id); assert.equal(second.Position, 1); assert.equal(first.Position, 2);
    record('Full occurrence reorder requires every member and its revision, then persists the requested order');

    const stalePlan = await preview([{ action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { Notes: 'stale native overwrite' } }]);
    first = await mutate(first, { Notes: 'Competing application gateway edit after native preview' });
    const staleApply = await request('plans/' + stalePlan.id + '/apply', { method: 'POST', token: editor.token, headers: { 'Idempotency-Key': randomUUID() }, body: {} });
    assert.equal(staleApply.status, 409); assert.equal(staleApply.value.error.code, 'revision_conflict'); first = await read(first.Id); assert.equal(first.Notes, 'Competing application gateway edit after native preview');
    record('Competing application gateway save invalidates the saved native plan and survives its rejected stale apply');

    for (const [name, credential, expectedCode] of [['Reader scope rejects writes', reader, 'scope_denied'], ['Backend Reader rights reject even a declared writer scope', readerWithWriteScope, 'permission_denied']]) {
      const denied = await request('plans', { method: 'POST', token: credential.token, body: { commands: [{ action: 'update', targetId: first.Id, expectedRevision: first.revision, fields: { Notes: 'reader must not save' } }] } });
      assert.equal(denied.status, 403); assert.equal(denied.value.error.code, expectedCode); assert.equal((await read(first.Id)).Notes, first.Notes); record(name, { status: denied.status, code: expectedCode });
    }
    const readerCreate = await request('plans', { method: 'POST', token: readerWithWriteScope.token, body: { commands: [{ action: 'create', type: 'TimelineEntry', parentId: timeline.Id, fields: { Name: prefix + '-reader-must-not-create', DisplayName: 'Denied reader creation', MediaItem: book.Id, Position: 3 } }] } });
    assert.equal(readerCreate.status, 403); assert.equal(readerCreate.value.error.code, 'permission_denied'); assert.equal((await list(timeline.Id)).length, 2);
    record('Backend Reader AddNew denial rejects creation before any occurrence is persisted', { status: 403, occurrences: 2 });
    const revoked = await issue(accounts.editor, ['content:read']);
    const delegatedRevoke=await request('grants/'+revoked.id+'/revoke',{method:'POST',token:editor.token,body:{}});assert.equal(delegatedRevoke.status,403);assert.equal(delegatedRevoke.value.error.code,'grant_admin_denied');
    succeed(await request('grants/' + revoked.id + '/revoke', { method: 'POST', token:accounts.editor.apiKey,headers:{'X-Timeline-Backend-Auth':'ApiKey'}, body: {} }));
    const revokedRead = await request('content/' + timeline.Id, { token: revoked.token }); assert.equal(revokedRead.status, 401); record('Revoked native credential is rejected on its next request', { status: 401 });

    book = await read(book.Id);
    const coverPlan = await preview([{ action: 'cover', targetId: book.Id, expectedRevision: book.revision, bytesBase64: PNG.toString('base64'), mimeType: 'image/png', fileName: prefix + '-cover.png' }]);
    await apply(coverPlan); book = await read(book.Id);
    const actualCover=await request('content/'+book.Id+'/cover',{token:editor.token});assert.equal(actualCover.status,200);assert.deepEqual(actualCover.bytes,PNG);
    const exported = await request('exchange/' + timeline.Id + '/export', { token: editor.token }); assert.equal(exported.status, 200); assert.ok(exported.headers['content-type'].startsWith('application/zip'));
    const decoded = await decodeArchive(exported.bytes); assert.equal(decoded.entries.length, 2); assert.equal(decoded.timelineName, timeline.Name); assert.deepEqual(new Set(decoded.entries.map(row => row.entryName)), new Set([first.Name, second.Name]));
    for (const row of decoded.entries) { assert.equal(Number(row.mediaId), book.Id); assert.equal(row.Title, book.Title); assert.equal(row.Author, book.Author); assert.deepEqual(decoded.covers.get(row.coverImageFilename), PNG); }
    const importedTimeline = await create('Timeline', { Name: prefix + '-import', DisplayName: prefix + ' import', IsVisible: true });
    const importPlan = succeed(await request('exchange/' + importedTimeline.Id + '/preview', { method: 'POST', token: editor.token, headers: { 'Content-Type': 'application/zip' }, body: exported.bytes }));
    assert.equal(importPlan.repositoryWrites, 0); assert.equal((await list(importedTimeline.Id)).length, 0); await apply(importPlan);
    const imported = await list(importedTimeline.Id); assert.equal(imported.length, 2);
    for (const entry of imported) { remember(entry); assert.equal(referenceId(entry.MediaItem), book.Id); assert.ok([first.Name, second.Name].includes(entry.Name)); }
    record('Real native ZIP contains 19-column TSV plus actual PNG bytes and imports distinct occurrences using existing media IDs', { entries: decoded.entries.length, covers: decoded.covers.size, imported: imported.length, skippedCovers: Number(exported.headers['x-timeline-skipped-covers']) });
    book = await read(book.Id);
    const sharedDelete = await request('plans', { method: 'POST', token: editor.token, body: { commands: [{ action: 'delete', targetId: book.Id, expectedRevision: book.revision }] } });
    assert.equal(sharedDelete.status, 409); assert.equal(sharedDelete.value.error.code, 'shared_reference_conflict'); assert.equal((await read(book.Id)).Id, book.Id);
    record('Referenced media deletion is refused while occurrences in both timelines still point to it', { references: sharedDelete.value.error.details.references.length });

    if (providers) {
      const search = await request('providers/books/search', { method: 'POST', token: editor.token, body: { query: 'The Hobbit', sources: ['openlibrary'], limit: 1 } });
      if (search.status === 200) { assert.ok(Array.isArray(search.value.data)); assert.ok(search.value.data.length && search.value.data[0].source === 'openlibrary'); report.providerValidation = { ran: true, passed: true, source: 'openlibrary', results: search.value.data.length }; record('Real keyless Open Library search returns provider-backed book results', { results: search.value.data.length }); }
      else {
        assert.ok([429, 502, 503, 504].includes(search.status), 'Provider request failed outside the expected external-service limits');
        report.providerValidation = { ran: true, passed: false, source: 'openlibrary', status: search.status, code: search.value?.error?.code || 'unexpected_response' };
        checks.push({ name: 'Real Open Library request has an explicit external-service limitation', ...report.providerValidation });
        console.log(JSON.stringify({ providerValidation: report.providerValidation }));
      }
    }
    const wait = Math.max(0, Date.parse(expiring.expiresAt) - Date.now() + 150);
    assert.ok(wait <= 60150, 'Unexpected native grant expiry interval');
    if (wait) { console.log(JSON.stringify({ check: 'Waiting for actual minimum-lifetime credential expiry', remainingMs: wait })); await new Promise(resolve => setTimeout(resolve, wait)); }
    const expiredRead = await request('content/' + timeline.Id, { token: expiring.token }); assert.equal(expiredRead.status, 401); assert.equal(expiredRead.value.error.code, 'invalid_credential');
    record('A real 60-second native grant expires and rejects subsequent reads', { status: 401, lifetimeSeconds: 60 });
  } catch (error) { primaryFailure = error; report.error = error.message; }
  finally {
    // Cleanup validates exact IDs, UUID Names and paths before each delete. It cannot enumerate or delete source content.
    const order = [...owned.values()].sort((a, b) => (a.type === 'TimelineEntry' ? 0 : a.type === 'Timeline' ? 1 : 2) - (b.type === 'TimelineEntry' ? 0 : b.type === 'Timeline' ? 1 : 2));
    for (const fixture of order) {
      try {
        const current = await local.api(fixture.id, { account: accounts.admin, query: { '$select': 'Id,Name,Path,Type', metadata: 'no' } });
        assert.equal(current.Id, fixture.id); assert.equal(current.Name, fixture.name); assert.equal(current.Path, fixture.path); assert.ok(current.Name.startsWith(prefix));
        let via = 'native';
        try { const content = await read(fixture.id); const plan = await preview([{ action: 'delete', targetId: fixture.id, expectedRevision: content.revision }]); await apply(plan); }
        catch { via = 'guarded-local-cleanup'; primaryFailure ||= new Error('Native UUID deletion failed; guarded local cleanup preserved source content'); await local.api(fixture.id, { method: 'DELETE', account: accounts.admin, query: { permanent: 'true' } }); }
        const absent = await local.request(local.endpoint(fixture.id), { account: accounts.admin }); assert.equal(absent.status, 404); cleanup.push({ id: fixture.id, deleted: true, via });
      } catch (error) { cleanup.push({ id: fixture.id, deleted: false, error: error.message }); primaryFailure ||= new Error('UUID fixture cleanup failed'); }
    }
    for (const grant of grants) {
      try { const response = await request('grants/' + grant.id + '/revoke', { method: 'POST', token: grant.account.apiKey, headers: { Origin: 'https://localhost:8080', 'X-Timeline-Backend-Auth': 'ApiKey' }, body: {} }); assert.equal(response.status, 200); }
      catch { primaryFailure ||= new Error('Temporary grant revocation failed'); }
    }
    try { report.finalCount = await sourceCount(); if (initialCount !== undefined) assert.equal(report.finalCount, initialCount, 'Local project count changed after UUID cleanup'); }
    catch (error) { primaryFailure ||= error; report.cleanupError = error.message; }
    if (!primaryFailure) { record('Own UUID content is deleted through the native API and local source count is preserved', { cleaned: cleanup.length, nativeDeletes: cleanup.filter(item => item.via === 'native').length, initialCount, finalCount: report.finalCount }); report.passed = true; }
    else report.error ||= primaryFailure.message;
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, cleaned: cleanup.filter(item => item.deleted).length, report: REPORT, providerValidation: report.providerValidation }));
  if (primaryFailure) throw primaryFailure;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) smoke({ providers: process.argv.includes('--providers') }).catch(error => { console.error(error.message); process.exitCode = 1; });
