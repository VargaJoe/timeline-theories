import { createHash } from 'node:crypto';
import raster from '../../scripts/helpers/image-variant-fixture.cjs';

// Stock CRUD/Upload fixture only. No native image operations or native seal.
export function imageProtocolFixture(projectRoot, contents, send, host = {}) {
  const state = { enabled: false, sourceReadable: true, sourcePublic: true, ownerPublic: true, revokeAtUpload: false, files: new Map(), sets: new Map(), uploads: 0, activations: 0, deletions: 0, binaryReads: [], interruptUploadOnce: false, interruptDeleteOnce: false, original: raster.png(4, 6), originalMime: 'image/png' };
  Object.defineProperty(state, 'stamp', { get: () => createHash('sha256').update(state.original).digest('hex') });
  let nextId = Math.max(30, ...[...contents.keys()].map(id => id + 1));
  const json = async req => { const parts = []; for await (const part of req) parts.push(part); return JSON.parse(Buffer.concat(parts).toString()); };
  const byPath = value => [...contents.values()].find(row => row.Path === value);
  const pathOf = url => decodeURIComponent(url.pathname).replace(/^\/OData\.svc/i, '').replace(/\('([^']*)'\)$/, '/$1');
  const ownerOf = row => { while (row && !['Timeline', 'MediaItem', 'BookMediaItem'].includes(row.Type)) row = contents.get(row.ParentId); return row; };
  const managedPath = path => /\/(?:\(images\)|_images)(?:\/|$)/.test(path || '');
  const managed = row => managedPath(row?.Path);
  const readable = (row, req) => { const anonymous = !req.headers.authorization && !req.headers.apikey, owner = ownerOf(row); return host.allowRead !== false && !host.deniedIds?.has(row?.Id) && !host.deniedIds?.has(owner?.Id) && (![10, 11].includes(row?.Id) || state.sourceReadable && (!anonymous || state.sourcePublic)) && (!anonymous || owner?.Type !== 'Timeline' || state.ownerPublic); };
  const namesFor = row => (Array.isArray(row?.AllowedChildTypes) ? row.AllowedChildTypes.map(type => typeof type === 'string' ? type : type.Name) : row?.AllowedChildTypes?.results?.map(type => type.Name)) || (['Folder', 'SystemFolder'].includes(row?.Type) ? namesFor(contents.get(row.ParentId)) : row?.Type === 'Timeline' ? ['TimelineEntry'] : []);
  const systemContent = row => !!row && (row.IsSystemContent === true || row.Type === 'SystemFolder' || systemContent(contents.get(row.ParentId)));
  const update = row => { row.VersionId = (row.VersionId || 1) + 1; row.Version = 'V' + row.VersionId + '.0'; row.ModificationDate = new Date().toISOString(); };
  async function handle(req, res, url) {
    const id = Number(url.pathname.match(/content\((\d+)\)/)?.[1]), row = contents.get(id) || byPath(pathOf(url));
    if (/\/(EffectiveAllowedChildTypes|AllowedChildTypes)$/.test(url.pathname) && contents.has(id)) { const target = contents.get(id), names = namesFor(target), effective = url.pathname.endsWith('/EffectiveAllowedChildTypes'); send(res, 200, { results: [...new Set([...names, ...(effective ? ['SystemFolder'] : [])])].map(Name => ({ Name })) }); return true; }
    if (url.pathname.endsWith('/HasPermission') && managed(contents.get(id))) { const permission = url.searchParams.get('permissions'); send(res, 200, readable(contents.get(id), req) && (permission !== 'Save' || host.allowSave !== false) && (permission !== 'AddNew' || !state.revokeAtUpload)); return true; }
    if (url.pathname.endsWith('/Upload') && managed(contents.get(id))) {
      const set = contents.get(id); if (!readable(set, req) || host.allowSave === false || state.revokeAtUpload) { send(res, 403, null); return true; }
      const parts = []; for await (const part of req) parts.push(part); const body = Buffer.concat(parts), text = body.toString('latin1'), match = /filename="(w\d+\.(?:png|jpg|webp))"\r\nContent-Type: (image\/[a-z]+)\r\n\r\n/.exec(text);
      if (!match || !text.includes('\r\nFile\r\n')) { send(res, 400, null); return true; }
      const file = { Id: nextId++, ParentId: set.Id, Type: 'File', Name: match[1], Path: set.Path + '/' + match[1], IsSystemContent: systemContent(set), Version: 'V1.0', VersionId: 1, ModificationDate: new Date().toISOString(), Description: '' };
      contents.set(file.Id, file); state.files.set(file.Id, { bytes: body.subarray(match.index + match[0].length, body.lastIndexOf(Buffer.from('\r\n--'))), mimeType: match[2] }); state.uploads++;
      if (state.interruptUploadOnce) { state.interruptUploadOnce = false; res.destroy(); } else send(res, 200, file); return true;
    }
    if (url.pathname === '/binaryhandler.ashx') {
      const binaryId = Number(url.searchParams.get('nodeid')), property = url.searchParams.get('propertyname'), target = contents.get(binaryId);
      if (!target || !readable(target, req)) { send(res, target ? 403 : 404, null); return true; }
      const file = property === 'Binary' ? state.files.get(binaryId) : { bytes: state.original, mimeType: state.originalMime }; if (!file) { send(res, 404, null); return true; }
      if (req.method !== 'HEAD') state.binaryReads.push({ id: binaryId, property }); res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Length': file.bytes.length }); res.end(req.method === 'HEAD' ? undefined : file.bytes); return true;
    }
    if (req.method === 'POST' && row && state.enabled) {
      const input = await json(req); if (!['SystemFolder', 'Folder', 'File'].includes(input.__ContentType)) { send(res, 400, null); return true; }
      if (!readable(row, req) || host.allowSave === false) { send(res, 403, null); return true; }
      const child = { Id: nextId++, ParentId: row.Id, Type: input.__ContentType, Path: row.Path + '/' + input.Name, Version: 'V1.0', VersionId: 1, ModificationDate: new Date().toISOString(), ...input, IsSystemContent: input.__ContentType === 'SystemFolder' || systemContent(row) };
      if (input.AllowedChildTypes) child.AllowedChildTypes = { results: input.AllowedChildTypes.map(Name => ({ Name })) };
      contents.set(child.Id, child); if (!['(images)', '_images'].includes(input.Name) && input.__ContentType === 'Folder') state.sets.set(child.Id, child); send(res, 201, child); return true;
    }
    if (req.method === 'PATCH' && row && state.enabled) {
      const input = await json(req); if (!readable(row, req) || host.allowSave === false) { send(res, 403, null); return true; }
      if (!managed(row)) { if (!Object.hasOwn(input, 'AllowedChildTypes')) { send(res, 400, null); return true; } row.AllowedChildTypes = { results: input.AllowedChildTypes.map(Name => ({ Name })) }; }
      else { if (['(images)', '_images'].includes(row.Name) && input.Description && JSON.parse(row.Description).activeSetId !== JSON.parse(input.Description).activeSetId) state.activations++; Object.assign(row, input); }
      update(row); send(res, 200, row); return true;
    }
    if (req.method === 'DELETE' && managed(row)) {
      if (!readable(row, req) || host.allowSave === false) { send(res, 403, null); return true; }
      for (const [nodeId, item] of contents) if (nodeId === row.Id || item.Path.startsWith(row.Path + '/')) { contents.delete(nodeId); state.files.delete(nodeId); state.sets.delete(nodeId); }
      state.deletions++; if (state.interruptDeleteOnce) { state.interruptDeleteOnce = false; res.destroy(); } else send(res, 200, {}); return true;
    }
    if (req.method === 'GET' && url.searchParams.has('query') && !/\/content\(\d+\)/.test(url.pathname) && byPath(pathOf(url))) {
      const parent = byPath(pathOf(url)), top = Number(url.searchParams.get('$top')) || 201, query = url.searchParams.get('query'), tree = query.match(/\+?InTree:(?:"([^"]+)"|([^\s]+))/), parentId = Number(query.match(/\+?ParentId:(\d+)/)?.[1]) || parent.Id;
      const rows = [...contents.values()].filter(value => (tree ? value.Path === (tree[1] || tree[2]) || value.Path.startsWith((tree[1] || tree[2]) + '/') : value.ParentId === parentId) && (/\.AUTOFILTERS:OFF\b/.test(query) || !systemContent(value)) && readable(value, req));
      send(res, 200, { results: rows.slice(0, top) }); return true;
    }
    if (req.method === 'GET' && (managed(row) || managedPath(pathOf(url)) || state.enabled && row && !readable(row, req))) { send(res, row ? readable(row, req) ? 200 : 403 : 404, row || null); return true; }
    return false;
  }
  return { state, handle };
}
