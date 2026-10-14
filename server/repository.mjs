import https from 'node:https';
import { DomainError, TYPES, assertId, projectPaths } from '../client/domain/content.mjs';
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
    const target = new URL(url);
    if (target.origin !== this.config.repositoryUrl || target.username || target.password) throw new DomainError('repository_mismatch', 'Repository origin mismatch.', 403);
    const headers = { Accept: 'application/json', ...(this.credential ? { [this.credential.mode === 'ApiKey' ? 'ApiKey' : 'Authorization']: this.credential.mode === 'ApiKey' ? this.credential.value : 'Bearer ' + this.credential.value } : {}) };
    if (body !== undefined) { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    return await new Promise((resolve, reject) => {
      const req = https.request(target, { method, headers, ...(this.config.ca ? { ca: this.config.ca } : {}) }, res => {
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
    const result = await this.api('/Root', 'GetCurrentUser', { query: { '$select': 'Id,Name', metadata: 'no' } });
    if (!Number.isSafeInteger(result?.Id) || result.Id < 1 || result.Name === 'Visitor') throw new DomainError('invalid_credential', 'Repository did not authenticate a user.', 401);
    return { Id: result.Id, Name: result.Name };
  }
  async read(target, { parent = false, expectedType } = {}) {
    throw new DomainError('repository_adapter_required','Application snapshots require the stock repository adapter.',503,{target,parent,expectedType});
  }
  async assert(operations) {
    for (const op of operations) {
      if (op.action !== 'read' && (this.config.readOnly || !this.credential)) throw new DomainError('read_only', 'Writes are disabled for this session/target.', 403);
      const permissions = { read: ['Open'], create: ['AddNew'], update: ['Save'], delete: ['Delete'], cover: ['Save'] }[op.action];
      if (!permissions) throw new DomainError('invalid_operation', 'Unknown application operation.');
      if (!this.credential && op.action === 'read') {
        await this.api(op.target, null, { query: { '$select': 'Id', metadata: 'no' } }); continue;
      }
      const allowed = await this.api(op.target, 'HasPermission', { query: { permissions: permissions.join(',') } });
      if (allowed !== true) throw new DomainError('permission_denied', 'The target permission is denied or unavailable.', 403);
      if (op.action === 'create') {
        const results = await Promise.all(['AllowedChildTypes', 'EffectiveAllowedChildTypes'].map(name => this.api(op.target, name, { query: { '$select': 'Name', metadata: 'no' } })));
        if (!results.every(r => Array.isArray(r?.results)) || !results.some(r => r.results.some(t => t.Name === op.type))) throw new DomainError('child_type_denied', 'The parent does not allow this content type.', 403);
      }
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
