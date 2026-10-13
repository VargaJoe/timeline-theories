'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { McpClient, loadConfiguredMcp, unpackResult, normalizeField, sanitizeRecord, paginated, collectSnapshot, verifySnapshot, ROOT_PATH, PRODUCTION_URL, sha256, decodeBase64, safeRelative } = require('./m0-snapshot.cjs');

const def = (name, type) => ({ name, type });
const core = [def('Id', 'Integer'), def('Path', 'ShortText'), def('Name', 'ShortText'), def('Type', 'NodeType'), def('Hidden', 'Boolean'), def('OwnerId', 'Integer'), def('CreationDate', 'DateTime')];
const schema = (name, extra = []) => ({ name, parentTypeName: name === 'GenericContent' ? null : 'GenericContent', path: `/Root/System/Schema/ContentTypes/GenericContent/${name}`, fields: [...core, ...extra] });
const item = (id, type = 'GenericContent', extra = {}) => ({ id, path: `${ROOT_PATH}/${id}`, name: String(id), type, Hidden: 'False', CreationDate: '07/11/2025 18:52:22', ...extra });
const countArgs = { query: `+InTree:${ROOT_PATH}`, autoFilterStatus: 0, lifespanFilterStatus: 0 };

test('normalizes MCP values without treating JSON LongText as a Choice', () => {
  assert.equal(normalizeField('False', def('Hidden', 'Boolean')), false);
  assert.equal(normalizeField('0', def('Position', 'Integer')), 0);
  assert.equal(normalizeField('1.25', def('Number', 'Number')), 1.25);
  assert.deepEqual(normalizeField('["movie"]', def('MediaType', 'Choice')), ['movie']);
  assert.equal(normalizeField('{"imdb":"test"}', def('ExternalLinks', 'LongText')), '{"imdb":"test"}');
  assert.equal(normalizeField('07/11/2025 18:52:22', def('CreationDate', 'DateTime')), '2025-07-11T18:52:22Z');
  assert.equal(normalizeField(null, def('Hidden', 'Boolean')), null);
  assert.throws(() => normalizeField('not-number', def('Position', 'Integer')), /numeric/);
  assert.throws(() => normalizeField('maybe', def('Hidden', 'Boolean')), /Boolean/);
  assert.throws(() => normalizeField('{"__deferred":{"uri":"/ignored"}}', def('MediaItem', 'Reference')), /Unexpanded/);
});

test('sanitizes identity and secret fields and nested expanded references', () => {
  const definitions = schema('TimelineEntry', [def('MediaItem', 'Reference'), def('ApiKey', 'ShortText'), def('Password', 'ShortText')]);
  const raw = item(2, 'TimelineEntry', { OwnerId: '123', ApiKey: 'should-never-export', Password: 'no', MediaItem: JSON.stringify([{ Id: 1, Path: `${ROOT_PATH}/1`, Type: 'MediaItem', OwnerId: 123, Password: 'bad' }, { Id: 99, Path: '/Root/IMS/Users/other', Type: 'User', Email: 'bad' }]) });
  const result = sanitizeRecord(raw, definitions);
  assert.deepEqual(result.fields.MediaItem, [1]);
  assert.equal(typeof result.rawFields.MediaItem, 'string');
  assert.deepEqual(JSON.parse(result.rawFields.MediaItem), [{ Id: 1, Path: `${ROOT_PATH}/1`, Type: 'MediaItem' }]);
  assert.equal(Object.hasOwn(result.fields, 'OwnerId'), false);
  assert.equal(Object.hasOwn(result.fields, 'Password'), false);
  assert.equal(JSON.stringify(result).includes('should-never-export'), false);
  assert.ok(result.excludedFields.some(field => field.reason === 'reference-outside-project'));
  assert.throws(() => sanitizeRecord(item(2, 'TimelineEntry', { MediaItem: '{"__deferred":{}}' }), definitions), /not expanded/);
  assert.throws(() => sanitizeRecord({ ...raw, path: `${ROOT_PATH}-other/1` }, definitions), /disallowed/);
});

