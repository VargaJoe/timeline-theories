import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import forge from '../client/node_modules/node-forge/lib/index.js';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';
import { createFunctionApp, invocationTimeoutMs, handleRequest as handleFunctionRequest } from '../client/api/function.mjs';
import { FIELDS } from '../client/domain/content.mjs';
import { hash } from '../client/api/store.mjs';
import { loadConfig } from '../client/api/config.mjs';
import { invokeBackground } from '../client/api/jobs.mjs';
import { imageProtocolFixture } from './helpers/image-assets-protocol-fixture.mjs';
import { StockRepository } from '../client/api/stock-repository.mjs';
import rasterFixture from '../scripts/helpers/image-variant-fixture.cjs';

// Function routing and ACL-flow tests only. Blobs uses its real SDK/HTTP/file
// emulator; the isolated HTTPS stub below supplies controlled SenseNet protocol
// responses. These tests never prove actual SenseNet or cloud CAS acceptance.
let fixture, tls;
before(async () => {
  fixture = await startBlobFixture();
  const keys = forge.pki.rsa.generateKeyPair(2048), cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey; cert.serialNumber = '01';
  cert.validity.notBefore = new Date(Date.now() - 60000); cert.validity.notAfter = new Date(Date.now() + 86400000);
  cert.setSubject([{ name: 'commonName', value: 'localhost' }]); cert.setIssuer(cert.subject.attributes);
  cert.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  tls = { key: forge.pki.privateKeyToPem(keys.privateKey), cert: forge.pki.certificateToPem(cert) };
});
after(async () => { await fixture?.close(); });

