import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { DomainError, assertId, assertObject } from '../domain/content.mjs';
import { assertUuid, hash, stableJson } from './store.mjs';
import { storedCoverMime } from './covers.mjs';

export const IMAGE_PROTOCOL = 'timeline-image-assets-v1';
export const IMAGE_STORAGE_NAME = '(images)';
export const IMAGE_LIMITS = Object.freeze({ variantBytes: 1024 * 1024, variants: 3, totalBytes: 3 * 1024 * 1024, manifestBytes: 16384 });
const OWNER_TYPES = new Set(['Timeline', 'MediaItem', 'BookMediaItem']);
const IMAGE_ACTIONS = new Set(['image-draft', 'image-variant', 'image-seal', 'image-delete']);
const TRANSPORT_ERRORS = new Set(['repository_transport', 'repository_timeout', 'repository_limit', 'backend_failure', 'backend_contract']);
const fail = (code, message, status = 400) => { throw new DomainError(code, message, status); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const only = (value, keys) => { assertObject(value); if (Object.keys(value).some(key => !keys.includes(key))) fail('invalid_image_asset', 'Unknown image asset property.'); };
export const isImageMutation = payload => IMAGE_ACTIONS.has(payload?.action);
export function imageOperationId(principal, key, action) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{8,128}$/.test(key)) fail('invalid_idempotency_key', 'Idempotency-Key must contain 8..128 safe characters.');
  const value = hash({ principal, key, action });
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
export function validateImageVariant(value, { withId = true } = {}) {
  only(value, ['id', 'name', 'width', 'height', 'mimeType', 'byteLength', 'sha256']);
  if (withId) assertId(value.id); else if (value.id !== undefined) fail('invalid_image_asset', 'A draft upload does not choose a repository ID.');
  if (!Number.isInteger(value.width) || value.width < 1 || value.width > 4096 || !Number.isInteger(value.height) || value.height < 1 || value.height > 4096 || value.width * value.height > 4 * 1024 * 1024 || value.name !== 'w' + value.width || !/^w[1-9][0-9]{0,3}$/.test(value.name)) fail('invalid_image_asset', 'Variant dimensions or extensionless name are invalid.');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(value.mimeType) || !Number.isSafeInteger(value.byteLength) || value.byteLength < 1 || value.byteLength > IMAGE_LIMITS.variantBytes || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(value.sha256)) fail('invalid_image_asset', 'Variant MIME, size or SHA-256 is invalid.');
  return { ...(withId ? { id: value.id } : {}), name: value.name, width: value.width, height: value.height, mimeType: value.mimeType, byteLength: value.byteLength, sha256: value.sha256 };
}
export function validateImageManifest(value, { draft = false } = {}) {
  only(value, ['schemaVersion', 'kind', 'projectPath', 'ownerId', 'generationId', 'sourceIds', 'sourceStamps', 'recipe', 'variants']);
  assertId(value.ownerId); assertUuid(value.generationId, 'Image generation ID');
  if (value.schemaVersion !== 1 || !['timeline-composite', 'media-sizes'].includes(value.kind) || typeof value.projectPath !== 'string' || !Array.isArray(value.sourceIds) || value.sourceIds.length < 1 || value.sourceIds.length > 4 || new Set(value.sourceIds).size !== value.sourceIds.length) fail('invalid_image_asset', 'Invalid image manifest binding.');
  value.sourceIds.forEach(assertId);
  if (value.kind === 'media-sizes' && (value.sourceIds.length !== 1 || value.sourceIds[0] !== value.ownerId)) fail('invalid_image_asset', 'Media size variants must use exactly their own preserved original image.');
  only(value.recipe, ['template', 'sourceIds', 'seed']);
  const template = value.kind === 'timeline-composite' ? 'poster-strip-v1' : 'media-sizes-v1';
  if (value.recipe.template !== template || stableJson(value.recipe.sourceIds) !== stableJson(value.sourceIds) || value.recipe.seed !== undefined && (!Number.isInteger(value.recipe.seed) || value.recipe.seed < 0 || value.recipe.seed > 2147483647)) fail('invalid_image_asset', 'Recipe must preserve the ordered selected sources.');
  if (!Array.isArray(value.sourceStamps) || value.sourceStamps.length !== value.sourceIds.length) fail('invalid_image_asset', 'Every source requires its original SHA-256.');
  value.sourceStamps.forEach((source, index) => { only(source, ['id', 'stamp']); if (source.id !== value.sourceIds[index] || typeof source.stamp !== 'string' || !/^[0-9a-f]{64}$/.test(source.stamp)) fail('invalid_image_asset', 'Invalid source image stamp.'); });
  if (!Array.isArray(value.variants) || value.variants.length > IMAGE_LIMITS.variants || (draft ? value.variants.length !== 0 : value.variants.length < 1)) fail('invalid_image_asset', 'A draft starts empty; a sealed set requires 1..3 variants.');
  const variants = value.variants.map(item => validateImageVariant(item));
  if (new Set(variants.map(item => item.id)).size !== variants.length || new Set(variants.map(item => item.name)).size !== variants.length || variants.reduce((sum, item) => sum + item.byteLength, 0) > IMAGE_LIMITS.totalBytes || Buffer.byteLength(JSON.stringify(value)) > IMAGE_LIMITS.manifestBytes) fail('invalid_image_asset', 'Variant manifest exceeds its bounds or contains duplicates.');
  return structuredClone({ ...value, variants });
}
export function decodeImageVariant(input, variant) {
  if (typeof input !== 'string' || input.length > 4 * Math.ceil(IMAGE_LIMITS.variantBytes / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input)) fail('invalid_image_asset', 'Supply one bounded canonical base64 image.');
  const bytes = Buffer.from(input, 'base64');
  if (bytes.length !== variant.byteLength || digest(bytes) !== variant.sha256) fail('image_integrity', 'Uploaded bytes do not match the approved variant length and SHA-256.');
  return bytes;
}

