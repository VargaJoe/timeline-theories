import { createHash, randomUUID } from 'node:crypto';
import { DomainError, assertId, assertObject } from '../domain/content.mjs';
import { decodeCover, requireScope, revision } from './plans.mjs';
import { hash, stableJson } from './store.mjs';

// Buffered Netlify Functions have a 6 MB wire limit, including base64 overhead.
export const TRANSFER_CHUNK_BYTES = 2 * 1024 * 1024;
export const TRANSFER_INLINE_BYTES = 3 * 1024 * 1024;
export const TRANSFER_JSON_BYTES = 4 * 1024 * 1024;
export const TRANSFER_PLAN_JSON_BYTES = 20 * 1024 * 1024;
const MAX_BYTES = { cover: 10 * 1024 * 1024, zip: 64 * 1024 * 1024 };
const LIFETIME = 15 * 60 * 1000;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code, message, status = 400) => { throw new DomainError(code, message, status); };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const safeHeaders = input => {
  const allowed = ['content-type', 'content-disposition', 'x-skipped-images', 'x-timeline-skipped-images', 'x-timeline-skipped-covers'];
  const headers = new Headers(input);
  return Object.fromEntries(allowed.filter(name => headers.has(name)).map(name => [name, headers.get(name)]));
};
function assertGeneratedId(id) {
  if (typeof id !== 'string' || !uuid.test(id)) fail('invalid_transfer_id', 'Transfer ID must be a generated UUID4.');
  return id.toLowerCase();
}
function fileName(value, fallback) {
  const name = value ?? fallback;
  if (typeof name !== 'string' || !name.trim() || name.length > 100 || /[\\/"\r\n\x00]/.test(name)) fail('invalid_transfer', 'Transfer file name is invalid.');
  return name;
}
async function boundedBody(request, maximum) {
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) fail('transfer_limit', 'Transfer body exceeds the wire byte limit.', 413);
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); fail('transfer_limit', 'Transfer body exceeds the wire byte limit.', 413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}
async function readJson(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) fail('invalid_transfer', 'Transfer control requests require JSON.');
  try { return JSON.parse((await boundedBody(request, 16384)).toString()); }
  catch (error) { if (error instanceof DomainError) throw error; fail('invalid_transfer', 'Transfer JSON is invalid.'); }
}

