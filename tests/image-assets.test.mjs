import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { ImageAssets, decodeImageVariant, validateImageManifest, validateImageVariant, classifyNativeImageFailure } from '../client/api/image-assets.mjs';
import { StockRepository } from '../client/api/stock-repository.mjs';
import { storedCoverMime } from '../client/api/covers.mjs';

const manifest = () => ({ schemaVersion: 1, kind: 'timeline-composite', projectPath: '/Root/Content/Images', ownerId: 20, generationId: randomUUID(), sourceIds: [10, 11], sourceStamps: [{ id: 10, stamp: 'a'.repeat(64) }, { id: 11, stamp: 'b'.repeat(64) }], recipe: { template: 'poster-strip-v1', sourceIds: [10, 11], seed: 42 }, variants: [] });
test('stored generic MIME uses only supported signatures and never relabels a known mismatch', () => {
  const samples = [['image/png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])], ['image/jpeg', Buffer.from([255, 216, 255, 224])], ['image/webp', Buffer.from('RIFFxxxxWEBP')]];
  for (const [mime, bytes] of samples) {
    assert.equal(storedCoverMime(bytes, 'application/octet-stream'), mime);
    assert.equal(storedCoverMime(bytes, mime), mime);
    assert.equal(storedCoverMime(bytes, mime === 'image/png' ? 'image/jpeg' : 'image/png'), null);
    assert.equal(storedCoverMime(bytes, 'text/html'), null);
  }
  for (const bytes of [Buffer.alloc(0), Buffer.from('<svg/>'), Buffer.from('<html>'), Buffer.from('%PDF-1.7')]) assert.equal(storedCoverMime(bytes, 'application/octet-stream'), null);
});
test('manifest binds exact ordered sources, native stamps and numeric deterministic recipe', () => {
  const valid = manifest(); assert.deepEqual(validateImageManifest(valid, { draft: true }), valid);
  for (const change of [value => value.recipe.sourceIds.reverse(), value => value.sourceStamps.reverse(), value => value.recipe.seed = randomUUID(), value => value.sourceIds.push(10), value => value.recipe.template = 'media-sizes-v1']) {
    const value = manifest(); change(value); assert.throws(() => validateImageManifest(value, { draft: true }), error => error.code === 'invalid_image_asset');
  }
});

test('media size manifests bind exactly the owner original rather than other media sources', () => {
  const self = { ...manifest(), kind: 'media-sizes', sourceIds: [20], sourceStamps: [{ id: 20, stamp: 'a'.repeat(64) }], recipe: { template: 'media-sizes-v1', sourceIds: [20] } };
  assert.deepEqual(validateImageManifest(self, { draft: true }), self);
  for (const sourceIds of [[10], [10, 20], [20, 10]]) {
    const foreign = { ...self, sourceIds, sourceStamps: sourceIds.map(id => ({ id, stamp: 'a'.repeat(64) })), recipe: { ...self.recipe, sourceIds } };
    assert.throws(() => validateImageManifest(foreign, { draft: true }), error => error.code === 'invalid_image_asset');
  }
});

test('sorted native SourceContents binds a reordered recipe as an exact unique ID set', async () => {
  const value = manifest(); value.sourceIds.reverse(); value.sourceStamps.reverse(); value.recipe.sourceIds.reverse();
  const data = { Id: 30, Type: 'ImageVariantSet', Path: `${value.projectPath}/ImageAssets/20/${value.generationId}`, OwnerContent: [{ Id: 20 }], SourceContents: [{ Id: 10 }, { Id: 11 }], GenerationId: value.generationId, Manifest: JSON.stringify(value), Sealed: false };
  const repo = { paths: { root: value.projectPath }, read: async id => id === 20 ? { Id: id, Type: 'Timeline' } : { Id: id, Type: 'MediaItem', CoverImageBin: { ContentType: 'image/png' } }, assert: async () => {},
    api: async (id, operation) => operation === 'ImageAssetCapabilities' ? { protocol: 'timeline-image-assets-v1', supported: true } : operation === 'GetImagePresentation' ? { state: 'legacy', imageStamp: id === 10 ? 'a'.repeat(64) : 'b'.repeat(64) } : data };
  const images = new ImageAssets(repo), set = await images.set(30, 20);
  assert.deepEqual(set.manifest.recipe.sourceIds, [11, 10]);
  assert.deepEqual(set.manifest.sourceStamps.map(source => source.id), [11, 10]);
  for (const sourceIds of [[10, 10], [10, 12], [10]]) {
    data.SourceContents = sourceIds.map(Id => ({ Id }));
    await assert.rejects(images.set(30, 20, { fresh: true }), error => error.code === 'image_backend_contract');
  }
});

test('new generated sets require a persisted original before native stamp or byte access', async () => {
  let nativeReads = 0;
  const row = { Id: 10, Type: 'MediaItem', CoverImageUrl: 'https://covers.fixture.invalid/original.png', CoverImageBin: null };
  const repo = { read: async () => row, assert: async () => {}, api: async () => { nativeReads++; return { state: 'legacy', imageStamp: 'a'.repeat(64) }; } };
  const images = new ImageAssets(repo), value = { sourceStamps: [{ id: 10, stamp: 'a'.repeat(64) }] };
  await assert.rejects(images.assertSources(value), error => error.code === 'image_original_required' && error.status === 400);
  assert.equal(nativeReads, 0);
  row.CoverImageBin = { ContentType: 'text/html' };
  await assert.rejects(images.assertSources(value), error => error.code === 'image_original_required' && error.status === 400);
  assert.equal(nativeReads, 0);
  row.CoverImageBin = { ContentType: 'image/png' };
  await images.assertSources(value); assert.equal(nativeReads, 1);
  row.CoverImageBin = { ContentType: 'application/octet-stream' };
  await new ImageAssets(repo).assertSources(value); assert.equal(nativeReads, 2);
});

test('stale editor presentation restores the saved recipe without exposing stale URLs or blocked source metadata', async () => {
  const value = manifest(); value.variants = [{ id: 31, name: 'w400', width: 400, height: 200, mimeType: 'image/webp', byteLength: 100, sha256: 'c'.repeat(64) }];
  const native = { state: 'stale', setId: 30, generationId: value.generationId, manifest: value, ownerGuard: { version: 'V1.0', modificationDate: '2026-11-05T00:00:00Z', token: '1' } };
  const operations = [], repo = { credential: { mode: 'Bearer', value: 'fixture-own-user' }, paths: { root: value.projectPath }, assert: async ops => operations.push(...ops), api: async (_target, operation) => operation === 'ImageAssetCapabilities' ? { protocol: 'timeline-image-assets-v1', supported: true } : native };
  const images = new ImageAssets(repo), owner = { Id: 20, Type: 'Timeline' };
  const editor = await images.presentation(owner, { recipe: true });
  assert.deepEqual(editor.recipe, value.recipe); assert.deepEqual(editor.sourceStamps, value.sourceStamps); assert.equal(Object.hasOwn(editor, 'variants'), false);
  assert.deepEqual(operations, [{ target: 20, action: 'cover' }]);
  delete native.manifest;
  const visitor = await images.presentation(owner);
  assert.equal(visitor.state, 'stale'); assert.equal(Object.hasOwn(visitor, 'recipe'), false); assert.equal(Object.hasOwn(visitor, 'variants'), false);
  native.state = 'blocked'; native.manifest = value;
  const blocked = await images.presentation(owner, { recipe: true });
  assert.equal(blocked.state, 'blocked'); assert.equal(Object.hasOwn(blocked, 'recipe'), false); assert.equal(Object.hasOwn(blocked, 'sourceStamps'), false); assert.equal(Object.hasOwn(blocked, 'variants'), false);
});
test('variant upload enforces extensionless dimension key, raster bounds, canonical base64 and raw-byte hash', () => {
  const bytes = Buffer.from('bounded transient raster bytes'), variant = { name: 'w400', width: 400, height: 200, mimeType: 'image/webp', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  assert.deepEqual(decodeImageVariant(bytes.toString('base64'), validateImageVariant(variant, { withId: false })), bytes);
  for (const value of [{ ...variant, name: 'w400.webp' }, { ...variant, name: 'w800' }, { ...variant, height: 4097 }, { ...variant, byteLength: 1048577 }, { ...variant, id: 1 }]) assert.throws(() => validateImageVariant(value, { withId: false }));
  assert.throws(() => decodeImageVariant(bytes.toString('base64') + '\n', variant), error => error.code === 'invalid_image_asset');
  assert.throws(() => decodeImageVariant(Buffer.from('wrong bytes').toString('base64'), variant), error => error.code === 'image_integrity');
});
test('missing native capability preserves old schema reads but a possible active reference fails closed', async () => {
  let calls = 0;
  const images = new ImageAssets({ paths: { root: '/Root/Content/Images' }, api: async () => { calls++; return { protocol: 'timeline-image-assets-v1', supported: false }; } });
  assert.deepEqual(await images.presentation({ Id: 10, Type: 'MediaItem' }), { state: 'legacy' });
  assert.deepEqual(await images.presentation({ Id: 10, Type: 'MediaItem', CoverImageSet: { __deferred: { uri: 'not-proof-of-empty' } } }), { state: 'missing' });
  assert.equal(calls, 1);
  await assert.rejects(images.requireCapability(), error => error.code === 'image_backend_unavailable');
  await assert.rejects(images.before({ action: 'image-draft', targetId: 10 }), error => error.code === 'image_backend_unavailable', 'capability is checked before a durable mutation intent can be prepared');
});
test('historical manifest without reconstruction fields produces a regeneration placeholder', async () => {
  const old = manifest(); delete old.recipe; delete old.sourceStamps;
  const images = new ImageAssets({ paths: { root: old.projectPath }, api: async (_target, operation) => operation === 'ImageAssetCapabilities' ? { protocol: 'timeline-image-assets-v1', supported: true } : { state: 'active', setId: 30, generationId: old.generationId, manifest: old, ownerGuard: { version: 'V1.0', modificationDate: '2026-11-05T00:00:00Z', token: '1' } } });
  const image = await images.presentation({ Id: 20, Type: 'Timeline' });
  assert.equal(image.state, 'missing'); assert.equal(Object.hasOwn(image, 'variants'), false);
});
test('only exact owned native validation failures become terminal input/conflict errors', () => {
  assert.deepEqual(classifyNativeImageFailure('InvalidOperationException', 'M0 image owner revision conflict.'), { status: 409, code: 'revision_conflict' });
  assert.deepEqual(classifyNativeImageFailure('SenseNetSecurityException', 'M0 image generation source has changed; regenerate the cover.'), { status: 409, code: 'image_source_changed' });
  assert.deepEqual(classifyNativeImageFailure('InvalidOperationException', 'M0 image asset binding or manifest is invalid (ValidateOutputs:397).'), { status: 400, code: 'invalid_image_asset' });
  for (const [type, message] of [['Exception', 'M0 image owner revision conflict.'], ['InvalidOperationException', 'An unrelated server operation failed.'], ['InvalidOperationException', 'M0 image asset configuration is invalid.']]) assert.equal(classifyNativeImageFailure(type, message), null);
});
test('native owner token is included in the same revision with or without the image DTO and conflicting version metadata is rejected', async () => {
  const projectRoot = '/Root/Content/Images';
  const row = { Id: 10, ParentId: 2, Name: 'source', Type: 'MediaItem', Path: projectRoot + '/MediaLibrary/source', Version: 'V1.0', VersionId: 1, ModificationDate: '2026-11-05T00:00:00Z' };
  let token = '100', guardVersionId = 1;
  const repo = new StockRepository({ projectRoot, repositoryUrl: 'https://repository.fixture.invalid' }, null);
  repo.assert = async () => {};
  repo.api = async (_target, operation) => operation === 'ImageAssetCapabilities' ? { protocol: 'timeline-image-assets-v1', supported: true } : operation === 'GetImagePresentation' ? { state: 'legacy', imageStamp: 'a'.repeat(64), ownerGuard: { version: row.Version, modificationDate: row.ModificationDate, token, versionId: guardVersionId } } : { ...row };
  const visible = await repo.read(10), internal = await repo.read(10, { image: false });
  assert.equal(visible.revision, internal.revision); assert.equal(internal.ImageOwnerGuard.token, '100'); assert.equal(Object.hasOwn(internal, 'image'), false);
  assert.deepEqual(repo.images.guard(internal), { expectedOwnerToken: '100', expectedVersion: 'V1.0', expectedModificationDate: 'utc:2026-11-05T00:00:00Z' });
  token = '101'; const next = await repo.read(10);
  assert.notEqual(next.revision, visible.revision, 'a native same-millisecond save changes the application revision');
  guardVersionId = 2;
  await assert.rejects(repo.read(10), error => error.code === 'revision_conflict');
});
