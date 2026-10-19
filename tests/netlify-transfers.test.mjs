import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';
import { Store } from '../client/api/store.mjs';
import { TransferService, TRANSFER_CHUNK_BYTES, TRANSFER_INLINE_BYTES, TRANSFER_PLAN_JSON_BYTES } from '../client/api/transfers.mjs';
import { DomainError } from '../client/domain/content.mjs';

// Actual SDK and its owned HTTP emulator. No repository traffic or content writes.
let blobFixture;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const revision = 'sha256:' + 'a'.repeat(64);
before(async () => { blobFixture = await startBlobFixture(); });
after(async () => { await blobFixture?.close(); });
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
function fixture() {
  const config = { repositoryUrl: 'https://fixture.invalid', authority: 'https://auth.fixture.invalid', projectRoot: '/Root/' + randomUUID(), blobOptions: blobFixture.blobOptions };
  const store = new Store(config), service = new TransferService(config, store), trace = [];
  const state = { revoked: false, denied: false, changed: false, deniedId: 0 };
  const context = {
    principal: 'grant:' + randomUUID(), scopes: ['covers:write','exchange:write'],
    check: async () => { if (state.revoked) throw new DomainError('credential_revoked', 'Revoked.', 401); },
    repo: {
      paths: { timelines: config.projectRoot + '/Timelines' },
      read: async id => {
        trace.push(['read',id]);
        if (state.deniedId === id) throw new DomainError('permission_denied', 'Denied.', 403);
        return { Id: id, Type: id === 20 ? 'Timeline' : 'MediaItem', Path: config.projectRoot + '/Timelines/' + id, revision: state.changed ? 'sha256:' + 'b'.repeat(64) : revision };
      },
      assertWritableTarget: async target => trace.push(['writable',target.Id]),
      assert: async operations => { trace.push(...operations); if (state.denied) throw new DomainError('permission_denied','Denied.',403); },
    },
  };
  return { config, store, service, context, trace, state };
}
function request(route, body, contentType = 'application/json', method = 'POST') {
  return new Request('https://app.fixture.invalid/api/v1/' + route, { method, ...(body === undefined ? {} : { body: Buffer.isBuffer(body) ? body : JSON.stringify(body), headers: { 'Content-Type': contentType } }) });
}
function png(size = TRANSFER_INLINE_BYTES + 27) { const bytes = Buffer.alloc(size, 17); Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes); return bytes; }
async function reserve(f, bytes, extra = {}) {
  const response = await f.service.handle(request('uploads', { kind: 'cover', targetId: 10, expectedRevision: revision, mimeType: 'image/png', fileName: 'approved.png', size: bytes.length, sha256: sha256(bytes), ...extra }), f.context);
  assert.equal(response.status, 201); return (await response.json()).upload;
}
async function chunks(f, upload, bytes) {
  for (let index = 0; index < upload.chunks; index++) {
    const result = await f.service.handle(request(`uploads/${upload.id}/chunks/${index}`, bytes.subarray(index * upload.chunkSize, (index + 1) * upload.chunkSize), 'application/octet-stream'), f.context);
    assert.equal(result.status, 200);
  }
}
async function complete(f, upload) { return f.service.handle(request(`uploads/${upload.id}/complete`, {}), f.context); }

test('large cover survives independent SDK objects, immutable replay and exact preview hydration', async () => {
  const f = fixture(), bytes = png(), upload = await reserve(f, bytes);
  assert.equal(upload.chunkSize, TRANSFER_CHUNK_BYTES); assert.equal(upload.chunks, 2);
  await chunks(f, upload, bytes);
  await chunks(f, upload, bytes); // Identical replay cannot replace bytes.
  const changed = Buffer.from(bytes.subarray(0, TRANSFER_CHUNK_BYTES)); changed[42]++;
  await rejectsCode(f.service.handle(request(`uploads/${upload.id}/chunks/0`, changed, 'application/octet-stream'), f.context), 'transfer_chunk_conflict');
  assert.equal((await (await complete(f, upload)).json()).upload.complete, true);
  f.service = new TransferService(f.config, new Store(f.config));
  const input = [{ action: 'cover', targetId: 10, expectedRevision: revision, uploadId: upload.id, mimeType: 'image/png', fileName: 'approved.png' }];
  const hydrated = await f.service.hydrateCommands(f.context, input);
  assert.deepEqual(Buffer.from(hydrated[0].bytesBase64, 'base64'), bytes);
  assert.equal(hydrated[0].uploadId, undefined); assert.equal(input[0].uploadId, upload.id);
  await rejectsCode(f.service.hydrateCommands(f.context, [{ ...input[0], fileName: 'changed.png' }]), 'transfer_target_mismatch');
  await rejectsCode(f.service.hydrateCommands(f.context, [{ ...input[0], targetId: 12 }]), 'transfer_target_mismatch');
  await rejectsCode(f.service.hydrateCommands(f.context, [{ ...input[0], expectedRevision: 'sha256:' + 'c'.repeat(64) }]), 'transfer_target_mismatch');
  assert.ok(f.trace.some(op => op.target === 10 && op.action === 'cover'));
});