async function setup(t, extra = {}) {
  const projectRoot = '/Root/Content/FunctionFixture-' + randomUUID();
  const state = { requests: [], patches: 0, allowSave: true, allowRead: true, allowRootRead: true, schemaAvailable: true, onSave: null, onRead: null, deniedIds: new Set(), interruptNextReadback: false };
  const content = { Id: 10, ParentId: 2, Name: 'media', DisplayName: 'Fixture media', Path: projectRoot + '/MediaLibrary/media', Type: 'MediaItem', Title: 'Before', CreationDate: '2026-10-01T00:00:00Z', CreatedById: 42, ModificationDate: '2026-10-01T00:00:00Z', ModifiedById: 42, Version: 'V1.0', VersionId: 1 };
  const contents = new Map([[content.Id, content]]);
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ d: value })); };
  const imageFixture = imageProtocolFixture(projectRoot, contents, send, state); state.images = imageFixture.state;
  const server = https.createServer(tls, async (req, res) => {
    try {
      const url = new URL(req.url, 'https://localhost'), credential = req.headers.apikey || req.headers.authorization?.replace(/^Bearer /, '');
      state.requests.push({ method: req.method, path: url.pathname, permissions: url.searchParams.get('permissions'), credential });
      if (url.pathname.endsWith('/GetCurrentUser')) return send(res, credential === 'rejected' ? 401 : 200, { Id: credential === 'other-user' ? 99 : 42, Name: 'AuthenticatedFixture' });
      if (await imageFixture.handle(req, res, url)) return;
      if (url.pathname.endsWith('/HasPermission')) {
        if (url.searchParams.get('permissions') === 'Save' && state.onSave) { const callback = state.onSave; state.onSave = null; await callback(); }
        return send(res, 200, url.searchParams.get('permissions') === 'Save' ? state.allowSave : state.allowRead && (state.allowRootRead || url.pathname.includes('content(10)')));
      }
      if (url.pathname.endsWith('/GetSchema')) {
        if (!state.schemaAvailable) return send(res, 200, []);
        const type = url.searchParams.get('contentTypeName');
        const names = ['Id','ParentId','Name','Path','Type','CreationDate','CreatedById','ModificationDate','ModifiedById','Version','VersionId', ...(FIELDS[type] || []), 'CoverImageBin'];
        return send(res, 200, [{ ContentTypeName: type, FieldSettings: [...new Set(names)].map(Name => ({ Name, ReadOnly: false })) }]);
      }
      if (url.pathname.endsWith('/AllowedChildTypes') || url.pathname.endsWith('/EffectiveAllowedChildTypes')) return send(res, 200, { results: [{ Name: 'File' }, {Name:'Folder'}] });
      if (url.pathname.endsWith("('MediaLibrary')") || url.pathname === '/OData.svc/content(2)') return send(res, state.allowRead && state.allowRootRead ? 200 : 403, { Id: 2, ParentId: 1, Name: 'MediaLibrary', Path: projectRoot + '/MediaLibrary', Type: 'Folder', ModificationDate: '2026-10-01T00:00:00Z', Version: 'V1.0' });
      const target = url.pathname.match(/^\/OData.svc\/content\((\d+)\)$/);
      if (target) {
        const id = Number(target[1]), row = contents.get(id);
        if (req.method === 'GET' && state.onRead) await state.onRead({ id, url });
        if (!state.allowRead || state.deniedIds.has(id)) return send(res, 403, null);
        if (!row) return send(res, 404, null);
        if (req.method === 'GET' && state.patches && state.interruptNextReadback) {
          // The controlled server already applied the actual HTTPS PATCH, but
          // its first readback connection is lost. Recovery must read durable
          // intent and the changed postcondition without sending another PATCH.
          state.interruptNextReadback = false; return res.destroy();
        }
        if (req.method === 'PATCH') {
          if (!state.allowSave) return send(res, 403, null);
          const chunks = []; for await (const part of req) chunks.push(part);
          Object.assign(row, JSON.parse(Buffer.concat(chunks).toString()), { Version: `V${++state.patches + 1}.0`, VersionId: state.patches + 1, ModificationDate: new Date().toISOString() });
        }
        return send(res, 200, row);
      }
      return send(res, 404, null);
    } catch { send(res, 500, null); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const config = { repositoryUrl: `https://127.0.0.1:${server.address().port}`, authority: 'https://authority.fixture.invalid', frontendOrigin: 'https://app.fixture.invalid', projectRoot, ca: tls.cert, local: false, readOnly: false, blobOptions: fixture.blobOptions, providerKeyPaths: {}, ...extra };
  const invocations = [], app = createFunctionApp(config, { invoke: async (url, headers, bytes) => { invocations.push({ url, headers, bytes }); } });
  function request(route, { method = 'GET', token = 'owner-user', browser = true, binding = true, body, headers = {}, direct = false } = {}) {
    return new Request(config.frontendOrigin + (direct ? '/.netlify/functions/native-api/v1/' : '/api/v1/') + route, { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(browser ? { Origin: config.frontendOrigin } : {}), ...(binding ? { 'X-Timeline-Repository': config.repositoryUrl, 'X-Timeline-Authority': config.authority, 'X-Timeline-Project': config.projectRoot } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  }
  async function enqueue(route, body, extra = {}) {
    const response = await app.handleRequest(request(route, { method: 'POST', body, ...extra }));
    assert.equal(response.status, 202, await response.clone().text()); return (await response.json()).job.id;
  }
  function background(sent) { return new Request(sent.url, { method: 'POST', headers: sent.headers, body: sent.bytes }); }
  async function runNext() { const sent = invocations.shift(); assert.ok(sent); assert.equal((await app.handleBackgroundRequest(background(sent))).status, 204); return sent; }
  async function preview() {
    const current = await (await app.handleRequest(request('content/10'))).json(); assert.ok(current.data?.revision);
    const id = await enqueue('plans', { commands: [{ action: 'update', targetId: 10, expectedRevision: current.data.revision, fields: { Title: 'Approved' } }] });
    await runNext();
    const result = await app.handleRequest(request(`jobs/${id}`)); assert.equal(result.status, 200, await result.clone().text());
    return result.json();
  }
  return { app, config, state, content, contents, request, enqueue, background, runNext, invocations, preview };
}

test('stored generic cover reads preserve bytes and metadata while retaining MIME and caller-access checks', async t => {
  const { app, request, state, content } = await setup(t);
  state.images.enabled = true;
  state.images.original = rasterFixture.png(4, 6);
  state.images.originalMime = 'application/octet-stream';
  content.CoverImageBin = { __mediaresource: { content_type: 'application/octet-stream', media_src: 'legacy-original' } };
  const before = structuredClone(content);
  const response = await app.handleRequest(request('content/10/cover'));
  assert.equal(response.status, 200, await response.clone().text());
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), state.images.original);
  assert.deepEqual(content, before, 'read-time MIME inference never repairs or reuploads original metadata');
  assert.equal(state.patches, 0); assert.equal(state.images.uploads, 0);
  state.images.originalMime = 'image/jpeg';
  assert.equal((await app.handleRequest(request('content/10/cover'))).status, 404, 'known MIME mismatch remains unavailable');
  const reads = state.images.binaryReads.length;
  state.allowRead = false;
  assert.equal((await app.handleRequest(request('content/10/cover'))).status, 403);
  assert.equal(state.images.binaryReads.length, reads, 'denied caller cannot probe original bytes');
});

test('anonymous content and snapshot reads work when production GetSchema is permission-filtered to an empty list', async t => {
  const {app,request,state,content}=await setup(t);state.schemaAvailable=false;content.ExtraRepositoryField='not-an-application-field';
  for(const req of [request('content/10',{token:null}),request('snapshots',{method:'POST',token:null,body:{ids:[10]}})]) {
    const response=await app.handleRequest(req);assert.equal(response.status,200,await response.clone().text());
    const value=(await response.json()).data,snapshot=Array.isArray(value)?value[0]:value;
    assert.equal(snapshot.Id,10);assert.equal(snapshot.Title,'Before');assert.match(snapshot.revision,/^sha256:[0-9a-f]{64}$/);
    assert.equal(Object.hasOwn(snapshot,'ExtraRepositoryField'),false);
    assert.equal(Object.hasOwn(snapshot,'Year'),false);assert.equal(Object.hasOwn(snapshot,'SeriesName'),false);
  }
  assert.equal(state.requests.some(row=>/GetSchema|HasPermission/.test(row.path)),false);
  assert.equal(state.requests.some(row=>row.credential),false);assert.equal(state.requests.every(row=>row.method==='GET'),true);assert.equal(state.patches,0);
});

test('snapshot batches bound complete caller reads to four and preserve input order and duplicates', async t => {
  const {app,request,state,content,contents}=await setup(t),ids=[14,10,13,12,11,15,16,10];
  for(const id of new Set(ids))contents.set(id,{...content,Id:id,Name:'media-'+id,Path:content.Path+'-'+id,Title:'Media '+id});
  let active=0,peak=0,releaseWave,releaseFirst;
  const wave=new Promise(resolve=>{releaseWave=resolve;}),first=new Promise(resolve=>{releaseFirst=resolve;}),started=[],finished=[];
  // The first snapshot waits for the other workers and a later full read.
  // A fallback releases a broken serial implementation so assertions can fail.
  const fallback=setTimeout(()=>{releaseWave();releaseFirst();},1000);
  t.after(()=>{clearTimeout(fallback);releaseWave();releaseFirst();});
  state.onRead=async({id,url})=>{
    if(url.searchParams.get('$select')==='Id,ParentId,Name,Path,Type') {
      started.push(id);active++;peak=Math.max(peak,active);const firstWave=started.length<=4;
      if(started.length===4)releaseWave();
      if(firstWave)await wave;
      if(firstWave&&id===ids[0])await first;
    } else if(!url.searchParams.has('$select')) {
      finished.push(id);active--;if(id!==ids[0])releaseFirst();
    }
  };
  const response=await app.handleRequest(request('snapshots',{method:'POST',token:null,body:{ids}}));
  assert.equal(response.status,200,await response.clone().text());const {data}=await response.json();
  assert.equal(peak,4);assert.equal(active,0);
  // Independent HTTP requests may reach the repository in a different order.
  // The first wave and duplicates must be complete; response order is checked below.
  const numeric=(a,b)=>a-b;
  assert.deepEqual(started.slice(0,4).sort(numeric),ids.slice(0,4).sort(numeric));
  assert.deepEqual([...started].sort(numeric),[...ids].sort(numeric));assert.notEqual(finished[0],ids[0]);
  assert.deepEqual(data.map(row=>row.Id),ids);assert.deepEqual(data.map(row=>row.Title),ids.map(id=>'Media '+id));
  for(const row of data)assert.match(row.revision,/^sha256:[0-9a-f]{64}$/);
  assert.equal(state.requests.some(row=>row.credential),false);assert.equal(state.requests.every(row=>row.method==='GET'),true);assert.equal(state.patches,0);
});

test('snapshot batches validate every ID before dispatching any content read', async t => {
  const {app,request,state}=await setup(t);
  for(const invalid of [0,-1,1.5,'11',null,Number.MAX_SAFE_INTEGER+1]) {
    const response=await app.handleRequest(request('snapshots',{method:'POST',token:null,body:{ids:[10,11,invalid]}}));
    assert.equal(response.status,400);assert.equal((await response.json()).error.code,'invalid_target');
  }
  assert.equal(state.requests.length,0);assert.equal(state.patches,0);
});

test('snapshot batch denial drains started reads, stops new IDs and returns no partial data', async t => {
  const {app,request,state,content,contents}=await setup(t),ids=[10,11,12,13,14,15];
  for(const id of ids)contents.set(id,{...content,Id:id});
  state.deniedIds.add(11);
  let release,denialStarted;
  const blocked=new Promise(resolve=>{release=resolve;}),denial=new Promise(resolve=>{denialStarted=resolve;}),started=[],finished=[];
  const fallback=setTimeout(release,1000);t.after(()=>{clearTimeout(fallback);release();});
  state.onRead=async({id,url})=>{
    if(url.searchParams.get('$select')==='Id,ParentId,Name,Path,Type') {
      started.push(id);if(id===11)denialStarted();else await blocked;
    } else if(!url.searchParams.has('$select'))finished.push(id);
  };
  let returned=false;
  const running=app.handleRequest(request('snapshots',{method:'POST',token:null,body:{ids}})).then(response=>{returned=true;return response;});
  await denial;await new Promise(resolve=>setTimeout(resolve,30));assert.equal(returned,false);
  release();const response=await running;assert.equal(response.status,403);
  const value=await response.json();assert.equal(value.error.code,'backend_denied');assert.equal(Object.hasOwn(value,'data'),false);
  // Independent HTTPS reads may arrive in any order; the membership proves
  // that the denied first wave never starts IDs 14/15 and is fully drained.
  assert.deepEqual([...started].sort((a,b)=>a-b),[10,11,12,13]);assert.deepEqual([...finished].sort((a,b)=>a-b),[10,12,13]);
  assert.equal(state.requests.some(row=>row.credential),false);assert.equal(state.requests.every(row=>row.method==='GET'),true);assert.equal(state.patches,0);
});

test('snapshot batch failures preserve the earliest input error and full-content scope revalidation', async t => {
  const {app,request,state,content,contents}=await setup(t);contents.set(12,{...content,Id:12});state.deniedIds.add(12);
  state.onRead=async({id})=>{if(id===11)await new Promise(resolve=>setTimeout(resolve,30));};
  const missing=await app.handleRequest(request('snapshots',{method:'POST',token:null,body:{ids:[11,12]}}));
  assert.equal(missing.status,404);assert.equal((await missing.json()).error.code,'target_unavailable');
  state.deniedIds.clear();contents.set(11,{...content,Id:11});
  state.onRead=async({id,url})=>{if(id===11&&!url.searchParams.has('$select'))contents.get(id).Path='/Root/Content/Outside/media';};
  const moved=await app.handleRequest(request('snapshots',{method:'POST',token:null,body:{ids:[10,11]}}));
  assert.equal(moved.status,403);const value=await moved.json();assert.equal(value.error.code,'project_boundary');assert.equal(Object.hasOwn(value,'data'),false);
  assert.equal(state.patches,0);
});

test('schema-independent reads preserve supported optional fields and include them in the snapshot revision',async t=>{
  const {app,request,state,content}=await setup(t);state.schemaAvailable=false;
  const before=(await(await app.handleRequest(request('content/10'))).json()).data;
  content.Year=2025;content.SeriesName='Supported local series';
  const response=await app.handleRequest(request('content/10'));assert.equal(response.status,200);
  const after=(await response.json()).data;assert.equal(after.Year,2025);assert.equal(after.SeriesName,'Supported local series');assert.notEqual(after.revision,before.revision);
  assert.equal(state.requests.some(row=>row.path.endsWith('/GetSchema')),false);assert.equal(state.patches,0);
});

test('an unreadable item stays denied when schema metadata is unavailable',async t=>{
  const {app,request,state}=await setup(t);state.schemaAvailable=false;state.allowRead=false;
  const response=await app.handleRequest(request('content/10',{token:null}));assert.equal(response.status,403);assert.equal((await response.json()).error.code,'backend_denied');
  assert.equal(state.requests.some(row=>row.path.endsWith('/GetSchema')),false);assert.equal(state.patches,0);
});

test('missing actual schema still denies schema discovery and an approved write before any mutation',async t=>{
  const {app,request,state,enqueue,runNext}=await setup(t);state.schemaAvailable=false;
  const current=await app.handleRequest(request('content/10'));assert.equal(current.status,200);const snapshot=(await current.json()).data;
  const schema=await app.handleRequest(request('schemas/MediaItem'));assert.equal(schema.status,503);assert.equal((await schema.json()).error.code,'backend_schema_unavailable');
  const job=await enqueue('plans',{commands:[{action:'update',targetId:10,expectedRevision:snapshot.revision,fields:{Title:'Must not save'}}]});await runNext();
  const preview=await app.handleRequest(request('jobs/'+job));assert.equal(preview.status,503);assert.equal((await preview.json()).error.code,'backend_schema_unavailable');
  assert.equal(state.requests.some(row=>row.path.endsWith('/GetSchema')),true);assert.equal(state.requests.every(row=>row.method==='GET'),true);assert.equal(state.patches,0);
});

test('public capability normalization and CORS reject foreign origins without backend access', async t => {
  const { app, request, state } = await setup(t);
  const normal = await app.handleRequest(request('capabilities', { token: null, binding: false }));
  const direct = await app.handleRequest(request('capabilities', { token: null, binding: false, direct: true }));
  assert.equal(normal.status, 200); assert.deepEqual(await normal.json(), await direct.json());
  assert.equal(normal.headers.get('access-control-allow-origin'), 'https://app.fixture.invalid');
  assert.equal(normal.headers.get('cache-control'), 'no-store'); assert.ok(normal.headers.get('x-request-id'));
  const denied = await app.handleRequest(request('capabilities', { token: null, headers: { Origin: 'https://evil.invalid' } }));
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'origin_denied');
  assert.equal((await app.handleRequest(request('capabilities', { method: 'OPTIONS', token: null }))).status, 204);
  assert.equal((await app.handleRequest(new Request('https://app.fixture.invalid/not-an-api'))).status, 404);
  assert.equal(state.requests.length, 0);
});

test('target binding, native raw sessions, browser sessions and visitor routing are explicit', async t => {
  const { app, request, state } = await setup(t);
  const binding = await app.handleRequest(request('snapshots', { method: 'POST', body: { ids: [] }, binding: false }));
  assert.equal(binding.status, 403); assert.equal((await binding.json()).error.code, 'target_binding_mismatch');
  const native = await app.handleRequest(request('snapshots', { method: 'POST', body: { ids: [] }, browser: false }));
  assert.equal(native.status, 401); assert.equal((await native.json()).error.code, 'scoped_credential_required');
  assert.equal(state.requests.length, 0);
  assert.equal((await app.handleRequest(request('snapshots', { method: 'POST', body: { ids: [] } }))).status, 200);
  const afterSession = state.requests.length;
  assert.equal((await app.handleRequest(request('snapshots', { method: 'POST', token: null, body: { ids: [] } }))).status, 200);
  assert.equal(state.requests.length, afterSession);
  const visitorWrite = await app.handleRequest(request('plans', { method: 'POST', token: null, body: { commands: [] } }));
  assert.equal(visitorWrite.status, 401); assert.equal((await visitorWrite.json()).error.code, 'invalid_credential');
  assert.equal(state.patches, 0);
});

test('preview storage selftest accepts no credential or arbitrary input and never reaches SenseNet', async t => {
  const {app,request,state}=await setup(t,{deployContext:'deploy-preview',deployId:randomUUID()});
  const route='__verification/storage';
  for(const options of [
    {body:{key:'grants/caller-supplied',value:'C'}},
    {body:{},token:'production-credential-must-not-be-used'},
    {body:{},headers:{ApiKey:'must-not-be-used'}},
    {body:{padding:'a'.repeat(256)}},
  ]) {
    const result=await app.handleRequest(request(route,{method:'POST',token:null,binding:false,...options}));
    assert.ok([400,413].includes(result.status));
  }
  assert.equal((await app.store.blobs.list({prefix:app.store.prefix})).blobs.length,0);
  const result=await app.handleRequest(request(route,{method:'POST',token:null,binding:false,browser:false,body:{}}));
  assert.equal(result.status,200,await result.clone().text());
  const proof=await result.json();assert.equal(proof.storageSelftest.passed,true);assert.equal(proof.senseNetRequests,0);assert.equal(proof.repositoryWrites,0);
  const repeated=await app.handleRequest(request(route,{method:'POST',token:null,binding:false,body:{}}));
  assert.deepEqual(await repeated.json(),proof);
  assert.equal(state.requests.length,0);
});

test('storage verification is unavailable in production and old arbitrary-phase route is removed before authentication',async t=>{
  const {app,request,state}=await setup(t,{deployContext:'production',deployId:randomUUID()});
  for(const route of ['__verification/storage','__verification/state/'+randomUUID()]){
    const result=await app.handleRequest(request(route,{method:'POST',token:null,binding:false,body:{}}));
    assert.equal(result.status,404);assert.equal((await result.json()).error.code,'route_unavailable');
  }
  assert.equal((await app.store.blobs.list({prefix:app.store.prefix})).blobs.length,0);assert.equal(state.requests.length,0);
});

test('grant routes await durable issuance and self/owner revoke ownership and idempotence', async t => {
  const { app, request } = await setup(t);
  const issue = async () => {
    const result = await app.handleRequest(request('grants', { method: 'POST', browser: false, body: { scopes: ['content:read','media:write'], expiresInSeconds: 60 } }));
    assert.equal(result.status, 201, await result.clone().text()); return result.json();
  };
  const first = await issue(), second = await issue();
  assert.equal((await app.store.grant(first.token)).identity, 42);
  const denied = await app.handleRequest(request(`grants/${second.id}/revoke`, { method: 'POST', token: first.token, browser: false, body: {} }));
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'grant_admin_denied');
  assert.equal(await app.store.active(second.id), true);
  const self = await app.handleRequest(request(`grants/${first.id}/revoke`, { method: 'POST', token: first.token, browser: false, body: {} }));
  assert.equal(self.status, 200); assert.equal(await app.store.active(first.id), false);
  const ownerRepeat = await app.handleRequest(request(`grants/${first.id}/revoke`, { method: 'POST', browser: false, body: {} }));
  assert.equal(ownerRepeat.status, 200);
  const badBody = await app.handleRequest(request('grants', { method: 'POST', body: '{malformed' }));
  assert.equal(badBody.status, 400); assert.equal((await badBody.json()).error.code, 'invalid_json');
});

test('background preview uses durable ownership and awaits saved plans without mutation', async t => {
  const { app, request, preview, state } = await setup(t);
  const plan = await preview();
  assert.ok(plan.id); assert.equal(plan.repositoryWrites, 0); assert.equal(state.patches, 0);
  const principal = 'session:42:' + hash('owner-user');
  assert.equal((await app.store.plan(plan.id, principal)).steps.length, 1);
  const queued = await app.jobs.blobs.list({ prefix: app.jobs.prefix + 'jobs/' });
  const inputKey = queued.blobs.find(row => row.key.endsWith('/input')).key;
  const input = await app.jobs.blobs.get(inputKey, { type: 'json', consistency: 'strong' });
  assert.equal(JSON.stringify(input).includes('owner-user'), false);
  const stranger = await app.handleRequest(request(`jobs/${input.id}`, { token: 'other-user' }));
  assert.equal(stranger.status, 404); assert.equal((await stranger.json()).error.code, 'job_unavailable');
});

test('cancelled claimed apply rechecks cancellation before HTTPS PATCH dispatch', async t => {
  const { app, request, preview, state, enqueue, invocations, background } = await setup(t);
  const plan = await preview(), jobId = await enqueue(`plans/${plan.id}/apply`, {}, { headers: { 'Idempotency-Key': 'cancelled-apply' } });
  let release, reached;
  const paused = new Promise(resolve => { reached = resolve; });
  state.onSave = async () => { reached(); await new Promise(resolve => { release = resolve; }); };
  const running = app.handleBackgroundRequest(background(invocations.shift()));
  await paused;
  const cancellation = await app.handleRequest(request(`jobs/${jobId}/cancel`, { method: 'POST', body: {} }));
  assert.equal(cancellation.status, 202); assert.equal((await cancellation.json()).job.state, 'cancelling');
  release(); assert.equal((await running).status, 204);
  const result = await app.handleRequest(request(`jobs/${jobId}`));
  assert.equal(result.status, 409); const body = await result.json();
  assert.equal(body.error?.code, 'job_cancelled'); assert.equal(state.patches, 0);
  assert.equal((await app.coordinator.inspect()).state, 'released');
  assert.deepEqual(await app.store.pendingMutations(), []);
});

test('successful apply persists replayable receipts and automatic job retry never repeats PATCH', async t => {
  const { app, request, preview, state, enqueue, runNext, background } = await setup(t);
  const plan = await preview(), jobId = await enqueue(`plans/${plan.id}/apply`, {}, { headers: { 'Idempotency-Key': 'success-apply' } });
  const sent = await runNext();
  const result = await app.handleRequest(request(`jobs/${jobId}`));
  assert.equal(result.status, 200, await result.clone().text()); assert.equal((await result.json()).ok, true);
  assert.equal(state.patches, 1);
  assert.equal((await app.handleBackgroundRequest(background(sent))).status, 204); assert.equal(state.patches, 1);
  const replay = await app.handleRequest(request(`plans/${plan.id}/apply`, { method: 'POST', body: {}, headers: { 'Idempotency-Key': 'success-apply' } }));
  assert.equal(replay.status, 200); assert.equal((await replay.json()).planId, plan.id); assert.equal(state.patches, 1);
  const saved = await app.store.plan(plan.id, 'session:42:' + hash('owner-user'));
  assert.equal((await app.store.reserve(saved.principal, 'success-apply', saved)).ok, true);
  assert.deepEqual(await app.store.pendingMutations(), []);
  state.allowRead = false;
  const denied = await app.handleRequest(request(`jobs/${jobId}`));
  assert.equal(denied.status, 403); assert.equal((await denied.json()).error.code, 'permission_denied');
  assert.equal(state.patches, 1);
});

test('exact-node Open/Save returns and replays a successful update when its library root is denied',async t=>{
  const {app,request,preview,state,enqueue,runNext}=await setup(t);state.allowRootRead=false;
  const plan=await preview(),key='exact-node-without-library-root';
  const job=await enqueue(`plans/${plan.id}/apply`,{},{headers:{'Idempotency-Key':key}});await runNext();
  const result=await app.handleRequest(request(`jobs/${job}`));assert.equal(result.status,200,await result.clone().text());
  assert.equal((await result.json()).completed[0].result.id,10);assert.equal(state.patches,1);
  const replay=await app.handleRequest(request(`plans/${plan.id}/apply`,{method:'POST',body:{},headers:{'Idempotency-Key':key}}));
  assert.equal(replay.status,200);assert.equal((await replay.json()).ok,true);assert.equal(state.patches,1);
  assert.equal(state.requests.some(row=>row.path.endsWith("('MediaLibrary')")||row.path.startsWith('/OData.svc/content(2)')),false);
});

test('current Save ACL denial blocks a queued approved plan before backend mutation', async t => {
  const { app, request, preview, state, enqueue, runNext } = await setup(t);
  const plan = await preview(); state.allowSave = false;
  const id = await enqueue(`plans/${plan.id}/apply`, {}, { headers: { 'Idempotency-Key': 'denied-current-save' } });
  await runNext();
  const response = await app.handleRequest(request(`jobs/${id}`));
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'permission_denied');
  assert.equal(state.patches, 0); assert.deepEqual(await app.store.pendingMutations(), []);
  assert.equal((await app.coordinator.inspect()).state, 'released');
});