test('paginated reads explicitly disable both filters and use stable Id pagination', async () => {
  const calls = [];
  const client = { call: async (name, args) => { calls.push({ name, args }); return [item(1), item(2), item(3)].slice(args.skip, args.skip + args.top); } };
  const result = await paginated(client, `+InTree:${ROOT_PATH}`, 3, { pageSize: 2 });
  assert.equal(result.length, 3);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.args.autoFilterStatus === 0 && call.args.lifespanFilterStatus === 0 && call.args.query.includes('.SORT:Id')));
  assert.ok(calls[1].args.query.includes('.SKIP:2 .TOP:2'));
});

for (const [name, pages, pattern] of [
  ['truncated', [[item(1)]], /Incomplete/],
  ['repeated', [[item(1), item(2)], [item(1), item(2)]], /Repeated/],
  ['duplicate', [[item(1), item(1)]], /Duplicate/],
  ['unsorted', [[item(2), item(1)]], /stable Id/],
  ['outside tree', [[item(1), { ...item(2), path: `${ROOT_PATH}-other/2` }]], /outside project/],
]) test(`rejects ${name} pagination`, async () => {
  let index = 0;
  await assert.rejects(paginated({ call: async () => pages[index++] }, `+InTree:${ROOT_PATH}`, name === 'repeated' ? 4 : 2, { pageSize: 2 }), pattern);
});

test('MCP transport preserves its session header and refuses write tools', async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ url, options, request });
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: request.method === 'initialize' ? {} : { content: [{ type: 'text', text: '7' }] } }), { headers: { 'mcp-session-id': 'session-1', 'content-type': 'application/json' } });
  };
  const client = new McpClient({ url: 'https://mcp.example/', headers: { 'Repository-ApiKey': 'hidden' } }, fetcher);
  assert.equal(await client.call('GetCountOfContentsByQuery', countArgs), 7);
  assert.equal(calls[1].options.headers['Mcp-Session-Id'], 'session-1');
  assert.equal(calls[2].options.headers['Mcp-Session-Id'], 'session-1');
  assert.ok(calls.every(call => call.options.method === 'POST' && call.options.redirect === 'error'));
  await assert.rejects(client.call('UpdateContent', {}), /write tool refused/);
  assert.equal(calls.length, 3);
});

test('MCP 404 renews a session instead of inventing missing content', async () => {
  let initializes = 0; let failed = false;
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'initialize') initializes++;
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (request.method === 'tools/call' && !failed) { failed = true; return new Response(null, { status: 404 }); }
    return new Response(JSON.stringify({ id: request.id, result: request.method === 'initialize' ? {} : { content: [{ type: 'text', text: '5' }] } }), { headers: { 'mcp-session-id': `session-${initializes}`, 'content-type': 'application/json' } });
  };
  assert.equal(await new McpClient({ url: 'https://mcp.example/', headers: {} }, fetcher).call('GetCountOfContentsByQuery', countArgs), 5);
  assert.equal(initializes, 2);
});

