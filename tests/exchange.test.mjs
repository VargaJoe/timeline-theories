import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import * as exchange from '../client/domain/exchange.mjs';
import { buildTSV, parseTSV, entryFieldsFromRow, EXCHANGE_LIMITS, inspectArchive, TSV_COLUMNS } from '../client/domain/exchange.mjs';
import { decodeArchive, encodeArchive } from '../server/exchange.mjs';
const require = createRequire(new URL('../client/package.json', import.meta.url));
const JSZip = require('jszip');
const media = { Id: 42, Name: 'shared-media', Title: 'A title', Description: 'Tabs\tnewlines\nand literal \\n / \\t', MediaType: ['book'], Author: 'An author', Publisher: 'Publisher', ISBN: '978-test', PublicationYear: 2020, Genre: ['fantasy', 'adventure'], Tags: 'one, two' };
const entries = [
  { Name: 'first-occurrence', DisplayName: 'First', MediaItem: [media], Position: 1, Notes: 'First notes', ChronologicalDate: '2020-01-01T00:00:00Z', EntryLabel: ['mainstory'], Importance: ['essential'] },
  { name: 'second-occurrence', displayName: 'Second', mediaItem: media, position: 2, notes: 'Second notes' },
];
const archive = async (tsv = buildTSV(entries, 'A timeline'), add = () => {}, options = {}) => {
  const zip = new JSZip(); zip.file('timeline_data.tsv', tsv); add(zip);
  return zip.generateAsync({ type: 'nodebuffer', ...options });
};
function centralOffsets(bytes) {
  const offsets = [];
  for (let offset = 0; offset + 46 <= bytes.length; offset++) if (bytes.readUInt32LE(offset) === 0x02014b50) offsets.push(offset);
  return offsets;
}
function replaceZipNames(bytes, before, after) {
  assert.equal(before.length, after.length);
  const copy = Buffer.from(bytes); let offset = 0;
  while ((offset = copy.indexOf(before, offset)) !== -1) { copy.write(after, offset); offset += before.length; }
  return copy;
}

