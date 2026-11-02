'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const local = require('./m0-local-api.cjs');
const { authenticate } = require('./m0-oidc-smoke.cjs');
const { permissions, READ_PERMISSIONS } = require('./m0-acl.cjs');
const { ASSETS } = require('./m0-image-variants-provision.cjs');
const { png, sha256 } = require('./helpers/image-variant-fixture.cjs');

const PROJECT = '/Root/Content/timelines';
const VISITOR = '/Root/IMS/BuiltIn/Portal/Visitor';
const probeCreate = process.argv.includes('--probe-create');
const reportPath = path.join(local.ROOT, probeCreate ? 'image-variants-create-probe.json' : 'image-variants-smoke.json');
function denied(response) {
  return [401, 403, 404].includes(response.status) ||
    (response.status === 500 && response.value?.error?.code === 'NotEnoughPermissions') ||
    (response.status === 500 && typeof response.value === 'string' && response.value.includes('SenseNetSecurityException') && /M0 image (asset|generation|source|variant|set)/.test(response.value)) ||
    (response.status === 400 && response.value?.error?.exceptiontype === 'SenseNetSecurityException');
}
function rejected(response) {
  const message = response.value?.error?.message?.value ?? response.value?.error?.message ?? '';
  return denied(response) || [400, 409].includes(response.status) ||
    (response.status === 500 && typeof message === 'string' && message.includes('M0 image asset'));
}
function binaryUrl(id, field = 'Binary', extra = {}) {
  return local.REPOSITORY + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: String(id), propertyname: field, ...extra });
}
function median(values) { return [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]; }

