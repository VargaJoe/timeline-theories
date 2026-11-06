import { Repository } from '@sensenet/client-core';
import { repositoryUrl, environment } from '../configuration';
import { createOperationGuard, guardRepository, snapshotRequestInit } from './operationGuard.mjs';
import { createDisplayPermissions } from './displayPermissions.mjs';
import { assertMembership, projectPaths, TYPES, validateFields } from '../domain/content.mjs';
import { acknowledgeNativeCommands, applyNativeCommands, cachedNativeSnapshot, canUseLegacyRead, configureNativeAuth, invalidateNativeSnapshots, markNativeGatewayUnavailable, nativeCommandFailure, nativeCreationApplyStart, NativeApiError, nativeCoverPayload, nativeReadSidecarAvailable, nativeSnapshot, nativeSnapshots, requireNativeWriteReadiness } from './nativeApi';
import type { NativeCommand, NativeSnapshot } from './nativeApi';
export type { Operation } from './operationGuard.mjs';

const rawRepository = new Repository({ repositoryUrl });
const originalFetch = rawRepository.fetch.bind(rawRepository);
configureNativeAuth(() => rawRepository.configuration.token);
const copyFormData = (body: FormData) => {
  const copy = new FormData();
  body.forEach((value, key) => copy.append(key, value));
  return copy;
};
const isConfiguredWriteTarget = () => environment.writable &&
  rawRepository.configuration.repositoryUrl.replace(/\/$/, '') === repositoryUrl;