test('explicit same-plan/key retry reconciles a lost HTTPS readback without repeating PATCH', async t => {
  const { app, request, preview, state, content, enqueue, runNext, background } = await setup(t);
  const plan = await preview(), key = 'uncertain-readback-retry';
  state.interruptNextReadback = true;
  const originalJob = await enqueue(`plans/${plan.id}/apply`, {}, { headers: { 'Idempotency-Key': key } });
  const originalInvocation = await runNext();
  const uncertain = await app.handleRequest(request(`jobs/${originalJob}`));
  assert.equal(uncertain.status, 502); const failure = await uncertain.json();
  assert.equal(failure.error.code, 'repository_transport'); assert.equal(failure.retrySamePlan, true);
  assert.equal(content.Title, 'Approved'); assert.equal(state.patches, 1);
  assert.equal((await app.store.pendingMutations()).length, 1);
  // Automatic retry of the original permanent claim does not re-execute it.
  assert.equal((await app.handleBackgroundRequest(background(originalInvocation))).status, 204);
  assert.equal(state.patches, 1);
  // Only this explicit original caller request may reserve another owned job.
  const recoveryJob = await enqueue(`plans/${plan.id}/apply`, {}, { headers: { 'Idempotency-Key': key } });
  assert.notEqual(recoveryJob, originalJob);
  await runNext();
  const confirmed = await app.handleRequest(request(`jobs/${recoveryJob}`));
  assert.equal(confirmed.status, 200, await confirmed.clone().text()); const result = await confirmed.json();
  assert.equal(result.ok, true); assert.equal(result.planId, plan.id);
  assert.equal(result.completed[0].replayed, true); assert.equal(result.completed[0].result.reconciled, true);
  assert.equal(state.patches, 1); assert.deepEqual(await app.store.pendingMutations(), []);
  const stored = await app.store.plan(plan.id, 'session:42:' + hash('owner-user'));
  assert.equal((await app.store.reserve(stored.principal, key, stored)).ok, true);
});