test('principal, fresh scope, revision and current exact target permissions gate every upload phase', async () => {
  const f = fixture(), bytes = png(20), upload = await reserve(f, bytes);
  await rejectsCode(f.service.loadUpload({ ...f.context, principal: 'grant:' + randomUUID() }, upload.id, { kind: 'cover', targetId: 10 }), 'transfer_unavailable');
  await rejectsCode(f.service.handle(request(`uploads/${upload.id}/chunks/0`, bytes, 'application/octet-stream'), { ...f.context, scopes: [] }), 'scope_denied');
  f.state.changed = true;
  await rejectsCode(chunks(f, upload, bytes), 'revision_conflict'); f.state.changed = false;
  f.state.denied = true;
  await rejectsCode(chunks(f, upload, bytes), 'permission_denied'); f.state.denied = false;
  f.state.revoked = true;
  await rejectsCode(chunks(f, upload, bytes), 'credential_revoked'); f.state.revoked = false;
  await chunks(f, upload, bytes); await complete(f, upload);
  const commands = [{ action: 'metadata', targetId: 10, expectedRevision: revision, proposal: { fields: {} }, cover: { uploadId: upload.id, mimeType: 'image/png', fileName: 'approved.png' } }];
  assert.deepEqual(Buffer.from((await f.service.hydrateCommands(f.context, commands))[0].cover.bytesBase64, 'base64'), bytes);
  f.state.denied = true;
  await rejectsCode(f.service.loadUpload(f.context, upload.id, { kind: 'cover', targetId: 10 }), 'permission_denied');
});

test('completion verifies all reserved sizes, complete SHA-256 and cover or ZIP signatures', async () => {
  const f = fixture(), bytes = png(), upload = await reserve(f, bytes);
  await rejectsCode(complete(f, upload), 'transfer_incomplete');
  await rejectsCode(f.service.handle(request(`uploads/${upload.id}/chunks/0`, Buffer.alloc(5), 'application/octet-stream'), f.context), 'invalid_transfer_chunk');
  await chunks(f, upload, bytes); await complete(f, upload);
  await rejectsCode(f.service.handle(request(`uploads/${upload.id}/chunks/00`, bytes, 'application/octet-stream'), f.context), 'invalid_transfer_chunk');
  const invalid = png(20); invalid[0] = 0;
  const invalidUpload = await reserve(f, invalid); await chunks(f, invalidUpload, invalid);
  await rejectsCode(complete(f, invalidUpload), 'invalid_cover');
  const mismatch = await reserve(f, png(20), { sha256: 'f'.repeat(64) }); await chunks(f, mismatch, png(20));
  await rejectsCode(complete(f, mismatch), 'transfer_integrity');
  const zip = Buffer.from([80,75,3,4,1,2]), archive = await reserve(f, zip, { kind: 'zip', targetId: 20, mimeType: 'application/zip', fileName: 'timeline.zip' });
  await chunks(f, archive, zip); await complete(f, archive);
  assert.deepEqual(await f.service.loadUpload(f.context, archive.id, { kind: 'zip', targetId: 20 }), zip);
  assert.ok(f.trace.some(op => op.target === 20 && op.action === 'create' && op.type === 'TimelineEntry'));
  await rejectsCode(reserve(f, zip, { kind: 'zip', targetId: 10, mimeType: 'application/zip' }), 'invalid_transfer_target');
});

test('upload limits, generated IDs and immutable complete chunks fail closed', async () => {
  const f = fixture(), bytes = png(20), upload = await reserve(f, bytes);
  await rejectsCode(reserve(f, bytes, { size: 10 * 1024 * 1024 + 1 }), 'transfer_limit');
  await rejectsCode(reserve(f, bytes, { kind: 'zip', size: 64 * 1024 * 1024 + 1 }), 'transfer_limit');
  await rejectsCode(reserve(f, bytes, { unexpected: true }), 'invalid_transfer');
  await rejectsCode(f.service.handle(request('uploads/not-uuid/complete', {}), f.context), 'invalid_transfer_id');
  await chunks(f, upload, bytes); await complete(f, upload);
  await chunks(f, upload, bytes);
  const changed = Buffer.from(bytes); changed[9]++;
  await rejectsCode(chunks(f, upload, changed), 'transfer_chunk_conflict');
  const key = f.service.key('uploads', f.context.principal, upload.id), record = await f.store.blobs.getWithMetadata(key, { type: 'json' });
  await f.store.blobs.setJSON(key, { ...record.data, expires: Date.now() - 1 }, { onlyIfMatch: record.etag });
  await rejectsCode(complete(f, upload), 'transfer_expired');
  const unsupported = [{ action: 'unsupported', uploadId: 'not-an-upload', field: 'untouched' }];
  assert.deepEqual(await f.service.hydrateCommands(f.context, unsupported), unsupported);
});