const extension = mime => ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[mime];
const fileName = variant => `${variant.name}.${extension(variant.mimeType)}`;
const projection = 'Id,ParentId,Name,Path,Type,IsSystemContent,Description,Version,VersionId,ModificationDate';
function description(value, limit = 20000) {
  if (typeof value !== 'string' || Buffer.byteLength(value) > limit) fail('image_storage_collision', 'Managed image metadata is invalid or foreign.', 409);
  try { return JSON.parse(value); } catch { fail('image_storage_collision', 'Managed image metadata is invalid or foreign.', 409); }
}
const ownerData = owner => Object.fromEntries(Object.entries(owner).filter(([key]) => !['revision', 'image', 'ImageStorageEnabled', 'ImageSelectionStamp', 'ModificationDate', 'ModifiedById', 'Version', 'VersionId'].includes(key)));

/** Signature/dimension checks only. The browser decodes originals and produces
 * raster outputs. Stock Files remain editable through native author tools. */
export function validateImageBytes(bytes, variant) {
  let width, height;
  if (variant.mimeType === 'image/png' && bytes.length >= 33 && bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (variant.mimeType === 'image/webp' && bytes.length >= 25 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length) {
    const kind = bytes.toString('ascii', 12, 16);
    if (kind === 'VP8X' && bytes.length >= 30) { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3); }
    else if (kind === 'VP8L' && bytes[20] === 0x2f) { const value = bytes.readUInt32LE(21); width = 1 + (value & 0x3fff); height = 1 + ((value >>> 14) & 0x3fff); }
    else if (kind === 'VP8 ' && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from('9d012a', 'hex'))) { width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff; }
  } else if (variant.mimeType === 'image/jpeg' && bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length;) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++]; if (marker === 0xda || marker === 0xd9) break;
      if (offset + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(offset); if (size < 2 || offset + size > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && size >= 8) { height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break; }
      offset += size;
    }
  }
  if (width !== variant.width || height !== variant.height || bytes.length !== variant.byteLength || digest(bytes) !== variant.sha256) fail('image_integrity', 'Image signature, dimensions, length or SHA-256 differ from the approved output.');
  return bytes;
}

/** All storage and byte requests use the caller. Published images are static
 * copies governed by their owner's inherited ACL, independent of later source
 * ACL/image changes. Immutability and multi-content CAS are not native promises. */
