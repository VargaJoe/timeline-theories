import { createHash, randomBytes } from 'node:crypto';
import { DomainError, assertId, assertObject } from '../domain/content.mjs';
import { assertUuid, hash, stableJson } from './store.mjs';

export const IMAGE_PROTOCOL = 'timeline-image-assets-v1';
export const IMAGE_LIMITS = Object.freeze({ variantBytes: 1024 * 1024, variants: 3, totalBytes: 3 * 1024 * 1024, manifestBytes: 16384 });
const OWNER_TYPES = new Set(['Timeline', 'MediaItem', 'BookMediaItem']);
const IMAGE_ACTIONS = new Set(['image-draft', 'image-variant', 'image-seal', 'image-delete']);
const TRANSPORT_ERRORS = new Set(['repository_transport', 'repository_timeout', 'repository_limit', 'backend_failure', 'backend_contract']);
const fail = (code, message, status = 400) => { throw new DomainError(code, message, status); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const only = (value, keys) => { assertObject(value); if (Object.keys(value).some(key => !keys.includes(key))) fail('invalid_image_asset', 'Unknown image asset property.'); };
const ids = value => (Array.isArray(value) ? value : value?.results || (value == null ? [] : [value])).map(item => assertId(typeof item === 'number' ? item : item?.Id));
export const isImageMutation = payload => IMAGE_ACTIONS.has(payload?.action);
// Only exact messages owned by the registered image extension are normalized.
// A generic repository/server error remains transport uncertainty.
export function classifyNativeImageFailure(exceptionType, message) {
  if (/^(?:System\.)?InvalidOperationException$/.test(exceptionType) && message === 'M0 image owner revision conflict.') return { status: 409, code: 'revision_conflict' };
  if (/^(?:SenseNet\.Security\.)?SenseNetSecurityException$/.test(exceptionType) && message === 'M0 image generation source has changed; regenerate the cover.') return { status: 409, code: 'image_source_changed' };
  if (/^(?:System\.)?InvalidOperationException$/.test(exceptionType) && /^M0 image asset binding or manifest is invalid \([A-Za-z0-9_]+:\d+\)\.$/.test(message)) return { status: 400, code: 'invalid_image_asset' };
  return null;
}

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
  if (!Array.isArray(value.sourceStamps) || value.sourceStamps.length !== value.sourceIds.length) fail('invalid_image_asset', 'Every source requires its native image stamp.');
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

/** Every request uses this repository's caller credential. Inventory/admin is never consulted. */
export class ImageAssets {
  constructor(repo) { this.repo = repo; this.sets = new Map(); this.sourceChecks = new Set(); this.draftOwners = new Map(); }
  async capabilities() {
    this.capabilityResult ??= this.loadCapabilities();
    return this.capabilityResult;
  }
  async loadCapabilities() {
    try {
      const value = await this.repo.api(this.repo.paths.root, 'ImageAssetCapabilities');
      return value?.protocol === IMAGE_PROTOCOL && value.supported === true ? { supported: true, protocol: IMAGE_PROTOCOL, limits: IMAGE_LIMITS } : { supported: false, protocol: IMAGE_PROTOCOL };
    } catch (error) { if ([403, 404].includes(error.status) || ['backend_failure', 'invalid_image_asset'].includes(error.code)) return { supported: false, protocol: IMAGE_PROTOCOL }; throw error; }
  }
  async requireCapability() { if (!(await this.capabilities()).supported) fail('image_backend_unavailable', 'This repository has not advertised the guarded image asset protocol.', 503); }
  async owner(id, { write = false } = {}) {
    const owner = await this.repo.read(assertId(id), { image: false });
    if (!OWNER_TYPES.has(owner.Type)) fail('invalid_cover_target', 'This content does not support image presentations.');
    await this.repo.assert([{ target: owner.Id, action: write ? 'cover' : 'read' }]);
    return owner;
  }
  async nativePresentation(owner) {
    const value = await this.repo.api(owner.Id, 'GetImagePresentation');
    if (!value || !['legacy', 'active', 'stale', 'blocked', 'missing'].includes(value.state)) fail('image_backend_contract', 'Invalid native image presentation.', 502);
    if (value.setId != null) assertId(value.setId);
    if (value.imageStamp != null && !/^[0-9a-f]{64}$/.test(value.imageStamp)) fail('image_backend_contract', 'Invalid native source image stamp.', 502);
    return value;
  }
  async presentation(owner, { recipe = false, guardOnly = false } = {}) {
    if (!OWNER_TYPES.has(owner.Type)) return { state: 'legacy' };
    if (recipe) await this.repo.assert([{ target: owner.Id, action: 'cover' }]);
    if (!(await this.capabilities()).supported) {
      // A schema with an existing reference cannot silently fall through to
      // legacy originals when the guarding extension is unavailable.
      const reference = owner.CoverImageSet;
      const selected = Array.isArray(reference) ? reference.length > 0 : reference && (!Array.isArray(reference.results) || reference.results.length > 0);
      return { state: selected ? 'missing' : 'legacy' };
    }
    let native;
    try { native = await this.nativePresentation(owner); }
    catch (error) {
      if (![403, 404].includes(error.status)) throw error;
      // Owner Open already succeeded. A source/set denial is a placeholder,
      // so one protected image cannot make the whole public content list fail.
      return { state: 'blocked' };
    }
    const ownerGuard = native.ownerGuard;
    if (!ownerGuard || typeof ownerGuard.version !== 'string' || !ownerGuard.version || typeof ownerGuard.modificationDate !== 'string' || !Number.isFinite(Date.parse(ownerGuard.modificationDate)) || typeof ownerGuard.token !== 'string' || !/^[0-9]{1,20}$/.test(ownerGuard.token) || ownerGuard.versionId !== undefined && (!Number.isSafeInteger(ownerGuard.versionId) || ownerGuard.versionId < 1)) fail('image_backend_contract', 'Native owner revision guard is unavailable.', 502);
    const result = { state: native.state, ownerGuard: structuredClone(ownerGuard), ...(native.setId ? { setId: native.setId } : {}), ...(native.generationId ? { generationId: assertUuid(native.generationId) } : {}), ...(native.imageStamp ? { imageStamp: native.imageStamp } : {}) };
    if (guardOnly) return result;
    if (native.state === 'active' || native.state === 'stale' && recipe && native.manifest !== undefined) {
      let manifest;
      try { manifest = this.boundManifest(native.manifest, owner.Id); }
      catch (error) {
        if (!['invalid_image_asset', 'invalid_input', 'invalid_target', 'invalid_id', 'image_backend_contract'].includes(error.code)) throw error;
        // Historical proof manifests did not carry reconstruction/stamp fields.
        // Preserve the reference and display a regeneration placeholder.
        return { ...result, state: 'missing' };
      }
      if (native.generationId !== manifest.generationId || !native.setId) fail('image_backend_contract', 'Image descriptor has inconsistent binding.', 502);
      if (native.state === 'active') result.variants = manifest.variants.map(({ name, width, height, mimeType, byteLength }) => ({ name, width, height, mimeType, byteLength, url: `/api/v1/images/${owner.Id}/${manifest.generationId}/${name}` }));
      if (recipe && this.repo.credential) {
        result.recipe = manifest.recipe; result.sourceStamps = manifest.sourceStamps;
      }
    }
    return result;
  }
  boundManifest(input, ownerId, options) {
    let value = input;
    if (typeof input === 'string') { try { value = JSON.parse(input); } catch { fail('image_backend_contract', 'Invalid native image manifest.', 502); } }
    const manifest = validateImageManifest(value, options);
    if (manifest.ownerId !== ownerId || manifest.projectPath !== this.repo.paths.root) fail('image_owner_mismatch', 'Image set belongs to a different owner or project.', 403);
    return manifest;
  }
  async set(setId, ownerId, { sealed, stamps = true, fresh = false, validateSources = true } = {}) {
    await this.requireCapability();
    assertId(setId); assertId(ownerId);
    const key = `${ownerId}:${setId}`;
    if (!fresh && this.sets.has(key)) {
      const cached = this.sets.get(key);
      if (sealed !== undefined && cached.Sealed !== sealed) fail('image_set_state', sealed ? 'Publish requires a sealed image set.' : 'This image set is already sealed.', 409);
      return cached;
    }
    // This cache carries only one invocation's immutable binding. Native
    // set/file handlers still check current owner Save, source Open/stamps and
    // draft permissions at every write and every byte read; it is no ACL cache.
    await this.repo.assert([{ target: ownerId, action: 'cover' }]);
    const owner = { Id: ownerId };
    const data = await this.repo.api(setId, null, { query: { '$expand': 'OwnerContent,SourceContents', '$select': 'Id,Type,Path,GenerationId,Manifest,Sealed,OwnerContent/Id,SourceContents/Id', metadata: 'no' } });
    if (data.Type !== 'ImageVariantSet' || data.Path !== `${this.repo.paths.root}/ImageAssets/${owner.Id}/${data.GenerationId}` || stableJson(ids(data.OwnerContent)) !== stableJson([owner.Id])) fail('image_owner_mismatch', 'Image set belongs to a different owner or project.', 403);
    const manifest = this.boundManifest(data.Manifest, owner.Id, { draft: !data.Sealed });
    const sourceIds = ids(data.SourceContents);
    if (manifest.generationId !== data.GenerationId || sourceIds.length !== manifest.sourceIds.length || new Set(sourceIds).size !== sourceIds.length || stableJson([...sourceIds].sort((a, b) => a - b)) !== stableJson([...manifest.sourceIds].sort((a, b) => a - b))) fail('image_backend_contract', 'Image set source binding is inconsistent.', 502);
    if (validateSources) await this.assertSources(manifest, { stamps });
    if (sealed !== undefined && data.Sealed !== sealed) fail('image_set_state', sealed ? 'Publish requires a sealed image set.' : 'This image set is already sealed.', 409);
    const result = { ...data, manifest, owner };
    this.sets.set(key, result);
    return result;
  }
  async assertSources(manifest, { stamps = true } = {}) {
    const key = hash({ sources: manifest.sourceStamps, stamps });
    if (this.sourceChecks.has(key)) return;
    for (const source of manifest.sourceStamps) {
      const row = this.repo.imageSourceSnapshot ? await this.repo.imageSourceSnapshot(source.id) : await this.repo.read(source.id, { expectedType: 'MediaItem', image: false });
      if (!this.repo.imageSourceSnapshot) await this.repo.assert([{ target: row.Id, action: 'read' }]);
      if (!['image/png', 'image/jpeg', 'image/webp', 'application/octet-stream'].includes(row.CoverImageBin?.ContentType)) fail('image_original_required', 'Upload the original PNG, JPEG or WebP cover to SenseNet before preparing generated variants.');
      if (stamps) {
        const descriptor = await this.nativePresentation(row);
        if (descriptor.imageStamp !== source.stamp) fail('image_source_changed', 'A selected source image changed. Generate a new image set.', 409);
      }
    }
    this.sourceChecks.add(key);
  }
  async preflight(owner, setId) {
    await this.requireCapability();
    this.guard(owner);
    if (setId === null) return { setId: null };
    const set = await this.set(assertId(setId), owner.Id, { sealed: true });
    return { setId: set.Id, generationId: set.GenerationId, manifestHash: hash(set.manifest), sourceStamps: set.manifest.sourceStamps };
  }
  guard(owner) {
    const value = owner.ImageOwnerGuard;
    if (!value?.token || !value.version || !value.modificationDate) fail('image_backend_contract', 'Snapshot has no exact native owner revision guard.', 503);
    // SenseNet's OData binder auto-coerces ISO-looking JSON strings to dates
    // before converting string parameters, discarding fractional precision.
    return { expectedOwnerToken: value.token, expectedVersion: value.version, expectedModificationDate: 'utc:' + value.modificationDate };
  }
  async list(ownerId) {
    await this.requireCapability();
    const owner = await this.owner(ownerId, { write: true });
    const value = await this.repo.api(owner.Id, 'GetImageAssetSets');
    if (!Array.isArray(value?.sets) || value.sets.length > 50 || typeof value.hasMore !== 'boolean') fail('image_backend_contract', 'Invalid native image set inventory.', 502);
    const sets = value.sets.map(row => {
      assertId(row.setId);
      if (!['draft', 'active', 'inactive', 'stale', 'blocked'].includes(row.state) || typeof row.canDelete !== 'boolean') fail('image_backend_contract', 'Invalid native image set inventory member.', 502);
      return { setId: row.setId, state: row.state, deletable: row.canDelete, ...(row.generationId ? { generationId: assertUuid(row.generationId) } : {}) };
    });
    return { sets, hasMore: value.hasMore };
  }
  async readVariant(ownerId, generationId, name) {
    assertUuid(generationId, 'Image generation ID');
    if (!/^w[1-9][0-9]{0,3}$/.test(name)) fail('invalid_image_asset', 'Invalid image variant name.');
    await this.requireCapability();
    const owner = await this.owner(ownerId), current = await this.nativePresentation(owner);
    if (current.state !== 'active' || current.generationId !== generationId) fail('image_unavailable', 'This is not the current readable image presentation.', 404);
    const manifest = this.boundManifest(current.manifest, owner.Id), variant = manifest.variants.find(item => item.name === name);
    if (!variant) fail('image_unavailable', 'Image variant is unavailable.', 404);
    const response = await this.repo.request(this.repo.config.repositoryUrl + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: variant.id, propertyname: 'Binary' }), { maxBytes: IMAGE_LIMITS.variantBytes });
    if (response.contentType?.split(';')[0] !== variant.mimeType || response.bytes.length !== variant.byteLength || digest(response.bytes) !== variant.sha256) fail('image_integrity', 'Native image bytes differ from the sealed manifest.', 502);
    // Close the owner/source/reference race before releasing bytes. Native binary
    // handler independently checks the same current caller and active generation.
    const after = await this.nativePresentation(await this.owner(owner.Id));
    if (after.state !== 'active' || after.setId !== current.setId || after.generationId !== generationId) fail('image_unavailable', 'Image presentation changed during this read.', 409);
    return { bytes: response.bytes, contentType: variant.mimeType, readTargets: [owner.Id, ...manifest.sourceIds] };
  }
  async before(payload) {
    await this.requireCapability();
    if (payload.action === 'image-draft' || payload.action === 'image-delete') {
      const owner = await this.owner(payload.targetId, { write: true });
      if (payload.action === 'image-draft') {
        this.guard(owner); this.repo.revisionMatches(owner, payload.expectedRevision); await this.assertSources(payload.manifest);
        const path = `${this.repo.paths.root}/ImageAssets/${owner.Id}/${payload.generationId}`;
        try { await this.repo.api(path, null, { query: { '$select': 'Id', metadata: 'no' } }); fail('image_generation_exists', 'This generation already exists. Resume its original saved request or choose a new generation.', 409); }
        catch (error) { if (error.status !== 404) throw error; }
        this.draftOwners.set(payload.operationId, owner);
      }
      return { owner };
    }
    const set = await this.set(payload.setId, payload.targetId, { stamps: payload.action !== 'image-delete' });
    return { setId: set.Id, path: set.Path, manifest: set.manifest, sealed: set.Sealed };
  }
  async write(payload, transient) {
    if (!isImageMutation(payload)) fail('invalid_operation', 'Invalid image mutation.');
    await this.requireCapability();
    let dispatched = false, acknowledged = false;
    const onDispatch = () => { dispatched = true; };
    try {
      if (payload.action === 'image-draft') {
        const owner = this.draftOwners.get(payload.operationId) || await this.owner(payload.targetId, { write: true });
        this.repo.revisionMatches(owner, payload.expectedRevision); await this.assertSources(payload.manifest);
        await this.repo.api(this.repo.paths.root, 'PrepareImageAssetDraft', { method: 'POST', body: { ownerId: owner.Id, generationId: payload.generationId, ...this.guard(owner), manifest: JSON.stringify(payload.manifest) }, onDispatch }); acknowledged = true;
        return { ok: true, result: await this.draftResult(payload) };
      }
      if (payload.action === 'image-delete') {
        const owner = await this.owner(payload.targetId, { write: true });
        await this.repo.api(owner.Id, 'DeleteImageAsset', { method: 'POST', body: { setId: payload.setId }, onDispatch }); acknowledged = true;
        return { ok: true, result: { id: owner.Id, setId: payload.setId, deleted: true } };
      }
      const set = await this.set(payload.setId, payload.targetId, { sealed: false });
      if (hash(set.manifest) !== payload.manifestHash) fail('image_draft_changed', 'Draft manifest changed since the request was saved.', 409);
      await this.repo.assert([{ target: set.Id, action: 'update' }]);
      if (payload.action === 'image-variant') {
        if (!Buffer.isBuffer(transient?.bytes) || transient.bytes.length !== payload.variant.byteLength || digest(transient.bytes) !== payload.variant.sha256) fail('image_integrity', 'Transient image bytes are unavailable or invalid.');
        // This fixed native type has one permitted child handler, enforced by
        // its CTD + observer. Keep concrete AddNew/Save, without serializing
        // two redundant type-list operations through the four-source gate.
        if (await this.repo.api(set.Id, 'HasPermission', { query: { permissions: 'AddNew' } }) !== true) fail('permission_denied', 'The caller cannot add an image variant to this draft.', 403);
        // Immutable extensionless names: an existing path is never overwritten.
        try { await this.repo.api(set.Path + '/' + payload.variant.name, null, { query: { '$select': 'Id', metadata: 'no' } }); fail('image_variant_exists', 'This draft already contains that variant name.', 409); } catch (error) { if (error.status !== 404) throw error; }
        await this.upload(set, payload.variant, transient.bytes, onDispatch); acknowledged = true;
        return { ok: true, result: await this.variantResult(payload) };
      }
      if (payload.action === 'image-seal') {
        const manifest = validateImageManifest({ ...set.manifest, variants: payload.variants });
        await this.repo.api(set.Id, null, { method: 'PATCH', body: { Manifest: JSON.stringify(manifest), Sealed: true }, onDispatch }); acknowledged = true;
        return { ok: true, result: await this.sealResult(payload) };
      }
      fail('invalid_operation', 'Unsupported image mutation.');
    } catch (error) {
      if (acknowledged || dispatched && error.code === 'function_deadline' || TRANSPORT_ERRORS.has(error.code)) return { ok: false, code: error.code, status: error.status || 502, message: error.message, uncertain: true, completed: [] };
      throw error;
    }
  }
  async draftResult(payload) {
    const data = await this.repo.api(`${this.repo.paths.root}/ImageAssets/${payload.targetId}/${payload.generationId}`, null, { query: { '$select': 'Id', metadata: 'no' } });
    const set = await this.set(assertId(data.Id), payload.targetId, { sealed: false });
    if (hash(set.manifest) !== hash(payload.manifest)) fail('image_draft_conflict', 'The reserved generation has a different manifest.', 409);
    return { id: payload.targetId, setId: set.Id, generationId: set.GenerationId, manifest: set.manifest, sealed: false };
  }
  async variantResult(payload) {
    const set = await this.set(payload.setId, payload.targetId);
    const file = await this.repo.api(set.Path + '/' + payload.variant.name, null, { query: { '$select': 'Id,ParentId,Type,Name', metadata: 'no' } });
    if (file.Type !== 'ImageVariant' || file.ParentId !== set.Id || file.Name !== payload.variant.name) fail('image_draft_conflict', 'The reserved variant path contains different content.', 409);
    const response = await this.repo.request(this.repo.config.repositoryUrl + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: file.Id, propertyname: 'Binary' }), { maxBytes: IMAGE_LIMITS.variantBytes });
    if (response.bytes.length !== payload.variant.byteLength || digest(response.bytes) !== payload.variant.sha256 || response.contentType?.split(';')[0] !== payload.variant.mimeType) fail('image_integrity', 'The draft variant does not match its saved upload metadata.', 409);
    return { id: payload.targetId, setId: set.Id, generationId: set.GenerationId, variant: { id: file.Id, ...payload.variant } };
  }
  async sealResult(payload) {
    const set = await this.set(payload.setId, payload.targetId, { sealed: true, fresh: true, validateSources: false });
    if (hash(set.manifest.variants) !== hash(payload.variants)) fail('image_draft_conflict', 'Sealed variants differ from the saved request.', 409);
    return { id: payload.targetId, setId: set.Id, generationId: set.GenerationId, manifest: set.manifest, sealed: true };
  }
  async reconcile(payload) {
    try {
      if (payload.action === 'image-delete') {
        await this.owner(payload.targetId, { write: true });
        const current = await this.repo.api(payload.targetId, 'GetImageAssetSetStatus', { query: { setId: String(payload.setId) } });
        if (typeof current?.exists !== 'boolean' || current.setId !== payload.setId) fail('image_backend_contract', 'Exact image deletion status is unavailable.', 502);
        if (!current.exists) return { id: payload.targetId, setId: payload.setId, deleted: true, reconciled: true };
        fail('uncertain_image_mutation', 'The dispatched image set deletion is not confirmed.', 409);
      }
      const result = payload.action === 'image-draft' ? await this.draftResult(payload) : payload.action === 'image-variant' ? await this.variantResult(payload) : await this.sealResult(payload);
      return { ...result, reconciled: true };
    } catch (error) {
      if ([404, 409].includes(error.status)) throw new DomainError('uncertain_image_mutation', 'Image write completion is unconfirmed. No image bytes are retained or redispatched; inspect this saved request before creating a new generation.', 409, { uncertain: true });
      throw error;
    }
  }
  async upload(set, variant, bytes, onDispatch) {
    const boundary = 'timeline-image-' + randomBytes(16).toString('hex'), chunks = [];
    for (const [key, value] of Object.entries({ ChunkToken: '0*0*False*False', FileName: variant.name, Overwrite: 'false', PropertyName: 'Binary', FileLength: bytes.length, ContentType: 'ImageVariant' })) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${variant.name}"; filename="${variant.name}"\r\nContent-Type: ${variant.mimeType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    await this.repo.request(this.repo.endpoint(set.Id) + '/Upload', { method: 'POST', body: Buffer.concat(chunks), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary }, onDispatch });
  }
}