test('aborted app deadline fails before backend authentication or dispatch', async t => {
  const controller = new AbortController(); controller.abort();
  const { app, request, state } = await setup(t, { signal: controller.signal });
  const response = await app.handleRequest(request('grants', { method: 'POST', body: { scopes: ['content:read'] } }));
  assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'function_deadline');
  assert.equal(state.requests.length, 0); assert.equal(state.patches, 0);
});

test('trusted modern Netlify context selects only its own preview alias and isolates preview state', () => {
  const environment = { TIMELINE_REPOSITORY_URL: 'https://plastice.sensenet.cloud', TIMELINE_AUTHORITY: 'https://plastice-is.sensenet.cloud', TIMELINE_PROJECT_ROOT: '/Root/Content/timelines', TIMELINE_READ_ONLY: 'true', TIMELINE_FRONTEND_ORIGIN: undefined, TIMELINE_INVENTORY_CREDENTIAL: undefined, TIMELINE_NETLIFY_DEV: undefined, TIMELINE_APP_DEV_CA_FILE: undefined, DEPLOY_PRIME_URL: undefined, URL: undefined, CONTEXT: undefined, REVIEW_ID: undefined };
  const saved = new Map(Object.keys(environment).map(name=>[name,process.env[name]]));
  try {
    for(const [name,value] of Object.entries(environment))if(value===undefined)delete process.env[name];else process.env[name]=value;
    const site={name:'timeline-theories',url:'https://timeline-theories.netlify.app'};
    const runtimeContext={site,deploy:{context:'deploy-preview',id:'trusted-build-one'}};
    const requestUrl='https://deploy-preview-53--timeline-theories.netlify.app/api/v1/capabilities';
    const preview=loadConfig({local:false,runtimeContext,requestUrl});
    assert.equal(preview.frontendOrigin,'https://deploy-preview-53--timeline-theories.netlify.app');
    assert.equal(preview.deployContext,'deploy-preview');assert.equal(preview.blobStoreName,'timeline-preview-trusted-build-one');assert.equal(preview.deployId,'trusted-build-one');
    for(const requestUrl of ['https://deploy-preview-53--another-site.netlify.app/api/v1/capabilities','https://deploy-preview-53--timeline-theories.netlify.app.evil.invalid/api/v1/capabilities','http://deploy-preview-53--timeline-theories.netlify.app/api/v1/capabilities'])assert.equal(loadConfig({local:false,runtimeContext,requestUrl}).frontendOrigin,site.url);
    assert.notEqual(loadConfig({local:false,runtimeContext:{site,deploy:{context:'deploy-preview',id:'trusted-build-two'}},requestUrl}).blobStoreName,preview.blobStoreName);
    for(const id of ['production-one','production-two']) {
      const production=loadConfig({local:false,runtimeContext:{site,deploy:{context:'production',id}},requestUrl});
      assert.equal(production.frontendOrigin,site.url);assert.equal(production.blobStoreName,'timeline-app-state-v1');
    }
  } finally {for(const [name,value] of saved)if(value===undefined)delete process.env[name];else process.env[name]=value;}
});