export class ImageAssets {
  constructor(repo) { this.repo = repo; this.roots = new Map(); }
  async capabilities() { return { supported: true, protocol: IMAGE_PROTOCOL, limits: IMAGE_LIMITS, storage: 'stock-folder-file' }; }
  async requireCapability() { return this.capabilities(); }
  async owner(id, { write = false } = {}) {
    const owner = await this.repo.read(assertId(id), { image: false });
    if (!OWNER_TYPES.has(owner.Type)) fail('invalid_cover_target', 'This content does not support image presentations.');
    await this.repo.assert([{ target: owner.Id, action: write ? 'cover' : 'read' }]); return owner;
  }
  invalidate(id) { this.roots.delete(id); }
  async node(target) { return this.repo.api(target, null, { query: { '$select': projection, metadata: 'no' } }); }
  async storage(owner, { force = false, fresh = false } = {}) {
    if (!force && owner.ImageStorageEnabled === false) return null;
    if (!fresh && this.roots.has(owner.Id)) return this.roots.get(owner.Id);
    let row, name = IMAGE_STORAGE_NAME;
    try { row = await this.node(owner.Path + '/' + name); }
    catch (error) {
      if (error.status !== 404) throw error;
      // Existing published sets remain readable until an explicit preserving
      // migration. Never rename or move content as a side effect of reading it.
      name = '_images';
      try { row = await this.node(owner.Path + '/' + name); } catch (legacyError) { if (legacyError.status === 404) return null; throw legacyError; }
    }
    const canonical = name === IMAGE_STORAGE_NAME;
    if (row.Type !== (canonical ? 'SystemFolder' : 'Folder') || canonical && row.IsSystemContent !== true || row.Name !== name || row.Path !== owner.Path + '/' + name || row.ParentId !== owner.Id) fail('image_storage_collision', 'The reserved image folder belongs to different content.', 409);
    const value = description(row.Description, 2048);
    only(value, ['protocol', 'projectPath', 'ownerId', 'activeSetId', 'generationId', 'selectionRevision']);
    if (value.protocol !== IMAGE_PROTOCOL || value.projectPath !== this.repo.paths.root || value.ownerId !== owner.Id || value.activeSetId !== null && (!Number.isSafeInteger(value.activeSetId) || value.activeSetId < 1) || (value.activeSetId === null) !== (value.generationId === null)) fail('image_storage_collision', 'The reserved image folder has a foreign binding.', 409);
    assertUuid(value.selectionRevision); if (value.generationId !== null) assertUuid(value.generationId);
    const result = { ...row, value }; this.roots.set(owner.Id, result); return result;
  }
  async selection(owner) {
    if (owner.ImageStorageEnabled === false) return { stamp: null, root: null };
    try { const root = await this.storage(owner, { fresh: true }); return { root, stamp: root ? hash({ id: root.Id, description: root.Description }) : null }; }
    catch (error) { if ([400, 403, 404, 409].includes(error.status)) return { stamp: 'blocked', blocked: true }; throw error; }
  }
  async presentation(owner, { recipe = false } = {}) {
    if (recipe) await this.repo.assert([{ target: owner.Id, action: 'cover' }]);
    let root;
    try { root = await this.storage(owner); } catch (error) { if ([400, 403, 404, 409].includes(error.status)) return { state: 'blocked' }; throw error; }
    if (!root?.value.activeSetId) return { state: 'legacy' };
    try {
      const set = await this.set(root.value.activeSetId, owner.Id, { owner, write: false, sources: false, sealed: true });
      if (set.GenerationId !== root.value.generationId) fail('image_storage_collision', 'Active image generation differs from its pointer.', 409);
      await Promise.all(set.manifest.variants.map(variant => this.fileMetadata(set, variant, { binaryAccess: true })));
      if ((await this.storage(owner, { fresh: true }))?.Description !== root.Description) fail('image_unavailable', 'Image selection changed while reading its descriptor.', 409);
      return { state: 'active', setId: set.Id, generationId: set.GenerationId,
        variants: set.manifest.variants.map(({ name, width, height, mimeType, byteLength }) => ({ name, width, height, mimeType, byteLength, url: `/api/v1/images/${owner.Id}/${set.GenerationId}/${name}` })),
        ...(recipe ? { recipe: set.manifest.recipe, sourceStamps: set.manifest.sourceStamps } : {}) };
    } catch (error) { if ([400, 403, 404, 409].includes(error.status)) return { state: error.status === 403 ? 'blocked' : 'missing', setId: root.value.activeSetId }; throw error; }
  }
  boundManifest(input, ownerId, options) {
    const manifest = validateImageManifest(typeof input === 'string' ? description(input) : input, options);
    if (manifest.projectPath !== this.repo.paths.root || manifest.ownerId !== ownerId) fail('image_owner_mismatch', 'Image manifest belongs to a different owner or project.', 403);
    return manifest;
  }
  async set(setId, ownerId, { owner, write = true, sources = true, stamps = false, sealed } = {}) {
    owner ??= await this.owner(ownerId, { write });
    if (write) await this.repo.assert([{ target: owner.Id, action: 'cover' }]);
    const root = await this.storage(owner, { force: true });
    if (!root) fail('image_unavailable', 'The owner has no managed image storage.', 404);
    const row = await this.node(assertId(setId));
    if (row.Type !== 'Folder' || row.ParentId !== root.Id || row.Path !== root.Path + '/' + row.Name) fail('image_owner_mismatch', 'Image generation belongs to a different owner or project.', 403);
    assertUuid(row.Name);
    const value = description(row.Description);
    only(value, ['protocol', 'manifest', 'sealed', 'ownerRevision']);
    if (value.protocol !== IMAGE_PROTOCOL || typeof value.sealed !== 'boolean' || typeof value.ownerRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value.ownerRevision)) fail('image_storage_collision', 'Image generation metadata is foreign.', 409);
    const manifest = this.boundManifest(value.manifest, owner.Id, { draft: !value.sealed });
    this.kind(owner, manifest);
    if (manifest.generationId !== row.Name) fail('image_owner_mismatch', 'Image generation folder and manifest differ.', 403);
    if (sealed !== undefined && value.sealed !== sealed) fail('image_set_state', sealed ? 'Publish requires a completed image set.' : 'This image set is already completed.', 409);
    if (sources) await this.assertSources(manifest, { stamps, publicOwner: write && await this.isPublic(owner) });
    return { ...row, root, owner, manifest, Sealed: value.sealed, GenerationId: row.Name, ownerRevision: value.ownerRevision };
  }
  async assertSources(manifest, { stamps = false, publicOwner = false } = {}) {
    for (const source of manifest.sourceStamps) {
      const row = await this.repo.imageSourceSnapshot(source.id);
      if (!['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(row.CoverImageBin?.ContentType)) fail('image_original_required', 'Upload the original PNG, JPEG or WebP cover to SenseNet before generating variants.');
      if (stamps && digest(await this.repo.coverBytes(source.id, { image: false })) !== source.stamp) fail('image_source_changed', 'A selected original image changed. Generate a new preview.', 409);
      if (publicOwner) {
        try { await this.repo.anonymousRead(source.id, { binary: true }); } catch (error) { if ([401, 403, 404].includes(error.status)) fail('image_source_not_public', 'A public image presentation requires publicly readable original sources.', 403); throw error; }
      }
    }
  }
  kind(owner, manifest) { if (manifest.kind !== (owner.Type === 'Timeline' ? 'timeline-composite' : 'media-sizes')) fail('invalid_image_asset', 'Image generation kind does not match its owner.'); }
  async isPublic(owner) { try { await this.repo.anonymousRead(owner.Id); if (owner.Type === 'Timeline' && owner.IsVisible === false) fail('image_owner_privacy_conflict', 'This private timeline is anonymously readable in SenseNet. Correct its existing access settings before storing generated images.', 403); return true; } catch (error) { if (error.code !== 'image_owner_privacy_conflict' && [401, 403, 404].includes(error.status)) return false; throw error; } }
  async preflight(owner, setId) {
    await this.repo.assert([{ target: owner.Id, action: 'cover' }]);
    if (setId === null) return { setId: null };
    const set = await this.set(assertId(setId), owner.Id, { owner, sealed: true, sources: false });
    await this.assertSources(set.manifest, { stamps: true, publicOwner: await this.isPublic(owner) });
    await this.verifyFiles(set, set.manifest.variants);
    return { setId: set.Id, generationId: set.GenerationId, manifestHash: hash(set.manifest), sourceStamps: set.manifest.sourceStamps };
  }
  async activate(owner, setId) {
    const root = await this.storage(owner, { force: true, fresh: true });
    if (!root) fail('image_unavailable', 'Managed image storage is unavailable.', 404);
    await this.repo.assert([{ target: root.Id, action: 'update' }]);
    const generationId = setId === null ? null : (await this.set(setId, owner.Id, { owner, sealed: true, sources: false })).GenerationId;
    const value = { ...root.value, activeSetId: setId, generationId, selectionRevision: randomUUID() };
    await this.repo.api(root.Id, null, { method: 'PATCH', query: { '$select': 'Id', metadata: 'no' }, body: { Description: JSON.stringify(value) } }); this.invalidate(owner.Id);
  }
  async entries(path, top = 201, parentId) {
    parentId ??= (await this.node(path)).Id;
    return (await this.repo.collection(path, { query: '+ParentId:' + assertId(parentId) + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': projection, '$top': top, '$orderby': 'Id', metadata: 'no' })).results;
  }
  async list(ownerId) {
    const owner = await this.owner(ownerId, { write: true }), root = await this.storage(owner);
    if (!root) return { sets: [], hasMore: false };
    const rows = await this.entries(root.Path, 51, root.Id), sets = [];
    for (const row of rows.slice(0, 50)) {
      const set = await this.set(row.Id, owner.Id, { owner, sources: false });
      let deletable = false; try { await this.deletePreflight(owner, set.Id); deletable = true; } catch (error) { if (![403, 409].includes(error.status)) throw error; }
      sets.push({ setId: set.Id, generationId: set.GenerationId, state: root.value.activeSetId === set.Id ? 'active' : set.Sealed ? 'inactive' : 'draft', deletable });
    }
    return { sets, hasMore: rows.length > 50 };
  }
  async fileMetadata(set, variant, { binaryAccess = false } = {}) {
    const file = await this.node(set.Path + '/' + fileName(variant));
    if (file.Type !== 'File' || file.ParentId !== set.Id || file.Name !== fileName(variant) || file.Path !== set.Path + '/' + fileName(variant) || variant.id !== undefined && file.Id !== variant.id) fail('image_draft_conflict', 'The reserved variant path contains different content.', 409);
    if (binaryAccess) await this.repo.request(this.repo.config.repositoryUrl + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: file.Id, propertyname: 'Binary' }), { method: 'HEAD', maxBytes: 0 });
    return file;
  }
  async file(set, variant) {
    const file = await this.fileMetadata(set, variant);
    const response = await this.repo.request(this.repo.config.repositoryUrl + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: file.Id, propertyname: 'Binary' }), { maxBytes: IMAGE_LIMITS.variantBytes });
    // Stock File may report application/octet-stream for .webp. Infer only
    // this generic case from a supported signature; never relabel a known MIME.
    if (storedCoverMime(response.bytes, response.contentType) !== variant.mimeType) fail('image_integrity', 'Stored image MIME differs from its manifest.', 409);
    validateImageBytes(response.bytes, variant); return { file, bytes: response.bytes };
  }
  async verifyFiles(set, variants) {
    const rows = await this.entries(set.Path, 4, set.Id);
    if (rows.length !== variants.length || rows.some(row => !variants.some(variant => variant.id === row.Id))) fail('image_draft_conflict', 'The image generation contains unexpected or missing files.', 409);
    for (const variant of variants) await this.file(set, variant);
  }
  async readVariant(ownerId, generationId, name) {
    assertUuid(generationId); if (!/^w[1-9][0-9]{0,3}$/.test(name)) fail('invalid_image_asset', 'Invalid variant key.');
    const owner = await this.owner(ownerId), root = await this.storage(owner);
    if (!root?.value.activeSetId || root.value.generationId !== generationId) fail('image_unavailable', 'This is not the current image presentation.', 404);
    const set = await this.set(root.value.activeSetId, ownerId, { owner, write: false, sources: false, sealed: true });
    const variant = set.manifest.variants.find(row => row.name === name); if (!variant) fail('image_unavailable', 'Image size is unavailable.', 404);
    const { bytes } = await this.file(set, variant);
    await this.repo.assert([{ target: owner.Id, action: 'read' }]);
    const after = await this.storage(owner, { fresh: true });
    if (after?.Description !== root.Description) fail('image_unavailable', 'Image selection changed while reading it.', 409);
    return { bytes, contentType: variant.mimeType, readTargets: [owner.Id, variant.id] };
  }
  async deletePreflight(owner, setId) {
    const set = await this.set(setId, owner.Id, { owner, sources: false });
    if (set.root.value.activeSetId === set.Id) fail('image_reference_conflict', 'Clear the active image presentation before deleting this set.', 409);
    const rows = await this.entries(set.Path, 4, set.Id);
    if (rows.length > 3 || rows.some(row => row.Type !== 'File' || row.ParentId !== set.Id || row.Path !== set.Path + '/' + row.Name || !/^w[1-9][0-9]{0,3}\.(png|jpg|webp)$/.test(row.Name))) fail('unexpected_children', 'Only exact managed image files can be deleted.', 409);
    await this.repo.assert([set, ...rows].flatMap(row => [{ target: row.Id, action: 'read' }, { target: row.Id, action: 'delete' }])); return set;
  }
  async managedTree(owner, rows, { deleting = false } = {}) {
    if (!rows.length) return [];
    if (rows.length > 201) fail('target_limit', 'Clean up inactive image generations before deleting this owner.', 413);
    const root = await this.storage(owner, { force: true, fresh: true });
    if (!root || !rows.some(row => row.Id === root.Id && row.ParentId === owner.Id)) fail('unexpected_children', 'The owner contains unsupported descendants.', 409);
    const generations = new Map(), result = [];
    for (const row of rows.filter(row => row.ParentId === root.Id)) {
      const set = await this.set(row.Id, owner.Id, { owner, write: false, sources: false }); generations.set(set.Id, set);
    }
    for (const summary of rows) {
      const row = await this.node(summary.Id);
      if (row.Id === root.Id) { if (row.Path !== root.Path || row.Type !== root.Type || root.Type === 'SystemFolder' && row.IsSystemContent !== true) fail('unexpected_children', 'Managed image root changed.', 409); }
      else if (generations.has(row.Id)) { if (row.Path !== generations.get(row.Id).Path) fail('unexpected_children', 'Managed image generation changed.', 409); }
      else {
        const set = generations.get(row.ParentId);
        if (!set || row.Type !== 'File' || row.Path !== set.Path + '/' + row.Name || !/^w[1-9][0-9]{0,3}\.(png|jpg|webp)$/.test(row.Name) || rows.filter(item => item.ParentId === set.Id).length > 3) fail('unexpected_children', 'The owner contains unmanaged image descendants.', 409);
      }
      await this.repo.assert([{ target: row.Id, action: 'read' }, ...(deleting ? [{ target: row.Id, action: 'delete' }] : [])]);
      result.push({ id: row.Id, revision: hash(row) });
    }
    return result.sort((a, b) => a.id - b.id);
  }
  async ensureStorage(owner, onDispatch) {
    let root = await this.storage(owner, { force: true }); if (root) return root;
    await this.addNew(owner.Id);
    // SystemFolder is a stock special type, but its CTD must still be visible
    // to this caller. Refuse before changing any owner child-type settings.
    await this.repo.assert([{ target: owner.Id, action: 'create', type: 'SystemFolder' }]);
    const before = hash(ownerData(owner));
    const ownerOriginal = owner.CoverImageBin?.ContentType ? digest(await this.repo.coverBytes(owner.Id, { image: false })) : null;
    const allowed = await this.repo.api(owner.Id, 'EffectiveAllowedChildTypes', { query: { '$select': 'Name', metadata: 'no' } });
    if (!Array.isArray(allowed?.results)) fail('backend_contract', 'The owner child-type settings are unavailable.', 502);
    const names = [...new Set([...allowed.results.map(row => row.Name), 'Folder', 'File'])];
    if (!owner.ImageStorageEnabled) await this.repo.api(owner.Id, null, { method: 'PATCH', query: { '$select': 'Id', metadata: 'no' }, body: { AllowedChildTypes: names }, onDispatch });
    const after = await this.repo.read(owner.Id, { image: false });
    if (!after.ImageStorageEnabled || hash(ownerData(after)) !== before || ownerOriginal !== null && digest(await this.repo.coverBytes(owner.Id, { image: false })) !== ownerOriginal) fail('revision_conflict', 'Owner content changed during image storage setup.', 409);
    const value = { protocol: IMAGE_PROTOCOL, projectPath: this.repo.paths.root, ownerId: owner.Id, activeSetId: null, generationId: null, selectionRevision: randomUUID() };
    await this.repo.api(owner.Id, null, { method: 'POST', query: { '$select': 'Id', metadata: 'no' }, body: { __ContentType: 'SystemFolder', Name: IMAGE_STORAGE_NAME, AllowedChildTypes: ['Folder', 'File'], Description: JSON.stringify(value) }, onDispatch });
    this.invalidate(owner.Id); root = await this.storage(after, { force: true, fresh: true }); return root;
  }
  async before(payload) {
    const owner = await this.owner(payload.targetId, { write: true });
    if (payload.action === 'image-draft') {
      this.kind(owner, payload.manifest);
      this.repo.revisionMatches(owner, payload.expectedRevision);
      const root = await this.storage(owner, { force: true });
      await this.addNew(root?.Id ?? owner.Id);
      await this.assertSources(payload.manifest, { stamps: true, publicOwner: await this.isPublic(owner) });
      if (root) { try { await this.node(root.Path + '/' + payload.generationId); fail('image_generation_exists', 'Resume the original generation request.', 409); } catch (error) { if (error.status !== 404) throw error; } }
      return { owner };
    }
    if (payload.action === 'image-delete') return { setId: (await this.deletePreflight(owner, payload.setId)).Id };
    const set = await this.set(payload.setId, owner.Id, { owner, sealed: false });
    if (payload.action === 'image-seal') await this.assertSources(set.manifest, { stamps: true, publicOwner: await this.isPublic(owner) });
    return { setId: set.Id, manifest: set.manifest, sealed: set.Sealed };
  }
  async addNew(id) { if (await this.repo.api(id, 'HasPermission', { query: { permissions: 'AddNew' } }) !== true) fail('permission_denied', 'The caller cannot create managed image storage here.', 403); }
  async write(payload, transient) {
    if (!isImageMutation(payload)) fail('invalid_operation', 'Invalid image mutation.');
    let dispatched = false, acknowledged = false; const onDispatch = () => { dispatched = true; };
    try {
      if (payload.action === 'image-draft') {
        const owner = await this.owner(payload.targetId, { write: true }); this.repo.revisionMatches(owner, payload.expectedRevision);
        await this.assertSources(payload.manifest, { stamps: true, publicOwner: await this.isPublic(owner) });
        const root = await this.ensureStorage(owner, onDispatch);
        const current = await this.owner(owner.Id, { write: true });
        if (hash(ownerData(current)) !== hash(ownerData(owner))) fail('revision_conflict', 'Owner content changed while preparing the image draft.', 409);
        await this.repo.assert([{ target: root.Id, action: 'create', type: 'Folder' }]);
        const value = { protocol: IMAGE_PROTOCOL, manifest: payload.manifest, sealed: false, ownerRevision: current.revision };
        await this.repo.api(root.Id, null, { method: 'POST', query: { '$select': 'Id', metadata: 'no' }, body: { __ContentType: 'Folder', Name: payload.generationId, Description: JSON.stringify(value) }, onDispatch }); acknowledged = true;
        return { ok: true, result: await this.draftResult(payload) };
      }
      if (payload.action === 'image-delete') {
        const owner = await this.owner(payload.targetId, { write: true }), set = await this.deletePreflight(owner, payload.setId);
        await this.repo.api(set.Id, null, { method: 'DELETE', query: { permanent: 'true' }, onDispatch }); acknowledged = true;
        return { ok: true, result: { id: owner.Id, setId: set.Id, deleted: true } };
      }
      const set = await this.set(payload.setId, payload.targetId, { sealed: false });
      if (hash(set.manifest) !== payload.manifestHash) fail('image_draft_changed', 'Draft metadata changed since the request was saved.', 409);
      await this.repo.assert([{ target: set.Id, action: 'update' }]);
      if (payload.action === 'image-variant') {
        if (!Buffer.isBuffer(transient?.bytes)) fail('image_integrity', 'Transient image bytes are unavailable.'); validateImageBytes(transient.bytes, payload.variant);
        await this.repo.assert([{ target: set.Id, action: 'create', type: 'File' }]);
        const currentFiles = await this.entries(set.Path, 4, set.Id);
        if (currentFiles.length >= 3 || currentFiles.some(row => row.Name.startsWith(payload.variant.name + '.'))) fail('image_variant_exists', 'This draft already contains that size or its maximum file count.', 409);
        try { await this.node(set.Path + '/' + fileName(payload.variant)); fail('image_variant_exists', 'This draft already contains that size.', 409); } catch (error) { if (error.status !== 404) throw error; }
        await this.upload(set, payload.variant, transient.bytes, onDispatch); acknowledged = true;
        return { ok: true, result: await this.variantResult(payload) };
      }
      if (payload.action === 'image-seal') {
        const manifest = validateImageManifest({ ...set.manifest, variants: payload.variants });
        await this.assertSources(manifest, { stamps: true, publicOwner: await this.isPublic(set.owner) }); await this.verifyFiles(set, manifest.variants);
        await this.repo.api(set.Id, null, { method: 'PATCH', query: { '$select': 'Id', metadata: 'no' }, body: { Description: JSON.stringify({ protocol: IMAGE_PROTOCOL, manifest, sealed: true, ownerRevision: set.ownerRevision }) }, onDispatch }); acknowledged = true;
        return { ok: true, result: await this.sealResult(payload) };
      }
      fail('invalid_operation', 'Unsupported image mutation.');
    } catch (error) {
      if (acknowledged || dispatched) return { ok: false, code: error.code, status: error.status || 502, message: error.message, uncertain: true, completed: [] };
      if (TRANSPORT_ERRORS.has(error.code)) return { ok: false, code: error.code, status: error.status || 502, message: error.message, uncertain: false, completed: [] };
      throw error;
    }
  }
  async draftResult(payload) {
    const owner = await this.owner(payload.targetId, { write: true }), root = await this.storage(owner, { force: true });
    if (!root) fail('image_unavailable', 'Draft storage is unavailable.', 404);
    const row = await this.node(root.Path + '/' + payload.generationId), set = await this.set(row.Id, owner.Id, { owner, sources: false });
    if (hash({ ...set.manifest, variants: [] }) !== hash(payload.manifest)) fail('image_draft_conflict', 'Generation metadata differs from the saved request.', 409);
    return { id: owner.Id, setId: set.Id, generationId: set.GenerationId, manifest: set.manifest, sealed: set.Sealed, ownerRevision: set.ownerRevision };
  }
  async variantResult(payload) {
    const set = await this.set(payload.setId, payload.targetId, { sources: false }), { file } = await this.file(set, payload.variant);
    return { id: payload.targetId, setId: set.Id, generationId: set.GenerationId, variant: { id: file.Id, ...payload.variant } };
  }
  async sealResult(payload) {
    const set = await this.set(payload.setId, payload.targetId, { sealed: true, sources: false });
    if (hash(set.manifest.variants) !== hash(payload.variants)) fail('image_draft_conflict', 'Completed image metadata differs from the request.', 409);
    await this.verifyFiles(set, payload.variants);
    return { id: payload.targetId, setId: set.Id, generationId: set.GenerationId, manifest: set.manifest, sealed: true };
  }
  async reconcile(payload) {
    try {
      if (payload.action === 'image-delete') {
        const owner = await this.owner(payload.targetId, { write: true });
        // A missing/renamed storage root is not evidence that this exact set
        // was deleted. Observe the saved target ID before checking its binding.
        try { await this.node(payload.setId); } catch (error) { if (error.status === 404) return { id: owner.Id, setId: payload.setId, deleted: true, reconciled: true }; throw error; }
        await this.set(payload.setId, owner.Id, { owner, sources: false });
        fail('uncertain_image_mutation', 'The generation deletion is unconfirmed.', 409);
      }
      const value = payload.action === 'image-draft' ? await this.draftResult(payload) : payload.action === 'image-variant' ? await this.variantResult(payload) : await this.sealResult(payload);
      return { ...value, reconciled: true };
    } catch (error) { if ([404, 409].includes(error.status)) throw new DomainError('uncertain_image_mutation', 'Image completion is unconfirmed. No image bytes are retained or redispatched.', 409, { uncertain: true }); throw error; }
  }
  async upload(set, variant, bytes, onDispatch) {
    const boundary = 'timeline-image-' + randomBytes(16).toString('hex'), chunks = [], name = fileName(variant);
    for (const [key, value] of Object.entries({ ChunkToken: '0*0*False*False', FileName: name, Overwrite: 'false', PropertyName: 'Binary', FileLength: bytes.length, ContentType: 'File' })) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\nContent-Type: ${variant.mimeType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    await this.repo.request(this.repo.endpoint(set.Id) + '/Upload', { method: 'POST', body: Buffer.concat(chunks), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }, onDispatch });
  }
}
