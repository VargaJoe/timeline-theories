import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Repository } from '../client/api/repository.mjs';
import { StockRepository } from '../client/api/stock-repository.mjs';
import { apply } from '../client/api/plans.mjs';
import { ImageAssets } from '../client/api/image-assets.mjs';

const root = '/Root/Content/PermissionFixture';
const credential = { mode: 'Bearer', value: 'controlled-caller' };
const row = (Id = 10) => ({ Id, Path: root + '/MediaLibrary/item-' + Id, Actions: ['Add', 'StartBlobUploadToParent', 'Edit', 'Delete'].map(Name => ({ Name, Forbidden: false })), EffectiveAllowedChildTypes: [{ Name: 'MediaItem' }, { Name: 'Folder' }, { Name: 'File' }, { Name: 'SystemFolder' }] });
function fixture({ anonymous = false, readOnly = false } = {}) {
  const repo = new Repository({ repositoryUrl: 'https://fixture.invalid', projectRoot: root, readOnly }, anonymous ? null : credential), rows = new Map([[10, row()], [11, row(11)]]), requests = [];
  repo.request = async (address, options = {}) => {
    const url = new URL(address); requests.push({ url, ...options });
    assert.doesNotMatch(url.pathname, /HasPermission/i);
    const id = Number(url.pathname.match(/content\((\d+)\)/)?.[1]);
    return { value: url.searchParams.has('query') ? { results: [...rows.values()] } : rows.get(id) };
  };
  return { repo, rows, requests };
}

test('read access uses a concrete exact GET for authenticated callers and Visitor', async () => {
  for (const anonymous of [false, true]) {
    const f = fixture({ anonymous }); await f.repo.assert([{ target: 10, action: 'read' }, { target: 10, action: 'read' }]);
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url.searchParams.get('$expand'), null);
    f.rows.set(10, { Id: null }); await assert.rejects(f.repo.assert([{ target: 10, action: 'read' }]), error => error.code === 'permission_denied');
    f.rows.set(10, row(11)); await assert.rejects(f.repo.assert([{ target: 10, action: 'read' }]), error => error.code === 'permission_denied');
  }
});

test('unknown, forbidden, missing, malformed or conflicting actions cannot authorize writes', async () => {
  for (const Actions of [undefined, { __deferred: { uri: 'actions' } }, [], [{ Name: 'Edit', Forbidden: true }], [{ Name: 'Edit', Forbidden: 'false' }], [{ Name: 'Update', Forbidden: false }], [{ Name: 'Edit', Forbidden: false }, { Name: 'Edit', Forbidden: true }], [{ Name: 'Edit', Forbidden: true }, { Name: 'Edit', Forbidden: false }]]) {
    const f = fixture(); f.rows.get(10).Actions = Actions;
    await assert.rejects(f.repo.assert([{ target: 10, action: 'update' }]), error => error.code === 'permission_denied');
    assert.equal(f.requests.length, 1);
  }
});

test('Save/Edit without Add cannot create; create also requires the exact effective child type', async () => {
  const f = fixture(), descriptor = f.rows.get(10);
  descriptor.Actions = [{ Name: 'Edit', Forbidden: false }, { Name: 'Add', Forbidden: true }];
  await f.repo.assert([{ target: 10, action: 'cover' }]);
  await assert.rejects(f.repo.assert([{ target: 10, action: 'create', type: 'File' }]), error => error.code === 'permission_denied');
  descriptor.Actions = { results: [{ Name: 'Add', Forbidden: false }, { Name: 'StartBlobUploadToParent', Forbidden: false }] };
  descriptor.AllowedChildTypes = [{ Name: 'SystemFolder' }]; descriptor.EffectiveAllowedChildTypes = [{ Name: 'Folder' }, { Name: 'File' }];
  await assert.rejects(f.repo.assert([{ target: 10, action: 'create', type: 'SystemFolder' }]), error => error.code === 'child_type_denied');
  descriptor.EffectiveAllowedChildTypes = { results: [{ Name: 'SystemFolder' }] };
  await f.repo.assert([{ target: 10, action: 'create', type: 'SystemFolder' }]);
  assert(f.requests.every(request => !/AllowedChildTypes$/.test(request.url.pathname)), 'child types travel in the same descriptor response');
});

