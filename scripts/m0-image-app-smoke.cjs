'use strict';

// Native local-only acceptance for the app-facing image protocol. Real PKCE
// users and actual canvas encoders; never targets production or existing data.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = require('./m0-local-api.cjs');
const { authenticate } = require('./m0-oidc-smoke.cjs');
const { permissions } = require('./m0-acl.cjs');
const { png, sha256 } = require('./helpers/image-variant-fixture.cjs');
const PROJECT = '/Root/Content/timelines';
const ASSETS = PROJECT + '/ImageAssets';
const reportPath = path.join(local.ROOT, 'image-app-smoke.json');

async function encodedFixtures() {
  const { chromium } = require(process.env.M0_PLAYWRIGHT_MODULE_PATH || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
  const parts = ['ms-playwright', 'chromium-1234', 'chrome-win64', 'chrome.exe'];
  const executable = process.env.M0_CHROMIUM_EXECUTABLE_PATH || [path.join(process.env.LOCALAPPDATA || '', ...parts),
    path.join(os.homedir(), 'AppData/Local', ...parts)].find(candidate => fs.existsSync(candidate));
  const browser = await chromium.launch(fs.existsSync(executable) ? { executablePath: executable, headless: true } : { headless: true });
  try {
    const page = await browser.newPage();
    const values = await page.evaluate(() => ['image/webp', 'image/jpeg'].map((mime, index) => {
      const canvas = document.createElement('canvas'); canvas.width = 64 << index; canvas.height = 32 << index;
      const ctx = canvas.getContext('2d');
      for (let x = 0; x < canvas.width; x++) { ctx.fillStyle = `hsl(${x * 5},65%,45%)`; ctx.fillRect(x, 0, 1, canvas.height); }
      const url = canvas.toDataURL(mime, 0.82);
      if (!url.startsWith('data:' + mime + ';base64,')) throw new Error('Requested browser encoder is unavailable.');
      return { mimeType: mime, width: canvas.width, height: canvas.height, base64: url.split(',')[1] };
    }));
    return values.map(value => ({ ...value, bytes: Buffer.from(value.base64, 'base64') }));
  } finally { await browser.close(); }
}

async function smoke() {
  local.assertLocal(local.REPOSITORY);
  const accounts = local.readAccounts();
  const editor = { token: (await authenticate('editor')).token };
  const reader = { token: (await authenticate('reader')).token };
  const checks = [], owners = [], sets = [], folders = [];
  const prefix = 'm0-image-app-' + crypto.randomUUID();
  const record = name => { checks.push({ name, passed: true }); console.log('PASS ' + name); };
  const selected = (id, account = editor) => local.api(id, { account, query: { $select: 'Id,Name,Path,Type,Version,ModificationDate', metadata: 'no' } });
  const descriptor = (id, account = editor) => local.api(id, { account, operation: 'GetImagePresentation' });
  const guard = owner => ({ expectedVersion: owner.ownerGuard.version, expectedModificationDate: 'utc:' + owner.ownerGuard.modificationDate,
    expectedOwnerToken: owner.ownerGuard.token });
  const post = (id, operation, body, account = editor) => local.api(id, { account, method: 'POST', operation, body });
  const binary = id => local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: String(id), propertyname: 'Binary' });
  const rejected = async (id, operation, body, account = editor) => {
    const response = await local.request(local.endpoint(id) + (operation ? '/' + operation : ''), { account, method: 'POST', body });
    assert.ok(response.status >= 400, `${operation || id} unexpectedly accepted`);
  };
  let initialCount, result, error, guardEvidence;
  const count = async () => {
    const query = { query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', $top: '1', $select: 'Id', $inlinecount: 'allpages', metadata: 'no' };
    const response = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams(query), { account: accounts.admin });
    assert.equal(response.status, 200);
    const value = Number(response.value.d.__count); assert.ok(Number.isSafeInteger(value) && value >= 0); return value;
  };
  try {
    console.log('Native image protocol: PKCE editor/reader authenticated; counting local fixtures.');
    initialCount = await count();
    const capabilities = await local.api(PROJECT, { operation: 'ImageAssetCapabilities' });
    assert.equal(capabilities.protocol, 'timeline-image-assets-v1'); assert.equal(capabilities.supported, true);
    assert.deepEqual(capabilities.formats, ['image/webp', 'image/jpeg', 'image/png']);
    assert.equal(capabilities.decoder.isolation, 'private-alc'); assert.equal(capabilities.decoder.context, 'TimelineImageDecoder');
    assert.equal(capabilities.decoder.hostFileManagedVersion, '3.116.0.0');
    assert.match(capabilities.decoder.managedVersion, /^4\./); assert.match(capabilities.decoder.nativeVersion, /^154\./);
    assert.ok(capabilities.decoder.hostLoadedVersions.every(version => version === '3.116.0.0'));
    record('Visitor sees the actual registered extension/schema capability and bounded formats');
    for (const [type, parent] of [['MediaItem', 'MediaLibrary'], ['Timeline', 'Timelines']]) {
      const owner = await local.api(PROJECT + '/' + parent, { account: editor, method: 'POST', query: { metadata: 'no' },
        body: { __ContentType: type, Name: prefix + '-' + type.toLowerCase(), ...(type === 'Timeline' ? { IsVisible: true } : { MediaType: ['movie'] }) } });
      owners.push(owner);
    }
    const [source, owner] = owners;
    const otherMedia = await local.api(PROJECT + '/MediaLibrary', { account: editor, method: 'POST', query: { metadata: 'no' },
      body: { __ContentType: 'MediaItem', Name: prefix + '-other-media', MediaType: ['movie'] } });
    owners.push(otherMedia);
    const original = png(100, 150, 33);
    await local.upload(PROJECT + '/MediaLibrary', { account: editor, name: source.Name, contentId: source.Id, contentType: 'MediaItem', field: 'CoverImageBin', mime: 'image/png', bytes: original });
    const stamp = (await descriptor(source.Id)).imageStamp;
    assert.match(stamp, /^[a-f0-9]{64}$/);
    const wrongSourceGeneration = crypto.randomUUID();
    await rejected(PROJECT, 'PrepareImageAssetDraft', { ownerId: otherMedia.Id, generationId: wrongSourceGeneration,
      ...guard(await descriptor(otherMedia.Id)), manifest: JSON.stringify({ schemaVersion: 1, kind: 'media-sizes', projectPath: PROJECT,
        ownerId: otherMedia.Id, generationId: wrongSourceGeneration, sourceIds: [source.Id], variants: [],
        recipe: { template: 'media-sizes-v1', sourceIds: [source.Id] }, sourceStamps: [{ id: source.Id, stamp }] }) });
    record('Media-size presentation cannot bind a different readable media source');
    await local.api(source.Id, { account: editor, method: 'PATCH', body: { DisplayName: 'Only a title change' } });
    assert.equal((await descriptor(source.Id)).imageStamp, stamp);
    record('Native image stamp tracks binary/URL independently of an unrelated title save');
    const makeManifest = generationId => ({ schemaVersion: 1, kind: 'timeline-composite', projectPath: PROJECT,
      ownerId: owner.Id, generationId, sourceIds: [source.Id], variants: [],
      recipe: { template: 'poster-strip-v1', sourceIds: [source.Id], seed: 7 }, sourceStamps: [{ id: source.Id, stamp }] });
    const generationId = crypto.randomUUID(), manifest = makeManifest(generationId);
    const current = { ...await selected(owner.Id), ...await descriptor(owner.Id) };
    guardEvidence = { stockVersion: current.Version, stockModificationDate: current.ModificationDate, nativeOwnerGuard: current.ownerGuard };
    const prepareBody = { ownerId: owner.Id, generationId, ...guard(current), manifest: JSON.stringify(manifest) };
    await rejected(PROJECT, 'PrepareImageAssetDraft', prepareBody, null);
    await rejected(PROJECT, 'PrepareImageAssetDraft', prepareBody, reader);
    await rejected(PROJECT, 'PrepareImageAssetDraft', { ...prepareBody, expectedModificationDate: 'utc:2000-01-01T00:00:00Z' });
    await rejected(PROJECT, 'PrepareImageAssetDraft', { ...prepareBody, manifest: JSON.stringify({ ...manifest, unexpected: true }) });
    record('Anonymous/reader creation, stale owner revision and unknown manifest members are rejected');
    await local.api(owner.Id, { account: editor, method: 'PATCH', body: { DisplayName: 'A same-version title save changes the exact native token' } });
    const nextGuard = await descriptor(owner.Id);
    assert.equal(nextGuard.ownerGuard.version, current.ownerGuard.version);
    assert.notEqual(nextGuard.ownerGuard.token, current.ownerGuard.token);
    await rejected(PROJECT, 'PrepareImageAssetDraft', prepareBody);
    record('Same-version owner Save invalidates the exact native CAS token');
    const draft = await post(PROJECT, 'PrepareImageAssetDraft', { ...prepareBody, ...guard(nextGuard) });
    assert.equal(draft.path, `${ASSETS}/${owner.Id}/${generationId}`); sets.push(draft.setId);
    const folder = await selected(`${ASSETS}/${owner.Id}`, accounts.admin); folders.push(folder.Id);
    record('Actual editor prepares its owner folder and draft without an admin credential');
    const unstampedGeneration = crypto.randomUUID();
    const { recipe: omittedRecipe, sourceStamps: omittedStamps, ...unstamped } = manifest;
    void omittedRecipe; void omittedStamps;
    const bypass = await local.request(local.endpoint(folder.Id), { account: editor, method: 'POST', body: {
      __ContentType: 'ImageVariantSet', Name: unstampedGeneration, OwnerContent: [owner.Id], SourceContents: [source.Id],
      GenerationId: unstampedGeneration, Manifest: JSON.stringify({ ...unstamped, generationId: unstampedGeneration }) } });
    assert.ok(bypass.status >= 400); record('Direct stock set creation cannot bypass saved recipe and source-stamp requirements');
    const rootCreate = await local.request(local.endpoint(ASSETS), { account: editor, method: 'POST', body: { __ContentType: 'Folder', Name: String(owner.Id + 1) } });
    assert.ok(rootCreate.status >= 400); record('Protected ImageAssets root stays unavailable to ordinary folder creation');
    const fixtures = await encodedFixtures();
    for (const fixture of fixtures) {
      await assert.rejects(() => local.upload(draft.path, { account: editor, name: 'w' + fixture.width, contentType: 'ImageVariant', mime: fixture.mimeType,
        bytes: fixture.bytes.subarray(0, Math.floor(fixture.bytes.length / 2)) }), /M0 image asset binding or manifest is invalid/);
    }
    record('Truncated browser JPEG and WebP are rejected by full native raster decoding');
    const variants = [];
    for (const fixture of fixtures) {
      const name = 'w' + fixture.width;
      await local.upload(draft.path, { account: editor, name, contentType: 'ImageVariant', mime: fixture.mimeType, bytes: fixture.bytes });
      const file = await selected(draft.path + '/' + name);
      variants.push({ id: file.Id, name, width: fixture.width, height: fixture.height, mimeType: fixture.mimeType,
        byteLength: fixture.bytes.length, sha256: sha256(fixture.bytes) });
    }
    const sealed = { ...manifest, variants };
    const badSeal = await local.request(local.endpoint(draft.setId), { account: editor, method: 'PATCH', body: {
      Manifest: JSON.stringify({ ...sealed, variants: variants.map(v => ({ ...v, sha256: '0'.repeat(64) })) }), Sealed: true } });
    assert.ok(badSeal.status >= 400); record('Decoded JPEG/WebP still require exact manifest dimensions, byte count and SHA');
    await local.api(draft.setId, { account: editor, method: 'PATCH', body: { Manifest: JSON.stringify(sealed), Sealed: true } });
    await rejected(owner.Id, 'ActivateImageAsset', { setId: draft.setId, ...guard(current), expectedVersion: 'V0.1.D' });
    await post(owner.Id, 'ActivateImageAsset', { setId: draft.setId, ...guard(await descriptor(owner.Id)) });
    for (const account of [null, reader]) {
      const active = await descriptor(owner.Id, account); assert.equal(active.state, 'active'); assert.equal(active.setId, draft.setId);
      for (const variant of variants) {
        const response = await local.request(binary(variant.id), { account });
        assert.equal(response.status, 200); assert.equal(sha256(response.bytes), variant.sha256); assert.match(response.headers['cache-control'], /no-store/);
      }
    }
    record('Guarded activation publishes exact JPEG/WebP bytes to Visitor and reader with no-store');
    const beforeChange = await local.request(local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: source.Id, propertyname: 'CoverImageBin' }), { account: editor });
    assert.equal(sha256(beforeChange.bytes), sha256(original)); record('Preparing and activating a composite preserves its original source binary');
    const deletion = await local.request(local.endpoint(source.Id) + '?permanent=true', { account: editor, method: 'DELETE' });
    assert.ok(deletion.status >= 400); record('Native source deletion refuses a still-referenced source');
    await local.upload(PROJECT + '/MediaLibrary', { account: editor, name: source.Name, contentId: source.Id, contentType: 'MediaItem', field: 'CoverImageBin', mime: 'image/png', bytes: png(100, 150, 34) });
    assert.notEqual((await descriptor(source.Id)).imageStamp, stamp);
    for (const account of [null, reader, editor]) {
      const stale = await descriptor(owner.Id, account); assert.equal(stale.state, 'stale'); assert.equal(stale.setId, draft.setId);
      if (account === editor) assert.deepEqual(JSON.parse(stale.manifest).recipe, manifest.recipe); else assert.equal(stale.manifest, undefined);
      const response = await local.request(binary(variants[0].id), { account, headers: { 'If-Modified-Since': new Date(Date.now() + 86400000).toUTCString() } });
      assert.equal(response.status, 403);
    }
    record('Source replacement gives a stale descriptor without manifest and denies even conditional image bytes');
    await permissions(source.Id, [{ identity: accounts.editor.path, Open: 'deny', OpenMinor: 'deny' }]);
    const blocked = await descriptor(owner.Id); assert.equal(blocked.state, 'blocked'); assert.equal(blocked.setId, draft.setId); assert.equal(blocked.manifest, undefined);
    await local.api(owner.Id, { account: editor, method: 'PATCH', body: { DisplayName: 'Title saved with revoked cover source' } });
    record('Revoked source returns only a blocked pointer and permits an unrelated owner title save');
    await post(owner.Id, 'ActivateImageAsset', { setId: null, ...guard(await descriptor(owner.Id)) });
    const inventory = await local.api(owner.Id, { account: editor, operation: 'GetImageAssetSets' });
    assert.equal(inventory.sets.find(set => set.setId === draft.setId)?.canDelete, true);
    await post(owner.Id, 'DeleteImageAsset', { setId: draft.setId }); sets.splice(sets.indexOf(draft.setId), 1);
    assert.equal((await descriptor(owner.Id)).state, 'legacy');
    record('Explicit reset and scoped whole-set cleanup work for actual editor even after source Open revocation');
    result = { passed: true, protocol: capabilities.protocol, decoder: capabilities.decoder, checks, guardEvidence };
  } catch (failure) { error = failure; result = { passed: false, checks, error: failure.message, guardEvidence }; }
  finally {
    try {
      for (const owner of owners) await local.api(owner.Id, { account: accounts.admin, method: 'PATCH', body: { CoverImageSet: [] } });
      for (const id of sets.reverse()) await local.api(id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } });
      for (const id of folders.reverse()) await local.api(id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } });
      for (const owner of owners.reverse()) {
        const actual = await selected(owner.Id, accounts.admin); assert.ok(actual.Name.startsWith(prefix));
        await local.api(owner.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } });
      }
      const finalCount = await count(); assert.equal(finalCount, initialCount); Object.assign(result, { cleanupPassed: true, initialCount, finalCount });
    } catch (failure) { error ||= failure; result = { ...result, passed: false, cleanupPassed: false, cleanupError: failure.message }; }
    fs.writeFileSync(reportPath, JSON.stringify(result, null, 2));
  }
  if (error) throw error;
  console.log(JSON.stringify({ passed: true, checks: checks.length, initialCount, finalCount: result.finalCount }));
  return result;
}
module.exports = { smoke, encodedFixtures };
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