const jsonResponse = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { 'Content-Type': 'application/json' } });
function oDataTarget(url: URL): string | number | undefined {
  const path = decodeURIComponent(url.pathname.replace(/^\/odata\.svc\/?/i, '/'));
  const numeric = path.match(/^\/content\((\d+)\)$/i);
  if (numeric) return Number(numeric[1]);
  if (!/^\/root\//i.test(path)) return undefined;
  return path.replace(/\/?\('((?:[^']|'')*)'\)$/, (_whole, name: string) => '/' + name.replace(/''/g, "'"));
}
function domainPath(target: string | number | undefined): boolean {
  const path = typeof target === 'string' ? target.toLowerCase() : '', root = environment.projectRoot.toLowerCase();
  return typeof target === 'number' || typeof target === 'string' && (
    path.startsWith(root + '/timelines/') || path.startsWith(root + '/medialibrary/') || path.startsWith(root + '/timelineentries/'));
}
function oDataSnapshot(snapshot: NativeSnapshot, previous: Record<string, unknown> = {}, expanded = new Map<number, NativeSnapshot>()): Record<string, unknown> {
  const result: Record<string, unknown> = { ...previous, ...snapshot };
  const binary = snapshot.CoverImageBin as { Url?: string; ContentType?: string } | undefined;
  if (binary?.Url) result.CoverImageBin = { __mediaresource: { media_src: binary.Url, content_type: binary.ContentType || '' } };
  if (snapshot.Type === 'TimelineEntry') {
    const ids = Array.isArray(snapshot.MediaItem) ? snapshot.MediaItem : [snapshot.MediaItem];
    const oldReferences = Array.isArray(previous.MediaItem) ? previous.MediaItem : [previous.MediaItem];
    const references = ids.filter(id => typeof id === 'number').map(id => {
      const old = oldReferences.find(value => value && typeof value === 'object' && (value as Record<string, unknown>).Id === id) as Record<string, unknown> | undefined;
      const current = expanded.get(id);
      return current ? oDataSnapshot(current, old) : old || id;
    });
    result.MediaItem = references;
  }
  return result;
}
async function checkedCover(body: FormData, target: string | number, expectedRevision?: string): Promise<NativeCommand> {
  const snapshot = await nativeSnapshot(target);
  const file = body.get(snapshot.Name);
  if (!(file instanceof Blob)) throw new Error('Missing checked cover blob');
  const fileName = file instanceof File ? file.name : 'cover';
  return { action: 'cover', targetId: snapshot.Id, expectedRevision: expectedRevision ?? snapshot.revision, ...await nativeCoverPayload(file, fileName) };
}
async function checkedRepositoryFetch(input: RequestInfo, init?: RequestInit, awaitReadyState?: boolean, expectedRevision?: string): Promise<Response> {
  if (expectedRevision !== undefined && (typeof expectedRevision !== 'string' || !expectedRevision)) throw new Error('A loaded content revision is required');
  if (typeof input !== 'string') throw new Error('Request objects are not supported by the checked repository');
  const url = new URL(input, repositoryUrl);
  if (url.origin !== repositoryUrl) throw new Error('Cross-repository requests are disabled');
  const checkedUpload = init?.body instanceof FormData ? checkedUploads.get(init.body) : undefined;
  const requestInit = snapshotRequestInit(init);
  const body = requestInit.body;
  const method = requestInit.method;
  const permissionContext = permissionGuard.context();
  const checkContext = () => { permissionContext(); if (requestInit.signal?.aborted) throw new Error('Operation request was cancelled'); };
  const before = rawRepository.configuration.token;
  if (awaitReadyState !== false) await rawRepository.awaitReadyState();
  if (before !== rawRepository.configuration.token) throw new Error('Identity changed before dispatch');
  if (!['GET', 'HEAD'].includes(method)) {
    if (!isConfiguredWriteTarget()) throw new Error('Repository writes are disabled by configuration');
    const target = oDataTarget(url);
    const commands: NativeCommand[] = [];
    let readBackId: number | undefined;
    if (body instanceof FormData) {
      const checked = checkedUpload;
      if (!checked) throw new Error('Unchecked upload');
      await assertOperations([{ target: checked.target, action: 'upload' }]);
      commands.push(await checkedCover(body, checked.target, checked.expectedRevision));
    } else {
      const payload = typeof body === 'string' ? JSON.parse(body) as Record<string, unknown> : {};
      if (/\/DeleteBatch$/i.test(url.pathname) && method === 'POST') {
        if (!Array.isArray(payload.paths) || !payload.paths.length || payload.permanent === true || Object.keys(payload).some(key => !['paths','permanent'].includes(key))) throw new Error('Invalid domain deletion');
        const paths = payload.paths as (string | number)[];
        await assertOperations(paths.map(value => ({ target: value, action: 'delete' as const })));
        for (const path of paths) {
          const snapshot = await nativeSnapshot(path);
          commands.push({ action: 'delete', targetId: snapshot.Id, expectedRevision: snapshot.revision });
        }
      } else if (method === 'PATCH' && target !== undefined) {
        await assertOperations([{ target, action: 'update' }]);
        const snapshot = await nativeSnapshot(target);
        commands.push({ action: 'update', targetId: snapshot.Id, expectedRevision: expectedRevision ?? snapshot.revision, fields: validateFields(snapshot.Type, payload) });
        readBackId = snapshot.Id;
      } else if (method === 'POST' && target !== undefined && typeof payload.__ContentType === 'string' && TYPES.includes(payload.__ContentType)) {
        await assertOperations([{ target, action: 'create', contentType: payload.__ContentType }]);
        if (payload.__ContentTemplate !== undefined) throw new Error('Content templates are outside the application domain');
        const { __ContentType: type, __ContentTemplate: ignoredTemplate, ...fields } = payload;
        void ignoredTemplate;
        const parent = await nativeSnapshot(target, { parent: true });
        commands.push({ action: 'create', type, parentId: parent.Id, fields: validateFields(type as string, fields, { create: true }) });
      } else throw new Error('Unsupported mutation endpoint');
    }
    if (before !== rawRepository.configuration.token || !isConfiguredWriteTarget()) throw new Error('Identity/repository changed before dispatch');
    checkContext();
    const result = await applyNativeCommands(commands, checkContext, nativeCreationApplyStart(init));
    if (commands[0]?.action === 'create') readBackId = result.completed[0]?.result.id;
    if (readBackId) {
      try {
      const snapshot = await nativeSnapshot(readBackId, { refresh: true });
      const readUrl = new URL(input, repositoryUrl);
      readUrl.pathname = `/odata.svc/content(${readBackId})`;
      const response = await originalFetch(readUrl.href, { method: 'GET' }, false);
      checkContext();
      if (!response.ok) throw new NativeApiError('The created or updated content could not be read back. Retry the original attempt to recover its saved result.', response.status, 'native_readback_unavailable');
      const value = await response.json() as { d: Record<string, unknown> };
      checkContext();
      acknowledgeNativeCommands(commands);
      return jsonResponse({ ...value, d: oDataSnapshot(snapshot, value.d) });
      } catch (error) { throw nativeCommandFailure(commands, error); }
    }
    acknowledgeNativeCommands(commands);
    return commands[0]?.action === 'cover' ? jsonResponse(result) : jsonResponse({ d: { results: result.completed.map(item => ({ Id: item.result.id, Deleted: true })) } });
  }
  checkContext();
  const target = oDataTarget(url);
  // SenseNet's SDK includes its default $top even on exact load() requests.
  const exactContent = typeof target === 'number' || /\('(?:[^']|'')*'\)$/.test(decodeURIComponent(url.pathname));
  const collection = !exactContent && ['query', '$filter', '$top', '$skip'].some(key => url.searchParams.has(key));
  const action = /\/(?:HasPermission|AllowedChildTypes|EffectiveAllowedChildTypes|GetCurrentUser)$/i.test(url.pathname);
  const selectedFields = (url.searchParams.get('$select') || '').split(',');
  const editorRead = selectedFields.some(field => ['DisplayName', 'Title', 'Description', 'Position', 'Notes', 'SortOrder'].includes(field));
  const domainCollection = collection && (domainPath(target) || typeof target === 'string' && target.toLowerCase().startsWith(environment.projectRoot.toLowerCase() + '/'));
  const displayContent = method === 'GET' && !action && (domainPath(target) || domainCollection);
  const readUrl = new URL(input, repositoryUrl);
  if (displayContent) {
    const select = new Set((readUrl.searchParams.get('$select') || '').split(',').filter(Boolean));
    if (!select.size) select.add('*');
    select.add('Id'); select.add('Path');
    if (rawRepository.configuration.token && isConfiguredWriteTarget()) {
      select.add('Actions/Name'); select.add('Actions/Forbidden');
      const expand = new Set((readUrl.searchParams.get('$expand') || '').split(',').filter(Boolean));
      expand.add('Actions');
      if (expand.has('MediaItem')) {
        select.add('MediaItem/Id'); select.add('MediaItem/Path');
        select.add('MediaItem/Actions/Name'); select.add('MediaItem/Actions/Forbidden');
        expand.add('MediaItem/Actions');
      }
      readUrl.searchParams.set('$expand', [...expand].join(','));
      if (!readUrl.searchParams.has('scenario')) readUrl.searchParams.set('scenario', 'ContextMenu');
    }
    readUrl.searchParams.set('$select', [...select].join(','));
    readUrl.searchParams.set('metadata', 'no');
  }
  let sidecar = method === 'GET' && !action && (domainPath(target) || domainCollection) ? await nativeReadSidecarAvailable() : false;
  let baseline: NativeSnapshot | undefined;
  let baselineMedia = new Map<number, NativeSnapshot>();
  if (sidecar && !collection && domainPath(target)) {
    try {
      baseline = await nativeSnapshot(target!, { refresh: editorRead || !cachedNativeSnapshot(target!) });
      const mediaIds = baseline.Type === 'TimelineEntry' ? (Array.isArray(baseline.MediaItem) ? baseline.MediaItem : [baseline.MediaItem]).filter(id => typeof id === 'number') as number[] : [];
      baselineMedia = new Map((await nativeSnapshots(mediaIds)).map(snapshot => [snapshot.Id, snapshot]));
    } catch (error) {
      if (!canUseLegacyRead(error)) throw error;
      markNativeGatewayUnavailable(error); sidecar = false; baseline = undefined;
    }
  }
  checkContext();
  const response = await originalFetch(readUrl.href, requestInit, false);
  checkContext();
  let content: { d?: Record<string, unknown> & { results?: Record<string, unknown>[] } } | undefined;
  if (displayContent && response.ok && response.headers.get('content-type')?.includes('json')) {
    content = await response.clone().json(); checkContext();
    const rows = content?.d?.results || (content?.d ? [content.d] : []);
    for (const row of rows) {
      displayPermissions.remember(row);
      for (const media of Array.isArray(row.MediaItem) ? row.MediaItem : row.MediaItem ? [row.MediaItem] : []) displayPermissions.remember(media);
    }
  }
  if (!sidecar || method !== 'GET' || !response.ok || action || !response.headers.get('content-type')?.includes('json')) return response;
  const value = content || await response.clone().json() as { d?: Record<string, unknown> & { results?: Record<string, unknown>[] } };
  if (baseline && value.d && !Array.isArray(value.d.results)) return jsonResponse({ ...value, d: oDataSnapshot(baseline, value.d, baselineMedia) });
  if (domainCollection && value.d?.results) {
    const rows = value.d.results;
    const ids = rows.map(row => row.Id).filter(id => Number.isSafeInteger(id)) as number[];
    if (!ids.length) return response;
    try {
      const current = await nativeSnapshots(ids);
      const members = new Map(current.map(snapshot => [snapshot.Id, snapshot]));
      const mediaIds = current.filter(snapshot => snapshot.Type === 'TimelineEntry').flatMap(snapshot => Array.isArray(snapshot.MediaItem) ? snapshot.MediaItem : [snapshot.MediaItem]).filter(id => typeof id === 'number') as number[];
      const media = new Map((await nativeSnapshots(mediaIds)).map(snapshot => [snapshot.Id, snapshot]));
      checkContext();
      return jsonResponse({ ...value, d: { ...value.d, results: rows.map(row => {
        const snapshot = members.get(row.Id as number);
        if (!snapshot) throw new Error('A listed item no longer has a readable native revision; reload');
        return oDataSnapshot(snapshot, row, media);
      }) } });
    } catch (error) {
      if (!canUseLegacyRead(error)) throw error;
      markNativeGatewayUnavailable(error); checkContext(); return response;
    }
  }
  return response;
}
rawRepository.fetch = checkedRepositoryFetch;
const checkedUploads = new WeakMap<FormData, { target: string | number; expectedRevision?: string }>();
function permissionUrl(target: string | number): URL {
  const url = new URL(repositoryUrl);
  if (typeof target === 'number' || typeof target === 'string' && /^[1-9][0-9]*$/.test(target)) {
    const id = Number(target); if (!Number.isSafeInteger(id) || id < 1) throw new Error('Invalid permission target');
    url.pathname = `/odata.svc/content(${id})`;
  } else {
    if (typeof target !== 'string' || !target.toLowerCase().startsWith(environment.projectRoot.toLowerCase() + '/') && target.toLowerCase() !== environment.projectRoot.toLowerCase() || /\.\.|[\\?#]/.test(target) || [...target].some(character => character.charCodeAt(0) < 32)) throw new Error('Invalid permission target');
    const slash = target.lastIndexOf('/');
    url.pathname = '/odata.svc' + target.slice(0, slash).split('/').map(encodeURIComponent).join('/') + "('" + encodeURIComponent(target.slice(slash + 1).replaceAll("'", "''")).replaceAll("'", '%27') + "')";
  }
  return url;
}
const permissionFields = 'Id,Path,Actions/Name,Actions/Forbidden,EffectiveAllowedChildTypes/Name';
async function permissionRows(targets: (string | number)[]): Promise<Record<string, unknown>[]> {
  const checkContext = permissionGuard.context();
  const clauses = targets.map(target => {
    const parsed = oDataTarget(permissionUrl(target));
    return typeof parsed === 'number' ? 'Id:' + parsed : 'Path:' + JSON.stringify(parsed);
  });
  const url = new URL(repositoryUrl); url.pathname = '/odata.svc' + environment.projectRoot.split('/').map(encodeURIComponent).join('/');
  url.search = new URLSearchParams({ query: '+InTree:' + JSON.stringify(environment.projectRoot) + ' +(' + clauses.join(' ') + ') .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': permissionFields, '$expand': 'Actions,EffectiveAllowedChildTypes', '$top': String(Math.max(100, targets.length)), metadata: 'no' }).toString();
  if (targets.length > 1000 || url.href.length > 16000) throw new Error('Permission review exceeds the supported batch size');
  const response = await originalFetch(url.href, { method: 'GET' }, false); checkContext();
  if (!response.ok) throw new Error('Permission content is unavailable');
  const value = await response.json() as { d?: { results?: Record<string, unknown>[] } }; checkContext();
  if (!Array.isArray(value.d?.results)) throw new Error('Permission content is invalid');
  return value.d.results;
}
type PendingPermission = { target: string | number; check: () => void; resolve: (value: Record<string, unknown>) => void; reject: (error: unknown) => void };
let pendingPermissions: PendingPermission[] = [], permissionFlushScheduled = false;
function permissionContent(target: string | number): Promise<Record<string, unknown>> {
  const check = permissionGuard.context();
  const promise = new Promise<Record<string, unknown>>((resolve, reject) => { pendingPermissions.push({ target, check, resolve, reject }); });
  if (!permissionFlushScheduled) {
    permissionFlushScheduled = true;
    void Promise.resolve().then(async () => {
      const batch = pendingPermissions; pendingPermissions = []; permissionFlushScheduled = false;
      try {
        const rows = await permissionRows([...new Set(batch.map(item => item.target))]);
        for (const item of batch) {
          try {
            item.check();
            const parsed = oDataTarget(permissionUrl(item.target));
            const row = rows.find(row => typeof parsed === 'number' ? row.Id === parsed : typeof parsed === 'string' && typeof row.Path === 'string' && row.Path.toLowerCase() === parsed.toLowerCase());
            if (!row) throw new Error('Permission target is unavailable');
            item.resolve(row);
          } catch (error) { item.reject(error); }
        }
      } catch (error) { for (const item of batch) item.reject(error); }
    });
  }
  return promise;
}
async function freshPermissionBatch(operations: readonly import('./operationGuard.mjs').Operation[]): Promise<boolean> {
  const checkContext = permissionGuard.context();
  const writing = operations.find(operation => operation.action !== 'read');
  if (writing) {
    if (!rawRepository.configuration.token || !isConfiguredWriteTarget()) return false;
    await requireNativeWriteReadiness(writing.target, writing.action === 'create'); checkContext();
  }
  const targets = [...new Set(operations.map(operation => operation.target))];
  if (!targets.length) return true;
  const rows = await permissionRows(targets); checkContext();
  // Seed only from this fresh compound response, never from cached UI hints.
  const reviewed = createDisplayPermissions({ identity: () => `${rawRepository.configuration.repositoryUrl}:${rawRepository.configuration.token || ''}`, writable: () => !!rawRepository.configuration.token && isConfiguredWriteTarget(), load: async () => { throw new Error('Reviewed target is missing'); }, ready: async () => true });
  for (const row of rows) reviewed.remember(row);
  const allowed = await reviewed.can(operations); checkContext(); return allowed;
}
const permissionGuard = createOperationGuard({
  probe: async () => false, childTypes: async () => [], batchProbe: freshPermissionBatch,
  writable: isConfiguredWriteTarget,
  identity: () => `${rawRepository.configuration.repositoryUrl}:${rawRepository.configuration.token || ''}`,
});
const displayPermissions = createDisplayPermissions({
  identity: () => `${rawRepository.configuration.repositoryUrl}:${rawRepository.configuration.token || ''}`,
  writable: () => !!rawRepository.configuration.token && isConfiguredWriteTarget(),
  load: permissionContent,
  // All queued descriptors become one compound HTTP request; this is not
  // permission-by-permission or target-by-target network concurrency.
  concurrency: 1000,
  ready: async (target, parent) => { await requireNativeWriteReadiness(target, parent); return true; },
});
export const repository = guardRepository(rawRepository, permissionGuard, { writesCheckedByTransport: true });
export const assertOperations = permissionGuard.assert;
export const canOperations = permissionGuard.can;
export const canDisplayOperations = displayPermissions.can;
export const invalidatePermissions = () => { displayPermissions.invalidate(); permissionGuard.invalidate(); };
export const subscribePermissions = permissionGuard.subscribe;
export const captureOperationContext = permissionGuard.context;

/** Display-only projection: covers need current caller-readable metadata, not editor revisions. */
export async function readTimelineCoverReferences(timelinePath: string, signal?: AbortSignal): Promise<Record<string, unknown>[]> {
  const parent = environment.projectRoot + '/Timelines/';
  const name = timelinePath.startsWith(parent) ? timelinePath.slice(parent.length) : '';
  if (!name || /[/\\?#]/.test(name) || name === '.' || name === '..') throw new Error('Invalid timeline cover target');
  signal?.throwIfAborted();
  const checkContext = captureOperationContext();
  signal?.throwIfAborted();
  const url = new URL(repositoryUrl);
  // Encode each repository path segment; a content Name cannot change the OData target.
  url.pathname = '/odata.svc' + timelinePath.split('/').map(segment => encodeURIComponent(segment)).join('/');
  url.search = new URLSearchParams({ query: '+TypeIs:TimelineEntry +Hidden:0',
    '$select': 'Id,Path,Name,Type,MediaItem/Id,MediaItem/Path,MediaItem/Type,MediaItem/CoverImageUrl,MediaItem/CoverImageBin',
    '$expand': 'MediaItem', '$orderby': 'Position', '$top': '50', metadata: 'no' }).toString();
  // This same-caller GET and subsequent binaries enforce repository access.
  const response = await originalFetch(url.href, { method: 'GET', signal }, false);
  checkContext();
  if (!response.ok) throw new Error('Timeline cover references are unavailable');
  const value = await response.json() as { d?: { results?: Record<string, unknown>[] } };
  checkContext();
  signal?.throwIfAborted();
  if (!Array.isArray(value.d?.results)) throw new Error('Invalid timeline cover response');
  const paths = projectPaths(environment.projectRoot);
  for (const row of value.d.results) {
    assertMembership(row, paths);
    if (row.Type !== 'TimelineEntry' || typeof row.Path !== 'string' || !row.Path.startsWith(timelinePath + '/')) throw new Error('Invalid timeline cover entry');
    const references = Array.isArray(row.MediaItem) ? row.MediaItem : row.MediaItem ? [row.MediaItem] : [];
    for (const reference of references) {
      if (!reference || typeof reference !== 'object' || !['MediaItem', 'BookMediaItem'].includes(reference.Type)) throw new Error('Invalid timeline cover media');
      assertMembership(reference, paths);
    }
  }
  return value.d.results;
}

/** Editor revisions are passed separately from fields and remain pinned across unrelated reads. */
export async function patchContentWithRevision<T = Record<string, unknown>>(target: string | number, fields: Record<string, unknown>, expectedRevision?: string, options: { select?: string[]; expand?: string[] } = {}): Promise<{ d: T }> {
  const url = new URL(repositoryUrl);
  if (typeof target === 'number' || /^\d+$/.test(target)) url.pathname = `/odata.svc/content(${Number(target)})`;
  else if (target.startsWith('/Root/')) url.pathname = '/odata.svc' + target;
  else throw new Error('Invalid content update target');
  if (options.select?.length) url.searchParams.set('$select', options.select.join(','));
  if (options.expand?.length) url.searchParams.set('$expand', options.expand.join(','));
  const response = await checkedRepositoryFetch(url.href, { method: 'PATCH', body: JSON.stringify(fields) }, undefined, expectedRevision);
  if (!response.ok) throw new Error('Updated content could not be read back; retry the same approved operation');
  return await response.json() as { d: T };
}

export async function uploadBinary(target: string | number, url: string, body: FormData, expectedRevision?: string): Promise<Response> {
  const checkContext = captureOperationContext();
  body = copyFormData(body);
  await assertOperations([{ target, action: 'upload' }]);
  const content = await repository.load({ idOrPath: target, oDataOptions: { select: ['Id', 'Name', 'ParentId', 'Type'] } });
  const expected = `${repositoryUrl}/odata.svc/content(${content.d.ParentId})/upload`;
  if (url !== expected || body.get('FileName') !== content.d.Name || body.get('PropertyName') !== 'CoverImageBin' || body.get('Overwrite') !== 'true') throw new Error('Upload target does not match checked content');
  const fields = new Set(['ChunkToken','FileName','Overwrite','PropertyName','FileLength','ContentType','ContentId',content.d.Name]);
  body.forEach((_value,key) => { if (!fields.has(key) || body.getAll(key).length !== 1) throw new Error('Unsupported or duplicate upload field'); });
  const file = body.get(content.d.Name);
  if (!(file instanceof Blob) || body.get('FileLength') !== String(file.size) || body.get('ContentType') !== content.d.Type || body.get('ChunkToken') !== '0*0*False*False' || (body.has('ContentId') && body.get('ContentId') !== String(content.d.Id))) throw new Error('Upload metadata does not match checked content');
  // A fresh check follows all asynchronous preparation; the backend remains authoritative.
  await assertOperations([{ target, action: 'upload' }]);
  checkContext();
  checkedUploads.set(body, { target, expectedRevision });
  return rawRepository.fetch(url, { method: 'POST', body });
}

// Set up authentication service based on auth type

/**
 * Sets the access token in the repository configuration
 * This is the proper way to set authentication for sn-client Repository
 */
export const setRepositoryAccessToken = (token: string) => {
  if (rawRepository.configuration.token === (token || undefined)) return;
  invalidatePermissions();
  invalidateNativeSnapshots();
  if (!token || token.trim() === '') {
    // Clear the token
    (repository.configuration as { token?: string }).token = undefined;
    console.log('[sensenet] Repository authentication cleared');
  } else {
    // Set the token in repository configuration - this is the proper sn-client way
    (repository.configuration as { token?: string }).token = token;
    console.log('[sensenet] Repository authentication set with token');
  }
};

export const loadBackgroundImage = async (imagePath: string): Promise<string | null> => {
  try {
    const content = await repository.load({
      idOrPath: imagePath,
      oDataOptions: {
        select: ['Binary']
      }
    });
    
    // Extract the binary streaming URL from SenseNet content
    const binaryUrl = content.d?.Binary?.__mediaresource?.media_src;
    
    if (binaryUrl) {
      // Create full URL if the binary URL is relative
      const fullUrl = binaryUrl.startsWith('http') 
        ? binaryUrl 
        : `${repositoryUrl.replace('/odata.svc', '')}${binaryUrl}`;
      
      console.log('[sensenet] Background image URL:', fullUrl);
      return fullUrl;
    } else {
      console.warn('[sensenet] No binary URL found for image:', imagePath);
      return null;
    }
  } catch (error) {
    console.error('[sensenet] Failed to load background image:', error);
    return null;
  }
};