test('managed SystemFolder bootstrap requires the stock AddNew descriptor even when non-folder media has no Add UI action', async () => {
  const f = fixture(), descriptor = f.rows.get(10);
  descriptor.Actions = [{ Name: 'Edit', Forbidden: false }, { Name: 'StartBlobUploadToParent', Forbidden: false }];
  await f.repo.assert([{ target: 10, action: 'create', type: 'SystemFolder' }]);
  assert.equal(f.requests.length, 1); assert(!f.requests.some(request => request.options?.method === 'POST'));
  for (const forbidden of [true, undefined, 'false']) {
    descriptor.Actions[1].Forbidden = forbidden;
    await assert.rejects(f.repo.assert([{ target: 10, action: 'create', type: 'SystemFolder' }]), error => error.code === 'permission_denied');
  }
  descriptor.Actions = [{ Name: 'Add', Forbidden: false }, { Name: 'Edit', Forbidden: false }];
  await assert.rejects(f.repo.assert([{ target: 10, action: 'create', type: 'SystemFolder' }]), error => error.code === 'permission_denied');
});

test('Visitor, read-only and unknown operations fail before descriptor traffic', async () => {
  for (const options of [{ anonymous: true }, { readOnly: true }]) {
    const f = fixture(options); await assert.rejects(f.repo.assert([{ target: 10, action: 'update' }]), error => error.code === 'read_only'); assert.equal(f.requests.length, 0);
  }
  const f = fixture(); await assert.rejects(f.repo.assert([{ target: 10, action: 'unknown' }]), error => error.code === 'invalid_operation'); assert.equal(f.requests.length, 0);
});

test('multiple write targets use one fresh compound descriptor query and preserve exact reads', async () => {
  const f = fixture();
  await f.repo.assert([{ target: 10, action: 'update' }, { target: 11, action: 'delete' }, { target: 10, action: 'cover' }]);
  assert.equal(f.requests.length, 1); const query = f.requests[0].url.searchParams;
  assert.match(query.get('query'), /Id:10 Id:11/); assert.equal(query.get('$top'), '2');
  assert.equal(query.get('$expand'), 'Actions,EffectiveAllowedChildTypes'); assert.equal(query.has('scenario'), false);
  f.rows.get(11).Actions = [{ Name: 'Delete', Forbidden: true }];
  await assert.rejects(f.repo.assert([{ target: 10, action: 'update' }, { target: 11, action: 'delete' }]), error => error.code === 'permission_denied');
  f.requests.length = 0; await f.repo.assert([{ target: 10, action: 'read' }, { target: 10, action: 'update' }]); assert.equal(f.requests.length, 1, 'one exact descriptor GET also proves its read');
});

const identity = { Id: 42, Path: '/Root/IMS/Public/Inventory' };
function inventoryFixture() {
  const repo = new StockRepository({ repositoryUrl: 'https://fixture.invalid', projectRoot: root, inventoryIdentity: 42 }, credential), requests = [];
  const entry = { identity: { id: 42, path: identity.Path }, propagates: true, permissions: Object.fromEntries(['See', 'Open', 'OpenMinor', 'Save', 'AddNew', 'Delete', 'SetPermissions'].map(name => [name, { value: ['See', 'Open', 'OpenMinor'].includes(name) ? 'allow' : 'deny' }])) };
  const state = { allowedUsers: [{ Id: identity.Id }] };
  const inventory = { identity: async () => identity, api: async (target, operation, options) => {
    requests.push({ target, operation, options }); assert.notEqual(operation, 'HasPermission');
    return operation === 'GetPermissions' ? [structuredClone(entry)] : operation === 'GetAllowedUsers' ? { results: state.allowedUsers } : { Id: target === root ? 1 : target.endsWith('/Timelines') ? 2 : 3, Path: target };
  } };
  repo.inventory = () => inventory; return { repo, inventory, entry, requests, state };
}

