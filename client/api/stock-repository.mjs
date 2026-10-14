import https from 'node:https';
import { createHash, randomBytes } from 'node:crypto';
import { Repository } from './repository.mjs';
import { DomainError, TYPES, FIELDS, assertId, assertMembership, safeName, validateFields } from '../domain/content.mjs';

const HEADERS = ['Id', 'ParentId', 'Name', 'Path', 'Type'];
const STAMPS = ['CreationDate', 'CreatedById', 'ModificationDate', 'ModifiedById', 'Version', 'VersionId'];
const COVER_TYPES = new Set(['Timeline', 'MediaItem', 'BookMediaItem']);
// The live cloud schema predates these optional local M0 additions. Reads
// remain useful; writing an unsupported optional field still fails preflight.
const OPTIONAL_FIELDS = new Set(['Year','SeriesName']);
const TRANSPORT_ERRORS = new Set(['repository_transport', 'repository_timeout', 'repository_limit', 'backend_failure', 'backend_contract']);
const stable = value => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
export const snapshotRevision = value => 'sha256:' + createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fail = (code, message, status = 409) => { throw new DomainError(code, message, status); };
const sameIds = (left, right) => left.length === right.length && new Set(right).size === right.length && left.every(id => right.includes(id));

/** Stock HTTP transport. Concurrency and durable receipts belong to the application's coordinator. */
export class StockRepository extends Repository {
  constructor(config, credential, { inventoryCredential } = {}) {
    super(config, credential);
    this.inventoryCredential = inventoryCredential ?? config.inventoryCredential;
    this.schemas = new Map();
    this.inventoryVerification = null;
  }

