import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createClient } from './m1-client.mjs';
import { decodeArchive } from '../client/api/exchange.mjs';
import { coverMimeType } from '../client/domain/exchange.mjs';
const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const PROJECT = '/Root/Content/timelines', REPORT = path.join(local.ROOT, 'm1-provider-live-report.json');
const SCOPES = ['content:read','timelines:write','media:write','entries:write','covers:write','metadata:write','providers:read','exchange:read','exchange:write'];
function publicUrl(value) {
  if (typeof value !== 'string') return undefined;
  const url = new URL(value);
  assert.equal(url.protocol, 'https:'); assert.ok(!url.username && !url.password);
  assert.ok(![...url.searchParams.keys()].some(name => /key|token|credential|secret|auth/i.test(name)), 'A public provider URL contains a credential-like query parameter');
  return url.href;
}
const provenance = data => (data.sources || []).map(source => { const url = new URL(publicUrl(source.url)); return { origin: url.origin, path: url.pathname, confidence: source.confidence }; });

/** Real application routes; provider credentials are never read or held by this client. */
export async function run() {
  const prefix = 'm1-provider-' + randomUUID(), checks = [], owned = new Map(), providerResults = [];
  const client = createClient({ baseUrl: 'https://localhost:8080/api/v1', repository: local.REPOSITORY, authority: local.AUTHORITY, project: PROJECT, caFile: path.join(local.ROOT, 'certificates/localhost.pem') });
  const report = { version: 1, ranAt: new Date().toISOString(), gateway: 'https://localhost:8080', repository: local.REPOSITORY, project: PROJECT, fixturePrefix: prefix, security: 'Application content and mutations use only the isolated localhost Netlify app. Provider secrets stay in Function memory. This client never calls production or reads provider keys.', checks, providers: providerResults, metadata: { ran: false }, book: { search: { ran: false }, details: { ran: false }, created: { ran: false } }, cover: { ran: false }, exchange: { ran: false }, cleanup: [], passed: false };
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  const account = local.readAccounts().editor; let grant, phase = 'initialization', failure, initialCount;
  const record = (name, details = {}) => { const value = { name, ...details, passed: true }; checks.push(value); console.log(JSON.stringify(value)); };
  const request = (route, options = {}) => { phase = route; return client.request(route, { token: grant?.token, ...options }); };
  const read = async id => (await request('/content/' + id)).data;
  const remember = data => { assert.ok(data.Name.startsWith(prefix)); assert.ok(data.Path.startsWith(PROJECT + '/')); owned.set(data.Id, { id: data.Id, name: data.Name, path: data.Path, type: data.Type }); return data; };
  const preview = async commands => { const plan = await request('/plans', { method: 'POST', body: { commands } }); assert.equal(plan.repositoryWrites, 0); return plan; };
  const apply = plan => request('/plans/' + plan.id + '/apply', { method: 'POST', body: {}, idempotencyKey: randomUUID() });
  const create = async (type, fields, parentId) => { const plan = await preview([{ action: 'create', type, fields, ...(parentId ? { parentId } : {}) }]); const result = await apply(plan); assert.equal(result.ok, true); return remember(await read(result.completed[0].result.id)); };
  const sourceCount = async () => { const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({ query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$top': '0', '$inlinecount': 'allpages', metadata: 'no' }), { account: local.readAccounts().admin }); assert.equal(response.status, 200); const count = Number(response.value.d.__count); assert.ok(Number.isSafeInteger(count)); return count; };
  const safeError = error => ({ phase, status: Number.isInteger(error.status) ? error.status : null, code: typeof error.code === 'string' ? error.code : error.name === 'AssertionError' ? 'assertion_failed' : 'transport_or_validation_failure', source: typeof error.result?.error?.source === 'string' ? error.result.error.source : undefined });
  try {
    initialCount = await sourceCount(); report.initialCount = initialCount;
    const capabilities = await client.verify(); assert.equal(capabilities.project, PROJECT);
    report.configuration = capabilities.providers.map ? capabilities.providers.map(item => ({ source: item.source, configured: item.configured })) : Object.fromEntries(Object.entries(capabilities.providers).map(([source, item]) => [source, { configured: item.configured }]));
    grant = await request('/grants', { method: 'POST', token: account.apiKey, backendAuth: 'ApiKey', body: { scopes: SCOPES, expiresInSeconds: 3600 } });
    let movie = await create('MediaItem', { Name: prefix + '-movie', DisplayName: 'Manual Matrix display name', Title: 'The Matrix', MediaType: 'movie', Description: '', Year: 0 });
    const movieBefore = await read(movie.Id), successful = [];
    for (const source of ['omdb','tmdb','trakt']) {
      const started = Date.now();
      try {
        const response = await request('/providers/media/lookup', { method: 'POST', body: { mediaItem: { Id: movie.Id }, preferredSources: [source] } });
        const data = response.data;
        if (!data) { providerResults.push({ source, route: '/providers/media/lookup', ran: true, passed: false, outcome: 'not_found', elapsedMs: Date.now() - started }); continue; }
        assert.equal(data.title, 'The Matrix'); assert.ok(data.source.toLowerCase().startsWith(source)); assert.ok(Array.isArray(data.sources) && data.sources.length);
        assert.ok(data.description || data.year || data.runtime); const sources = provenance(data); assert.ok(sources.every(item => item.confidence >= 0 && item.confidence <= 1));
        successful.push({ source, data }); providerResults.push({ source, route: '/providers/media/lookup', ran: true, passed: true, title: data.title, year: data.year, fields: Object.keys(data).filter(name => !['sources'].includes(name)), provenance: sources, elapsedMs: Date.now() - started });
        record('Actual ' + source.toUpperCase() + ' lookup through application gateway returns matching metadata and source provenance', { source, title: data.title, year: data.year });
      } catch (error) { const safe = safeError(error); if (safe.code === 'invalid_provider_input' && /^Invalid (?:media (?:Subtitle|DisplayName|Title|item)|provider sources|media title|title)$/.test(error.message)) safe.validation = error.message; const result = { ...safe, source, route: '/providers/media/lookup', ran: true, passed: false, elapsedMs: Date.now() - started }; providerResults.push(result); console.log(JSON.stringify({ providerLimitation: result })); }
    }
    const afterLookups = await read(movie.Id); assert.equal(afterLookups.revision, movieBefore.revision); assert.equal(afterLookups.Description, ''); record('Real provider lookups perform zero repository writes', { lookups: 3 });
    assert.ok(successful.length, 'No actual configured media provider returned usable metadata');
    const selected = successful.find(item => item.source === 'tmdb' && item.data.coverImageUrl) || successful.find(item => item.data.coverImageUrl) || successful[0];
    const fields = { Title: selected.data.title, DisplayName: selected.data.title, ...(selected.data.description ? { Description: selected.data.description } : {}), ...(selected.data.year ? { Year: selected.data.year } : {}), ...(selected.data.runtime ? { Duration: selected.data.runtime } : {}), ...(selected.data.coverImageUrl ? { CoverImageUrl: publicUrl(selected.data.coverImageUrl) } : {}) };
    const metadataPlan = await preview([{ action: 'metadata', targetId: movie.Id, expectedRevision: movie.revision, proposal: { fields, sources: selected.data.sources } }]);
    assert.equal((await read(movie.Id)).revision, movie.revision); assert.ok(metadataPlan.effects[0].preservedFields.includes('Title')); assert.ok(metadataPlan.effects[0].preservedFields.includes('DisplayName')); await apply(metadataPlan); movie = await read(movie.Id);
    assert.equal(movie.Title, 'The Matrix'); assert.equal(movie.DisplayName, 'Manual Matrix display name'); if (selected.data.year) assert.equal(movie.Year, selected.data.year); if (selected.data.description) assert.equal(movie.Description, selected.data.description);
    record('Approved real ' + selected.source.toUpperCase() + ' metadata fills missing fields and preserves manual title/display name', { source: selected.source, appliedFields: metadataPlan.diff[0].fields.map(field => field.field) });
    report.metadata = { ran: true, passed: true, source: selected.source, appliedFields: metadataPlan.diff[0].fields.map(field => field.field), preservedFields: metadataPlan.effects[0].preservedFields };

    const search = await request('/providers/books/search', { method: 'POST', body: { query: 'The Hobbit', sources: ['openlibrary'], limit: 2 } });
    assert.ok(Array.isArray(search.data) && search.data.length); const match = search.data.find(item => item.externalId) || search.data[0]; assert.equal(match.source, 'openlibrary');
    const details = await request('/providers/books/details', { method: 'POST', body: { source: match.source, externalId: match.externalId } }); assert.ok(details.data?.title); assert.equal(details.data.source, match.source);
    const parsedBook = { ...match, ...Object.fromEntries(Object.entries(details.data).filter(([, value]) => value !== undefined)) };
    const externalUrl = publicUrl('https://openlibrary.org' + parsedBook.externalId);
    const bookFields = { Name: prefix + '-book', DisplayName: parsedBook.title, Title: parsedBook.title, MediaType: 'book', BookSeriesNumber: 1, ExternalLinks: JSON.stringify({ openlibrary: externalUrl }), ...(parsedBook.author ? { Author: parsedBook.author } : {}), ...(parsedBook.publisher ? { Publisher: parsedBook.publisher } : {}), ...(parsedBook.isbn ? { ISBN: parsedBook.isbn } : {}), ...(parsedBook.publicationYear && parsedBook.publicationYear <= 2100 ? { PublicationYear: parsedBook.publicationYear } : {}), ...(parsedBook.description ? { Description: parsedBook.description } : {}), ...(parsedBook.coverUrl ? { CoverImageUrl: publicUrl(parsedBook.coverUrl) } : {}) };
    const book = await create('BookMediaItem', bookFields); assert.equal(book.Title, parsedBook.title); if (bookFields.Author) assert.equal(book.Author, bookFields.Author); assert.equal(JSON.parse(book.ExternalLinks).openlibrary, externalUrl);
    report.book = { source: 'openlibrary', search: { ran: true, results: search.data.length }, details: { ran: true, externalId: parsedBook.externalId }, created: { passed: true, title: book.Title, hasAuthor: Boolean(book.Author), hasISBN: Boolean(book.ISBN), publicationYear: book.PublicationYear } };
    record('Application book search and details feed a real local BookMediaItem with provider identity and readback', { source: 'openlibrary', title: book.Title, externalId: parsedBook.externalId });

    const coverMedia = movie.CoverImageUrl ? movie : book;
    const binarySize = Number(coverMedia.CoverImageBin?.Size ?? 0);
    report.cover = { ran: false, nativeBinarySize: binarySize };
    assert.ok(coverMedia.CoverImageUrl, 'No actual provider result supplied a URL-only cover'); assert.ok(binarySize <= 0, 'URL-only cover fixture unexpectedly has stored binary data');
    const image = await request('/content/' + coverMedia.Id + '/cover', { binary: true }); const mimeType = coverMimeType(image); assert.ok(image.length > 8);
    report.cover = { ran: true, passed: true, nativeBinarySize: binarySize, origin: new URL(coverMedia.CoverImageUrl).origin, bytes: image.length, mimeType, sha256: createHash('sha256').update(image).digest('hex') };
    record('Actual URL-only provider cover is fetched through the bound gateway with image bytes', { origin: report.cover.origin, bytes: image.length, mimeType });
    const timeline = await create('Timeline', { Name: prefix + '-timeline', DisplayName: 'Real provider exchange proof', IsVisible: true });
    await create('TimelineEntry', { Name: prefix + '-occurrence', DisplayName: coverMedia.Title, MediaItem: coverMedia.Id, Position: 1, Notes: 'Actual provider URL cover acceptance' }, timeline.Id);
    const exported = await request('/exchange/' + timeline.Id + '/export', { binary: true }); const decoded = await decodeArchive(exported); assert.equal(decoded.entries.length, 1); assert.equal(Number(decoded.entries[0].mediaId), coverMedia.Id); assert.ok(decoded.entries[0].coverImageFilename); const zipCover = decoded.covers.get(decoded.entries[0].coverImageFilename); assert.equal(coverMimeType(zipCover), mimeType); assert.ok(zipCover.length > 8);
    report.exchange = { ran: true, passed: true, entries: decoded.entries.length, covers: decoded.covers.size, archiveBytes: exported.length, coverBytes: zipCover.length };
    record('Actual native ZIP export embeds a fetched URL-only provider cover and active 19-column TSV', report.exchange);
  } catch (error) { failure = safeError(error); report.error = failure; console.error(JSON.stringify({ failure })); }
  finally {
    const sorted = [...owned.values()].sort((a, b) => (a.type === 'TimelineEntry' ? 0 : a.type === 'Timeline' ? 1 : 2) - (b.type === 'TimelineEntry' ? 0 : b.type === 'Timeline' ? 1 : 2));
    for (const fixture of sorted) {
      try { const current = await read(fixture.id); assert.equal(current.Name, fixture.name); assert.equal(current.Path, fixture.path); assert.ok(current.Name.startsWith(prefix)); const plan = await preview([{ action: 'delete', targetId: fixture.id, expectedRevision: current.revision }]); await apply(plan); let absent = false; try { await read(fixture.id); } catch (error) { absent = error.status === 404; } assert.equal(absent, true); report.cleanup.push({ id: fixture.id, deleted: true, via: 'native' }); }
      catch (error) { report.cleanup.push({ id: fixture.id, deleted: false, ...safeError(error) }); failure ||= safeError(error); }
    }
    if (grant) { try { await request('/grants/' + grant.id + '/revoke', { method: 'POST', body: {} }); } catch (error) { failure ||= safeError(error); } }
    try { report.finalCount = await sourceCount(); assert.equal(report.finalCount, initialCount); } catch (error) { failure ||= safeError(error); }
    report.passed = !failure && providerResults.every(result => result.passed);
    if (failure) report.error ||= failure;
    if (!failure) record('Own provider fixtures are deleted only through native API; source count is preserved', { cleaned: report.cleanup.length, initialCount, finalCount: report.finalCount });
    fs.writeFileSync(REPORT, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, providers: providerResults.map(({ source, passed, status, code }) => ({ source, passed, status, code })), cleaned: report.cleanup.filter(item => item.deleted).length, initialCount, finalCount: report.finalCount, report: REPORT }));
  if (failure || !report.passed) process.exitCode = 1;
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) run().catch(() => { console.error('Provider live acceptance failed before sanitized reporting completed.'); process.exitCode = 1; });