test('inventory proves effective read coverage and propagating own write denials with composite permission operations', async () => {
  const f = inventoryFixture(); const proof = await f.repo.verifyInventory();
  assert.equal(proof.identityId, 42); assert.equal(proof.completeness, 'configured-read-all-project');
  assert.equal(f.requests.length, 9); assert.equal(f.requests.filter(request => request.operation === 'GetPermissions').length, 3);
  assert(f.requests.filter(request => request.operation === 'GetPermissions').every(request => request.options.query.identity === identity.Path));
  const readChecks = f.requests.filter(request => request.operation === 'GetAllowedUsers'); assert.equal(readChecks.length, 3);
  assert(readChecks.every(request => JSON.stringify(request.options.query.getAll('permissions')) === JSON.stringify(['See', 'Open', 'OpenMinor']) && request.options.query.get('$filter') === 'Id eq 42'));
  assert(f.requests.filter(request => request.operation === null).every(request => request.options.query.version === 'lastminor'));
  await f.repo.verifyInventory(); assert.equal(f.requests.length, 9, 'one invocation reuses its already verified configured identity');
});

test('inventory fails closed for missing, allowed, unrecognized or unpropagated write denials including SetPermissions', async () => {
  for (const permission of ['Save', 'AddNew', 'Delete', 'SetPermissions']) for (const value of [null, { value: 'allow' }, { value: 'unknown' }, undefined]) {
    const f = inventoryFixture(); if (value === undefined) delete f.entry.permissions[permission]; else f.entry.permissions[permission] = value;
    await assert.rejects(f.repo.verifyInventory(), error => error.code === 'inventory_overprivileged');
  }
  for (const change of [entry => { entry.propagates = false; }, entry => { entry.identity.id = 99; }]) {
    const f = inventoryFixture(); change(f.entry); await assert.rejects(f.repo.verifyInventory(), error => error.code === 'inventory_unavailable');
  }
  const f = inventoryFixture(); f.inventory.api = async () => []; await assert.rejects(f.repo.verifyInventory(), error => error.code === 'inventory_unavailable');
});

test('inventory does not infer effective read coverage from own ACE allows or successful container GETs', async () => {
  for (const allowedUsers of [[], [{ Id: 99 }], [{ Id: '42' }], undefined]) {
    const f = inventoryFixture(); f.state.allowedUsers = allowedUsers;
    await assert.rejects(f.repo.verifyInventory(), error => error.code === 'inventory_unavailable');
    assert(f.requests.some(request => request.operation === null), 'the successful exact GET does not replace the effective all-bit check');
    assert.equal(f.entry.permissions.Open.value, 'allow', 'an own allow summary cannot override an inherited/group deny');
  }
  const f = inventoryFixture(); delete f.entry.permissions.See; delete f.entry.permissions.Open; delete f.entry.permissions.OpenMinor;
  assert.equal((await f.repo.verifyInventory()).identityId, 42, 'canonical positive membership also supports group-derived read rights');
});

test('whole-plan permission failure prevents an earlier allowed mutation from dispatching', async () => {
  const f = fixture(); let writes = 0;
  f.rows.get(11).Actions = [{ Name: 'Edit', Forbidden: true }];
  f.repo.read = async id => ({ ...f.rows.get(id), revision: 'sha256:' + 'a'.repeat(64) }); f.repo.assertWritableTarget = async () => {};
  const plan = { id: 'controlled-plan', steps: [10, 11].map(targetId => ({ payload: { operationId: 'operation-' + targetId, action: 'update', type: 'MediaItem', targetId }, operations: [{ target: targetId, action: 'update' }], preconditions: [] })) };
  const context = { repo: f.repo, principal: 'caller', check: async () => {}, journal: { assertRecoveryBoundary: async () => {}, receipt: async () => ({ found: false }), mutation: async () => { writes++; } } };
  await assert.rejects(apply(context, plan.id, 'controlled-key', { plan: async () => plan, reserve: async () => undefined }), error => error.code === 'permission_denied');
  assert.equal(writes, 0);
});

