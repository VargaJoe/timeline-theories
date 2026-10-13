#!/usr/bin/env node
'use strict';

// Production is read-only: MCP tools are allowlisted and binary transport is GET-only.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const ROOT_PATH = '/Root/Content/timelines';
const PRODUCTION_URL = 'https://plastice.sensenet.cloud/';
const FORMAT_VERSION = 1;
const READ_TOOLS = new Set(['TestRepositoryConnection', 'GetContentTypeSchema', 'GetContentFields', 'GetContentsByQuery', 'GetCountOfContentsByQuery', 'DownloadFile']);
const IDENTITY_FIELDS = /^(?:Owner(?:Id)?|CreatedBy(?:Id)?|ModifiedBy(?:Id)?|VersionCreatedBy(?:Id)?|VersionModifiedBy(?:Id)?|CheckedOutTo|Manager|Members|MemberOf|SharedBy|SharedWith|Sharing(?:Level|Mode)?|Email|LoginName|Username|FullName|Avatar)$/i;
const SECRET_FIELDS = /password|passwd|secret|credential|authorization|apikey|api_key|token|authentication/i;
const EXCLUDED_TYPES = /^(?:User|Group|Domain|OrganizationalUnit|Identity|ApiKey|ApiKeyStore|AccessToken)$/i;
const VERSION_FIELDS = new Set(['Versions']);

