import https from 'node:https';
import { DomainError, TYPES, assertId, projectPaths } from '../domain/content.mjs';
export class Repository {
  constructor(config, credential) { this.config = config; this.credential = credential; this.paths = projectPaths(config.projectRoot); }
  endpoint(target) {
    if (typeof target === 'number') return this.config.repositoryUrl + '/OData.svc/content(' + assertId(target) + ')';
    if (target === '/Root') return this.config.repositoryUrl + "/OData.svc/('Root')";
    if (typeof target !== 'string' || !target.startsWith('/Root/') || /\.\.|[\\\x00-\x1f]/.test(target)) throw new DomainError('invalid_target', 'Invalid repository target.');
    const slash = target.lastIndexOf('/');
    return this.config.repositoryUrl + '/OData.svc' + target.slice(0, slash).split('/').map(encodeURIComponent).join('/') + "('" + encodeURIComponent(target.slice(slash + 1).replaceAll("'", "''")).replaceAll("'", '%27') + "')";
  }
  async request(url, { method = 'GET', body, maxBytes = 20 * 1024 * 1024 } = {}) {
    if (this.config.signal?.aborted) throw new DomainError('function_deadline','The app invocation deadline expired before dispatch.',409);
    const target = new URL(url);
    if (target.origin !== this.config.repositoryUrl || target.username || target.password) throw new DomainError('repository_mismatch', 'Repository origin mismatch.', 403);
    const headers = { Accept: 'application/json', ...(this.credential ? { [this.credential.mode === 'ApiKey' ? 'ApiKey' : 'Authorization']: this.credential.mode === 'ApiKey' ? this.credential.value : 'Bearer ' + this.credential.value } : {}) };
    if (body !== undefined) { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    return await new Promise((resolve, reject) => {
      const req = https.request(target, { method, headers, signal: this.config.signal, ...(this.config.ca ? { ca: this.config.ca } : {}) }, res => {
        const parts = []; let length = 0;
        res.on('data', part => { length += part.length; if (length > maxBytes) req.destroy(new DomainError('repository_limit', 'Repository response exceeds the byte limit.', 502)); else parts.push(part); });
        res.on('end', () => {
          const bytes = Buffer.concat(parts); let json; try { json = JSON.parse(bytes.toString()); } catch { json = null; }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const status = res.statusCode === 412 ? 409 : [401,403,404,409].includes(res.statusCode) ? res.statusCode : 502;
            reject(new DomainError(status === 401 ? 'backend_credential_rejected' : status === 403 ? 'backend_denied' : status === 404 ? 'target_unavailable' : status === 409 || status === 412 ? 'revision_conflict' : 'backend_failure', 'The repository rejected the request.', status));
          } else resolve({ value: json?.d ?? json, bytes, contentType: res.headers['content-type'] });
        });
      });
      req.setTimeout(30000, () => req.destroy(new DomainError('repository_timeout', 'Repository request timed out.', 502)));
      req.on('error', error => reject(error instanceof DomainError ? error : new DomainError('repository_transport', 'Repository transport failed.', 502)));
      req.end(body);
    });
  }
  async api(target, operation, options = {}) {
    let url = this.endpoint(target) + (operation ? '/' + operation : '');
    const { query, ...request } = options;
    if (query) url += '?' + new URLSearchParams(query);
    return (await this.request(url, request)).value;
  }
  async identity() {
    if (!this.credential) return { Id: 0, visitor: true };
    const result = await this.api('/Root', 'GetCurrentUser', { query: { '$select': 'Id,Name,Path', metadata: 'no' } });
    if (!Number.isSafeInteger(result?.Id) || result.Id < 1 || result.Name === 'Visitor') throw new DomainError('invalid_credential', 'Repository did not authenticate a user.', 401);
    return { Id: result.Id, Name: result.Name, Path: result.Path };
  }
  async read(target, { parent = false, expectedType } = {}) {
    throw new DomainError('repository_adapter_required','Application snapshots require the stock repository adapter.',503,{target,parent,expectedType});
  }
  async assert(operations) {
    if (!Array.isArray(operations)) throw new DomainError('invalid_operation', 'Expected application operations.');
    for (const op of operations) {
      if (!op || !['read', 'create', 'update', 'delete', 'cover'].includes(op.action)) throw new DomainError('invalid_operation', 'Unknown application operation.');
      this.endpoint(op.target);
      if (op.action !== 'read' && (this.config.readOnly || !this.credential)) throw new DomainError('read_only', 'Writes are disabled for this session/target.', 403);
      if (op.action === 'create' && (typeof op.type !== 'string' || !op.type)) throw new DomainError('invalid_operation', 'Creation requires an exact content type.');
    }
    const targets = [...new Set(operations.filter(op => op.action !== 'read').map(op => op.target))];
    const descriptors = await this.permissionDescriptors(targets);
    // An exact GET is Open proof for Visitor and authenticated callers alike.
    // Collection membership alone is not substituted for a concrete read.
    const reads = [...new Set(operations.filter(op => op.action === 'read').map(op => op.target))];
    for (const target of reads) {
      if (targets.length === 1 && target === targets[0]) continue; // Exact descriptor GET already read it.
      const row = await this.permissionRead(target, { '$select': 'Id,Path', metadata: 'no' });
      if (!matchesTarget(row, target)) throw new DomainError('permission_denied', 'The target is unreadable or unavailable.', 403);
    }
    for (const op of operations.filter(op => op.action !== 'read')) {
      const row = descriptors.find(row => matchesTarget(row, op.target));
      // Add is a Folder UI action and is absent on stock non-folder media.
      // This stock operation descriptor requires exactly AddNew on any
      // GenericContent. Inspect its permission flag; never invoke the upload.
      const actions = permissionActions(row?.Actions), action = op.action === 'create' ? op.type === 'SystemFolder' ? 'StartBlobUploadToParent' : 'Add' : op.action === 'delete' ? 'Delete' : 'Edit';
      if (actions.get(action) !== true) throw new DomainError('permission_denied', 'The target action is denied or unavailable.', 403);
      const types = Array.isArray(row?.EffectiveAllowedChildTypes) ? row.EffectiveAllowedChildTypes : row?.EffectiveAllowedChildTypes?.results;
      if (op.action === 'create' && (!Array.isArray(types) || !types.some(type => type?.Name === op.type))) throw new DomainError('child_type_denied', 'The parent does not allow this content type.', 403);
    }
  }
  async permissionDescriptors(targets) {
    const query = { '$select': 'Id,Path,Actions/Name,Actions/Forbidden,EffectiveAllowedChildTypes/Name', '$expand': 'Actions,EffectiveAllowedChildTypes', metadata: 'no' };
    if (!targets.length) return [];
    if (targets.length === 1) {
      const row = await this.permissionRead(targets[0], query);
      if (!matchesTarget(row, targets[0])) throw new DomainError('permission_denied', 'The target is unreadable or unavailable.', 403);
      return [row];
    }
    const rows = [];
    for (let offset = 0; offset < targets.length; offset += 100) {
      const batch = targets.slice(offset, offset + 100), clauses = batch.map(target => typeof target === 'number' ? 'Id:' + target : 'Path:' + JSON.stringify(target));
      const url = this.config.repositoryUrl + '/OData.svc' + this.paths.root.split('/').map(encodeURIComponent).join('/') + '?' + new URLSearchParams({ ...query, query: '+InTree:' + JSON.stringify(this.paths.root) + ' +(' + clauses.join(' ') + ') .AUTOFILTERS:OFF .LIFESPAN:OFF', '$top': String(batch.length) });
      if (url.length > 16000) throw new DomainError('target_limit', 'Permission review exceeds the supported batch size.', 413);
      const page = (await this.request(url)).value;
      if (!Array.isArray(page?.results) || page.results.some(row => !batch.some(target => matchesTarget(row, target))) || new Set(page.results.map(row => row.Id)).size !== page.results.length) throw new DomainError('backend_contract', 'Invalid repository action response.', 502);
      rows.push(...page.results);
    }
    return rows;
  }
  async permissionRead(target, query) {
    try { return await this.api(target, null, { query }); }
    catch (error) {
      if ([403, 404].includes(error.status)) throw new DomainError('permission_denied', 'The target is unreadable or unavailable.', 403);
      throw error;
    }
  }
  async list(type, { parentId, skip = 0, top = 50, search = '', includeHidden = false } = {}) {
    if (!TYPES.includes(type) || !Number.isInteger(skip) || skip < 0 || !Number.isInteger(top) || top < 1 || top > 100 || typeof search !== 'string' || search.length > 200) throw new DomainError('invalid_query', 'Invalid list/search/page parameters.');
    let parent = type === 'Timeline' ? this.paths.timelines : ['MediaItem','BookMediaItem'].includes(type) ? this.paths.media : this.paths.root;
    if (parentId) {
      const content = await this.read(assertId(parentId));
      if (type !== 'TimelineEntry' || content.Type !== 'Timeline') throw new DomainError('invalid_target', 'Occurrences require a timeline parent.');
      parent = content.Path;
    }
    let query = '+TypeIs:' + type + (includeHidden ? '' : ' +Hidden:0');
    // Encode as a quoted value; callers cannot inject a repository query.
    if (search) query += ' +DisplayName:' + JSON.stringify('*' + search.replace(/[\\*?]/g, '') + '*');
    const collectionUrl = this.config.repositoryUrl + '/OData.svc' + parent.split('/').map(encodeURIComponent).join('/') + '?' + new URLSearchParams({ query: query + (includeHidden ? ' .AUTOFILTERS:OFF .LIFESPAN:OFF' : ''), '$select': 'Id', '$orderby': 'Id', '$skip': skip, '$top': top, metadata: 'no' });
    const page = (await this.request(collectionUrl)).value;
    if (!Array.isArray(page?.results)) throw new DomainError('backend_contract', 'Invalid repository page response.', 502);
    const data = [];
    for (const row of page.results) {
      try { data.push(await this.read(row.Id)); } catch (error) { if (![403,404].includes(error.status)) throw error; }
    }
    return { items: data, page: { skip, top, nextSkip: page.results.length === top ? skip + top : null } };
  }
  async all(type, options = {}) {
    const items = [];
    for (let skip = 0; ; skip += 100) { const page = await this.list(type, { ...options, skip, top: 100 }); items.push(...page.items); if (page.page.nextSkip === null) break; if (items.length > 10000) throw new DomainError('target_limit', 'Operation exceeds the target limit.'); }
    return items;
  }
}

function matchesTarget(row, target) {
  return Number.isSafeInteger(row?.Id) && row.Id > 0 && (typeof target === 'number' ? row.Id === target : typeof row.Path === 'string' && row.Path.toLowerCase() === target.toLowerCase());
}
function permissionActions(value) {
  const rows = Array.isArray(value) ? value : value?.results, actions = new Map();
  // Duplicate descriptors cannot cancel an explicit or malformed prohibition.
  for (const row of Array.isArray(rows) ? rows : []) if (typeof row?.Name === 'string') actions.set(row.Name, row.Forbidden === false && actions.get(row.Name) !== false);
  return actions;
}