test('private large downloads retain exact bytes and recheck every original read target after ACL changes', async () => {
  const f = fixture(), bytes = png();
  const response = await f.service.prepareResponse({ status: 200, body: bytes, headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="timeline.zip"', 'Authorization': 'must-not-leak', 'Set-Cookie': 'must-not-leak' }, readTargets: [20,10,11] }, f.context);
  const { download } = await response.json();
  assert.equal(download.size, bytes.length); assert.equal(download.sha256, sha256(bytes));
  assert.equal(JSON.stringify(download).includes('must-not-leak'), false);
  assert.equal(download.readTargets, undefined);
  const read = (context, index) => f.service.handle(request(`downloads/${download.id}/chunks/${index}`, undefined, undefined, 'GET'), context);
  const parts = [];
  for (let index = 0; index < download.chunks; index++) parts.push(Buffer.from(await (await read(f.context, index)).arrayBuffer()));
  assert.deepEqual(Buffer.concat(parts), bytes);
  await rejectsCode(read({ ...f.context, principal: 'grant:' + randomUUID() }, 0), 'transfer_unavailable');
  f.state.deniedId = 11;
  await rejectsCode(read(f.context, 1), 'permission_denied'); f.state.deniedId = 0;
  f.state.revoked = true;
  await rejectsCode(read(f.context, 0), 'credential_revoked');
});

test('storage timeouts are typed, bounded and cannot acknowledge completion', async () => {
  const f = fixture();
  f.service = new TransferService({ transferTimeoutMs: 5 }, { prefix: f.store.prefix, blobs: { getWithMetadata: () => new Promise(() => {}) } });
  await rejectsCode(f.service.loadUpload(f.context, randomUUID(), { kind: 'cover', targetId: 10 }), 'transfer_timeout');
});

test('logical plan expansion rejects individually valid staged covers before reading any binary chunks', async () => {
  const f = fixture(), bytes = png(10 * 1024 * 1024);
  const first = await reserve(f, bytes), second = await reserve(f, bytes, { targetId: 11 });
  await chunks(f, first, bytes); await complete(f, first);
  await chunks(f, second, bytes); await complete(f, second);
  const commands = [
    { action: 'cover', targetId: 10, expectedRevision: revision, uploadId: first.id, mimeType: 'image/png', fileName: 'approved.png' },
    { action: 'metadata', targetId: 11, expectedRevision: revision, proposal: { fields: { Description: 'Accepted ordinary metadata' } }, cover: { uploadId: second.id, mimeType: 'image/png', fileName: 'approved.png' } },
  ];
  assert.ok(Buffer.byteLength(JSON.stringify({ commands })) < 4 * 1024 * 1024);
  assert.equal(TRANSFER_PLAN_JSON_BYTES, 20 * 1024 * 1024);
  const originalRead = f.service.read.bind(f.service); let binaryReads = 0, repositoryWrites = 0;
  f.service.read = async (key, type) => { if (type === 'arrayBuffer') binaryReads++; return originalRead(key, type); };
  f.context.repo.write = async () => { repositoryWrites++; throw new Error('Staging cannot mutate repository content.'); };
  await assert.rejects(f.service.hydrateCommands(f.context, commands), error => error.code === 'plan_input_limit' && error.status === 413);
  assert.equal(binaryReads, 0); assert.equal(repositoryWrites, 0);
  assert.ok(f.trace.some(op => op.target === 10 && op.action === 'cover'));
  assert.ok(f.trace.some(op => op.target === 11 && op.action === 'cover'));
  f.state.deniedId = 11;
  await rejectsCode(f.service.hydrateCommands(f.context, commands), 'permission_denied');
  assert.equal(binaryReads, 0); f.state.deniedId = 0;
  const hydrated = await f.service.hydrateCommands(f.context, [commands[0]]);
  assert.equal(sha256(Buffer.from(hydrated[0].bytesBase64, 'base64')), sha256(bytes));
  assert.ok(Buffer.byteLength(JSON.stringify({ commands: hydrated })) < TRANSFER_PLAN_JSON_BYTES);
  assert.equal(binaryReads, 5); assert.equal(repositoryWrites, 0);
});

test('owned staging preserves the full 10 MiB cover and 64 MiB ZIP envelopes for later domain validation', async () => {
  const f = fixture(), cover = png(10 * 1024 * 1024), coverUpload = await reserve(f, cover);
  assert.equal(coverUpload.chunks, 5); await chunks(f, coverUpload, cover); await complete(f, coverUpload);
  assert.equal(sha256(await f.service.loadUpload(f.context, coverUpload.id, { kind: 'cover', targetId: 10 })), sha256(cover));
  // Staging verifies the transport signature/hash; archive contents still belong to domain preflight.
  const archive = Buffer.alloc(64 * 1024 * 1024, 21); Buffer.from([80,75,3,4]).copy(archive);
  const zipUpload = await reserve(f, archive, { kind: 'zip', targetId: 20, mimeType: 'application/zip', fileName: 'timeline.zip' });
  assert.equal(zipUpload.chunks, 32); await chunks(f, zipUpload, archive); await complete(f, zipUpload);
  assert.equal(sha256(await f.service.loadUpload(f.context, zipUpload.id, { kind: 'zip', targetId: 20 })), sha256(archive));
});