test('trusted dev runtime scopes app origin, CA and corrected storage independently of ordinary repository settings', () => {
  const caFile=path.join(fixture.directory,'dev-app-ca.pem');fs.writeFileSync(caFile,tls.cert);
  const environment={TIMELINE_LOCAL_PROFILE:undefined,TIMELINE_NETLIFY_DEV:'true',TIMELINE_APP_DEV_CA_FILE:caFile,
    TIMELINE_REPOSITORY_URL:'https://repository.fixture.invalid',TIMELINE_AUTHORITY:'https://authority.fixture.invalid',TIMELINE_PROJECT_ROOT:'/Root/Content/ConfiguredFixture',
    TIMELINE_FRONTEND_ORIGIN:'https://production-app.fixture.invalid',DEPLOY_PRIME_URL:'https://deploy-preview.fixture.invalid',URL:'http://offline-context.fixture.invalid',
    TIMELINE_LOCAL_BLOB_ENDPOINT:fixture.url,TIMELINE_LOCAL_BLOB_SITE_ID:fixture.siteID,TIMELINE_LOCAL_BLOB_TOKEN:fixture.token,
    TIMELINE_INVENTORY_CREDENTIAL:undefined,TIMELINE_READ_ONLY:'true',VITE_READ_ONLY:undefined,NODE_EXTRA_CA_CERTS:'existing-repository-ca.pem',CONTEXT:'dev'};
  const saved=new Map(Object.keys(environment).map(name=>[name,process.env[name]]));
  try {
    for(const [name,value] of Object.entries(environment))if(value===undefined)delete process.env[name];else process.env[name]=value;
    const config=loadConfig({local:false,runtimeContext:{site:{url:'http://offline-context.fixture.invalid'}}});
    assert.equal(config.local,false);assert.equal(config.devRuntime,true);assert.equal(config.frontendOrigin,'https://localhost:8080');
    assert.equal(config.repositoryUrl,environment.TIMELINE_REPOSITORY_URL);assert.equal(config.authority,environment.TIMELINE_AUTHORITY);assert.equal(config.projectRoot,environment.TIMELINE_PROJECT_ROOT);
    assert.equal(config.ca,undefined);assert.equal(config.appCa.toString(),tls.cert);assert.equal(process.env.NODE_EXTRA_CA_CERTS,'existing-repository-ca.pem');
    assert.deepEqual(config.blobOptions,fixture.blobOptions);assert.equal(config.deployId,'local-app-development');
    process.env.TIMELINE_APP_DEV_CA_FILE='relative-app-ca.pem';assert.throws(()=>loadConfig({local:false}),error=>error.code==='invalid_configuration'&&error.status===503);
    process.env.TIMELINE_NETLIFY_DEV='false';
    const production=loadConfig({local:false,runtimeContext:{deploy:{context:'production',id:'production-build'}}});
    assert.equal(production.devRuntime,false);assert.equal(production.frontendOrigin,'https://production-app.fixture.invalid');assert.equal(production.appCa,undefined);assert.equal(production.ca,undefined);assert.equal(production.blobOptions,undefined);assert.equal(production.deployId,'production-build');
  }finally{for(const [name,value] of saved)if(value===undefined)delete process.env[name];else process.env[name]=value;}
});