function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function decodeBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/\r\n]*={0,2}$/.test(value)) throw new Error('Invalid binary base64 download');
  const compact = value.replace(/[\r\n]/g, '');
  const bytes = Buffer.from(compact, 'base64');
  if (bytes.toString('base64') !== compact) throw new Error('Noncanonical or truncated binary download');
  return bytes;
}
function inTree(value, root = ROOT_PATH) { return typeof value === 'string' && !value.includes('\\') && !value.split('/').some(segment => segment === '.' || segment === '..') && (value === root || value.startsWith(root + '/')); }
function isSchemaPath(value) { return typeof value === 'string' && /^\/Root\/System\/Schema\/ContentTypes(?:\/[A-Za-z][A-Za-z0-9_]*)+$/.test(value); }
function isExcludedField(name) { return IDENTITY_FIELDS.test(name) || SECRET_FIELDS.test(name) || VERSION_FIELDS.has(name); }
function jsonString(value) { return typeof value === 'string' && /^[\s]*[\[{]/.test(value) ? JSON.parse(value) : value; }
function unpackResult(result, { binary = false } = {}) {
  if (result?.isError) throw new Error('MCP tool reported an error');
  const raw = result?.structuredContent ?? result?.content?.filter(item => item.type === 'text').map(item => item.text).join('\n') ?? result;
  let value = raw;
  if (typeof raw === 'string' && !binary) { try { value = JSON.parse(raw); } catch { throw new Error('Invalid MCP JSON response'); } }
  if (value && typeof value === 'object' && (value.error || value.Error)) throw new Error('MCP tool returned an error object');
  if (binary && typeof raw === 'string' && /^\s*\{/.test(raw)) throw new Error('MCP download returned an error object');
  return value;
}
function parseTomlString(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"')) { try { return JSON.parse(trimmed); } catch { throw new Error('Invalid configured MCP string'); } }
  if (/^'[^']*'$/.test(trimmed)) return trimmed.slice(1, -1);
  throw new Error('MCP configuration must use literal string values');
}
async function loadConfiguredMcp(configPath = path.join(os.homedir(), '.codex', 'config.toml')) {
  const source = await fs.readFile(configPath, 'utf8');
  const config = { headers: {} }; let section = '';
  for (const line of source.split(/\r?\n/)) {
    const heading = line.match(/^\s*\[([^\]]+)\]\s*(?:#.*)?$/);
    if (heading) { section = heading[1].replace(/["']/g, ''); continue; }
    const pair = line.match(/^\s*([\w-]+|"[^"]+")\s*=\s*(.+?)\s*$/);
    if (!pair) continue;
    const key = pair[1].replace(/^"|"$/g, '');
    if (/^mcp_servers\.sensenet[-_]plastice$/.test(section) && key === 'url') config.url = parseTomlString(pair[2]);
    if (/^mcp_servers\.sensenet[-_]plastice\.http_headers$/.test(section)) config.headers[key] = parseTomlString(pair[2]);
  }
  if (!config.url || new URL(config.url).protocol !== 'https:') throw new Error('Configured production MCP endpoint must use HTTPS');
  const repositoryUrl = Object.entries(config.headers).find(([key]) => key.toLowerCase() === 'repository-url')?.[1];
  const apiKey = Object.entries(config.headers).find(([key]) => key.toLowerCase() === 'repository-apikey')?.[1];
  if (!repositoryUrl || new URL(repositoryUrl).href !== PRODUCTION_URL || !apiKey) throw new Error('Configured MCP repository must be the expected production origin with an API key');
  return { ...config, repositoryUrl, apiKey };
}
class McpClient {
  constructor(config, fetchImpl = fetch) { this.config = config; this.fetch = fetchImpl; this.sessionId = undefined; this.id = 0; }
  async request(method, params, notification = false) {
    const requestId = notification ? undefined : ++this.id;
    const response = await this.fetch(this.config.url, {
      method: 'POST', redirect: 'error', headers: { ...this.config.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(this.sessionId ? { 'Mcp-Session-Id': this.sessionId } : {}) },
      body: JSON.stringify({ jsonrpc: '2.0', ...(notification ? {} : { id: requestId }), method, ...(params === undefined ? {} : { params }) }), signal: AbortSignal.timeout(120000),
    });
    const session = response.headers.get('mcp-session-id'); if (session) this.sessionId = session;
    if (!response.ok) throw new Error(`MCP transport HTTP ${response.status}`);
    if (notification || response.status === 202 || response.status === 204) { await response.body?.cancel(); return undefined; }
    const body = await response.text(); let parsed;
    try {
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        parsed = body.split(/\r?\n\r?\n/).map(block => block.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')).filter(Boolean).map(value => JSON.parse(value)).find(value => value.id === requestId);
      } else parsed = JSON.parse(body);
    } catch { throw new Error('Invalid MCP transport response'); }
    if (!parsed || parsed.id !== requestId || parsed.error) throw new Error('MCP protocol request failed');
    return parsed.result;
  }
  async initialize() {
    this.sessionId = undefined;
    await this.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'timeline-m0-read-only-snapshot', version: '1.0.0' } });
    await this.request('notifications/initialized', undefined, true);
  }
  async call(name, args = {}) {
    if (!READ_TOOLS.has(name)) throw new Error('Production MCP write tool refused');
    if (name === 'DownloadFile' && !inTree(args.path) && !isSchemaPath(args.path)) throw new Error('MCP download outside approved snapshot scope');
    if (name === 'GetContentFields' && !inTree(args.contentPath)) throw new Error('MCP fields outside approved snapshot scope');
    if (name === 'GetContentTypeSchema' && (!/^[A-Za-z][A-Za-z0-9_]*$/.test(args.contentTypeName ?? '') || EXCLUDED_TYPES.test(args.contentTypeName))) throw new Error('MCP schema outside approved snapshot scope');
    if (name === 'GetContentsByQuery' || name === 'GetCountOfContentsByQuery') {
      if (!/^\+InTree:\/Root\/Content\/timelines(?: \+Type:[A-Za-z][A-Za-z0-9_]*)?(?: \.SORT:Id \.SKIP:\d+ \.TOP:\d+)?$/.test(args.query ?? '') || args.autoFilterStatus !== 0 || args.lifespanFilterStatus !== 0) throw new Error('MCP query outside approved snapshot scope or filter policy');
    }
    if (!this.sessionId) await this.initialize();
    try { return unpackResult(await this.request('tools/call', { name, arguments: args }), { binary: name === 'DownloadFile' }); }
    catch (error) {
      // A vanished MCP session is transport failure, never missing repository data.
      if (!/MCP transport HTTP 404/.test(error.message)) throw error;
      await this.initialize();
      return unpackResult(await this.request('tools/call', { name, arguments: args }), { binary: name === 'DownloadFile' });
    }
  }
  async binary(record, field, resource) {
    if (!inTree(record.path) || !Number.isSafeInteger(record.id) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(field)) throw new Error('Binary endpoint is outside the approved content field');
    const source = new URL(resource.media_src, PRODUCTION_URL);
    if (source.origin !== new URL(PRODUCTION_URL).origin || source.pathname.toLowerCase() !== '/binaryhandler.ashx' || source.searchParams.get('nodeid') !== String(record.id) || source.searchParams.get('propertyname') !== field) throw new Error('Binary endpoint is outside the approved content field');
    if (source.username || source.password || source.hash || [...source.searchParams.keys()].some(key => !['nodeid', 'propertyname', 'checksum', 'version'].includes(key))) throw new Error('Unexpected binary URL component');
    const response = await this.fetch(source.href, { method: 'GET', redirect: 'error', headers: { ApiKey: this.config.apiKey }, signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Binary download HTTP ${response.status}`);
    const contentType = response.headers.get('content-type');
    if (resource.content_type && contentType && resource.content_type.split(';')[0].toLowerCase() !== contentType.split(';')[0].toLowerCase() && contentType.split(';')[0].toLowerCase() !== 'application/octet-stream') throw new Error('Binary response content type does not match metadata');
    return { bytes: Buffer.from(await response.arrayBuffer()), contentType, sourcePath: source.pathname + source.search };
  }
}
function normalizeField(value, definition) {
  const type = definition.type;
  if (value === null || value === undefined) return null;
  if (type === 'Boolean') {
    if (typeof value === 'boolean') return value;
    if (/^(?:true|false)$/i.test(String(value))) return String(value).toLowerCase() === 'true';
    throw new Error(`Invalid Boolean field ${definition.name}`);
  }
  if (type === 'Integer' || type === 'Number') {
    const number = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(number) || (type === 'Integer' && !Number.isSafeInteger(number)) || value === '') throw new Error(`Invalid numeric field ${definition.name}`);
    return number;
  }
  if (type === 'DateTime') {
    if (/^\d{4}-\d\d-\d\dT/.test(String(value))) return value;
    const match = String(value).match(/^(\d\d)\/(\d\d)\/(\d{4}) (\d\d):(\d\d):(\d\d)$/);
    if (!match) throw new Error(`Unsupported DateTime representation for ${definition.name}`);
    return `${match[3]}-${match[1]}-${match[2]}T${match[4]}:${match[5]}:${match[6]}Z`;
  }
  if (type === 'Reference') {
    const parsed = jsonString(value);
    if (parsed?.__deferred) throw new Error(`Unexpanded Reference field ${definition.name}`);
    const refs = parsed?.results ?? (Array.isArray(parsed) ? parsed : [parsed]);
    return refs.filter(Boolean).map(ref => {
      if (!Number.isSafeInteger(ref.Id ?? ref.id) || !inTree(ref.Path ?? ref.path) || EXCLUDED_TYPES.test(ref.Type ?? ref.type ?? '')) throw new Error(`Reference outside project in ${definition.name}`);
      return ref.Id ?? ref.id;
    });
  }
  if (type === 'Choice' || /Mode$/.test(type) || ['AllowedChildTypes', 'Rating', 'Binary'].includes(type)) return jsonString(value);
  return value;
}
function sanitizeRecord(raw, schema) {
  const id = raw.id ?? raw.Id; const contentPath = raw.path ?? raw.Path; const type = raw.type ?? raw.Type;
  if (!Number.isSafeInteger(id) || !inTree(contentPath) || EXCLUDED_TYPES.test(type) || type !== schema.name) throw new Error('Invalid or disallowed project content record');
  const record = { id, path: contentPath, name: raw.name ?? raw.Name, displayName: raw.displayName ?? raw.DisplayName ?? null, type, rawFields: {}, fields: {}, excludedFields: [] };
  for (const definition of schema.fields) {
    const name = definition.name;
    if (isExcludedField(name)) { record.excludedFields.push({ name, reason: VERSION_FIELDS.has(name) ? 'current-content-only' : 'identity-or-secret' }); continue; }
    let value = raw[name];
    if (value === undefined && ['Id', 'Path', 'Type', 'Name', 'DisplayName'].includes(name)) value = raw[name[0].toLowerCase() + name.slice(1)];
    value ??= null;
    if (definition.type === 'Reference' && value !== null) {
      const parsed = jsonString(value);
      if (parsed?.__deferred) throw new Error(`Reference was not expanded: ${type}.${name}`);
      const refs = parsed?.results ?? (Array.isArray(parsed) ? parsed : [parsed]);
      const kept = []; let excluded = 0;
      for (const ref of refs.filter(Boolean)) {
        if (!inTree(ref.Path ?? ref.path) || EXCLUDED_TYPES.test(ref.Type ?? ref.type ?? '')) { excluded++; continue; }
        kept.push({ Id: ref.Id ?? ref.id, Path: ref.Path ?? ref.path, Type: ref.Type ?? ref.type });
      }
      if (excluded) record.excludedFields.push({ name, reason: 'reference-outside-project', count: excluded });
      // Preserve the MCP JSON-string representation without nested identities or external content.
      value = typeof value === 'string' ? JSON.stringify(kept) : kept;
    }
    if (definition.type === 'AllowedChildTypes') {
      const parsed = value === null ? null : jsonString(value);
      if (parsed?.__deferred) throw new Error(`Child type field was not expanded: ${type}.${name}`);
      value = parsed === null ? null : JSON.stringify((parsed?.results ?? (Array.isArray(parsed) ? parsed : [parsed])).map(ref => typeof ref === 'string' ? ref : ref.Name ?? ref.name));
    }
    record.rawFields[name] = value;
    record.fields[name] = normalizeField(value, definition);
  }
  return record;
}
async function paginated(client, query, count, options = {}) {
  const top = options.pageSize ?? 100; const records = []; const ids = new Set(); const pages = new Set(); let lastId = -1;
  for (let skip = 0; skip < count; skip += top) {
    const page = await client.call('GetContentsByQuery', { query: `${query} .SORT:Id .SKIP:${skip} .TOP:${top}`, autoFilterStatus: 0, lifespanFilterStatus: 0, select: options.select ?? ['Id', 'Path', 'Type'], expand: options.expand ?? [], skip, top });
    if (!Array.isArray(page) || page.length !== Math.min(top, count - skip)) throw new Error('Incomplete or oversized pagination page');
    const signature = page.map(record => record.id ?? record.Id).join(',');
    if (pages.has(signature)) throw new Error('Repeated pagination page'); pages.add(signature);
    for (const record of page) {
      const id = record.id ?? record.Id;
      if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error('Duplicate or invalid content Id');
      if (id <= lastId) throw new Error('Pagination is not sorted by stable Id');
      if (!inTree(record.path ?? record.Path)) throw new Error('Query returned content outside project');
      ids.add(id); lastId = id; records.push(record);
    }
    options.progress?.({ page: Math.floor(skip / top) + 1, fetched: records.length, total: count });
  }
  return records;
}
async function mapLimit(items, limit, callback) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => { while (cursor < items.length) { const index = cursor++; await callback(items[index], index); } }));
}
async function writeJson(filename, value) { const bytes = Buffer.from(JSON.stringify(value, null, 2) + '\n'); await fs.writeFile(filename, bytes, { flag: 'wx' }); return { sha256: sha256(bytes), bytes: bytes.length }; }
async function collectSnapshot(client, outputDir, options = {}) {
  const startedAt = new Date().toISOString();
  await fs.mkdir(outputDir, { recursive: false }); await fs.mkdir(path.join(outputDir, 'schemas')); await fs.mkdir(path.join(outputDir, 'binaries'));
  const query = `+InTree:${ROOT_PATH}`;
  const countArgs = { query, autoFilterStatus: 0, lifespanFilterStatus: 0 };
  const initialCount = await client.call('GetCountOfContentsByQuery', countArgs);
  if (!Number.isSafeInteger(initialCount) || initialCount < 1) throw new Error('Invalid or empty production project count');
  // Confirm fields before constructing the first content query.
  const generic = await client.call('GetContentTypeSchema', { contentTypeName: 'GenericContent' });
  if (!['Id', 'Path', 'Type'].every(name => generic.fields?.some(field => field.name === name))) throw new Error('Required core fields are missing');
  const inventory = await paginated(client, query, initialCount, { pageSize: options.pageSize, progress: options.progress });
  const schemas = {}; const schemaFiles = []; const files = [];
  const pending = [...new Set(inventory.map(record => record.type ?? record.Type))];
  while (pending.length) {
    const name = pending.shift();
    if (schemas[name]) continue;
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name) || EXCLUDED_TYPES.test(name)) throw new Error('Disallowed content type in project tree');
    const schema = name === 'GenericContent' ? generic : await client.call('GetContentTypeSchema', { contentTypeName: name });
    if (schema.name !== name || !isSchemaPath(schema.path) || schema.path.split('/').at(-1) !== name || !Array.isArray(schema.fields)) throw new Error('Invalid production content type schema');
    if (schema.fields.some(field => !/^[A-Za-z][A-Za-z0-9_]*$/.test(field.name) || typeof field.type !== 'string') || new Set(schema.fields.map(field => field.name)).size !== schema.fields.length) throw new Error('Invalid production schema field definitions');
    schemas[name] = schema;
    if (schema.parentTypeName && !schemas[schema.parentTypeName]) pending.push(schema.parentTypeName);
    const base64 = await client.call('DownloadFile', { path: schema.path });
    const xml = decodeBase64(base64);
    if (!xml.toString('utf8').includes(`<ContentType name="${name}"`)) throw new Error('Schema XML does not match type');
    const xmlPath = `schemas/${name}.xml`; const metadataPath = `schemas/${name}.json`;
    await fs.writeFile(path.join(outputDir, xmlPath), xml, { flag: 'wx' });
    const metadata = await writeJson(path.join(outputDir, metadataPath), schema);
    schemaFiles.push({ name, parentTypeName: schema.parentTypeName, sourcePath: schema.path, xmlFile: xmlPath, metadataFile: metadataPath });
    files.push({ path: xmlPath, sha256: sha256(xml), bytes: xml.length }, { path: metadataPath, ...metadata });
    options.log?.(`schema ${name}`);
  }
  const records = []; const typeCounts = {};
  for (const name of [...new Set(inventory.map(record => record.type ?? record.Type))].sort()) {
    const schema = schemas[name]; const count = inventory.filter(record => (record.type ?? record.Type) === name).length;
    const expectedIds = new Set(inventory.filter(record => (record.type ?? record.Type) === name).map(record => record.id ?? record.Id));
    const selected = schema.fields.filter(field => !isExcludedField(field.name));
    const raw = await paginated(client, `${query} +Type:${name}`, count, { pageSize: options.pageSize, select: selected.map(field => field.name), expand: selected.filter(field => ['Reference', 'AllowedChildTypes'].includes(field.type)).map(field => field.name), progress: options.progress });
    for (const item of raw) {
      if (!expectedIds.delete(item.id ?? item.Id)) throw new Error('Content inventory changed during snapshot');
      records.push(sanitizeRecord(item, schema));
    }
    if (expectedIds.size) throw new Error('Content inventory is incomplete');
    typeCounts[name] = count; options.log?.(`content ${name}: ${count}`);
  }
  records.sort((a, b) => a.id - b.id);
  const binaryTasks = [];
  for (const record of records) for (const definition of schemas[record.type].fields.filter(field => field.type === 'Binary' && !isExcludedField(field.name))) {
    const resource = record.fields[definition.name]?.__mediaresource;
    if (resource?.media_src) binaryTasks.push({ record, field: definition.name, resource });
    else if (record.fields[definition.name] !== null && resource === undefined) throw new Error('Unknown binary field representation');
  }
  const binaries = []; let completed = 0;
  await mapLimit(binaryTasks, options.binaryConcurrency ?? 6, async ({ record, field, resource }) => {
    const result = field === 'Binary' ? { bytes: decodeBase64(await client.call('DownloadFile', { path: record.path })), contentType: resource.content_type, sourcePath: record.path } : await client.binary(record, field, resource);
    const filename = `binaries/${record.id}-${field}.bin`;
    const metadata = { contentId: record.id, field, path: filename, sha256: sha256(result.bytes), bytes: result.bytes.length, contentType: result.contentType ?? resource.content_type, sourcePath: result.sourcePath };
    await fs.writeFile(path.join(outputDir, filename), result.bytes, { flag: 'wx' }); binaries.push(metadata); files.push({ path: filename, sha256: metadata.sha256, bytes: metadata.bytes });
    completed++; if (completed % 100 === 0 || completed === binaryTasks.length) options.log?.(`binary ${completed}/${binaryTasks.length}`);
  });
  binaries.sort((a, b) => a.contentId - b.contentId || a.field.localeCompare(b.field));
  const finalInventory = await paginated(client, query, await client.call('GetCountOfContentsByQuery', countArgs), { pageSize: options.pageSize });
  if (finalInventory.length !== inventory.length || finalInventory.some((record, index) => (record.id ?? record.Id) !== (inventory[index].id ?? inventory[index].Id) || (record.path ?? record.Path) !== (inventory[index].path ?? inventory[index].Path) || (record.type ?? record.Type) !== (inventory[index].type ?? inventory[index].Type))) throw new Error('Production inventory changed during snapshot');
  files.push({ path: 'contents.json', ...await writeJson(path.join(outputDir, 'contents.json'), records) });
  const counts = { total: records.length, byType: typeCounts, hidden: records.filter(record => record.fields.Hidden === true).length, visibleTimelines: records.filter(record => record.type === 'Timeline' && record.fields.IsVisible === true).length, privateTimelines: records.filter(record => record.type === 'Timeline' && record.fields.IsVisible === false).length, binaries: binaries.length, binaryBytes: binaries.reduce((sum, binary) => sum + binary.bytes, 0) };
  const manifest = { formatVersion: FORMAT_VERSION, complete: true, sourceUrl: PRODUCTION_URL, rootPath: ROOT_PATH, startedAt, completedAt: new Date().toISOString(), filterPolicy: { query, autoFilterStatus: 0, lifespanFilterStatus: 0, hidden: 'included', private: 'included', versions: 'current-content-only', identityFields: 'excluded', secrets: 'excluded', externalReferences: 'excluded', schemaDefinitions: 'included-without-instance-values', dateTimeSourceFormat: 'MM/dd/yyyy HH:mm:ss (MCP); ISO UTC normalized' }, counts, contentFile: 'contents.json', schemaFiles, binaries, files: files.sort((a, b) => a.path.localeCompare(b.path)), consistency: { stableIdPagination: true, initialInventoryCount: initialCount, finalInventoryCount: finalInventory.length, transactional: false, note: 'Inventory was checked before and after export. Concurrent edits of existing fields cannot be excluded; quiescent source is required for a transactional backup.' } };
  await writeJson(path.join(outputDir, 'manifest.json'), manifest);
  await verifySnapshot(outputDir);
  return manifest;
}
function safeRelative(root, relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.startsWith('/') || relative.split('/').some(segment => !segment || segment === '.' || segment === '..')) throw new Error('Unsafe snapshot file path');
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(path.resolve(root) + path.sep)) throw new Error('Snapshot file escapes directory');
  return absolute;
}
async function rejectSymlinks(filename, root) {
  // fs.realpath may be unavailable in a restricted Windows host. lstat each
  // component instead, including the root, to refuse symlinks and junctions.
  for (let current = filename; ; current = path.dirname(current)) {
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Snapshot path resolves through symlink');
    if (current === root) break;
    if (path.dirname(current) === current) throw new Error('Snapshot path is outside directory');
  }
}
async function verifySnapshot(outputDir) {
  const root = path.resolve(outputDir);
  await rejectSymlinks(root, root);
  await rejectSymlinks(path.join(root, 'manifest.json'), root);
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  if (manifest.formatVersion !== FORMAT_VERSION || !manifest.complete || manifest.sourceUrl !== PRODUCTION_URL || manifest.rootPath !== ROOT_PATH || manifest.filterPolicy?.autoFilterStatus !== 0 || manifest.filterPolicy?.lifespanFilterStatus !== 0) throw new Error('Unsupported or incomplete snapshot manifest');
  const knownFiles = new Set();
  for (const file of manifest.files) {
    if (knownFiles.has(file.path)) throw new Error('Duplicate snapshot file manifest entry'); knownFiles.add(file.path);
    const filename = safeRelative(root, file.path);
    await rejectSymlinks(filename, root);
    const bytes = await fs.readFile(filename);
    if (bytes.length !== file.bytes || sha256(bytes) !== file.sha256) throw new Error(`Snapshot integrity check failed: ${file.path}`);
  }
  if (!knownFiles.has(manifest.contentFile)) throw new Error('Content file is not covered by checksum manifest');
  const records = JSON.parse(await fs.readFile(safeRelative(root, manifest.contentFile), 'utf8'));
  if (!Array.isArray(records) || records.length !== manifest.counts.total) throw new Error('Snapshot content count mismatch');
  const ids = new Set(); const paths = new Set(); const byType = {}; const schemaMap = new Map();
  for (const schema of manifest.schemaFiles) {
    if (!knownFiles.has(schema.xmlFile) || !knownFiles.has(schema.metadataFile) || schemaMap.has(schema.name)) throw new Error('Schema checksum coverage is incomplete');
    const metadata = JSON.parse(await fs.readFile(safeRelative(root, schema.metadataFile), 'utf8'));
    if (metadata.name !== schema.name || !Array.isArray(metadata.fields)) throw new Error('Schema metadata does not match manifest');
    schemaMap.set(schema.name, metadata);
  }
  for (const record of records) {
    if (!Number.isSafeInteger(record.id) || ids.has(record.id) || paths.has(record.path) || !inTree(record.path) || EXCLUDED_TYPES.test(record.type)) throw new Error('Invalid, duplicated or out-of-tree snapshot content');
    ids.add(record.id); paths.add(record.path); byType[record.type] = (byType[record.type] ?? 0) + 1;
    const schema = schemaMap.get(record.type); if (!schema) throw new Error('Content schema missing');
    for (const bag of [record.rawFields, record.fields]) if (!bag || Object.keys(bag).some(isExcludedField)) throw new Error('Snapshot contains disallowed field');
    for (const definition of schema.fields.filter(field => !isExcludedField(field.name))) {
      if (!Object.hasOwn(record.fields, definition.name) || !Object.hasOwn(record.rawFields, definition.name)) throw new Error('Snapshot field coverage is incomplete');
      if (JSON.stringify(normalizeField(record.rawFields[definition.name], definition)) !== JSON.stringify(record.fields[definition.name])) throw new Error('Snapshot typed normalization mismatch');
    }
  }
  if (JSON.stringify(Object.entries(byType).sort()) !== JSON.stringify(Object.entries(manifest.counts.byType).sort())) throw new Error('Snapshot type counts mismatch');
  if (records.filter(record => record.fields.Hidden === true).length !== manifest.counts.hidden || records.filter(record => record.type === 'Timeline' && record.fields.IsVisible === true).length !== manifest.counts.visibleTimelines || records.filter(record => record.type === 'Timeline' && record.fields.IsVisible === false).length !== manifest.counts.privateTimelines) throw new Error('Snapshot visibility counts mismatch');
  const discoveredBinaries = new Set();
  for (const record of records) for (const field of schemaMap.get(record.type).fields) {
    if (field.type === 'Reference' && record.fields[field.name]?.some(id => !ids.has(id))) throw new Error(`Snapshot reference target missing: content ${record.id}, field ${field.name}`);
    if (field.type === 'Binary' && record.fields[field.name]?.__mediaresource?.media_src) discoveredBinaries.add(`${record.id}:${field.name}`);
  }
  for (const binary of manifest.binaries) {
    const fingerprint = `${binary.contentId}:${binary.field}`;
    if (!discoveredBinaries.delete(fingerprint) || !knownFiles.has(binary.path)) throw new Error('Binary mapping is incomplete or duplicated');
    const file = manifest.files.find(file => file.path === binary.path);
    if (file.sha256 !== binary.sha256 || file.bytes !== binary.bytes) throw new Error('Binary manifest integrity mismatch');
  }
  if (discoveredBinaries.size || manifest.binaries.length !== manifest.counts.binaries || manifest.binaries.reduce((sum, binary) => sum + binary.bytes, 0) !== manifest.counts.binaryBytes) throw new Error('Snapshot binary coverage mismatch');
  return { manifest, records, schemas: Object.fromEntries(schemaMap), directory: root };
}
async function main(args = process.argv.slice(2)) {
  if (args[0] === '--verify' && args.length === 2) {
    const result = await verifySnapshot(path.resolve(args[1])); console.log(JSON.stringify({ verified: true, counts: result.manifest.counts })); return;
  }
  if (args.length) throw new Error('Usage: node scripts/m0-snapshot.cjs [--verify snapshot-directory]');
  const repositoryRoot = path.resolve(__dirname, '..'); const snapshotRoot = path.join(repositoryRoot, 'deployment', '.local', 'snapshots');
  const outputDir = path.join(snapshotRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  // Trust only this invocation's canonical checkout; never change global Git trust.
  try { execFileSync('git', ['-c', `safe.directory=${repositoryRoot.replace(/\\/g, '/')}`, 'check-ignore', '--quiet', outputDir], { cwd: repositoryRoot, stdio: 'pipe' }); } catch { throw new Error('Snapshot output must be ignored by Git before export'); }
  const config = await loadConfiguredMcp(); const client = new McpClient(config);
  await fs.mkdir(snapshotRoot, { recursive: true });
  const result = await collectSnapshot(client, outputDir, { log: message => console.log(message) });
  console.log(JSON.stringify({ snapshotDirectory: outputDir, verified: true, counts: result.counts }));
}
module.exports = { ROOT_PATH, PRODUCTION_URL, FORMAT_VERSION, READ_TOOLS, McpClient, loadConfiguredMcp, unpackResult, normalizeField, sanitizeRecord, paginated, collectSnapshot, verifySnapshot, sha256, decodeBase64, inTree, isExcludedField, safeRelative, main };
if (require.main === module) main().catch(error => { console.error(`Snapshot failed: ${error.message}`); process.exitCode = 1; });
