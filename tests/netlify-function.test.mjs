import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import forge from '../client/node_modules/node-forge/lib/index.js';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';
import { createFunctionApp } from '../client/api/function.mjs';
import { FIELDS } from '../client/domain/content.mjs';
import { hash } from '../client/api/store.mjs';
import { loadConfig } from '../client/api/config.mjs';

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
  const state = { requests: [], patches: 0, allowSave: true, allowRead: true, onSave: null, interruptNextReadback: false };
  const content = { Id: 10, ParentId: 2, Name: 'media', DisplayName: 'Fixture media', Path: projectRoot + '/MediaLibrary/media', Type: 'MediaItem', Title: 'Before', CreationDate: '2026-10-01T00:00:00Z', CreatedById: 42, ModificationDate: '2026-10-01T00:00:00Z', ModifiedById: 42, Version: 'V1.0', VersionId: 1 };
  const send = (res, status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ d: value })); };
  const server = https.createServer(tls, async (req, res) => {
    try {
      const url = new URL(req.url, 'https://localhost'), credential = req.headers.apikey || req.headers.authorization?.replace(/^Bearer /, '');
      state.requests.push({ method: req.method, path: url.pathname, permissions: url.searchParams.get('permissions'), credential });
      if (url.pathname.endsWith('/GetCurrentUser')) return send(res, credential === 'rejected' ? 401 : 200, { Id: credential === 'other-user' ? 99 : 42, Name: 'AuthenticatedFixture' });
      if (url.pathname.endsWith('/HasPermission')) {
        if (url.searchParams.get('permissions') === 'Save' && state.onSave) { const callback = state.onSave; state.onSave = null; await callback(); }
        return send(res, 200, url.searchParams.get('permissions') === 'Save' ? state.allowSave : state.allowRead);
      }
      if (url.pathname.endsWith('/GetSchema')) {
        const type = url.searchParams.get('contentTypeName');
        const names = ['Id','ParentId','Name','Path','Type','CreationDate','CreatedById','ModificationDate','ModifiedById','Version','VersionId', ...(FIELDS[type] || []), 'CoverImageBin'];
        return send(res, 200, [{ ContentTypeName: type, FieldSettings: [...new Set(names)].map(Name => ({ Name, ReadOnly: false })) }]);
      }
      if (url.pathname.endsWith("('MediaLibrary')") || url.pathname === '/OData.svc/content(2)') return send(res, state.allowRead ? 200 : 403, { Id: 2, ParentId: 1, Name: 'MediaLibrary', Path: projectRoot + '/MediaLibrary', Type: 'Folder', ModificationDate: '2026-10-01T00:00:00Z', Version: 'V1.0' });
      if (url.pathname === '/OData.svc/content(10)') {
        if (!state.allowRead) return send(res, 403, null);
        if (req.method === 'GET' && state.patches && state.interruptNextReadback) {
          // The controlled server already applied the actual HTTPS PATCH, but
          // its first readback connection is lost. Recovery must read durable
          // intent and the changed postcondition without sending another PATCH.
          state.interruptNextReadback = false; return res.destroy();
        }
        if (req.method === 'PATCH') {
          if (!state.allowSave) return send(res, 403, null);
          const chunks = []; for await (const part of req) chunks.push(part);
          Object.assign(content, JSON.parse(Buffer.concat(chunks).toString()), { Version: `V${++state.patches + 1}.0`, VersionId: state.patches + 1, ModificationDate: new Date().toISOString() });
        }
        return send(res, 200, content);
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
  return { app, config, state, content, request, enqueue, background, runNext, invocations, preview };
}

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
  const environment = { TIMELINE_REPOSITORY_URL: 'https://plastice.sensenet.cloud', TIMELINE_AUTHORITY: 'https://plastice-is.sensenet.cloud', TIMELINE_PROJECT_ROOT: '/Root/Content/timelines', TIMELINE_READ_ONLY: 'true', TIMELINE_FRONTEND_ORIGIN: undefined, TIMELINE_INVENTORY_CREDENTIAL: undefined, DEPLOY_PRIME_URL: undefined, URL: undefined, CONTEXT: undefined, REVIEW_ID: undefined };
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