test('the active 19-column TSV preserves separate occurrence Names, shared media and escaped text', () => {
  const tsv = buildTSV(entries, 'A timeline');
  assert.deepEqual(tsv.split('\n')[0].split('\t'), TSV_COLUMNS);
  const parsed = parseTSV(tsv.replace(/\n/g, '\r\n'));
  assert.equal(parsed.timelineName, 'A timeline');
  assert.deepEqual(parsed.entries.map(row => [row.entryName, row.mediaId]), [['first-occurrence', '42'], ['second-occurrence', '42']]);
  assert.equal(parsed.entries[0].Description, media.Description);
  assert.equal(parsed.entries[0].Author, media.Author);
  assert.deepEqual(parsed.entries[0].Genre, media.Genre);
  const fields = entryFieldsFromRow(parsed.entries[0]);
  assert.equal(fields.Name, 'first-occurrence'); assert.equal(fields.MediaItem, 42); assert.equal(fields.EntryLabel, 'mainstory');
  assert.equal(Object.hasOwn(fields, 'Author'), false);
  assert.equal(entryFieldsFromRow(parsed.entries[1]).ChronologicalDate, null);
});
test('malformed or ambiguous TSV is rejected before a plan can be constructed', () => {
  const tsv = buildTSV(entries, 'A timeline');
  for (const changed of [
    tsv.replace('timeline_name', 'legacy_name'), tsv + '\textra',
    tsv.replace('second-occurrence', 'first-occurrence'), tsv.replace('first-occurrence', '../escape'),
    tsv.replace('\t42\t', '\t0\t'), tsv.replace('\t42\t', '\t42junk\t'), tsv.replace('\t1\tFirst notes', '\t1junk\tFirst notes'),
    tsv.replace('A timeline\tsecond-occurrence', 'Another timeline\tsecond-occurrence'),
  ]) assert.throws(() => parseTSV(changed));
  assert.throws(() => parseTSV(buildTSV(entries, 'A timeline', new Map([[0, '../cover.png']]))));
  assert.throws(() => entryFieldsFromRow({ ...parseTSV(tsv).entries[0], Importance: 'arbitrary' }));
});
test('native ZIP export/import uses actual media metadata and binary covers with UI-compatible names', async () => {
  const withCovers = entries.map((item, index) => ({ ...item, MediaItem: { ...media, CoverImageBin: index ? { Size: 8, ContentType: 'image/png', Url: '/binary' } : { __mediaresource: { media_src: '/binary' } } }, mediaItem: undefined }));
  const binary = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]); let reads = 0;
  const exported = await encodeArchive({ DisplayName: 'A timeline' }, withCovers, async value => { reads++; assert.equal(value.Id, 42); return { data: binary, contentType: 'image/png' }; });
  assert.equal(reads, 2);
  const decoded = await decodeArchive(exported.buffer);
  assert.equal(decoded.entries.length, 2); assert.equal(decoded.entries[0].Title, media.Title);
  assert.deepEqual([...decoded.covers.keys()], ['cover_0.png', 'cover_1.png']);
  for (const bytes of decoded.covers.values()) assert.deepEqual(bytes, binary);
  assert.equal(decoded.stats.coversCount, 2); assert.equal(exported.skippedImagesCount, 0);
});
test('optional URL covers are counted when skipped and unsafe URLs never reach the callback', async () => {
  let called = 0;
  const items = ['https://images.example/cover.png', 'http://127.0.0.1/secret'].map((url, index) => ({ ...entries[1], name: 'url-' + index, mediaItem: { ...media, CoverImageUrl: url } }));
  const exported = await encodeArchive('urls', items, async () => { called++; return null; });
  assert.equal(called, 1); assert.equal(exported.skippedImagesCount, 2);
  assert.equal((await decodeArchive(exported.buffer)).covers.size, 0);
});
test('unsupported cover bytes are skipped and counted instead of producing an unimportable ZIP', async () => {
  const entry = { ...entries[1], mediaItem: { ...media, CoverImageBin: { __mediaresource: { media_src: '/binary' } } } };
  const exported = await encodeArchive('unsupported-cover', [entry], async () => ({ data: Buffer.from('GIF89a'), contentType: 'image/gif' }));
  assert.equal(exported.skippedImagesCount, 1); assert.equal((await decodeArchive(exported.buffer)).covers.size, 0);
});
test('raw ZIP traversal, duplicate paths and symbolic links are rejected', async () => {
  const traversal = await archive(undefined, zip => zip.file('../escape.png', 'data'));
  await assert.rejects(decodeArchive(traversal), /unsafe path/);
  const duplicate = await archive(undefined, zip => { zip.file('covers/a.png', 'a'); zip.file('covers/b.png', 'b'); });
  await assert.rejects(decodeArchive(replaceZipNames(duplicate, 'covers/b.png', 'covers/a.png')), /duplicate ZIP/);
  const symlink = await archive(undefined, zip => zip.file('covers/link.png', '/etc/passwd', { unixPermissions: 0o120777 }), { platform: 'UNIX' });
  await assert.rejects(decodeArchive(symlink), /Symbolic links/);
});
test('declared inflation bombs and oversized covers are rejected before decompression', async () => {
  const bomb = await archive(undefined, zip => zip.file('covers/bomb.png', Buffer.alloc(2 * 1024 * 1024)), { compression: 'DEFLATE' });
  assert.throws(() => inspectArchive(bomb), /inflation limit/);
  const oversized = await archive(undefined, zip => zip.file('covers/large.png', 'small'));
  const coverDirectory = centralOffsets(oversized).find(offset => oversized.toString('utf8', offset + 46, offset + 46 + oversized.readUInt16LE(offset + 28)) === 'covers/large.png');
  oversized.writeUInt32LE(EXCHANGE_LIMITS.coverBytes + 1, coverDirectory + 24);
  assert.throws(() => inspectArchive(oversized), /inflation limit/);
});
test('forged small directory sizes are bounded while streaming actual inflated output', async () => {
  const forged = await archive(undefined, zip => zip.file('covers/forged.png', Buffer.alloc(2 * 1024 * 1024)), { compression: 'DEFLATE' });
  const coverDirectory = centralOffsets(forged).find(offset => forged.toString('utf8', offset + 46, offset + 46 + forged.readUInt16LE(offset + 28)) === 'covers/forged.png');
  forged.writeUInt32LE(8, coverDirectory + 24);
  await assert.rejects(decodeArchive(forged), /declared size|uncompressed data size mismatch/);
});
test('missing, empty and corrupt binary covers fail without producing an import plan', async () => {
  const tsv = buildTSV(entries, 'A timeline', new Map([[0, 'cover.png']]));
  await assert.rejects(decodeArchive(await archive(tsv)), /missing/);
  await assert.rejects(decodeArchive(await archive(tsv, zip => zip.file('covers/cover.png', ''))), /empty/);
  const corrupt = await archive(tsv, zip => zip.file('covers/cover.png', 'unique-cover-bytes'));
  corrupt[corrupt.indexOf('unique-cover-bytes')] ^= 1;
  await assert.rejects(decodeArchive(corrupt), /checksum/);
});
test('invalid occurrence export data is rejected before optional provider reads', async () => {
  let reads = 0;
  await assert.rejects(encodeArchive('invalid', [{ Name: '../escape', MediaItem: { ...media, CoverImageUrl: 'https://images.example/a' } }], async () => { reads++; return null; }));
  assert.equal(reads, 0);
});