  async request(url, { method = 'GET', body, headers: extraHeaders = {}, maxBytes = 20 * 1024 * 1024 } = {}) {
    if (this.config.signal?.aborted) fail('function_deadline', 'The app invocation deadline expired before dispatch.', 409);
    const target = new URL(url);
    if (target.origin !== this.config.repositoryUrl || target.username || target.password) fail('repository_mismatch', 'Repository origin mismatch.', 403);
    if (Object.keys(extraHeaders).some(key => ['authorization', 'apikey', 'host'].includes(key.toLowerCase()))) fail('invalid_headers', 'Repository credentials cannot be overridden.');
    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase()) && this.beforeWrite) await this.beforeWrite();
    if (this.config.signal?.aborted) fail('function_deadline', 'The app invocation deadline expired before dispatch.', 409);
    const headers = { Accept: 'application/json', ...extraHeaders, ...(this.credential ? { [this.credential.mode === 'ApiKey' ? 'ApiKey' : 'Authorization']: this.credential.mode === 'ApiKey' ? this.credential.value : 'Bearer ' + this.credential.value } : {}) };
    if (body !== undefined && !Buffer.isBuffer(body) && typeof body !== 'string') { body = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
    if (body !== undefined) headers['Content-Length'] = Buffer.byteLength(body);
    return new Promise((resolve, reject) => {
      const req = https.request(target, { method, headers, signal: this.config.signal, ...(this.config.ca ? { ca: this.config.ca } : {}) }, res => {
        const parts = []; let length = 0;
        res.on('data', part => { length += part.length; if (length > maxBytes) req.destroy(new DomainError('repository_limit', 'Repository response exceeds the byte limit.', 502)); else parts.push(part); });
        res.on('error', () => reject(new DomainError('repository_transport', 'Repository response was interrupted.', 502)));
        res.on('end', () => {
          const bytes = Buffer.concat(parts); let json; try { json = JSON.parse(bytes.toString('utf8')); } catch { json = null; }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const exceptionType = String(json?.error?.exceptiontype ?? json?.error?.exceptionType ?? '');
            const backend = String(json?.error?.code ?? '') + ' ' + exceptionType + ' ' + String(json?.error?.message?.value ?? json?.error?.message ?? '');
            let status = res.statusCode === 412 ? 409 : [401, 403, 404, 409].includes(res.statusCode) ? res.statusCode : 502;
            // Request parsing can wrap an M0 Open denial as RequestError400
            // with an explicit SenseNetSecurityException exceptiontype.
            if ([400, 500].includes(res.statusCode) && (/^(?:SenseNetSecurityException|AccessDeniedException)$/.test(exceptionType) || /AccessDenied|PermissionDenied|permission.*denied/i.test(backend))) status = 403;
            if (res.statusCode === 400 && /NodeIsOutOfDate|ContentNameAlreadyExists|NameAlreadyExists|already exists/i.test(backend)) status = 409;
            const code = status === 401 ? 'backend_credential_rejected' : status === 403 ? 'backend_denied' : status === 404 ? 'target_unavailable' : status === 409 ? 'revision_conflict' : 'backend_failure';
            reject(new DomainError(code, 'The repository rejected the request.', status)); return;
          }
          resolve({ value: json?.d ?? json, bytes, contentType: res.headers['content-type'], headers: res.headers, status: res.statusCode });
        });
      });
      req.setTimeout(30000, () => req.destroy(new DomainError('repository_timeout', 'Repository request timed out.', 502)));
      req.on('error', error => reject(error instanceof DomainError ? error : new DomainError('repository_transport', 'Repository transport failed.', 502)));
      req.end(body);
    });
  }

  async schemaFor(type) {
    if (!TYPES.includes(type)) fail('invalid_type', 'Unsupported application content type.', 400);
    if (!this.schemas.has(type)) this.schemas.set(type, this.loadSchema(type).catch(error => { this.schemas.delete(type); throw error; }));
    return this.schemas.get(type);
  }
  async schema(type) { return this.schemaFor(type); }
  async loadSchema(type) {
    const fields = new Map(); let current = type, root; const seen = new Set();
    while (current) {
      if (seen.has(current) || seen.size > 20) fail('backend_schema_contract', 'Repository schema inheritance is invalid.', 503);
      seen.add(current);
      const result = await this.api('/Root', 'GetSchema', { query: { contentTypeName: current } });
      const rows = Array.isArray(result) ? result : result?.results;
      const schema = rows?.find(row => row.ContentTypeName === current);
      if (!schema || !Array.isArray(schema.FieldSettings)) fail('backend_schema_unavailable', 'The required repository schema is unavailable.', 503);
      root ??= schema;
      for (const setting of schema.FieldSettings) if (typeof setting.Name === 'string' && !fields.has(setting.Name)) fields.set(setting.Name, setting);
      current = schema.ParentTypeName;
    }
    const required = [...HEADERS, ...STAMPS, ...FIELDS[type].filter(name=>!OPTIONAL_FIELDS.has(name)), ...(COVER_TYPES.has(type) ? ['CoverImageBin'] : [])];
    if (required.some(name => !fields.has(name))) fail('backend_schema_mismatch', 'The repository schema does not support the complete application contract.', 503);
    return { ...root, FieldSettings: [...fields.values()] };
  }

  scope(content, { parent = false, expectedType } = {}) {
    if (parent && content?.Path === this.paths.root && ['Workspace', 'Folder'].includes(content.Type)) return content;
    assertMembership(content, this.paths, { parent, type: expectedType });
    if (parent && !['Workspace', 'Folder', 'Timeline'].includes(content.Type)) fail('invalid_parent', 'The parent is not an application container.', 403);
    if (!parent && !TYPES.includes(content.Type)) fail('invalid_type', 'The target is not an application content type.', 403);
    if (expectedType && content.Type !== expectedType && !(expectedType === 'MediaItem' && content.Type === 'BookMediaItem')) fail('invalid_type', 'Target has a different content type.');
    return content;
  }
  async read(target, options = {}) {
    const header = await this.api(target, null, { query: { '$select': HEADERS.join(','), metadata: 'no' } });
    this.scope(header, options);
    await this.assert([{ target: header.Id, action: 'read' }]);
    const domain = TYPES.includes(header.Type);
    const schema=domain?await this.schemaFor(header.Type):undefined;
    const select = [...HEADERS, ...STAMPS, ...(domain ? FIELDS[header.Type].filter(name=>schema.FieldSettings.some(field=>field.Name===name)) : []), ...(COVER_TYPES.has(header.Type) ? ['CoverImageBin'] : [])];
    const query = { '$select': [...new Set(select.filter(field => field !== 'MediaItem'))].join(','), metadata: 'no' };
    if (header.Type === 'TimelineEntry') { query['$select'] += ',MediaItem/Id'; query['$expand'] = 'MediaItem'; }
    const data = await this.api(header.Id, null, { query }); this.scope(data, options);
    if (data.Type !== header.Type || data.Id !== header.Id) fail('revision_conflict', 'Target changed during the snapshot.');
    const snapshot = Object.fromEntries([...new Set(select)].map(field => [field, data[field] ?? null]));
    if (header.Type === 'TimelineEntry') snapshot.MediaItem = referenceId(data.MediaItem);
    if (!data.ModificationDate || typeof data.Version !== 'string') fail('backend_revision_unavailable', 'Repository snapshot version metadata is unavailable.', 503);
    // The binary URL contains SenseNet's binary timestamp from this same content snapshot.
    const binaryToken = data.CoverImageBin?.__mediaresource ?? null;
    if (COVER_TYPES.has(header.Type)) snapshot.CoverImageBin = binaryToken ? { __mediaresource: { ...binaryToken }, ContentType: binaryToken.content_type ?? null, ETag: binaryToken.media_etag ?? null, SnapshotToken: binaryToken.media_src ?? null } : null;
    snapshot.revision = snapshotRevision(snapshot);
    if (binaryToken?.content_type) {
      const response = await this.request(this.binaryUrl(snapshot.Id), { method: 'HEAD', maxBytes: 0 });
      const size = response.headers['content-length'] === undefined ? null : Number(response.headers['content-length']);
      // This stock BinaryHandler omits Content-Length on HEAD. Unknown size is
      // not an empty binary; the caller can use ContentType and a bounded GET.
      snapshot.CoverImageBin.Size = Number.isSafeInteger(size) && size >= 0 ? size : null;
    } else if (snapshot.CoverImageBin) snapshot.CoverImageBin.Size = 0;
    return snapshot;
  }
  binaryUrl(id) { return this.config.repositoryUrl + '/binaryhandler.ashx?' + new URLSearchParams({ nodeid: assertId(id), propertyname: 'CoverImageBin' }); }
  async coverBytes(id) {
    const target = await this.read(assertId(id));
    if (!COVER_TYPES.has(target.Type)) fail('invalid_cover_target', 'This content does not support covers.', 400);
    await this.assert([{ target: target.Id, action: 'read' }]);
    const response = await this.request(this.binaryUrl(target.Id), { maxBytes: 10 * 1024 * 1024 });
    return coverBytes({ bytesBase64: response.bytes.toString('base64'), mimeType: response.contentType?.split(';')[0] });
  }

  async assert(operations) {
    // Stock HasPermission intentionally excludes Visitor. A concrete minimal
    // GET uses the repository's actual read policy, including the M0 Open gate.
    for (const op of operations) {
      if (op.action === 'read' && !this.credential) {
        const readable = await this.api(op.target, null, { query: { '$select': 'Id', metadata: 'no' } });
        if (!Number.isSafeInteger(readable?.Id) || readable.Id < 1) fail('permission_denied', 'The target is unreadable or unavailable.', 403);
      } else await super.assert([op]);
    }
  }

  async list(type, { parentId, skip = 0, top = 50, search = '', includeHidden = false } = {}) {
    if (!TYPES.includes(type) || !Number.isInteger(skip) || skip < 0 || !Number.isInteger(top) || top < 1 || top > 100 || typeof search !== 'string' || search.length > 200) fail('invalid_query', 'Invalid list/search/page parameters.', 400);
    let parent = type === 'Timeline' ? this.paths.timelines : ['MediaItem', 'BookMediaItem'].includes(type) ? this.paths.media : this.paths.root;
    if (parentId) {
      const content = await this.read(assertId(parentId));
      if (type !== 'TimelineEntry' || content.Type !== 'Timeline') fail('invalid_target', 'Occurrences require a timeline parent.', 400);
      parent = content.Path;
    }
    let query = '+TypeIs:' + type + (includeHidden ? '' : ' +Hidden:0');
    if (search) query += ' +DisplayName:' + JSON.stringify('*' + search.replace(/[\\*?]/g, '') + '*');
    const page = await this.collection(parent, { query: query + (includeHidden ? ' .AUTOFILTERS:OFF .LIFESPAN:OFF' : ''), '$select': 'Id', '$orderby': 'Id', '$skip': skip, '$top': top, metadata: 'no' });
    const items = [];
    for (const row of page.results) {
      try { items.push(await this.read(assertId(row.Id))); } catch (error) { if (![403, 404].includes(error.status)) throw error; }
    }
    return { items, page: { skip, top, nextSkip: page.results.length === top ? skip + top : null } };
  }
  async collection(path, query) {
    const url = this.config.repositoryUrl + '/OData.svc' + path.split('/').map(encodeURIComponent).join('/') + '?' + new URLSearchParams(query);
    const page = (await this.request(url)).value;
    if (!Array.isArray(page?.results)) fail('backend_contract', 'Invalid repository collection response.', 502);
    return page;
  }

  inventory() {
    if (!this.inventoryCredential) fail('inventory_unavailable', 'Complete project inventory is not configured.', 503);
    return new StockRepository(this.config, this.inventoryCredential);
  }
  async verifyInventory() {
    if (!this.inventoryVerification) this.inventoryVerification = this.checkInventory().catch(error => { this.inventoryVerification = null; throw error; });
    return this.inventoryVerification;
  }
  async checkInventory() {
    const inventory = this.inventory(), identity = await inventory.identity();
    if (identity.visitor || identity.Id === 6) fail('inventory_unavailable', 'Project inventory requires its configured read-only service identity.', 503);
    if (this.config.inventoryIdentity !== undefined && this.config.inventoryIdentity !== identity.Id) fail('inventory_unavailable', 'The inventory identity does not match its configured binding.', 503);
    const root = await inventory.api(this.paths.root, null, { query: { '$select': 'Id,Path', metadata: 'no' } });
    if (root?.Path !== this.paths.root || !Number.isSafeInteger(root.Id)) fail('inventory_unavailable', 'The inventory project binding is unavailable.', 503);
    for (const target of [this.paths.root, this.paths.timelines, this.paths.media]) {
      for (const permission of ['See', 'Open', 'OpenMinor']) if (await inventory.api(target, 'HasPermission', { query: { permissions: permission } }) !== true) fail('inventory_unavailable', 'The inventory identity lacks project read coverage.', 503);
      for (const permission of ['Save', 'AddNew', 'Delete', 'SetPermissions']) if (await inventory.api(target, 'HasPermission', { query: { permissions: permission } }) !== false) fail('inventory_overprivileged', 'The inventory identity must have no application write permissions.', 503);
    }
    return { identityId: identity.Id, projectId: root.Id, projectRoot: this.paths.root, repositoryUrl: this.config.repositoryUrl, completeness: 'configured-read-all-project' };
  }
  async inventoryRows(expression) {
    await this.verifyInventory();
    const inventory = this.inventory(), rows = [], ids = new Set();
    for (let skip = 0; ; skip += 100) {
      const page = await inventory.collection(this.paths.root, { query: '+InTree:' + JSON.stringify(this.paths.root) + ' ' + expression + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': 'Id,ParentId,Type', '$orderby': 'Id', '$skip': skip, '$top': 100, metadata: 'no' });
      for (const row of page.results) {
        if (!Number.isSafeInteger(row.Id) || !Number.isSafeInteger(row.ParentId) || typeof row.Type !== 'string' || ids.has(row.Id)) fail('inventory_unavailable', 'Complete project inventory is unavailable.', 503);
        ids.add(row.Id); rows.push({ Id: row.Id, ParentId: row.ParentId, Type: row.Type });
      }
      if (rows.length > 10000) fail('target_limit', 'Operation exceeds the project inventory limit.', 413);
      if (page.results.length < 100) return rows;
    }
  }
  async children(id, purpose = 'order') {
    const timeline = await this.read(assertId(id), { expectedType: 'Timeline' });
    if (!['order', 'delete'].includes(purpose)) fail('invalid_operation', 'Invalid complete child purpose.', 400);
    const rows = await this.inventoryRows('+InTree:' + JSON.stringify(timeline.Path) + ' -Id:' + timeline.Id);
    try {
      if (rows.some(row => row.Type !== 'TimelineEntry' || row.ParentId !== timeline.Id)) fail('permission_denied', 'Complete child access is denied.', 403);
      await this.assert(rows.flatMap(row => [{ target: row.Id, action: 'read' }, { target: row.Id, action: purpose === 'order' ? 'update' : 'delete' }]));
      const children = [];
      for (const row of rows) {
        const child = await this.read(row.Id, { expectedType: 'TimelineEntry' });
        if (child.ParentId !== timeline.Id) fail('permission_denied', 'Complete child access is denied.', 403);
        children.push(child);
      }
      return children;
    } catch (error) {
      if ([403, 404].includes(error.status)) fail('permission_denied', 'Complete child access is denied or unavailable.', 403);
      throw error;
    }
  }
  async references(id) {
    const media = await this.read(assertId(id), { expectedType: 'MediaItem' });
    const rows = await this.inventoryRows('+TypeIs:TimelineEntry +MediaItem:' + media.Id), readableReferences = [];
    for (const row of rows) {
      try {
        await this.assert([{ target: row.Id, action: 'read' }]);
        const entry = await this.read(row.Id, { expectedType: 'TimelineEntry' });
        if (entry.MediaItem !== media.Id) fail('inventory_unavailable', 'Reference inventory changed during the snapshot.', 503);
        readableReferences.push({ id: row.Id, parentId: row.ParentId });
      } catch (error) { if (![403, 404].includes(error.status)) throw error; }
    }
    return { hasReferences: rows.length > 0, readableReferences, completeness: 'configured-read-all-project' };
  }
  async assertLeaf(id) {
    const target = await this.read(assertId(id));
    if (!['TimelineEntry', 'MediaItem', 'BookMediaItem'].includes(target.Type)) fail('invalid_type', 'Leaf deletion applies only to media and occurrences.', 400);
    if ((await this.inventoryRows('+ParentId:' + target.Id)).length) fail('unexpected_children', 'The target has unsupported children; deletion is unavailable.');
  }
  async assertWritableTarget(target) {
    if(target.Type==='TimelineEntry') {
      const parent=await this.read(target.ParentId,{parent:true,expectedType:'Timeline'});
      if(parent.Type!=='Timeline'||!parent.Path.startsWith(this.paths.timelines+'/'))fail('invalid_parent','Occurrence writes require a current timeline parent.',403);
    }
  }

  async writableFields(type, fields, create = false) {
    const data = validateFields(type, fields, { create }), schema = await this.schemaFor(type);
    for (const name of Object.keys(data)) {
      const field=schema.FieldSettings.find(field=>field.Name===name);
      if(field?.ReadOnly!==false)fail('backend_schema_mismatch','A requested field is not supported or writable in the repository schema.',503);
      if(field.Type==='ChoiceFieldSetting') {
        const values=Array.isArray(data[name])?data[name]:[data[name]];
        if(field.AllowMultiple===false&&values.length>1||field.AllowExtraValue===false&&values.some(value=>value!==''&&!field.Options?.some(option=>option.Value===value&&option.Enabled!==false)))fail('backend_choice_mismatch','A requested choice is not supported by this repository schema.',400);
      }
    }
    if (data.MediaItem) await this.read(assertId(data.MediaItem), { expectedType: 'MediaItem' });
    return data;
  }
  revisionMatches(content, expected) { if (content.revision !== expected) fail('revision_conflict', 'The target changed since preview.'); }
  async mutation(payload) { return this.write(payload); }
  async write(payload) {
    if (!payload || !['create', 'update', 'delete', 'cover', 'order'].includes(payload.action) || !TYPES.includes(payload.type)) fail('invalid_operation', 'Invalid application mutation.', 400);
    if (payload.action === 'order') return this.writeOrder(payload);
    if (payload.action === 'create') return this.writeCreate(payload);
    const target = await this.read(assertId(payload.targetId), { expectedType: payload.type });
    await this.assertWritableTarget(target);
    if (target.Type !== payload.type) fail('invalid_type', 'Target has a different exact content type.');
    this.revisionMatches(target, payload.expectedRevision);
    await this.assert([{ target: target.Id, action: payload.action }]);
    if (payload.action === 'delete') {
      if (target.Type === 'Timeline') {
        const children = await this.children(target.Id, 'delete'), entries = payload.entries ?? [];
        if (!sameIds(children.map(row => row.Id), entries.map(row => row.id))) fail('membership_conflict', 'Timeline membership changed since preview.');
        for (const child of children) this.revisionMatches(child, entries.find(row => row.id === child.Id)?.expectedRevision);
      } else {
        await this.assertLeaf(target.Id);
        if (['MediaItem', 'BookMediaItem'].includes(target.Type) && (await this.references(target.Id)).hasReferences) fail('shared_reference_conflict', 'Media is still referenced.');
      }
      return this.executeSingle(async () => {
        await this.api(target.Id, null, { method: 'DELETE', query: { permanent: 'true' } });
        return { id: target.Id, revision: target.revision, deleted: true };
      }, target.Id);
    }
    const hasFields = payload.fields && Object.keys(payload.fields).length > 0;
    const fields = hasFields ? await this.writableFields(target.Type, payload.fields) : null;
    if (fields?.Name && fields.Name !== target.Name) await this.assertNameAvailable(target.Path.slice(0, target.Path.lastIndexOf('/')) + '/' + fields.Name, target.Id);
    if (payload.action === 'update' && !fields && !payload.bytesBase64) fail('empty_change', 'At least one change is required.', 400);
    const cover = payload.bytesBase64 !== undefined ? coverBytes(payload) : null;
    if (payload.action === 'cover' && !cover) fail('invalid_cover', 'A binary cover is required.', 400);
    if (cover && !COVER_TYPES.has(target.Type)) fail('invalid_cover_target', 'This content does not support covers.', 400);
    const completed = []; let awaitingReadback = false;
    try {
      if (fields) {
        await this.api(target.Id, null, { method: 'PATCH', body: fields }); awaitingReadback = true;
        const after = await this.read(target.Id);
        completed.push({ id: after.Id, revision: after.revision, fieldsApplied: true, coverApplied: false }); awaitingReadback = false;
        if (fields.Name && after.Name !== fields.Name) return { ok: false, code: 'name_conflict', message: 'Repository update did not preserve the requested Name.', completed: [{ ...completed[0], fieldsApplied: false }], failedId: target.Id, atomic: false };
      }
      if (cover) {
        await this.assert([{ target: target.Id, action: 'cover' }]);
        await this.uploadCover(target, payload, cover); awaitingReadback = true;
      }
      const after = await this.read(target.Id), result = { id: after.Id, revision: after.revision, fieldsApplied: Boolean(fields), coverApplied: Boolean(cover) };
      return { ok: true, result, completed: [result], atomic: !(fields && cover) };
    } catch (error) { return this.partial(error, completed, target.Id, awaitingReadback); }
  }
  async writeCreate(payload) {
    const parent = await this.read(assertId(payload.parentId), { parent: true });
    this.revisionMatches(parent, payload.expectedRevision);
    const valid = payload.type === 'Timeline' ? parent.Path === this.paths.timelines : payload.type === 'TimelineEntry' ? parent.Type === 'Timeline' && parent.Path.startsWith(this.paths.timelines + '/') : ['MediaItem', 'BookMediaItem'].includes(payload.type) && (parent.Path === this.paths.media || parent.Type === 'Folder' && parent.Path.startsWith(this.paths.media + '/'));
    if (!valid) fail('invalid_parent', 'Parent does not match the application content type.', 403);
    const fields = await this.writableFields(payload.type, payload.fields, true);
    await this.assert([{ target: parent.Id, action: 'create', type: payload.type }]);
    const path = parent.Path + '/' + safeName(fields.Name);
    // Read-only inventory detects an unreadable colliding Name as well. No adoption or suffix retry.
    await this.assertNameAvailable(path);
    let created;
    try {
      created = await this.api(parent.Id, null, { method: 'POST', body: { __ContentType: payload.type, ...fields } });
      if (!Number.isSafeInteger(created?.Id)) fail('backend_contract', 'Create response did not include a content identifier.', 502);
      const after = await this.read(created.Id);
      const result = { id: after.Id, revision: after.revision, created: true, replayed: false };
      if (after.Name !== fields.Name || after.ParentId !== parent.Id || after.Type !== payload.type) return { ok: false, code: 'create_name_conflict', message: 'Repository create did not preserve the reserved Name/type/parent.', completed: [result], failedId: created.Id, atomic: false };
      return { ok: true, result, completed: [result] };
    } catch (error) { return this.partial(error, created?.Id ? [{ id: created.Id, created: true }] : [], parent.Id, Boolean(created?.Id)); }
  }
  async writeOrder(payload) {
    const timeline = await this.read(assertId(payload.targetId), { expectedType: 'Timeline' });
    this.revisionMatches(timeline, payload.expectedRevision);
    const children = await this.children(timeline.Id, 'order'), entries = payload.entries;
    if (!Array.isArray(entries) || !entries.length || entries.length > 5000 || !sameIds(children.map(row => row.Id), entries.map(row => row.id))) fail('membership_conflict', 'Order requires every current occurrence exactly once.');
    if (!sameIds(entries.map(row => row.position), entries.map((_, index) => index + 1))) fail('invalid_order', 'Order positions must be exactly 1..count.', 400);
    for (const child of children) this.revisionMatches(child, entries.find(row => row.id === child.Id).expectedRevision);
    const completed = [];
    for (const entry of entries) {
      let awaitingReadback = false;
      try {
        await this.assert([{ target: entry.id, action: 'update' }]);
        await this.api(entry.id, null, { method: 'PATCH', body: { Position: entry.position } }); awaitingReadback = true;
        const after = await this.read(entry.id); completed.push({ id: after.Id, revision: after.revision, position: entry.position });
      } catch (error) { return this.partial(error, completed, entry.id, awaitingReadback); }
    }
    return { ok: true, completed, atomic: false };
  }
  async assertNameAvailable(path, existingId) {
    await this.verifyInventory();
    const inventory = this.inventory();
    try {
      const existing = await inventory.api(path, null, { query: { '$select': 'Id', metadata: 'no' } });
      if (!Number.isSafeInteger(existing?.Id)) fail('inventory_unavailable', 'Name reservation could not be checked.', 503);
      if (existing.Id !== existingId) fail('name_conflict', 'The reserved repository Name already exists.');
    } catch (error) { if (error.status !== 404) throw error; }
  }
  async executeSingle(fn, id) {
    try { const result = await fn(); return { ok: true, result, completed: [result] }; }
    catch (error) { return this.partial(error, [], id, false); }
  }
  partial(error, completed, failedId, acknowledgedWrite) {
    const uncertain = TRANSPORT_ERRORS.has(error.code) || acknowledgedWrite;
    return { ok: false, code: error.code || 'backend_failure', status: error.status || 502, message: error.message || 'Repository mutation failed.', completed, failedId, atomic: false, ...(uncertain ? { uncertain: true } : {}) };
  }
  async uploadCover(target, payload, bytes) {
    const boundary = 'timeline-' + randomBytes(16).toString('hex'), chunks = [], name = payload.fileName || 'cover';
    for (const [key, value] of Object.entries({ ChunkToken: '0*0*False*False', FileName: name, Overwrite: 'true', PropertyName: 'CoverImageBin', FileLength: bytes.length, ContentType: target.Type, ContentId: target.Id })) chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${name}"\r\nContent-Type: ${payload.mimeType}\r\n\r\n`), bytes, Buffer.from(`\r\n--${boundary}--\r\n`));
    await this.request(this.endpoint(target.ParentId) + '/Upload', { method: 'POST', body: Buffer.concat(chunks), headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary } });
  }
  async receipt() { fail('application_journal_required', 'Durable receipts belong to the application mutation journal.', 503); }
}