async function smoke() {
  local.assertLocal(local.REPOSITORY);
  const accounts = local.readAccounts();
  const editor = { token: (await authenticate('editor')).token };
  const reader = { token: (await authenticate('reader')).token };
  const roles = [{ name: 'Visitor', account: undefined, identity: VISITOR }, { name: 'reader', account: reader, identity: accounts.reader.path }];
  const prefix = 'm0-images-' + crypto.randomUUID();
  const checks = [], owners = [], sets = [], folders = [], sourceFiles = [];
  const sourceIds = new Set(Object.values(JSON.parse(fs.readFileSync(path.join(local.ROOT, 'restore-journal.json'), 'utf8')).idMap));
  let report, initialCount;
  const record = (name, detail = {}) => checks.push({ name, ...detail, passed: true });
  const selected = (target, account, fields = 'Id,Name,Path,Type') => local.api(target, { account, query: { $select: fields, metadata: 'no' } });
  async function count() {
    const query = {
      query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', $top: '0', $inlinecount: 'allpages', metadata: 'no',
    };
    const result = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams(query), { account: accounts.admin });
    assert.equal(result.status, 200);
    const resultCount = Number(result.value.d.__count);
    assert.ok(Number.isSafeInteger(resultCount) && resultCount >= 0);
    return resultCount;
  }
  async function create(parent, type, name, fields = {}) {
    return local.api(parent, { account: editor, method: 'POST', query: { metadata: 'no' }, body: { __ContentType: type, Name: name, ...fields } });
  }
  async function assetFolder(owner) {
    const folder = await local.api(ASSETS, { account: accounts.admin, method: 'POST', query: { metadata: 'no' },
      body: { __ContentType: 'Folder', Name: String(owner.Id), AllowedChildTypes: ['ImageVariantSet'] } });
    folders.push(folder);
    await permissions(folder.Id, [{ identity: accounts.editor.path, localOnly: true, Save: 'deny', Delete: 'deny' },
      ...roles.map(role => ({ identity: role.identity, localOnly: true, See: 'deny', Open: 'deny' }))]);
    return folder;
  }
  async function draft(owner, sources, outputs = [{ width: 400, height: 200 }]) {
    const folder = folders.find(item => item.Name === String(owner.Id)) || await assetFolder(owner);
    const generationId = crypto.randomUUID();
    const manifest = { schemaVersion: 1, kind: owner.Type === 'Timeline' ? 'timeline-composite' : 'media-sizes', projectPath: PROJECT,
      ownerId: owner.Id, generationId, sourceIds: sources.map(item => item.Id), variants: [] };
    const set = await create(folder.Id, 'ImageVariantSet', generationId, {
      OwnerContent: [owner.Id], SourceContents: sources.map(item => item.Id), GenerationId: generationId,
      Manifest: JSON.stringify(manifest),
    });
    sets.push({ ...set, ownerId: owner.Id });
    const variants = [];
    for (const [index, dimensions] of outputs.entries()) {
      const bytes = png(dimensions.width, dimensions.height, index);
      const name = 'w' + dimensions.width;
      await local.upload(set.Path, { name, bytes, contentType: 'ImageVariant', mime: 'image/png', account: editor });
      const file = await selected(set.Path + '/' + name, editor);
      variants.push({ id: file.Id, name, ...dimensions, mimeType: 'image/png', byteLength: bytes.length, sha256: sha256(bytes) });
    }
    manifest.variants = variants;
    await local.api(set.Id, { account: editor, method: 'PATCH', body: { Manifest: JSON.stringify(manifest) } });
    return { ...set, ownerId: owner.Id, manifest, variants };
  }
  const activate = (owner, set) => local.api(owner.Id, { account: editor, method: 'PATCH', body: { CoverImageSet: [set.Id] } });
  const seal = set => local.api(set.Id, { account: editor, method: 'PATCH', body: { Sealed: true } });
  async function assertReadDenied(set, role, label) {
    for (const select of ['Id', 'Id,Manifest', undefined]) {
      const response = await local.request(local.endpoint(set.Id) + (select ? '?' + new URLSearchParams({ $select: select, metadata: 'no' }) : ''), { account: role.account });
      assert.ok(denied(response), `${label}/${role.name} set ${select ?? 'all'} read HTTP ${response.status}`);
    }
    const variant = set.variants[0];
    const response = await local.request(binaryUrl(variant.id), { account: role.account });
    assert.equal(response.status, 403, `${label}/${role.name} native binary must report a security denial`);
    assert.notEqual(sha256(response.bytes), variant.sha256);
    const conditional = await local.request(binaryUrl(variant.id, 'Binary', { maxAge: '604800' }), { account: role.account,
      headers: { 'If-Modified-Since': new Date(Date.now() + 86400000).toUTCString() } });
    assert.equal(conditional.status, 403, `${label}/${role.name} conditional binary must not return304 or an internal error`);
    const imageMetadata = await local.request(local.endpoint(variant.id) + '?' + new URLSearchParams({ $select: 'Id,Name,Binary', metadata: 'no' }), { account: role.account });
    assert.ok(denied(imageMetadata), `${label}/${role.name} file metadata HTTP ${imageMetadata.status}`);
    record(`${label}: ${role.name} selected/all metadata and direct Binary denied`);
  }
  async function assertBytes(set, role) {
    for (const variant of set.variants) {
      const response = await local.request(binaryUrl(variant.id), { account: role.account });
      assert.equal(response.status, 200, `${role.name} active binary HTTP ${response.status}`);
      assert.equal(response.bytes.length, variant.byteLength);
      assert.equal(sha256(response.bytes), variant.sha256);
      assert.match(response.headers['cache-control'] ?? '', /no-store/i, 'Derived bytes must not be cached publicly.');
    }
  }
  async function clear(owner) { await local.api(owner.Id, { account: accounts.admin, method: 'PATCH', body: { CoverImageSet: [] } }); }
  async function protectedMutation(name, target, body, account = editor) {
    const response = await local.request(local.endpoint(target), { account, method: 'PATCH', body });
    assert.ok(rejected(response), `${name} HTTP ${response.status}`);
    record(name, { status: response.status });
  }
  fs.writeFileSync(reportPath, JSON.stringify({ passed: false, startedAt: new Date().toISOString(), status: 'started' }, null, 2));
  try {
    await selected(ASSETS, accounts.admin);
    initialCount = await count();
    for (let index = 0; index < (probeCreate ? 1 : 4); index++) {
      const media = await create(PROJECT + '/MediaLibrary', index === 3 ? 'BookMediaItem' : 'MediaItem', prefix + '-source-' + index,
        index === 3 ? { MediaType: ['book'], BookSeriesNumber: 1, PublicationYear: 2000 } : { MediaType: ['movie'] });
      owners.push(media);
      const bytes = png(640, 960, index);
      await local.upload(PROJECT + '/MediaLibrary', { name: media.Name, bytes, contentId: media.Id, contentType: media.Type, field: 'CoverImageBin', mime: 'image/png', account: editor });
      sourceFiles.push({ id: media.Id, bytes: bytes.length, sha256: sha256(bytes) });
    }
    const timeline = await create(PROJECT + '/Timelines', 'Timeline', prefix + '-timeline', { IsVisible: true }); owners.push(timeline);
    const other = await create(PROJECT + '/Timelines', 'Timeline', prefix + '-other', { IsVisible: true }); owners.push(other);
    const media = owners[0], sources = owners.slice(0, 4);
    const first = await draft(timeline, [media]);
    if (probeCreate) {
      record('Actual editor creates one complete draft set and PNG child');
      report = { version: 1, ranAt: new Date().toISOString(), repository: local.REPOSITORY, scope: 'Creation diagnostic only; not full acceptance.', checks };
      return report;
    }
    const invalidOutput = await draft(timeline, [media], []);
    const corruptPng = png(10, 10); corruptPng[42] ^= 1;
    await assert.rejects(() => local.upload(invalidOutput.Path, { name: 'w10', bytes: corruptPng,
      contentType: 'ImageVariant', mime: 'image/png', account: editor }), /HTTP (400|403|409):|HTTP 500:.*M0/);
    record('A PNG signature with corrupt raster/CRC is rejected by the native write path');
    for (const type of ['SystemFolder', 'TrashBag']) {
      const response = await local.request(local.endpoint(first.Id), { account: editor, method: 'POST',
        body: { __ContentType: type, Name: prefix + '-' + type.toLowerCase() } });
      assert.ok(rejected(response), `Unguarded ${type} child creation HTTP ${response.status}`);
      record(`Native ${type} exception cannot bypass the guarded child model`);
    }
    for (const role of roles) await assertReadDenied(first, role, 'Draft');
    await protectedMutation('Incomplete generation cannot be activated', timeline.Id, { CoverImageSet: [first.Id] });
    for (const [label, overrides] of [['Dimension mismatch', { height: first.variants[0].height + 1 }], ['MIME mismatch', { mimeType: 'image/jpeg' }]]) {
      const invalid = { ...first.manifest, variants: first.variants.map(item => ({ ...item, ...overrides })) };
      await local.api(first.Id, { account: editor, method: 'PATCH', body: { Manifest: JSON.stringify(invalid) } });
      await protectedMutation(`${label} cannot be sealed`, first.Id, { Sealed: true });
    }
    const badManifest = { ...first.manifest, variants: first.variants.map(item => ({ ...item, sha256: '0'.repeat(64) })) };
    await local.api(first.Id, { account: editor, method: 'PATCH', body: { Manifest: JSON.stringify(badManifest) } });
    await protectedMutation('Hash mismatch cannot be sealed', first.Id, { Sealed: true });
    await local.api(first.Id, { account: editor, method: 'PATCH', body: { Manifest: JSON.stringify(first.manifest) } });
    await seal(first);
    for (const role of roles) await assertReadDenied(first, role, 'Sealed but inactive');
    await protectedMutation('Set cannot be activated on a different owner', other.Id, { CoverImageSet: [first.Id] });
    await activate(timeline, first);
    for (const role of roles) { await assertBytes(first, role); record(`${role.name} reads exact bytes from active single-source set`); }
    // Repeated reads warm both repository node and binary caches before revocation.
    await assertBytes(first, roles[0]);
    const version = await selected(first.variants[0].id, editor, 'Id,Version');
    assert.equal(typeof version.Version, 'string', 'Explicit old-version probe requires an actual backend version.');
    await local.api(timeline.Id, { account: editor, method: 'PATCH', body: { IsVisible: false } });
    for (const role of roles) {
      await assertReadDenied(first, role, 'Owner hidden after warm read');
      const old = await local.request(binaryUrl(first.variants[0].id, 'Binary', { version: version.Version }), { account: role.account });
      assert.ok(denied(old), `${role.name} explicit old-version binary bypassed owner deny`);
      record(`${role.name} explicit binary version does not bypass current owner deny`);
    }
    await local.api(timeline.Id, { account: editor, method: 'PATCH', body: { IsVisible: true } });
    for (const role of roles) await assertBytes(first, role);
    const second = await draft(timeline, sources, [{ width: 400, height: 200 }, { width: 800, height: 400 }]);
    await seal(second); await activate(timeline, second);
    for (const role of roles) { await assertBytes(second, role); await assertReadDenied(first, role, 'Replaced generation'); }
    record('A complete four-source generation atomically replaces the previous owner reference');
    await permissions(sources[2].Id, roles.map(role => ({ identity: role.identity, ...READ_PERMISSIONS, Open: 'deny', OpenMinor: 'deny' })));
    for (const role of roles) await assertReadDenied(second, role, 'One composite source revoked');
    // Expanded navigation must not return protected manifest/binary bytes.
    for (const role of roles) {
      const response = await local.request(local.endpoint(timeline.Id) + '?' + new URLSearchParams({ $expand: 'CoverImageSet', $select: 'Id,CoverImageSet/Id,CoverImageSet/Manifest', metadata: 'no' }), { account: role.account });
      if (response.status === 200) assert.ok(!response.value.d.CoverImageSet || response.value.d.CoverImageSet.length === 0, 'Expanded owner reference disclosed protected set.');
      else assert.ok(denied(response));
      record(`${role.name} expanded owner reference does not disclose source-revoked set`);
    }
    await permissions(sources[2].Id, [{ identity: accounts.editor.path, Open: 'deny', OpenMinor: 'deny' }]);
    const scalar = await local.request(local.endpoint(timeline.Id) + '?' + new URLSearchParams({ $select: 'Id', metadata: 'no' }), {
      account: editor, method: 'PATCH', body: { DisplayName: 'Edited title with an unreadable cover source' },
    });
    assert.equal(scalar.status, 200, 'An unreadable cover source blocked an unrelated title save.');
    const preserved = await local.api(timeline.Id, { account: accounts.admin, query: { $expand: 'CoverImageSet', $select: 'Id,CoverImageSet/Id', metadata: 'no' } });
    const references = Array.isArray(preserved.CoverImageSet) ? preserved.CoverImageSet : [preserved.CoverImageSet];
    assert.deepEqual(references.map(item => item?.Id), [second.Id]);
    record('Unrelated editor title save preserves the raw cover pointer while a source is unreadable');
    await assertReadDenied(second, { name: 'editor', account: editor }, 'Editor source read revoked');
    await permissions(sources[2].Id, [{ identity: accounts.editor.path, Open: 'allow', OpenMinor: 'allow' }]);
    await permissions(sources[2].Id, roles.map(role => ({ identity: role.identity, ...READ_PERMISSIONS })));
    for (const role of roles) await assertBytes(second, role);
    await protectedMutation('Sealed manifest is immutable', second.Id, { Manifest: '{}' });
    await protectedMutation('Sealed flag cannot be cleared', second.Id, { Sealed: false });
    await protectedMutation('Sealed file cannot be renamed', second.variants[0].id, { Name: 'changed.png' });
    await assert.rejects(() => local.upload(second.Path, { name: second.variants[0].name, contentId: second.variants[0].id,
      bytes: png(400, 200, 9), contentType: 'ImageVariant', mime: 'image/png', account: editor }), /HTTP (400|403|409):|HTTP 500:.*M0/);
    record('Native multipart overwrite cannot change a sealed binary');
    const blobStart = await local.request(local.endpoint(second.variants[0].id) + '/StartBlobUpload', {
      account: editor, method: 'POST', body: { fullSize: second.variants[0].byteLength, fieldName: 'Binary' },
    });
    assert.ok(rejected(blobStart), 'A sealed binary entered a native chunk-upload session.');
    record('Native StartBlobUpload cannot reopen a sealed binary');
    for (const role of roles) await protectedMutation(`${role.name} cannot publish an owner reference`, timeline.Id, { CoverImageSet: [first.Id] }, role.account ?? null);
    const deleteActive = await local.request(local.endpoint(second.Id) + '?permanent=true', { account: editor, method: 'DELETE' });
    assert.ok(rejected(deleteActive), 'Active generation deletion succeeded.'); record('Active generation deletion denied');
    const deleteOwner = await local.request(local.endpoint(timeline.Id) + '?permanent=true', { account: editor, method: 'DELETE' });
    assert.ok(rejected(deleteOwner), 'An owner with an active cover reference was deleted.'); record('Owner deletion requires clearing its active cover reference');
    const deleteFile = await local.request(local.endpoint(second.variants[0].id) + '?permanent=true', { account: editor, method: 'DELETE' });
    assert.ok(rejected(deleteFile), 'Individual sealed file deletion succeeded.'); record('Individual sealed file deletion denied');
    await assertBytes(second, roles[0]);
    const mediaSet = await draft(media, [media], [{ width: 160, height: 240 }, { width: 320, height: 480 }]);
    await seal(mediaSet); await activate(media, mediaSet);
    for (const role of roles) { await assertBytes(mediaSet, role); record(`${role.name} reads exact media-size variant bytes`); }
    const renamed = prefix + '-renamed';
    await local.api(media.Id, { account: editor, method: 'PATCH', body: { Name: renamed } }); media.Name = renamed; media.Path = PROJECT + '/MediaLibrary/' + renamed;
    for (const role of roles) await assertBytes(mediaSet, role);
    record('ID-based media ownership survives source rename within the project');
    for (const source of sourceFiles) {
      const response = await local.request(binaryUrl(source.id, 'CoverImageBin'), { account: editor });
      assert.equal(response.status, 200); assert.equal(sha256(response.bytes), source.sha256);
    }
    record('All four original binary hashes are unchanged');
    const raced = await Promise.all([
      local.request(local.endpoint(timeline.Id), { account: editor, method: 'PATCH', body: { CoverImageSet: [first.Id] } }),
      local.request(local.endpoint(first.Id) + '?permanent=true', { account: editor, method: 'DELETE' }),
    ]);
    const succeeded = raced.map(result => result.status >= 200 && result.status < 300);
    assert.equal(succeeded.filter(Boolean).length, 1, 'Activation and deletion must have exactly one winner.');
    const indexed = await local.request(local.REPOSITORY + '/OData.svc/Root/Content?' + new URLSearchParams({
      query: `+Id:${timeline.Id} +CoverImageSet:${first.Id} .AUTOFILTERS:OFF .LIFESPAN:OFF`, $select: 'Id', metadata: 'no',
    }), { account: accounts.admin });
    assert.equal(indexed.status, 200);
    if (succeeded[1]) {
      assert.equal(indexed.value.d.results.length, 0, 'Deleted set remains an indexed active owner reference.');
      assert.equal((await local.request(local.endpoint(first.Id), { account: accounts.admin })).status, 404);
      sets.splice(sets.findIndex(item => item.Id === first.Id), 1);
    } else {
      assert.equal(indexed.value.d.results[0]?.Id, timeline.Id);
      await assertBytes(first, roles[0]);
    }
    await activate(timeline, second);
    record('Concurrent activation and inactive-set deletion cannot leave an active dangling pointer', { statuses: raced.map(result => result.status) });
    const samples = [];
    for (let sample = 0; sample < 3; sample++) {
      const started = performance.now();
      const response = await local.request(binaryUrl(second.variants[0].id), { account: roles[0].account });
      assert.equal(response.status, 200); assert.equal(sha256(response.bytes), second.variants[0].sha256);
      samples.push(Math.round((performance.now() - started) * 10) / 10);
    }
    const measured = { fixture: 'Synthetic lossless PNG; not production poster compression or UI speed.', directBinaryMs: samples,
      medianMs: median(samples), minMs: Math.min(...samples), maxMs: Math.max(...samples),
      selectedVariantBytes: second.variants[0].byteLength, fourSourceBytes: sourceFiles.reduce((sum, item) => sum + item.bytes, 0) };
    report = { version: 1, ranAt: new Date().toISOString(), repository: local.REPOSITORY, format: 'PNG-only M0 proof',
      authentication: 'Anonymous Visitor and actual authorization-code PKCE reader/editor, verified GetCurrentUser.', checks, measured };
  } catch (error) {
    fs.writeFileSync(reportPath, JSON.stringify({ ranAt: new Date().toISOString(), passed: false, checks, error: error.message }, null, 2));
    console.error(JSON.stringify({ completedChecks: checks.length, failure: error.message }));
    throw error;
  } finally {
    const cleanup = [];
    try {
      for (const source of sourceFiles) await permissions(source.id, [...roles.map(role => ({ identity: role.identity, ...READ_PERMISSIONS })),
        { identity: accounts.editor.path, Open: 'allow', OpenMinor: 'allow' }]);
      for (const owner of owners) await clear(owner);
      for (const set of [...sets].reverse()) {
        const actual = await selected(set.Id, accounts.admin);
        assert.equal(actual.Id, set.Id); assert.equal(actual.Name, set.Name); assert.equal(actual.Path, set.Path);
        assert.ok(!sourceIds.has(set.Id) && set.Path.startsWith(ASSETS + '/' + set.ownerId + '/'));
        await local.api(set.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); cleanup.push(set.Id);
      }
      for (const folder of [...folders].reverse()) {
        const actual = await selected(folder.Id, accounts.admin);
        assert.equal(actual.Path, folder.Path); assert.equal(actual.Name, folder.Name); assert.ok(folder.Path.startsWith(ASSETS + '/'));
        await local.api(folder.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); cleanup.push(folder.Id);
      }
      for (const owner of [...owners].reverse()) {
        const actual = await selected(owner.Id, accounts.admin);
        assert.equal(actual.Path, owner.Path); assert.equal(actual.Name, owner.Name); assert.ok(!sourceIds.has(owner.Id) && owner.Name.startsWith(prefix));
        await local.api(owner.Id, { account: accounts.admin, method: 'DELETE', query: { permanent: 'true' } }); cleanup.push(owner.Id);
      }
      const finalCount = await count();
      if (initialCount !== undefined) assert.equal(finalCount, initialCount, 'Fixture cleanup changed project record count.');
      if (report) {
        Object.assign(report, { passed: true, cleanup, initialCount, finalCount });
        fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
        console.log(JSON.stringify({ passed: true, checks: checks.length, cleaned: cleanup.length, initialCount, finalCount, measured: report.measured }));
      } else {
        const failed = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
        Object.assign(failed, { cleanupPassed: true, cleanup, initialCount, finalCount });
        fs.writeFileSync(reportPath, JSON.stringify(failed, null, 2));
      }
    } catch (error) {
      fs.writeFileSync(reportPath, JSON.stringify({ passed: false, ranAt: new Date().toISOString(), checks, cleanup, initialCount, error: 'Fixture cleanup failed: ' + error.message }, null, 2));
      throw error;
    }
  }
  return report;
}

module.exports = { smoke };
if (require.main === module) smoke().catch(error => { console.error(error.message); process.exitCode = 1; });