test('MCP SSE matches each response to its own id during concurrency', async () => {
  const fetcher = async (url, options) => {
    const request = JSON.parse(options.body);
    if (request.method === 'notifications/initialized') return new Response(null, { status: 202 });
    if (request.method === 'initialize') return new Response(JSON.stringify({ id: request.id, result: {} }), { headers: { 'mcp-session-id': 'same' } });
    await new Promise(resolve => setTimeout(resolve, request.id % 2 ? 10 : 1));
    return new Response(`event: message\ndata: ${JSON.stringify({ id: request.id, result: { content: [{ type: 'text', text: JSON.stringify(request.params.arguments.number) }] } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  };
  const client = new McpClient({ url: 'https://mcp.example/', headers: {} }, fetcher); await client.initialize();
  assert.deepEqual(await Promise.all([client.call('GetCountOfContentsByQuery', { ...countArgs, number: 3 }), client.call('GetCountOfContentsByQuery', { ...countArgs, number: 4 })]), [3, 4]);
});

test('binary GET permits only the current project content field and expected production origin', async () => {
  const calls = []; const client = new McpClient({ apiKey: 'hidden' }, async (url, options) => { calls.push({ url, options }); return new Response(Buffer.from([1, 2, 3]), { headers: { 'content-type': 'image/png' } }); });
  const resource = { media_src: '/binaryhandler.ashx?nodeid=1&propertyname=CoverImageBin&checksum=42' };
  const result = await client.binary({ id: 1, path: `${ROOT_PATH}/1` }, 'CoverImageBin', resource);
  assert.deepEqual(result.bytes, Buffer.from([1, 2, 3]));
  assert.equal(calls[0].options.method, 'GET'); assert.equal(calls[0].options.redirect, 'error');
  for (const uri of ['https://attacker.example/binaryhandler.ashx?nodeid=1&propertyname=CoverImageBin', '/binaryhandler.ashx?nodeid=2&propertyname=CoverImageBin', '/binaryhandler.ashx?nodeid=1&propertyname=Binary', '/binaryhandler.ashx?nodeid=1&propertyname=CoverImageBin&token=leak']) await assert.rejects(client.binary({ id: 1, path: `${ROOT_PATH}/1` }, 'CoverImageBin', { media_src: uri }), /endpoint|component/);
  assert.equal(calls.length, 1);
});

test('production MCP scope guards reject unrelated downloads, identities and filtered queries before transport', async () => {
  const client = new McpClient({}, async () => { throw new Error('Transport must not run'); });
  for (const [name, args] of [['DownloadFile', { path: '/Root/IMS/Users/admin' }], ['GetContentFields', { contentPath: '/Root/Other' }], ['GetContentTypeSchema', { contentTypeName: 'User' }], ['GetContentsByQuery', { ...countArgs, query: '+InTree:/Root/Other' }], ['GetCountOfContentsByQuery', { ...countArgs, lifespanFilterStatus: 1 }]]) await assert.rejects(client.call(name, args), /approved snapshot scope|filter policy/);
});

test('binary base64 decoding rejects truncation and text disguised as a successful download', () => {
  assert.deepEqual(decodeBase64('AQID'), Buffer.from([1, 2, 3]));
  for (const input of ['abc', 'not base64', '{"error":"bad"}', 'AQI===']) assert.throws(() => decodeBase64(input), /binary|truncated/);
});

test('error and base64 responses never mistake an MCP error for file bytes', () => {
  assert.equal(unpackResult({ content: [{ type: 'text', text: 'YWJj' }] }, { binary: true }), 'YWJj');
  assert.throws(() => unpackResult({ content: [{ type: 'text', text: '{"error":"no"}' }] }, { binary: true }), /error object/);
  assert.throws(() => unpackResult({ content: [{ type: 'text', text: '{"error":"no"}' }] }), /error object/);
  assert.throws(() => unpackResult({ isError: true }), /reported an error/);
});

test('configuration loader uses only the configured production endpoint and keeps secrets out of errors', async t => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'm0-config-test-')); t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const filename = path.join(temporary, 'config.toml');
  await fs.writeFile(filename, `[mcp_servers.sensenet-plastice]\nurl = "https://mcp.example/"\n[mcp_servers.sensenet-plastice.http_headers]\nRepository-Url = "${PRODUCTION_URL}"\nRepository-ApiKey = "test-secret"\n`);
  const config = await loadConfiguredMcp(filename); assert.equal(config.apiKey, 'test-secret'); assert.equal(config.repositoryUrl, PRODUCTION_URL);
  await fs.writeFile(filename, `[mcp_servers.sensenet-plastice]\nurl = "https://mcp.example/"\n[mcp_servers.sensenet-plastice.http_headers]\nRepository-Url = "https://other.example/"\nRepository-ApiKey = "test-secret"\n`);
  await assert.rejects(loadConfiguredMcp(filename), error => /expected production/.test(error.message) && !error.message.includes('test-secret'));
});

async function fixture(t) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'm0-snapshot-test-')); t.after(() => fs.rm(temporary, { recursive: true, force: true }));
  const output = path.join(temporary, 'snapshot');
  const mediaSchema = schema('MediaItem', [def('CoverImageBin', 'Binary'), def('MediaType', 'Choice')]);
  const entrySchema = schema('TimelineEntry', [def('MediaItem', 'Reference'), def('Position', 'Integer')]);
  const data = [item(1, 'MediaItem', { Hidden: 'True', OwnerId: '123', CoverImageBin: JSON.stringify({ __mediaresource: { media_src: '/binaryhandler.ashx?nodeid=1&propertyname=CoverImageBin&checksum=42', content_type: 'image/png' } }), MediaType: '["movie"]' }), item(2, 'TimelineEntry', { MediaItem: JSON.stringify({ Id: 1, Path: `${ROOT_PATH}/1`, Type: 'MediaItem', OwnerId: 123 }), Position: '0' })];
  const calls = [];
  const client = { call: async (name, args) => {
    calls.push({ name, args });
    if (name === 'GetCountOfContentsByQuery') return data.length;
    if (name === 'GetContentTypeSchema') return args.contentTypeName === 'MediaItem' ? mediaSchema : args.contentTypeName === 'TimelineEntry' ? entrySchema : schema('GenericContent');
    if (name === 'DownloadFile') { const name = args.path.split('/').at(-1); return Buffer.from(`<ContentType name="${name}"><Fields /></ContentType>`).toString('base64'); }
    if (name === 'GetContentsByQuery') { const type = args.query.match(/\+Type:([\w]+)/)?.[1]; return data.filter(record => !type || record.type === type).slice(args.skip, args.skip + args.top); }
    throw new Error('Unexpected fixture tool');
  }, binary: async () => ({ bytes: Buffer.from([1, 2, 3]), contentType: 'image/png', sourcePath: '/binaryhandler.ashx?nodeid=1&propertyname=CoverImageBin&checksum=42' }) };
  const manifest = await collectSnapshot(client, output, { pageSize: 1 });
  return { output, manifest, calls };
}

test('complete snapshot includes full metadata, raw fields, typed references, schemas and verified binary hashes', async t => {
  const { output, manifest, calls } = await fixture(t); const result = await verifySnapshot(output);
  assert.equal(manifest.counts.total, 2); assert.equal(manifest.counts.hidden, 1); assert.equal(manifest.counts.binaries, 1);
  assert.equal(manifest.binaries[0].sha256, sha256(Buffer.from([1, 2, 3])));
  assert.deepEqual(result.records[1].fields.MediaItem, [1]); assert.equal(result.records[1].fields.Position, 0);
  assert.equal(Object.hasOwn(result.records[0].rawFields, 'OwnerId'), false);
  assert.ok(manifest.schemaFiles.some(value => value.name === 'GenericContent'));
  assert.ok(calls.every(value => /^(?:Get|DownloadFile)/.test(value.name)));
  assert.ok(calls.filter(value => value.name === 'GetContentsByQuery').every(value => !value.args.select.includes('OwnerId')));
});

test('snapshot verification fails on binary corruption and incomplete binary mapping', async t => {
  const { output, manifest } = await fixture(t);
  const binary = path.join(output, manifest.binaries[0].path); await fs.writeFile(binary, Buffer.from([1, 2, 4]));
  await assert.rejects(verifySnapshot(output), /integrity check failed/);
  await fs.writeFile(binary, Buffer.from([1, 2, 3]));
  manifest.binaries = []; manifest.counts.binaries = 0; manifest.counts.binaryBytes = 0;
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifySnapshot(output), /binary coverage/);
});

test('verification rejects a fabricated normalized field even with an updated file hash', async t => {
  const { output, manifest } = await fixture(t); const filename = path.join(output, 'contents.json');
  const content = JSON.parse(await fs.readFile(filename, 'utf8')); content[1].fields.Position = 999;
  const bytes = Buffer.from(JSON.stringify(content)); await fs.writeFile(filename, bytes);
  Object.assign(manifest.files.find(file => file.path === 'contents.json'), { bytes: bytes.length, sha256: sha256(bytes) });
  await fs.writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest));
  await assert.rejects(verifySnapshot(output), /normalization mismatch/);
});

test('snapshot file paths reject traversal, absolute paths and Windows separators', () => {
  for (const value of ['../secret', '/secret', 'schemas/../../secret', 'schemas\\secret', 'schemas//secret']) assert.throws(() => safeRelative(os.tmpdir(), value), /Unsafe|escapes/);
});