test('actual background HTTPS acknowledgement uses app-only CA, rejects redirects and cannot change its target',async t=>{
  const received=[];let status=202;
  const server=https.createServer(tls,async(req,res)=>{const parts=[];for await(const part of req)parts.push(part);received.push({method:req.method,path:req.url,authorization:req.headers.authorization,apiKey:req.headers.apikey,body:JSON.parse(Buffer.concat(parts).toString())});res.writeHead(status,status===302?{Location:'https://foreign.fixture.invalid/'}:{});res.end();});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const frontendOrigin='https://127.0.0.1:'+server.address().port,url=new URL('/.netlify/functions/native-api-background',frontendOrigin),jobId=randomUUID();
  const headers=new Headers({'Content-Type':'application/json'}),bytes=Buffer.from(JSON.stringify({jobId}));
  await invokeBackground(url,headers,bytes,{frontendOrigin,devRuntime:true,appCa:tls.cert,ca:'separate backend trust'});
  assert.deepEqual(received,[{method:'POST',path:'/.netlify/functions/native-api-background',authorization:undefined,apiKey:undefined,body:{jobId}}]);
  await assert.rejects(invokeBackground(url,headers,bytes,{frontendOrigin,devRuntime:true,ca:tls.cert})); // Repository CA does not become app trust.
  await assert.rejects(invokeBackground(url,headers,bytes,{frontendOrigin,devRuntime:false,local:false,appCa:tls.cert,ca:tls.cert})); // Deployed TLS does not use dev app trust.
  assert.throws(()=>invokeBackground(new URL('/.netlify/functions/native-api-background','https://foreign.fixture.invalid'),headers,bytes,{frontendOrigin,devRuntime:true,appCa:tls.cert}),error=>error.code==='job_dispatch_invalid');
  assert.throws(()=>invokeBackground(new URL('/not-background',frontendOrigin),headers,bytes,{frontendOrigin,devRuntime:true,appCa:tls.cert}),error=>error.code==='job_dispatch_invalid');
  status=302;await assert.rejects(invokeBackground(url,headers,bytes,{frontendOrigin,devRuntime:true,appCa:tls.cert}));assert.equal(received.length,2);
});