test('runtime application adapters contain no legacy per-permission endpoint', async () => {
  for (const file of ['repository.mjs', 'stock-repository.mjs', 'image-assets.mjs']) {
    const source = await fs.readFile(new URL('../client/api/' + file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /HasPermission/i, file);
  }
});

test('timeline-composite sources cannot substitute a Timeline for a MediaItem original', async () => {
  let binaries = 0;
  const images = new ImageAssets({ imageSourceSnapshot: async () => ({ Id: 10, Type: 'Timeline', CoverImageBin: { ContentType: 'image/png' } }), coverBytes: async () => { binaries++; } });
  await assert.rejects(images.assertSources({ kind: 'timeline-composite', sourceStamps: [{ id: 10, stamp: 'a'.repeat(64) }] }, { stamps: true }), error => error.code === 'invalid_image_source');
  assert.equal(binaries, 0);
});

test('minimal original descriptors include changing repository and binary stamps without any second read', async () => {
  const repo = new StockRepository({ projectRoot: root }, credential), requests = [];
  const content = { Id: 10, Type: 'MediaItem', Path: root + '/MediaLibrary/item', ModificationDate: '2026-11-16T12:00:00Z', Version: 'V2.0', CoverImageUrl: 'https://images.fixture.invalid/cover.png', CoverImageBin: { __mediaresource: { content_type: 'image/png', media_etag: 'etag-2', media_src: 'binary-token' } } };
  repo.api = async (target, operation, options) => { requests.push({ target, operation, options }); return content; };
  repo.assert = async () => { throw new Error('Successful source GET must not trigger a redundant permission read'); };
  const snapshot = await repo.imageSourceSnapshot(10);
  assert.deepEqual(snapshot, { Id: 10, Type: 'MediaItem', Path: content.Path, ModificationDate: content.ModificationDate, Version: 'V2.0', CoverImageUrl: content.CoverImageUrl, CoverImageBin: { ContentType: 'image/png', ETag: 'etag-2', SnapshotToken: 'binary-token' } });
  assert.equal(requests.length, 1); assert.equal(requests[0].operation, null);
  delete content.Version;
  await assert.rejects(repo.imageSourceSnapshot(10), error => error.code === 'backend_revision_unavailable');
});

test('image owner reads use one caller snapshot operation and never add a read permission probe', async () => {
  const owner = { Id: 20, Type: 'Timeline' }, calls = [];
  const images = new ImageAssets({ read: async (id, options) => { calls.push({ id, options }); return owner; }, assert: async operations => { calls.push({ operations }); } });
  assert.equal(await images.owner(20), owner);
  assert.deepEqual(calls, [{ id: 20, options: { image: false } }]);
  calls.length = 0; await images.owner(20, { write: true });
  assert.deepEqual(calls, [{ id: 20, options: { image: false } }, { operations: [{ target: 20, action: 'cover' }] }], 'fresh write authorization is retained');
});

test('original binary reads use only fresh minimal caller metadata and the ACL-enforced binary GET', async () => {
  const repo = new StockRepository({ projectRoot: root, repositoryUrl: 'https://fixture.invalid' }, credential), calls = [];
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  repo.api = async (target, operation, options) => { calls.push({ target, operation, options }); return { Id: 10, Type: 'MediaItem', Path: root + '/MediaLibrary/item', ModificationDate: '2026-11-16T12:00:00Z', Version: 'V1.0', CoverImageBin: { __mediaresource: { content_type: 'image/png' } } }; };
  repo.read = async () => { throw new Error('Original bytes do not require a full snapshot or image tree'); };
  repo.assert = async () => { throw new Error('Actual caller GET already proves read access'); };
  repo.request = async (url, options) => { calls.push({ url, options }); return { bytes: png, contentType: 'image/png' }; };
  assert.deepEqual(await repo.coverBytes(10), png); assert.equal(calls.length, 2);
  assert.equal(calls[0].operation, null); assert.match(calls[1].url, /binaryhandler\.ashx\?nodeid=10&propertyname=CoverImageBin$/);
  repo.request = async () => { throw Object.assign(new Error('Binary denied'), { status: 403 }); };
  await assert.rejects(repo.coverBytes(10), error => error.status === 403);
});