async function browserImportFixture() {
  const root = '/Root/Content/timelines', parentPath = root + '/Timelines/test';
  const raw = new Map([[10, { Id: 10, Name: 'test', Type: 'Timeline', Path: parentPath, ModificationDate: 'initial', revision: 'opaque-parent-initial' }], [42, { ...media, Id: 42, DisplayName: 'A title', Type: 'BookMediaItem', Path: root + '/MediaLibrary/shared-media', ModificationDate: 'initial', revision: 'opaque-media-initial' }]]);
  const writes = [], acknowledged = []; let denied, applyFailure;
  const repository = {
    load: async ({ idOrPath }) => ({ d: structuredClone(raw.get(idOrPath === parentPath ? 10 : Number(idOrPath))) }),
    post: async () => { throw new Error('Import must use a single native batch'); },
    patch: async () => { throw new Error('Import must use a single native batch'); },
  };
  class NativeApiError extends Error {}
  const assertOperations = async operations => { if (operations.some(operation => operation.target === denied)) throw new Error('Permission denied'); };
  const TimelineEntryService = { listTimelineEntries: async () => [...raw.values()].filter(value => value.Type === 'TimelineEntry').map(value => ({ id: String(value.Id), name: value.Name, displayName: value.DisplayName, timelineId: 10, position: value.Position, mediaItem: media })) };
  const ts = require('typescript');
  const source = await readFile(new URL('../client/services/timelineImportService.ts', import.meta.url), 'utf8');
  const transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mockRequire = name => {
    if (name === 'jszip') return JSZip;
    if (name === './timelineEntryService') return { TimelineEntryService };
    if (name === './nativeApi') return {
      NativeApiError,
      nativeCoverPayload: async (blob, fileName) => ({ bytesBase64: Buffer.from(await blob.arrayBuffer()).toString('base64'), mimeType: blob.type, fileName }),
      applyNativeCommands: async commands => { writes.push(structuredClone(commands)); if (applyFailure) { const error = new NativeApiError('Repository write stopped'); error.applyResult = applyFailure; throw error; } return { ok: true, completed: commands.map((command, index) => ({ index, result: { id: command.targetId || 100 + index } })) }; },
      acknowledgeNativeCommands: commands => acknowledged.push(structuredClone(commands)),
    };
    if (name === './sensenet') return { repository, assertOperations, captureOperationContext: () => () => {} };
    if (name === '../projectPaths') return { mediaLibraryPath: root + '/MediaLibrary', timelinesPath: root + '/Timelines' };
    if (name === '../domain/exchange.mjs') return exchange;
    throw new Error('Unexpected module ' + name);
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', transpiled)(mockRequire, module, module.exports);
  const prepare = async input => module.exports.prepareTimelineImport(new Blob([input || await archive()]), 10, parentPath);
  return { prepare, raw, writes, acknowledged, deny: target => { denied = target; }, fail: receipt => { applyFailure = receipt; } };
}
test('browser preview mutations cannot remove later denied private-plan targets', async () => {
  const fixture = await browserImportFixture(); const prepared = await fixture.prepare();
  prepared.operations.length = 0; fixture.deny('/Root/Content/timelines/Timelines/test');
  await assert.rejects(prepared.execute(), /Permission denied/); assert.equal(fixture.writes.length, 0);
});
test('browser import checks every target revision before the first write', async () => {
  const fixture = await browserImportFixture(); const prepared = await fixture.prepare();
  fixture.raw.get(42).ModificationDate = 'manual edit after preparation';
  await assert.rejects(prepared.execute(), /changed after preparation/); assert.equal(fixture.writes.length, 0);
});
test('browser import preserves distinct Names sharing media and prevents plan replay', async () => {
  const fixture = await browserImportFixture(); const prepared = await fixture.prepare();
  const result = await prepared.execute(); assert.equal(result.entriesCreated, 2);
  assert.equal(fixture.writes.length, 1); assert.deepEqual(fixture.writes[0].map(command => [command.fields.Name, command.fields.MediaItem]), [['first-occurrence', 42], ['second-occurrence', 42]]);
  assert.equal(fixture.acknowledged.length, 1);
  await assert.rejects(prepared.execute(), /already been executed/); assert.equal(fixture.writes.length, 1);
});
test('an occurrence created during review invalidates the entire browser import before writes', async () => {
  const fixture = await browserImportFixture(); const prepared = await fixture.prepare();
  fixture.raw.set(50, { Id: 50, Name: 'second-occurrence', Type: 'TimelineEntry', DisplayName: 'Concurrent', Position: 2 });
  await assert.rejects(prepared.execute(), /occurrences changed/); assert.equal(fixture.writes.length, 0);
});
test('browser same-media cover reuse prepares one bounded image in the whole native batch and rejects conflicting bytes', async () => {
  const tsv = buildTSV(entries, 'A timeline', new Map([[0, 'one.png'], [1, 'two.png']]));
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const fixture = await browserImportFixture();
  const prepared = await fixture.prepare(await archive(tsv, zip => { zip.file('covers/one.png', png); zip.file('covers/two.png', png); }));
  assert.equal(prepared.operations.filter(operation => operation.action === 'upload').length, 1);
  await prepared.execute(); assert.equal(fixture.writes.length, 1); assert.equal(fixture.writes[0].length, 3);
  assert.deepEqual(fixture.writes[0][0], { action: 'cover', targetId: 42, expectedRevision: 'opaque-media-initial', bytesBase64: png.toString('base64'), mimeType: 'image/png', fileName: 'one.png' });
  const denied = await browserImportFixture();
  const conflicting = await archive(tsv, zip => { zip.file('covers/one.png', png); zip.file('covers/two.png', Buffer.concat([png, Buffer.from('different')])); });
  await assert.rejects(denied.prepare(conflicting), /conflicting covers/); assert.equal(denied.writes.length, 0);
});
test('browser mixed import submits every create/update together with the exact approved occurrence revision', async () => {
  const fixture = await browserImportFixture();
  fixture.raw.set(50, { Id: 50, Name: 'first-occurrence', Type: 'TimelineEntry', Path: '/Root/Content/timelines/Timelines/test/first-occurrence', MediaItem: 42, revision: 'opaque-occurrence-approved' });
  const prepared = await fixture.prepare(); const result = await prepared.execute();
  assert.equal(fixture.writes.length, 1); assert.equal(result.entriesCreated, 1); assert.equal(result.entriesUpdated, 1);
  assert.equal(fixture.writes[0][0].action, 'update'); assert.equal(fixture.writes[0][0].targetId, 50); assert.equal(fixture.writes[0][0].expectedRevision, 'opaque-occurrence-approved');
  assert.equal(fixture.writes[0][1].action, 'create'); assert.equal(fixture.writes[0][1].parentId, 10);
});
test('browser partial import preserves the native receipt and reports completed versus unapplied entries', async () => {
  const fixture = await browserImportFixture(); const prepared = await fixture.prepare();
  const receipt = { ok: false, completed: [{ index: 0, result: { id: 101 } }], notApplied: [{ index: 1 }], error: { code: 'write_failed' } };
  fixture.fail(receipt);
  await assert.rejects(prepared.execute(), error => { assert.equal(error.applyResult, receipt); assert.match(error.message, /1 entries created, 0 updated, 1 not applied/); return true; });
  assert.equal(fixture.writes.length, 1); assert.equal(fixture.acknowledged.length, 0);
});
test('browser uncertain import distinguishes unconfirmed creates from confirmed nonwrites', async () => {
  const fixture = await browserImportFixture(); const prepared = await fixture.prepare();
  const receipt = { ok: false, completed: [], notApplied: [{ index: 0 }, { index: 1 }], retrySamePlan: true, uncertainTargets: [10], error: { code: 'repository_timeout' } };
  fixture.fail(receipt);
  await assert.rejects(prepared.execute(), error => { assert.equal(error.applyResult, receipt); assert.match(error.message, /2 without a confirmed result/); assert.doesNotMatch(error.message, /2 not applied/); return true; });
  assert.equal(fixture.writes.length, 1); assert.equal(fixture.acknowledged.length, 0);
});

async function browserExportFixture({ binary = false, failure } = {}) {
  const root = '/Root/Content/timelines', parentPath = root + '/Timelines/test';
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const exportedMedia = { ...media, DisplayName: 'Media', Type: 'BookMediaItem', Path: root + '/MediaLibrary/shared-media', CoverImageUrl: 'https://covers.openlibrary.org/b/id/1-L.jpg', ...(binary ? { CoverImageBin: { __mediaresource: { media_src: '/binaryhandler.ashx?nodeid=42&propertyname=CoverImageBin' } } } : {}) };
  const nativeCalls = [], repositoryCalls = [];
  class NativeApiError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
  const repository = {
    configuration: { repositoryUrl: 'https://localhost:41016' },
    load: async ({ idOrPath }) => ({ d: idOrPath === 10 ? { Id: 10, Type: 'Timeline', Path: parentPath } : { ...exportedMedia } }),
    fetch: async url => { repositoryCalls.push(url); return new Response(bytes, { headers: { 'Content-Type': 'image/png' } }); },
  };
  const TimelineEntryService = { listTimelineEntries: async () => [{ id: '50', name: 'entry', displayName: 'Entry', mediaItem: { Id: 42 }, position: 1 }] };
  const source = await readFile(new URL('../client/services/timelineExportService.ts', import.meta.url), 'utf8');
  const ts = require('typescript'), transpiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const mockRequire = name => {
    if (name === 'jszip') return JSZip;
    if (name === './timelineEntryService') return { TimelineEntryService };
    if (name === './sensenet') return { repository, assertOperations: async () => {}, captureOperationContext: () => () => {} };
    if (name === '../projectPaths') return { mediaLibraryPath: root + '/MediaLibrary', timelinesPath: root + '/Timelines' };
    if (name === '../domain/exchange.mjs') return exchange;
    if (name === './nativeApi') return { NativeApiError, nativeResponse: async route => { nativeCalls.push(route); if (failure) throw new NativeApiError(failure.status, failure.code); return new Response(bytes, { headers: { 'Content-Type': 'image/png' } }); } };
    throw new Error('Unexpected module ' + name);
  };
  const module = { exports: {} }; new Function('require', 'module', 'exports', transpiled)(mockRequire, module, module.exports);
  return { nativeCalls, repositoryCalls, bytes, export: () => module.exports.exportTimelineAsZip(10, 'test', parentPath, repository) };
}
test('browser URL-only cover export uses the bound gateway and embeds its actual image bytes', async () => {
  const fixture = await browserExportFixture(), exported = await fixture.export();
  assert.deepEqual(fixture.nativeCalls, ['/content/42/cover']); assert.equal(fixture.repositoryCalls.length, 0); assert.equal(exported.skippedImagesCount, 0);
  const decoded = await decodeArchive(Buffer.from(await exported.blob.arrayBuffer())); assert.deepEqual(decoded.covers.get('cover_0.png'), fixture.bytes);
});
test('browser binary covers take preference over URL fallback, and optional failures are counted', async () => {
  const binary = await browserExportFixture({ binary: true }); await binary.export();
  assert.equal(binary.nativeCalls.length, 0); assert.ok(binary.repositoryCalls[0].startsWith('https://localhost:41016/'));
  const skipped = await browserExportFixture({ failure: { status: 404, code: 'cover_unavailable' } }); assert.equal((await skipped.export()).skippedImagesCount, 1);
  const denied = await browserExportFixture({ failure: { status: 403, code: 'permission_denied' } }); await assert.rejects(denied.export(), /permission_denied/);
});