test('generated variants travel directly to SenseNet, activate through a saved plan and read one current size without changing originals', async t => {
  const { app, request, state, content, contents, config, enqueue, runNext } = await setup(t);
  state.images.enabled = true;
  content.CoverImageBin = { __mediaresource: { content_type: 'image/png', media_src: 'preserved-original-stamp' } };
  contents.set(11, { ...content, Id: 11, Name: 'second-media', Path: config.projectRoot + '/MediaLibrary/second-media' });
  const owner = { ...content, Id: 20, Type: 'Timeline', Name: 'timeline', Path: config.projectRoot + '/Timelines/timeline', CoverImageBin: null };
  contents.set(owner.Id, owner);
  const originalHash = createHash('sha256').update(state.images.original).digest('hex');
  const get = async route => { const response = await app.handleRequest(request(route)); assert.equal(response.status, 200, await response.clone().text()); return response.json(); };
  const post = async (route, body, key, expected = 200) => { const response = await app.handleRequest(request(route, { method: 'POST', body, headers: { 'Idempotency-Key': key } })); assert.equal(response.status, expected, await response.clone().text()); return response.json(); };
  const before = (await get('content/20')).data;
  assert.equal((await get('images/capabilities')).data.available, true);
  const source = (await get('content/10/image-presentation')).data;
  const generationId = randomUUID(), manifest = { schemaVersion: 1, kind: 'timeline-composite', projectPath: config.projectRoot, ownerId: 20, generationId, sourceIds: [11, 10], sourceStamps: [{ id: 11, stamp: state.images.stamp }, { id: 10, stamp: state.images.stamp }], recipe: { template: 'poster-strip-v1', sourceIds: [11, 10], seed: 42 }, variants: [] };
  const prepared = (await post('images/drafts', { ownerId: 20, generationId, expectedRevision: before.revision, manifest }, 'prepare-image-1', 201)).data;
  assert.deepEqual(prepared.manifest.recipe.sourceIds, [11, 10]);
  assert.deepEqual(JSON.parse(state.images.sets.get(prepared.setId).Description).manifest.sourceIds, [11, 10]);
  const imageBytes = rasterFixture.png(400,200);
  const variant = { name: 'w400', width: 400, height: 200, mimeType: 'image/png', byteLength: imageBytes.length, sha256: createHash('sha256').update(imageBytes).digest('hex') };
  const uploadBody = { ownerId: 20, variant, bytesBase64: imageBytes.toString('base64') };
  state.images.interruptUploadOnce = true;
  const uploadRequestStart = state.requests.length, originalReadsBeforeUpload = state.images.binaryReads.filter(row=>row.property==='CoverImageBin').length;
  const interrupted = await post(`images/drafts/${prepared.setId}/variants/w400`, uploadBody, 'upload-image-1', 502);
  const uploadRequests = state.requests.slice(uploadRequestStart);
  assert.equal(state.images.binaryReads.filter(row=>row.property==='CoverImageBin').length,originalReadsBeforeUpload,'variant upload never redownloads originals');
  assert.equal(uploadRequests.some(row=>/ImageAsset|GetImagePresentation/.test(row.path)),false);
  assert.ok(uploadRequests.some(row => row.permissions === 'AddNew'));
  assert.equal(interrupted.error.details.uncertain, true); assert.equal((await app.store.pendingMutations()).length, 1);
  const uploaded = (await post(`images/drafts/${prepared.setId}/variants/w400`, uploadBody, 'upload-image-1')).data;
  assert.equal((await app.store.pendingMutations()).length, 0); assert.equal(state.images.uploads, 1);
  await post(`images/drafts/${prepared.setId}/seal`, { ownerId: 20, variants: [uploaded] }, 'seal-image-1');
  assert.equal(state.images.activations, 0);
  const planJob = await enqueue('plans', { commands: [{ action: 'cover-presentation', targetId: 20, expectedRevision: prepared.ownerRevision, setId: prepared.setId }] }); await runNext();
  const plan = await get(`jobs/${planJob}`);
  assert.equal(plan.repositoryWrites, 0); assert.equal(state.images.activations, 0);
  const savedPlan = await app.store.plan(plan.id, (await app.store.read(`plans/${plan.id}`)).data.principal);
  assert.equal(savedPlan.steps[0].payload.setId, prepared.setId);
  assert.equal(JSON.stringify(savedPlan).includes('bytesBase64'), false);
  const applyJob = await enqueue(`plans/${plan.id}/apply`, {}, { headers: { 'Idempotency-Key': 'activate-image-1' } }); await runNext();
  const applied = await get(`jobs/${applyJob}`); assert.equal(applied.ok, true); assert.equal(state.images.activations, 1);
  const snapshotResponse = await app.handleRequest(request('content/20', { token: null })); assert.equal(snapshotResponse.status, 200);
  const snapshot = (await snapshotResponse.json()).data; assert.equal(snapshot.image.state, 'active'); assert.equal(snapshot.image.variants.length, 1);
  assert.equal(Object.hasOwn(snapshot.image, 'recipe'), false);
  assert.deepEqual((await get('content/20/image-presentation/editor')).data.recipe, manifest.recipe);
  state.images.binaryReads.length = 0;
  const imageResponse = await app.handleRequest(request(snapshot.image.variants[0].url.slice('/api/v1/'.length), { token: null }));
  assert.equal(imageResponse.status, 200); assert.equal(imageResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), imageBytes);
  assert.deepEqual(state.images.binaryReads, [{ id: uploaded.id, property: 'Binary' }]);
  // Replays use immutable journal receipts and never resend the image upload.
  await post(`images/drafts/${prepared.setId}/variants/w400`, uploadBody, 'upload-image-1'); assert.equal(state.images.uploads, 1);
  assert.equal((await get('content/20/image-sets')).data[0].deletable, false);
  assert.equal(createHash('sha256').update(state.images.original).digest('hex'), originalHash);
  // Published copies depend on owner/file ACL, not later source changes.
  state.images.original = rasterFixture.png(4,6,99);
  state.images.sourceReadable = false; state.deniedIds.add(10);
  assert.equal((await get('content/20')).data.image.state, 'active');
  assert.equal((await get('content/20/image-presentation/editor')).data.recipe.template, 'poster-strip-v1');
  const staticResponse = await app.handleRequest(request(snapshot.image.variants[0].url.slice('/api/v1/'.length), {token:null}));
  assert.equal(staticResponse.status,200);
  const current = (await get('content/20')).data;
  const clearJob = await enqueue('plans', { commands: [{ action: 'cover-presentation', targetId: 20, expectedRevision: current.revision, setId: null }] }); await runNext();
  const clearPlan = await get(`jobs/${clearJob}`), clearApply = await enqueue(`plans/${clearPlan.id}/apply`, {}, { headers: { 'Idempotency-Key': 'clear-image-1' } }); await runNext();
  assert.equal((await get(`jobs/${clearApply}`)).ok, true);
  assert.equal((await get('content/20')).data.image.state, 'legacy');
  const management = (await get('content/20/image-sets')).data[0];
  assert.equal(management.state, 'inactive'); assert.equal(management.deletable, true); assert.equal(management.generationId, generationId);
  state.images.interruptDeleteOnce = true;
  const deleteInterrupted = await post(`images/drafts/${prepared.setId}/delete`, { ownerId: 20 }, 'delete-image-1', 502);
  assert.equal(deleteInterrupted.error.details.uncertain, true);
  await post(`images/drafts/${prepared.setId}/delete`, { ownerId: 20 }, 'delete-image-1');
  await post(`images/drafts/${prepared.setId}/delete`, { ownerId: 20 }, 'delete-image-1'); assert.equal(state.images.deletions, 1);
  assert.equal(state.images.sets.size, 0);
  const blobRows = await app.store.blobs.list({ prefix: app.store.prefix });
  assert.equal(blobRows.blobs.some(row => row.key.includes('/transfers/')), false);
  for (const row of blobRows.blobs) {
    const bytes = Buffer.from(await app.store.blobs.get(row.key, { type: 'arrayBuffer' }));
    assert.equal(bytes.includes(imageBytes), false, row.key);
    assert.equal(bytes.toString().includes(imageBytes.toString('base64')), false, row.key);
  }
});

test('dedicated image writes keep their existing deadline in deployed and local runtimes', () => {
  for (const devRuntime of [false, true]) for (const path of ['/api/v1/images/drafts', '/api/v1/images/drafts/30/variants/w400', '/.netlify/functions/native-api/v1/images/drafts/30/seal', '/.netlify/functions/native-api/images/drafts/30/delete']) assert.equal(invocationTimeoutMs(new Request('https://app.fixture.invalid' + path, { method: 'POST' }), false, devRuntime), 25000);
});

test('local synchronous reads and plans leave cleanup headroom while deployed and background deadlines remain unchanged', () => {
  for (const [method, path] of [['GET', '/api/v1/capabilities'], ['POST', '/api/v1/lookup'], ['GET', '/api/v1/content/10'], ['POST', '/api/v1/plans'], ['GET', '/.netlify/functions/native-api/v1/capabilities'], ['POST', '/.netlify/functions/native-api/lookup']]) {
    const request = new Request('https://app.fixture.invalid' + path, { method });
    assert.equal(invocationTimeoutMs(request, false, true), 25000);
    assert.equal(invocationTimeoutMs(request), 55000);
    assert.equal(invocationTimeoutMs(request, false, false), 55000);
  }
  const background = new Request('https://app.fixture.invalid/.netlify/functions/native-api-background', { method: 'POST' });
  for (const devRuntime of [false, true]) assert.equal(invocationTimeoutMs(background, true, devRuntime), 895000);
});

test('the function entrypoint chooses its local deadline from the exact runtime flag before configuration', async t => {
  const names = ['TIMELINE_NETLIFY_DEV', 'TIMELINE_APP_DEV_CA_FILE', 'TIMELINE_READ_ONLY'], saved = new Map(names.map(name => [name, process.env[name]]));
  t.after(() => { for (const [name, value] of saved) if (value === undefined) delete process.env[name]; else process.env[name] = value; });
  // Configuration deliberately fails before any backend or storage access.
  process.env.TIMELINE_APP_DEV_CA_FILE = 'relative-test-only.pem'; process.env.TIMELINE_READ_ONLY = 'invalid-test-only';
  const delays = [], originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => { delays.push(delay); return originalTimeout(callback, delay, ...args); });
  for (const flag of [undefined, 'false', 'true']) {
    if (flag === undefined) delete process.env.TIMELINE_NETLIFY_DEV; else process.env.TIMELINE_NETLIFY_DEV = flag;
    const response = await handleFunctionRequest(new Request('https://app.fixture.invalid/api/v1/lookup', { method: 'POST', body: '{}' }));
    assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'invalid_configuration');
  }
  assert.deepEqual(delays, [55000, 55000, 25000]);
});

