// Controlled protocol fixture for app routing/journal tests. Actual SenseNet
// permissions, raster decoding and atomic activation require the native smoke.
export function imageProtocolFixture(projectRoot, contents, send) {
  const state = { enabled: false, stamp: 'd'.repeat(64), sourceReadable: true, revokeAtUpload: false, files: new Map(), sets: new Map(), uploads: 0, activations: 0, deletions: 0, binaryReads: [], interruptUploadOnce: false, interruptDeleteOnce: false, original: Buffer.from('preserved original fixture bytes'), originalMime: 'image/png' };
  let nextId = 30;
  const json = async req => { const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString()); };
  const ownerId = url => Number(url.pathname.match(/content\((\d+)\)/)?.[1]);
  const presentation = (id, editor = false) => {
    const owner = contents.get(id), setId = owner?.CoverImageSet?.[0], set = state.sets.get(setId);
    const base = { ownerGuard: { version: owner.Version, modificationDate: owner.ModificationDate, token: String(owner.VersionId), versionId: owner.VersionId }, ...(owner?.Type === 'MediaItem' ? { imageStamp: state.stamp } : { imageStamp: null }) };
    if (!set) return { state: 'legacy', ...base };
    if (!state.sourceReadable) return { state: 'blocked', setId, ...base };
    const manifest = JSON.parse(set.Manifest);
    return manifest.sourceStamps.some(source => source.stamp !== state.stamp)
      ? { state: 'stale', setId, generationId: set.GenerationId, ...(editor ? { manifest: set.Manifest } : {}), ...base }
      : { state: 'active', setId, generationId: set.GenerationId, manifest: set.Manifest, ...base };
  };
  async function handle(req, res, url) {
    if (!state.enabled) return false;
    if (url.pathname.endsWith('/ImageAssetCapabilities')) { send(res, 200, { protocol: 'timeline-image-assets-v1', supported: true }); return true; }
    if (url.pathname.endsWith('/GetImagePresentation')) { send(res, 200, presentation(ownerId(url), !!(req.headers.authorization || req.headers.apikey))); return true; }
    if (url.pathname.endsWith('/GetImageAssetSets')) {
      const id = ownerId(url), selected = presentation(id);
      send(res, 200, { sets: [...state.sets.values()].filter(set => set.OwnerContent[0] === id).map(set => state.sourceReadable ? { setId: set.Id, generationId: set.GenerationId, state: selected.setId === set.Id ? selected.state : set.Sealed ? 'inactive' : 'draft', canDelete: selected.setId !== set.Id } : { setId: set.Id, state: 'blocked', canDelete: selected.setId !== set.Id }), hasMore: false }); return true;
    }
    if (url.pathname.endsWith('/GetImageAssetSetStatus')) {
      const id = Number(url.searchParams.get('setId')), set = state.sets.get(id);
      if (set && set.OwnerContent[0] !== ownerId(url)) { send(res, 403, null); return true; }
      send(res, 200, { exists: !!set, setId: id }); return true;
    }
    if (url.pathname.endsWith('/PrepareImageAssetDraft')) {
      const input = await json(req), manifest = JSON.parse(input.manifest), owner = contents.get(input.ownerId);
      if (String(owner.VersionId) !== input.expectedOwnerToken || owner.Version !== input.expectedVersion || 'utc:' + owner.ModificationDate !== input.expectedModificationDate || manifest.sourceStamps.some(source => source.stamp !== state.stamp)) { send(res, 409, null); return true; }
      const set = { Id: nextId++, ParentId: 29, Name: input.generationId, Path: `${projectRoot}/ImageAssets/${owner.Id}/${input.generationId}`, Type: 'ImageVariantSet', OwnerContent: [owner.Id], SourceContents: [...manifest.sourceIds].sort((a, b) => a - b), GenerationId: input.generationId, Manifest: input.manifest, Sealed: false };
      contents.set(set.Id, set); state.sets.set(set.Id, set);
      send(res, 200, { setId: set.Id, path: set.Path, ownerId: owner.Id, generationId: set.GenerationId, sealed: false, manifest: set.Manifest }); return true;
    }
    if (url.pathname.endsWith('/ActivateImageAsset')) {
      const owner = contents.get(ownerId(url)), input = await json(req), set = state.sets.get(input.setId);
      if (String(owner.VersionId) !== input.expectedOwnerToken || owner.Version !== input.expectedVersion || 'utc:' + owner.ModificationDate !== input.expectedModificationDate || input.setId !== null && (!set?.Sealed || JSON.parse(set.Manifest).sourceStamps.some(source => source.stamp !== state.stamp))) { send(res, 409, null); return true; }
      owner.CoverImageSet = input.setId === null ? [] : [input.setId]; owner.Version = `V${++state.activations + 1}.0`; owner.VersionId++; owner.ModificationDate = new Date().toISOString();
      send(res, 200, { setId: input.setId }); return true;
    }
    if (url.pathname.endsWith('/DeleteImageAsset')) {
      const input = await json(req), id = ownerId(url), set = state.sets.get(input.setId);
      if (!set || set.OwnerContent[0] !== id || presentation(id).setId === set.Id) { send(res, 403, null); return true; }
      state.sets.delete(set.Id); contents.delete(set.Id);
      for (const [childId, row] of contents) if (row.ParentId === set.Id) { contents.delete(childId); state.files.delete(childId); }
      state.deletions++;
      if (state.interruptDeleteOnce) { state.interruptDeleteOnce = false; res.destroy(); return true; }
      send(res, 200, { setId: set.Id, deleted: true }); return true;
    }
    if (url.pathname.endsWith('/Upload')) {
      if (state.revokeAtUpload) state.sourceReadable = false;
      const set = state.sets.get(ownerId(url)); if (!set || set.Sealed || !state.sourceReadable) { send(res, 403, null); return true; }
      const parts = []; for await (const part of req) parts.push(part);
      const body = Buffer.concat(parts), text = body.toString('latin1'), match = /filename="(w\d+)"\r\nContent-Type: (image\/[a-z]+)\r\n\r\n/.exec(text);
      if (!match) { send(res, 400, null); return true; }
      const start = match.index + match[0].length, end = body.lastIndexOf(Buffer.from('\r\n--'));
      const file = { Id: nextId++, ParentId: set.Id, Type: 'ImageVariant', Name: match[1], Path: set.Path + '/' + match[1] };
      contents.set(file.Id, file); state.files.set(file.Id, { bytes: body.subarray(start, end), mimeType: match[2] }); state.uploads++;
      if (state.interruptUploadOnce) { state.interruptUploadOnce = false; res.destroy(); return true; }
      send(res, 200, file); return true;
    }
    if (url.pathname === '/binaryhandler.ashx') {
      const id = Number(url.searchParams.get('nodeid')), property = url.searchParams.get('propertyname'), file = property === 'Binary' ? state.files.get(id) : { bytes: state.original, mimeType: state.originalMime };
      if (!file) { send(res, 404, null); return true; }
      const containingSet = state.sets.get(contents.get(id)?.ParentId);
      if (property === 'Binary' && (!state.sourceReadable || JSON.parse(containingSet.Manifest).sourceStamps.some(source => source.stamp !== state.stamp))) { send(res, 403, null); return true; }
      if (req.method !== 'HEAD') state.binaryReads.push({ id, property });
      res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Length': file.bytes.length }); res.end(req.method === 'HEAD' ? undefined : file.bytes); return true;
    }
    if (req.method === 'DELETE' && state.sets.has(ownerId(url))) {
      const set = state.sets.get(ownerId(url));
      if (presentation(set.OwnerContent[0]).setId === set.Id) { send(res, 403, null); return true; }
      state.sets.delete(set.Id); contents.delete(set.Id);
      for (const [id, row] of contents) if (row.ParentId === set.Id) { contents.delete(id); state.files.delete(id); }
      send(res, 200, {}); return true;
    }
    const repositoryPath = decodeURIComponent(url.pathname).replace(/^\/OData\.svc/, '').replace(/\('([^']+)'\)$/, '/$1');
    if (!state.sourceReadable && req.method === 'GET' && (state.sets.has(ownerId(url)) || state.files.has(ownerId(url)))) { send(res, 403, null); return true; }
    const pathRow = [...contents.values()].find(row => row.Path === repositoryPath);
    if (req.method === 'GET' && repositoryPath.startsWith(projectRoot + '/ImageAssets/')) { send(res, pathRow ? 200 : 404, pathRow || null); return true; }
    return false;
  }
  return { state, handle };
}
