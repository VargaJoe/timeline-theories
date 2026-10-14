import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import ts from '../client/node_modules/typescript/lib/typescript.js';
import { createProviderService } from '../server/providers.mjs';

// Contract tests exercise the real shared domain and browser service; external effects are injected.
const root = new URL('../', import.meta.url);
const read = path => fs.readFileSync(new URL(path, root), 'utf8');
const compile = source => 'data:text/javascript;base64,' + Buffer.from(ts.transpileModule(source,
  { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText).toString('base64');
globalThis.window = { location: { origin: 'https://ui.test' } };
globalThis.__metadataEnv = { repositoryUrl: 'https://repo.test', authority: 'https://auth.test', projectRoot: '/Root/Content/timelines', writable: true };
const apiSource = read('client/services/nativeApi.ts')
  .replace("import { environment } from '../configuration';", 'const environment=globalThis.__metadataEnv;')
  .replace('import.meta.env.VITE_NATIVE_API_URL', 'undefined');
const native = await import(compile(apiSource));
const media = id => ({ Id: id, Name: 'media' + id, DisplayName: 'Existing', Description: '', MediaType: 'movie',
  Year: 0, CoverImageUrl: '', ChronologicalDate: '2000-01-01T00:00:00Z' });
const sources = [{ url: 'https://www.themoviedb.org/movie/1', note: 'Provider-reported metadata, independently unverified.', confidence: 0.65 }];
let trace = [], providerCalls = 0, sent = [], deny = false, failProvider = false, partial = false, preflightHook, revision = 'gw:hash-before';
const dependencies = {
  cachedNativeSnapshot: id => ({ Id: id, Type: 'MediaItem', revision }),
  nativeSnapshot: async id => { trace.push('snapshot:' + id); return { Id: id, Type: 'MediaItem', revision }; },
  nativeRequest: async (_path, init) => {
    providerCalls++; trace.push('provider');
    if (failProvider) throw Object.assign(new Error('TMDB provider is not configured'), { status: 503 });
    const input = JSON.parse(init.body);
    return { title: input.mediaItem.DisplayName, year: 2001, description: 'Metadata description',
      coverImageUrl: 'https://image.tmdb.org/t/p/w500/cover.jpg', source: 'TMDB', sources: structuredClone(sources) };
  },
  assertOperations: async ops => {
    trace.push('preflight:' + ops.map(op => op.target + ':' + op.action).join(','));
    preflightHook?.(); if (deny) throw new Error('Permission denied');
  },
  captureOperationContext: () => () => {},
  resizeImageToDefault: async url => {
    trace.push('resize:' + url); return new Blob([new Uint8Array([255, 216, 255, 0])], { type: 'image/jpeg' });
  },
  nativeCoverPayload: native.nativeCoverPayload,
  applyNativeCommands: async commands => {
    sent = structuredClone(commands); trace.push('apply');
    if (partial) throw Object.assign(new Error('Later target conflicted'), { applyResult: { ok: false,
      completed: [{ index: 0, result: { id: commands[0].targetId, revision: 'gw:hash-after' } }], notApplied: [{ index: 1 }],
      error: { code: 'revision_conflict', message: 'Later target conflicted' } } });
    return { ok: true, completed: commands.map((command, index) => ({ index, result: { id: command.targetId, revision: 'gw:hash-after' } })) };
  },
  acknowledgeNativeCommands: () => { trace.push('ack'); },
};
globalThis.__metadataDeps = dependencies;
const domainUrl = pathToFileURL(fileURLToPath(new URL('client/domain/content.mjs', root))).href;
const serviceSource = read('client/services/mediaUpdateService.ts')
  .replace(/^import .* from '\.\/nativeApi';\r?\n/gm, '')
  .replace(/^import .* from '\.\/sensenet';\r?\n/gm, '')
  .replace(/^import .* from '\.\/mediaLibraryService';\r?\n/gm, '')
  .replace("from '../domain/content.mjs'", 'from ' + JSON.stringify(domainUrl));
const prefix = 'const {acknowledgeNativeCommands,applyNativeCommands,cachedNativeSnapshot,nativeCoverPayload,nativeRequest,nativeSnapshot,assertOperations,captureOperationContext,resizeImageToDefault}=globalThis.__metadataDeps;\n';
const service = (await import(compile(prefix + serviceSource))).MediaUpdateService;
const options = { updateTitles: true, updateDescriptions: true, updateCoverImages: true, onlyMissing: true,
  preferredSources: ['tmdb'], coverImageMode: 'url' };
let checks = 0, preview;
async function test(name, run) {
  trace = []; providerCalls = 0; sent = []; deny = false; failProvider = false; partial = false; preflightHook = undefined;
  await run(); checks++; process.stdout.write('PASS ' + name + '\n');
}

async function main() {
  await test('mixed denied preview sends zero provider requests', async () => {
    deny = true; await assert.rejects(service.processBulkUpdate([media(1), media(2)], options), /Permission denied/);
    assert.equal(providerCalls, 0); assert.equal(sent.length, 0);
  });
  await test('whole preview batch is checked before the first provider fetch', async () => {
    const results = await service.processBulkUpdate([media(1), media(2)], options);
    assert.equal(trace[0], 'preflight:1:update,2:update'); assert.equal(results.length, 2);
    assert.equal(results[0].proposal.fields.DisplayName, undefined); assert.equal(results[0].proposal.fields.Description, 'Metadata description');
    assert.equal(results[0].proposal.fields.Year, 2001); assert.equal(results[0].expectedRevision, 'gw:hash-before');
    assert.deepEqual(results[0].proposal.sources, sources);
  });
  await test('shared missing-only rules preserve existing metadata and chronology', async () => {
    const item = { ...media(1), Description: 'Curated', Year: 2002, CoverImageUrl: 'https://image.tmdb.org/t/p/w500/existing.jpg' };
    assert.equal(service.analyzeChanges(item, { title: 'Replacement', year: 2001, description: 'Provider text',
      coverImageUrl: 'https://image.tmdb.org/t/p/w500/new.jpg', source: 'TMDB', sources }, options), null);
    preview = await service.processBulkUpdate([media(1)], options);
    assert.equal(preview[0].proposal.fields.ChronologicalDate, undefined);
  });
  await test('approved metadata uses exact selected fields and sources without provider refetch', async () => {
    const results = await service.applyApprovedUpdates(preview);
    assert.equal(providerCalls, 0); assert.equal(results[0].hasChanges, true); assert.equal(sent[0].action, 'metadata');
    assert.equal(sent[0].expectedRevision, 'gw:hash-before'); assert.equal(sent[0].overwrite, false); assert.deepEqual(sent[0].proposal, preview[0].proposal);
  });
  await test('binary bytes are prepared after entire Save/upload preflight and accompany metadata', async () => {
    const binary = await service.processBulkUpdate([media(1), media(2)], { ...options, coverImageMode: 'binary' });
    assert.equal(trace[0], 'preflight:1:update,1:upload,2:update,2:upload');
    assert.equal(trace.filter(value => value.startsWith('resize:')).length, 2);
    const reviewedBytes = binary[0].binaryCover.bytesBase64;
    trace = []; providerCalls = 0; await service.applyApprovedUpdates(binary);
    assert.equal(trace[0], 'preflight:1:update,1:upload,2:update,2:upload');
    assert.equal(trace.filter(value => value.startsWith('resize:')).length, 0); assert.equal(trace.at(-2), 'apply');
    assert.equal(sent[0].proposal.fields.CoverImageUrl, ''); assert.equal(sent[0].cover.mimeType, 'image/jpeg');
    assert.equal(sent[0].cover.bytesBase64, reviewedBytes); assert.equal(providerCalls, 0);
  });
  await test('forged editorial metadata is rejected before writes or cover download', async () => {
    const forged = structuredClone(preview); forged[0].proposal.fields.ChronologicalDate = '2020-01-01T00:00:00Z';
    await assert.rejects(service.applyApprovedUpdates(forged), error => error.code === 'protected_editorial_field');
    assert.equal(sent.length, 0); assert.equal(trace.length, 0);
  });
  await test('mixed denied binary apply prepares zero covers and sends zero writes', async () => {
    const batch = await service.processBulkUpdate([media(1), media(2)], { ...options, coverImageMode: 'binary' });
    trace = []; deny = true; await assert.rejects(service.applyApprovedUpdates(batch), /Permission denied/);
    assert.equal(trace.filter(value => value.startsWith('resize:')).length, 0); assert.equal(sent.length, 0);
  });
  await test('overwrite approval includes only fields selected in the preview', async () => {
    const changes = service.analyzeChanges({ ...media(1), Description: 'Curated' },
      { title: 'Other title', description: 'Approved description', year: 2002, source: 'TMDB', sources },
      { ...options, onlyMissing: false, updateTitles: false, updateCoverImages: false });
    assert.equal(changes.description, 'Approved description'); assert.equal(changes.title, undefined); assert.equal(changes.year, undefined);
  });
  await test('apply retains the reviewed revision when the current cache refreshes', async () => {
    revision = 'gw:hash-refreshed'; await service.applyApprovedUpdates(preview); assert.equal(sent[0].expectedRevision, 'gw:hash-before');
    assert.equal(trace.some(value => value.startsWith('snapshot:')), false); revision = 'gw:hash-before';
  });
  await test('partial receipt identifies completed and not-applied media', async () => {
    const batch = await service.processBulkUpdate([media(1), media(2)], options); partial = true;
    const results = await service.applyApprovedUpdates(batch);
    assert.equal(results[0].mediaItem.Id, 1); assert.equal(results[0].error, undefined);
    assert.equal(results[1].mediaItem.Id, 2); assert.equal(results[1].error, 'Later target conflicted'); assert.equal(results[1].hasChanges, false);
  });
  await test('proposal snapshot survives caller mutation during preflight', async () => {
    const batch = structuredClone(preview); preflightHook = () => { batch[0].proposal.sources[0].note = 'Caller changed after approval'; };
    await service.applyApprovedUpdates(batch); assert.equal(sent[0].proposal.sources[0].note, sources[0].note);
  });
  await test('an absent live provider key is reported explicitly', async () => {
    failProvider = true; const results = await service.processBulkUpdate([media(1)], options);
    assert.equal(results[0].error, 'TMDB provider is not configured'); assert.equal(results[0].hasChanges, false);
  });
  await test('provider provenance carries uncertainty and excludes credential URLs', async () => {
    const provider = createProviderService({ keys: { tmdb: 'fixture-key' },
      fetchImpl: async () => new Response(JSON.stringify({ id: 1, title: 'Existing', overview: 'Description' })) });
    const result = await provider.execute('media.lookup', { mediaItem: { Title: 'Existing', MediaType: 'movie', ExternalLinks: '{"tmdb":1}' }, preferredSources: ['tmdb'] });
    assert.equal(result.sources[0].url, 'https://www.themoviedb.org/movie/1'); assert.equal(result.sources[0].confidence, 0.85);
    assert.match(result.sources[0].note, /incorrect/); assert.ok(!JSON.stringify(result.sources).includes('fixture-key'));
  });
  await test('nativeResponse preserves a binary body and repository binding', async () => {
    native.configureNativeAuth(() => 'fixture-jwt'); globalThis.fetch = async (_url, init) => {
      assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fixture-jwt');
      return new Response(new Uint8Array([255, 216, 255]), { headers: { 'Content-Type': 'image/jpeg' } });
    };
    const result = await native.nativeResponse('/content/1/cover');
    assert.equal(result.headers.get('content-type'), 'image/jpeg'); assert.equal((await result.arrayBuffer()).byteLength, 3);
  });
  process.stdout.write(checks + ' metadata parity checks passed\n');
}
await main().catch(error => { process.stderr.write(String(error.message) + '\n'); process.exitCode = 1; });