async function preparedImageUpload(t, extra = {}) {
  const f = await setup(t, extra); f.state.images.enabled = true;
  f.content.CoverImageBin = { __mediaresource: { content_type: 'image/png', media_src: 'stored-original' } };
  f.contents.set(20, { ...f.content, Id: 20, Type: 'Timeline', CoverImageBin: null, Name: 'owner', Path: f.config.projectRoot + '/Timelines/owner' });
  const current = (await (await f.app.handleRequest(f.request('content/20'))).json()).data;
  const generationId = randomUUID(), manifest = { schemaVersion: 1, kind: 'timeline-composite', projectPath: f.config.projectRoot, ownerId: 20, generationId, sourceIds: [10], sourceStamps: [{ id: 10, stamp: f.state.images.stamp }], recipe: { template: 'poster-strip-v1', sourceIds: [10] }, variants: [] };
  const draftResponse = await f.app.handleRequest(f.request('images/drafts', { method: 'POST', body: { ownerId: 20, generationId, expectedRevision: current.revision, manifest }, headers: { 'Idempotency-Key': 'deadline-draft-key' } })); assert.equal(draftResponse.status, 201, await draftResponse.clone().text());
  const draft = (await draftResponse.json()).data, bytes = rasterFixture.png(400,200), variant = { name: 'w400', width: 400, height: 200, mimeType: 'image/png', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  return { ...f, route: `images/drafts/${draft.setId}/variants/w400`, upload: { method: 'POST', body: { ownerId: 20, variant, bytesBase64: bytes.toString('base64') }, headers: { 'Idempotency-Key': 'deadline-upload-key' } } };
}

test('deadline after native upload committed but before readback remains uncertain and same-key retry reads without uploading again', async t => {
  const controller = new AbortController(), f = await preparedImageUpload(t, { signal: controller.signal });
  const original = StockRepository.prototype.request;
  StockRepository.prototype.request = async function (url, options) {
    const result = await original.call(this, url, options);
    if (options?.method === 'POST' && new URL(url).pathname.endsWith('/Upload')) controller.abort();
    return result;
  };
  t.after(() => { StockRepository.prototype.request = original; });
  const response = await f.app.handleRequest(f.request(f.route, f.upload));
  assert.equal(response.status, 409); const failure = (await response.json()).error;
  assert.equal(failure.code, 'function_deadline'); assert.equal(failure.details.uncertain, true);
  assert.equal(f.state.images.uploads, 1); assert.equal((await f.app.store.pendingMutations()).length, 1);
  assert.equal((await f.app.coordinator.inspect()).state, 'released');
  const first = (await f.app.store.pendingMutations())[0]; assert.equal(first.state, 'pending'); assert.equal(first.result, null);
  const restarted = createFunctionApp({ ...f.config, signal: undefined }), afterCommit = f.state.requests.length;
  const replay = await restarted.handleRequest(f.request(f.route, f.upload));
  assert.equal(replay.status, 200, await replay.clone().text());
  assert.equal(f.state.images.uploads, 1); assert.equal((await restarted.store.pendingMutations()).length, 0);
  assert.equal(f.state.requests.slice(afterCommit).some(row => ['POST', 'PATCH', 'DELETE', 'PUT'].includes(row.method)), false);
});

test('deadline before actual native dispatch is a terminal no-write failure and releases only its own writer', async t => {
  const controller = new AbortController(), f = await preparedImageUpload(t, { signal: controller.signal });
  const original = StockRepository.prototype.request;
  StockRepository.prototype.request = async function (url, options) {
    const result = await original.call(this, url, options), parsed = new URL(url);
    if (parsed.pathname.endsWith('/HasPermission') && parsed.searchParams.get('permissions') === 'AddNew') controller.abort();
    return result;
  };
  t.after(() => { StockRepository.prototype.request = original; });
  const response = await f.app.handleRequest(f.request(f.route, f.upload));
  assert.equal(response.status, 409); const failure = (await response.json()).error;
  assert.equal(failure.code, 'function_deadline'); assert.equal(f.state.images.uploads, 0);
  assert.equal((await f.app.store.pendingMutations()).length, 0); assert.equal((await f.app.coordinator.inspect()).state, 'released');
});

test('current stock draft AddNew denial blocks image upload without writing bytes', async t => {
  const { app, request, state, content, contents, config } = await setup(t); state.images.enabled = true;
  content.CoverImageBin = { __mediaresource: { content_type: 'image/png', media_src: 'stored-original' } };
  contents.set(20, { ...content, Id: 20, Type: 'Timeline', CoverImageBin: null, Name: 'owner', Path: config.projectRoot + '/Timelines/owner' });
  const currentResponse = await app.handleRequest(request('content/20')), current = (await currentResponse.json()).data;
  const generationId = randomUUID(), manifest = { schemaVersion: 1, kind: 'timeline-composite', projectPath: config.projectRoot, ownerId: 20, generationId, sourceIds: [10], sourceStamps: [{ id: 10, stamp: state.images.stamp }], recipe: { template: 'poster-strip-v1', sourceIds: [10] }, variants: [] };
  const draftResponse = await app.handleRequest(request('images/drafts', { method: 'POST', body: { ownerId: 20, generationId, expectedRevision: current.revision, manifest }, headers: { 'Idempotency-Key': 'acl-draft-key' } })); assert.equal(draftResponse.status, 201, await draftResponse.clone().text());
  const draft = (await draftResponse.json()).data, bytes = rasterFixture.png(400,200), variant = { name: 'w400', width: 400, height: 200, mimeType: 'image/png', byteLength: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  state.images.revokeAtUpload = true;
  const response = await app.handleRequest(request(`images/drafts/${draft.setId}/variants/w400`, { method: 'POST', body: { ownerId: 20, variant, bytesBase64: bytes.toString('base64') }, headers: { 'Idempotency-Key': 'acl-upload-key' } }));
  assert.equal(response.status, 403); assert.equal((await response.json()).error.code, 'permission_denied');
  assert.equal(state.images.uploads, 0); assert.equal(state.images.files.size, 0); assert.equal(state.images.activations, 0);
});

test('metadata GET failure before upload dispatch is a durable terminal failure and never redispatches', async t => {
  const f=await preparedImageUpload(t),original=StockRepository.prototype.request;
  StockRepository.prototype.request=async function(url,options){const parsed=new URL(url);if((!options?.method||options.method==='GET')&&parsed.searchParams.get('query')?.startsWith('+ParentId:')){const error=new Error('Controlled stock metadata failure');error.status=502;error.code='backend_failure';throw error;}return original.call(this,url,options);};
  t.after(()=>{StockRepository.prototype.request=original;});
  const failed=await f.app.handleRequest(f.request(f.route,f.upload));assert.equal(failed.status,502);assert.equal((await failed.json()).error.details.uncertain,false);
  assert.equal(f.state.images.uploads,0);assert.equal((await f.app.store.pendingMutations()).length,0);assert.equal((await f.app.coordinator.inspect()).state,'released');
  StockRepository.prototype.request=original;
  const retry=await f.app.handleRequest(f.request(f.route,f.upload));assert.equal(retry.status,502);assert.equal((await retry.json()).error.details.uncertain,false);assert.equal(f.state.images.uploads,0,'terminal key never replays the failed write');
});