/** Private staging inside the one Netlify application. No method writes to the repository. */
export class TransferService {
  constructor(config, store) { this.config = config; this.store = store; }
  key(kind, principal, id, suffix = 'manifest') {
    if (typeof principal !== 'string' || !principal || principal.length > 256) fail('invalid_principal', 'A bounded transfer principal is required.');
    return this.store.prefix + `transfers/${kind}/${hash({ principal, id: assertGeneratedId(id) })}/${suffix}`;
  }
  async storage(operation) {
    let timer;
    try { return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => reject(new DomainError('transfer_timeout', 'Private transfer storage timed out; retry the same transfer.', 503)), this.config.transferTimeoutMs || 20000); })]); }
    catch (error) { if (error instanceof DomainError) throw error; throw new DomainError('transfer_storage_unavailable', 'Private transfer storage is unavailable; retry the same transfer.', 503); }
    finally { clearTimeout(timer); }
  }
  read(key, type = 'json') { return this.storage(() => this.store.blobs.getWithMetadata(key, { type, consistency: 'strong' })); }
  async manifest(context, kind, id) {
    const record = await this.read(this.key(kind, context.principal, id));
    if (!record || record.data.principal !== context.principal || record.data.id !== assertGeneratedId(id)) fail('transfer_unavailable', 'Transfer is unavailable for this credential.', 404);
    if (!Number.isSafeInteger(record.data.expires) || record.data.expires <= Date.now()) fail('transfer_expired', 'Transfer expired; preview a new transfer before applying.', 410);
    return record;
  }
  async assertUpload(context, manifest) {
    await context.check();
    requireScope(context, manifest.kind === 'cover' ? 'covers:write' : 'exchange:write');
    const target = await context.repo.read(manifest.targetId, manifest.kind === 'zip' ? { expectedType: 'Timeline' } : {});
    if (target.Id !== manifest.targetId) fail('invalid_transfer_target', 'Transfer target no longer matches.', 403);
    if (manifest.expectedRevision !== undefined && revision(target) !== manifest.expectedRevision) fail('revision_conflict', 'Transfer target changed; reload and preview again.', 409);
    if (manifest.kind === 'cover') {
      if (!['Timeline', 'MediaItem', 'BookMediaItem'].includes(target.Type)) fail('invalid_cover_target', 'This content does not support covers.');
      await context.repo.assertWritableTarget(target);
      await context.repo.assert([{ target: target.Id, action: 'cover' }]);
    } else {
      if (target.Type !== 'Timeline' || !target.Path.startsWith(context.repo.paths.timelines + '/')) fail('invalid_transfer_target', 'ZIP staging needs an actual application timeline.', 403);
      await context.repo.assert([{ target: target.Id, action: 'read' }, { target: target.Id, action: 'create', type: 'TimelineEntry' }]);
    }
    await context.check();
  }
  describe(value) {
    return { id: value.id, size: value.size, sha256: value.sha256, chunkSize: value.chunkSize, chunks: value.chunks, expiresAt: new Date(value.expires).toISOString(), ...(value.complete ? { complete: true } : {}) };
  }
  async init(context, input) {
    assertObject(input);
    if (Object.keys(input).some(key => !['kind','targetId','size','sha256','mimeType','fileName','expectedRevision'].includes(key)) || !Object.hasOwn(MAX_BYTES, input.kind)) fail('invalid_transfer', 'Unsupported transfer input.');
    const targetId = assertId(input.targetId);
    if (!Number.isSafeInteger(input.size) || input.size < 1 || input.size > MAX_BYTES[input.kind] || typeof input.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(input.sha256)) fail('transfer_limit', 'Transfer needs a bounded size and SHA-256 digest.', 413);
    if (input.kind === 'cover' && (!['image/png','image/jpeg','image/webp'].includes(input.mimeType) || typeof input.expectedRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision))) fail('invalid_cover', 'Cover staging requires its MIME type and exact editor revision.');
    if (input.kind === 'zip' && input.mimeType !== undefined && input.mimeType !== 'application/zip') fail('invalid_transfer', 'ZIP staging requires application/zip.');
    if (input.expectedRevision !== undefined && (typeof input.expectedRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision))) fail('invalid_transfer', 'Transfer revision is invalid.');
    const manifest = { id: randomUUID(), principal: context.principal, kind: input.kind, targetId, size: input.size, sha256: input.sha256, mimeType: input.mimeType || 'application/zip', fileName: fileName(input.fileName, input.kind === 'cover' ? 'cover' : 'timeline.zip'), ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }), chunkSize: TRANSFER_CHUNK_BYTES, chunks: Math.ceil(input.size / TRANSFER_CHUNK_BYTES), expires: Date.now() + LIFETIME, complete: false };
    await this.assertUpload(context, manifest);
    const result = await this.storage(() => this.store.blobs.setJSON(this.key('uploads', context.principal, manifest.id), manifest, { onlyIfNew: true }));
    if (!result.modified) fail('transfer_conflict', 'Generated transfer ID already exists.', 409);
    await context.check();
    return json({ upload: this.describe(manifest) }, 201);
  }
  index(index, manifest) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= manifest.chunks) fail('invalid_transfer_chunk', 'Chunk index is outside this transfer.');
    return index;
  }
  chunkSize(index, manifest) { return Math.min(manifest.chunkSize, manifest.size - index * manifest.chunkSize); }
  async putChunk(context, id, index, request) {
    const { data: manifest } = await this.manifest(context, 'uploads', id); this.index(index, manifest);
    await this.assertUpload(context, manifest);
    if (request.headers.get('content-type')?.split(';')[0].toLowerCase() !== 'application/octet-stream') fail('invalid_transfer', 'Chunks require application/octet-stream.');
    const bytes = await boundedBody(request, TRANSFER_CHUNK_BYTES);
    if (bytes.length !== this.chunkSize(index, manifest)) fail('invalid_transfer_chunk', 'Chunk size does not match the reserved transfer.');
    const sha256 = digest(bytes), key = this.key('uploads', context.principal, id, `chunks/${index}`);
    if (manifest.complete) {
      const existing = await this.read(key, 'arrayBuffer');
      if (!existing || digest(Buffer.from(existing.data)) !== sha256) fail('transfer_chunk_conflict', 'Completed transfer bytes cannot be changed.', 409);
    } else {
      const result = await this.storage(() => this.store.blobs.set(key, bytes, { onlyIfNew: true, metadata: { sha256, size: bytes.length } }));
      if (!result.modified) {
        const existing = await this.read(key, 'arrayBuffer');
        if (!existing || Buffer.from(existing.data).length !== bytes.length || digest(Buffer.from(existing.data)) !== sha256) fail('transfer_chunk_conflict', 'This chunk already contains different bytes.', 409);
      }
    }
    await this.assertUpload(context, manifest);
    return json({ uploadId: manifest.id, index, sha256, size: bytes.length });
  }
  async bytes(context, manifest, kind = 'uploads') {
    const chunks = [];
    for (let index = 0; index < manifest.chunks; index++) {
      await context.check();
      const part = await this.read(this.key(kind, context.principal, manifest.id, `chunks/${index}`), 'arrayBuffer');
      if (!part) fail('transfer_incomplete', 'Every reserved chunk is required before completion.', 409);
      const bytes = Buffer.from(part.data);
      if (bytes.length !== this.chunkSize(index, manifest) || digest(bytes) !== part.metadata?.sha256) fail('transfer_integrity', 'Stored chunk failed size or digest verification.', 409);
      chunks.push(bytes);
    }
    const bytes = Buffer.concat(chunks);
    if (bytes.length !== manifest.size || digest(bytes) !== manifest.sha256) fail('transfer_integrity', 'Transfer failed complete size or SHA-256 verification.', 409);
    return bytes;
  }
  validateBytes(manifest, bytes) {
    if (manifest.kind === 'cover') decodeCover({ bytesBase64: bytes.toString('base64'), mimeType: manifest.mimeType, fileName: manifest.fileName });
    else if (bytes.length < 4 || bytes[0] !== 80 || bytes[1] !== 75 || ![[3,4],[5,6],[7,8]].some(([a,b]) => bytes[2] === a && bytes[3] === b)) fail('invalid_archive', 'ZIP signature is invalid.');
  }
  async complete(context, id, input) {
    assertObject(input); if (Object.keys(input).length) fail('invalid_transfer', 'Completion accepts an empty JSON object.');
    const record = await this.manifest(context, 'uploads', id), manifest = record.data;
    await this.assertUpload(context, manifest);
    this.validateBytes(manifest, await this.bytes(context, manifest));
    await this.assertUpload(context, manifest);
    if (!manifest.complete) {
      if (!record.etag) fail('transfer_storage_unavailable', 'Transfer state ETag is unavailable.', 503);
      const completed = { ...manifest, complete: true };
      const result = await this.storage(() => this.store.blobs.setJSON(this.key('uploads', context.principal, id), completed, { onlyIfMatch: record.etag }));
      if (!result.modified) {
        const current = (await this.manifest(context, 'uploads', id)).data;
        if (!current.complete || stableJson(current) !== stableJson(completed)) fail('transfer_conflict', 'Transfer completion changed concurrently.', 409);
      }
      manifest.complete = true;
    }
    return json({ upload: this.describe(manifest) });
  }
  async checkedUpload(context, id, expected) {
    assertObject(expected);
    const { data: manifest } = await this.manifest(context, 'uploads', id);
    if (!manifest.complete) fail('transfer_incomplete', 'Complete the upload before preview.', 409);
    if (manifest.kind !== expected.kind || manifest.targetId !== expected.targetId || ['expectedRevision','mimeType','fileName'].some(key => expected[key] !== undefined && expected[key] !== manifest[key])) fail('transfer_target_mismatch', 'Upload kind, target, revision and file identity must match the reviewed command.', 409);
    if (!Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > MAX_BYTES[manifest.kind]) fail('transfer_integrity', 'Upload manifest size is invalid.', 409);
    await this.assertUpload(context, manifest);
    return manifest;
  }
  async loadUpload(context, id, expected) {
    const manifest = await this.checkedUpload(context, id, expected);
    const bytes = await this.bytes(context, manifest); this.validateBytes(manifest, bytes);
    await this.assertUpload(context, manifest);
    return bytes;
  }
  async hydrateCommands(context, commands) {
    if (!Array.isArray(commands) || commands.length < 1 || commands.length > 5000) return commands; // The domain owns ordinary command validation.
    let logicalBytes = Buffer.byteLength(JSON.stringify({ commands }));
    const withinBudget = () => { if (logicalBytes > TRANSFER_PLAN_JSON_BYTES) fail('plan_input_limit', 'Hydrated plan JSON exceeds the 20 MiB application limit.', 413); };
    withinBudget();
    const staged = [];
    // Preflight the complete expansion using private manifest sizes before any
    // binary chunks are read. Small reference JSON cannot inflate an unbounded plan.
    for (const [index, command] of commands.entries()) {
      if (!command || typeof command !== 'object') continue;
      const cover = command.action === 'cover' ? command : command.action === 'metadata' ? command.cover : null;
      if (!cover || typeof cover !== 'object' || !Object.hasOwn(cover, 'uploadId')) continue;
      if (Object.hasOwn(cover, 'bytesBase64') || typeof cover.mimeType !== 'string' || typeof command.expectedRevision !== 'string') fail('invalid_cover', 'Staged cover needs its exact MIME type, revision and one byte source.');
      const expected = { kind: 'cover', targetId: assertId(command.targetId), expectedRevision: command.expectedRevision, mimeType: cover.mimeType, fileName: cover.fileName || 'cover' };
      const manifest = await this.checkedUpload(context, cover.uploadId, expected);
      // Replace the uploadId key/value with the bytesBase64 key and its exact
      // JSON string size; all ordinary fields and inline covers remain counted.
      logicalBytes += Buffer.byteLength(JSON.stringify('bytesBase64')) - Buffer.byteLength(JSON.stringify('uploadId')) + 4 * Math.ceil(manifest.size / 3) + 2 - Buffer.byteLength(JSON.stringify(cover.uploadId));
      withinBudget(); staged.push({ index, command, cover, expected });
    }
    const hydrated = [...commands];
    for (const { index, command, cover, expected } of staged) {
      // Re-read the immutable completed manifest and current ACL before loading.
      const bytes = await this.loadUpload(context, cover.uploadId, expected);
      const { uploadId: _id, ...inline } = cover;
      inline.bytesBase64 = bytes.toString('base64');
      hydrated[index] = command.action === 'cover' ? inline : { ...command, cover: inline };
    }
    return hydrated;
  }
  async assertDownload(context, manifest) {
    await context.check();
    if (!Array.isArray(manifest.readTargets) || !manifest.readTargets.length || manifest.readTargets.some(id => !Number.isSafeInteger(id) || id < 1)) fail('transfer_integrity', 'Download read targets are unavailable.', 503);
    for (const id of manifest.readTargets) await context.repo.read(id);
    await context.repo.assert(manifest.readTargets.map(target => ({ target, action: 'read' })));
    await context.check();
  }
  async prepareResponse(result, context) {
    const body = Buffer.from(result.body), headers = new Headers(result.headers);
    headers.set('Cache-Control', 'no-store');
    if (body.length <= TRANSFER_INLINE_BYTES) return new Response(body, { status: result.status, headers });
    if (body.length > MAX_BYTES.zip) fail('transfer_limit', 'Download exceeds the application byte limit.', 413);
    const readTargets = [...new Set(result.readTargets || [])];
    const manifest = { id: randomUUID(), principal: context.principal, size: body.length, sha256: digest(body), chunkSize: TRANSFER_CHUNK_BYTES, chunks: Math.ceil(body.length / TRANSFER_CHUNK_BYTES), expires: Date.now() + LIFETIME, status: result.status, headers: safeHeaders(headers), contentType: headers.get('content-type') || 'application/octet-stream', readTargets };
    await this.assertDownload(context, manifest);
    for (let index = 0; index < manifest.chunks; index++) {
      await context.check();
      const bytes = body.subarray(index * TRANSFER_CHUNK_BYTES, (index + 1) * TRANSFER_CHUNK_BYTES);
      const written = await this.storage(() => this.store.blobs.set(this.key('downloads', context.principal, manifest.id, `chunks/${index}`), bytes, { onlyIfNew: true, metadata: { sha256: digest(bytes), size: bytes.length } }));
      if (!written.modified) fail('transfer_conflict', 'Generated download chunk already exists.', 409);
    }
    await this.assertDownload(context, manifest);
    const written = await this.storage(() => this.store.blobs.setJSON(this.key('downloads', context.principal, manifest.id), manifest, { onlyIfNew: true }));
    if (!written.modified) fail('transfer_conflict', 'Generated download ID already exists.', 409);
    return json({ download: { ...this.describe(manifest), contentType: manifest.contentType, status: manifest.status, headers: manifest.headers } }, result.status);
  }
  async downloadChunk(context, id, index) {
    const { data: manifest } = await this.manifest(context, 'downloads', id); this.index(index, manifest);
    await this.assertDownload(context, manifest);
    const part = await this.read(this.key('downloads', context.principal, id, `chunks/${index}`), 'arrayBuffer');
    if (!part) fail('transfer_unavailable', 'Download chunk is unavailable.', 404);
    const bytes = Buffer.from(part.data);
    if (bytes.length !== this.chunkSize(index, manifest) || digest(bytes) !== part.metadata?.sha256) fail('transfer_integrity', 'Download chunk failed integrity verification.', 409);
    await this.assertDownload(context, manifest);
    return new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length), 'X-Content-SHA256': digest(bytes), 'Cache-Control': 'no-store' } });
  }
  async handle(request, context) {
    const route = new URL(request.url).pathname.replace(/^\/(?:api\/v1\/)?/, '').replace(/\/$/, '');
    if (route === 'uploads') {
      if (request.method !== 'POST') fail('method_not_allowed', 'Uploads require POST.', 405);
      return this.init(context, await readJson(request));
    }
    const upload = route.match(/^uploads\/([^/]+)\/(complete|chunks\/(\d+))$/);
    if (upload) {
      assertGeneratedId(upload[1]);
      if (request.method !== 'POST') fail('method_not_allowed', 'Upload operations require POST.', 405);
      if (upload[2] === 'complete') return this.complete(context, upload[1], await readJson(request));
      if (!/^(0|[1-9]\d*)$/.test(upload[3])) fail('invalid_transfer_chunk', 'Chunk index must be canonical.');
      return this.putChunk(context, upload[1], Number(upload[3]), request);
    }
    const download = route.match(/^downloads\/([^/]+)\/chunks\/(\d+)$/);
    if (download) {
      assertGeneratedId(download[1]);
      if (request.method !== 'GET') fail('method_not_allowed', 'Downloads require GET.', 405);
      if (!/^(0|[1-9]\d*)$/.test(download[2])) fail('invalid_transfer_chunk', 'Chunk index must be canonical.');
      return this.downloadChunk(context, download[1], Number(download[2]));
    }
    return null;
  }
}