function referenceId(value) {
  if (value == null) return null;
  if (Number.isSafeInteger(value) && value > 0) return value;
  const rows = Array.isArray(value) ? value : Array.isArray(value.results) ? value.results : [value];
  if (!rows.length) return null;
  if (rows.length !== 1 || !Number.isSafeInteger(rows[0]?.Id) || rows[0].Id < 1) fail('backend_reference_contract', 'Invalid occurrence media reference.', 502);
  return rows[0].Id;
}
function coverBytes(payload) {
  if (typeof payload.bytesBase64 !== 'string' || payload.bytesBase64.length > 14 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(payload.bytesBase64) || !['image/png', 'image/jpeg', 'image/webp'].includes(payload.mimeType)) fail('invalid_cover', 'Expected a bounded PNG, JPEG or WebP cover.', 400);
  const bytes = Buffer.from(payload.bytesBase64, 'base64');
  const matches = payload.mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : payload.mimeType === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!bytes.length || bytes.length > 10 * 1024 * 1024 || !matches || payload.fileName !== undefined && (typeof payload.fileName !== 'string' || !payload.fileName.trim() || payload.fileName.length > 100 || /[\\/"\r\n\x00]/.test(payload.fileName))) fail('invalid_cover', 'Cover signature or file name is invalid.', 400);
  return bytes;
}
