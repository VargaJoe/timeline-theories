import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { JobService } from '../client/api/jobs.mjs';
import { Store, hash } from '../client/api/store.mjs';
import { Coordinator } from '../client/api/coordinator.mjs';
import { DomainError } from '../client/domain/content.mjs';
import { startBlobFixture } from './helpers/netlify-blobs-fixture.mjs';
import { devOptions } from '../scripts/m1-dev.mjs';

// Real Blobs SDK against its local HTTP server, with explicit emulator fixes.
// Context callbacks isolate job ownership; integrated API smoke verifies ACLs.
let fixture;
before(async () => { fixture = await startBlobFixture(); });
after(async () => { await fixture?.close(); });
const origin = 'https://app.fixture.invalid', secret = 'backend-token-never-in-blobs';
const rejectsCode = (promise, code) => assert.rejects(promise, error => error.code === code);
function context(extra = {}) {
  return { principal: 'session:42:' + hash(secret), identity: { Id: 42 }, check: async () => {}, repo: { assert: async () => {} }, ...extra };
}
function setup(extra = {}) {
  const config = { frontendOrigin: origin, repositoryUrl: 'https://repository.fixture.invalid', authority: 'https://authority.fixture.invalid', projectRoot: '/Root/' + randomUUID(), blobOptions: fixture.blobOptions };
  const store = new Store(config), invocations = [];
  const jobs = new JobService(config, { store, invoke: async (url, headers, bytes) => { invocations.push({ url, headers, bytes }); }, ...extra });
  return { jobs, store, config, invocations };
}
function request(path = '/plans', { key, body = '{"commands":[]}', method = 'POST' } = {}) {
  return new Request(origin + '/api/v1' + path, { method, headers: { authorization: 'Bearer ' + secret, origin, 'x-timeline-backend-auth': 'ApiKey', 'x-timeline-repository': 'https://repository.fixture.invalid', 'x-timeline-authority': 'https://authority.fixture.invalid', 'x-timeline-project': '/Root/project', 'x-do-not-forward': 'untrusted', 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, ...(method === 'GET' ? {} : { body }) });
}
function invocation(saved, id) {
  return new Request(origin + '/.netlify/functions/native-api-background', { method: 'POST', headers: saved.headers, body: JSON.stringify({ jobId: id }) });
}
async function enqueue(jobs, req = request(), ctx = context()) { const response = await jobs.enqueue(req, ctx); assert.equal(response.status, 202); return (await response.json()).job.id; }

test('private input omits credentials and forwards only fixed-origin HTTPS headers', async () => {
  const { jobs, store, invocations } = setup(), id = await enqueue(jobs);
  const sent = invocations[0];
  assert.equal(sent.url.href, origin + '/.netlify/functions/native-api-background');
  assert.equal(sent.headers.get('authorization'), 'Bearer ' + secret);
  assert.equal(sent.headers.get('x-timeline-client-origin'), origin);
  assert.equal(sent.headers.has('origin'), false);
  assert.equal(sent.headers.has('x-do-not-forward'), false);
  assert.deepEqual(JSON.parse(sent.bytes.toString()), { jobId: id });
  const keys = await store.blobs.list({ prefix: store.prefix });
  for (const blob of keys.blobs) assert.equal(JSON.stringify(await store.blobs.get(blob.key, { type: 'json', consistency: 'strong' })).includes(secret), false);
  await rejectsCode(jobs.enqueue(new Request('https://evil.invalid/api/v1/plans', { method: 'POST', body: '{}' }), context()), 'job_route_invalid');
});

test('automatic retry and concurrent invocations execute the saved job exactly once', async () => {
  const { jobs, invocations } = setup(), ctx = context(), id = await enqueue(jobs), sent = invocations[0];
  let calls = 0;
  const execute = async ({ request: original, job }) => {
    calls++; await job.assertOwner();
    assert.equal(original.url, origin + '/api/v1/plans');
    assert.equal(original.headers.get('authorization'), 'Bearer ' + secret);
    assert.deepEqual(await original.json(), { commands: [] });
    return { status: 200, headers: { 'Content-Type': 'application/json', 'X-Result': 'same' }, body: Buffer.from('{"plan":"saved"}') };
  };
  await Promise.all([jobs.run(invocation(sent, id), ctx, execute), jobs.run(invocation(sent, id), ctx, execute)]);
  await jobs.run(invocation(sent, id), ctx, execute);
  assert.equal(calls, 1);
  const result = await jobs.status(id, ctx);
  assert.equal(result.status, 200); assert.equal(result.headers.get('x-result'), 'same');
  assert.equal(await result.text(), '{"plan":"saved"}');
});

test('same principal and apply key returns the same job; different saved plan conflicts', async () => {
  const { jobs, invocations } = setup(), plan = randomUUID(), key = randomUUID(), ctx = context();
  const ids = await Promise.all([enqueue(jobs, request('/plans/' + plan + '/apply', { key }), ctx), enqueue(jobs, request('/plans/' + plan + '/apply', { key }), ctx)]);
  assert.equal(ids[0], ids[1]); assert.equal(invocations.length, 1);
  await rejectsCode(jobs.enqueue(request('/plans/' + randomUUID() + '/apply', { key }), ctx), 'idempotency_conflict');
});

test('status/cancel reject changed principal or identity and recheck final private targets', async () => {
  const { jobs, invocations } = setup(), ctx = context(), id = await enqueue(jobs);
  await jobs.run(invocation(invocations[0], id), ctx, async () => ({ status: 200, headers: { 'content-type': 'application/zip' }, body: Buffer.from('private-archive'), readTargets: [10, 11] }));
  await rejectsCode(jobs.status(id, context({ principal: 'grant:' + randomUUID() })), 'job_unavailable');
  await rejectsCode(jobs.cancel(id, context({ identity: { Id: 43 } })), 'job_unavailable');
  let checked;
  assert.equal(await (await jobs.status(id, context({ repo: { assert: async operations => { checked = operations; } } }))).text(), 'private-archive');
  assert.deepEqual(checked, [{ target: 10, action: 'read' }, { target: 11, action: 'read' }]);
  await rejectsCode(jobs.status(id, context({ repo: { assert: async () => { throw new DomainError('permission_denied', 'Open was revoked.', 403); } } })), 'permission_denied');
  await rejectsCode(jobs.status(id, context({ check: async () => { throw new DomainError('credential_revoked', 'The grant was revoked.', 401); } })), 'credential_revoked');
});

test('pending owner sees only the exact held writer confirmation IDs for its saved job', async () => {
  const { jobs, config } = setup(), ctx = context(), planId = randomUUID(), key = randomUUID();
  const id = await enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx);
  await jobs.blobs.setJSON(jobs.key(id, 'claim'), { id, principal: ctx.principal, identity: ctx.identity.Id, nonce: randomUUID() }, { onlyIfNew: true });
  const coordinator = new Coordinator(config), requestId = randomUUID();
  const held = await coordinator.acquire({ requestId, identity: ctx.identity.Id, principal: ctx.principal, planId, jobId: id });
  try {
    const response = await jobs.status(id, ctx), value = await response.json();
    assert.equal(response.status, 202); assert.equal(value.pending, true); assert.equal(value.job.state, 'running');
    assert.deepEqual(value.recovery, { planId, stoppedRequestId: requestId, requiresStoppedConfirmation: true });
    const text = JSON.stringify(value);
    assert.equal(text.includes(held.nonce), false); assert.equal(text.includes(ctx.principal), false);
    assert.equal(Object.hasOwn(value.recovery, 'identity'), false); assert.equal(Object.hasOwn(value.recovery, 'etag'), false);
    await rejectsCode(jobs.status(id, context({ identity: { Id: 43 } })), 'job_unavailable');
    let checks = 0;
    await rejectsCode(jobs.descriptor(id, context({ check: async () => { if (++checks === 2) throw new DomainError('credential_revoked', 'The credential changed while reading recovery state.', 401); } })), 'credential_revoked');
  } finally { await coordinator.releaseOwned(held); }
  assert.equal(Object.hasOwn(await (await jobs.status(id, ctx)).json(), 'recovery'), false);
});

test('pending job recovery never discloses a different writer, principal, identity or plan', async () => {
  for (const mismatch of ['job', 'principal', 'identity', 'plan']) {
    const { jobs, config } = setup(), ctx = context(), planId = randomUUID(), key = randomUUID();
    const id = await enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx), coordinator = new Coordinator(config);
    const held = await coordinator.acquire({ requestId: randomUUID(), identity: mismatch === 'identity' ? 43 : ctx.identity.Id, principal: mismatch === 'principal' ? 'grant:' + randomUUID() : ctx.principal, planId: mismatch === 'plan' ? randomUUID() : planId, jobId: mismatch === 'job' ? randomUUID() : id });
    try {
      const value = await (await jobs.status(id, ctx)).json();
      assert.equal(Object.hasOwn(value, 'recovery'), false);
      assert.equal(JSON.stringify(value).includes(held.requestId), false);
      assert.equal(JSON.stringify(value).includes(held.nonce), false);
    } finally { await coordinator.releaseOwned(held); }
  }
});

test('final non-2xx status and bytes reproduce the original response', async () => {
  const { jobs, invocations } = setup(), id = await enqueue(jobs);
  const bytes = Buffer.from([0, 1, 254, 255]);
  await jobs.run(invocation(invocations[0], id), context(), async () => ({ status: 412, headers: { 'content-type': 'application/octet-stream', 'x-failure': 'kept' }, body: bytes }));
  const result = await jobs.status(id, context());
  assert.equal(result.status, 412); assert.equal(result.headers.get('x-failure'), 'kept');
  assert.deepEqual(Buffer.from(await result.arrayBuffer()), bytes);
});

test('queued cancellation prevents execution; running cancellation stops the next write guard', async () => {
  const queued = setup(), queuedId = await enqueue(queued.jobs);
  assert.equal((await queued.jobs.cancel(queuedId, context())).status, 409);
  let queuedCalls = 0;
  await queued.jobs.run(invocation(queued.invocations[0], queuedId), context(), async () => { queuedCalls++; });
  assert.equal(queuedCalls, 0);
  const running = setup(), id = await enqueue(running.jobs);
  let enter, proceed, writes = 0;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { proceed = resolve; });
  const execution = running.jobs.run(invocation(running.invocations[0], id), context(), async ({ job }) => {
    enter(); await gate; await job.assertOwner(); writes++;
    return { status: 200, body: Buffer.from('{}') };
  });
  await entered;
  assert.equal((await (await running.jobs.cancel(id, context())).json()).job.state, 'cancelling');
  proceed(); await execution;
  const result = await running.jobs.status(id, context());
  assert.equal(result.status, 409); assert.equal((await result.json()).error.code, 'job_cancelled'); assert.equal(writes, 0);
});

test('unconfirmed dispatch remains inspectable and the same apply retry never redispatches', async () => {
  let calls = 0;
  const { jobs } = setup({ invoke: async () => { calls++; throw new Error('Network acknowledgement lost.'); } });
  const plan = randomUUID(), key = randomUUID(), id = await enqueue(jobs, request('/plans/' + plan + '/apply', { key }));
  assert.equal((await (await jobs.status(id, context())).json()).job.state, 'dispatch_unconfirmed');
  assert.equal(await enqueue(jobs, request('/plans/' + plan + '/apply', { key })), id); assert.equal(calls, 1);
});

test('two simultaneous retries replace only a known coordinator-busy job with one new job', async () => {
  const { jobs, invocations } = setup(), ctx = context(), plan = randomUUID(), key = randomUUID();
  const first = await enqueue(jobs, request('/plans/' + plan + '/apply', { key }), ctx);
  await jobs.run(invocation(invocations[0], first), ctx, async () => { throw new DomainError('coordinator_busy', 'No writer was acquired and no write was dispatched.', 409); });
  assert.equal((await jobs.status(first, ctx)).status, 409);
  const next = await Promise.all([enqueue(jobs, request('/plans/' + plan + '/apply', { key }), ctx), enqueue(jobs, request('/plans/' + plan + '/apply', { key }), ctx)]);
  assert.equal(next[0], next[1]); assert.notEqual(next[0], first); assert.equal(invocations.length, 2);
  await jobs.run(invocation(invocations[1], next[0]), ctx, async () => ({ status: 200, body: Buffer.from('{"ok":true}') }));
  const final = await jobs.enqueue(request('/plans/' + plan + '/apply', { key }), ctx);
  assert.equal(final.status, 200); assert.deepEqual(await final.json(), { ok: true }); assert.equal(invocations.length, 2);
});

test('cancelled, partial and revision-denied apply jobs retain their permanent mapping', async () => {
  for (const [code, receipt] of [['job_cancelled', {}], ['revision_conflict', {}], ['partial', { completed: [{ id: 10 }] }], ['coordinator_owner_lost', {}], ['coordinator_busy', { ok: false, completed: [{ id: 10 }] }]]) {
    const { jobs, invocations } = setup(), ctx = context(), plan = randomUUID(), key = randomUUID();
    const id = await enqueue(jobs, request('/plans/' + plan + '/apply', { key }), ctx);
    await jobs.run(invocation(invocations[0], id), ctx, async () => ({ status: 409, body: Buffer.from(JSON.stringify({ error: { code }, ...receipt })) }));
    const retry = await jobs.enqueue(request('/plans/' + plan + '/apply', { key }), ctx);
    assert.equal(retry.status, 409); assert.equal((await retry.json()).error.code, code); assert.equal(invocations.length, 1);
  }
});

test('explicit concurrent same-plan retries reserve one uncertain-receipt reconciliation job', async () => {
  const { jobs, invocations } = setup(), ctx = context(), planId = randomUUID(), key = randomUUID();
  const first = await enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx);
  let executions = 0;
  await jobs.run(invocation(invocations[0], first), ctx, async () => {
    executions++;
    return { status: 502, body: Buffer.from(JSON.stringify({ ok: false, planId, retrySamePlan: true, completed: [], notApplied: [{ index: 0 }], error: { code: 'repository_transport' } })) };
  });
  await jobs.run(invocation(invocations[0], first), ctx, async () => { executions++; });
  assert.equal(executions, 1, 'Netlify retries of the original job cannot re-execute it.');
  const next = await Promise.all([enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx), enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx)]);
  assert.equal(next[0], next[1]); assert.notEqual(next[0], first); assert.equal(invocations.length, 2);
  await jobs.run(invocation(invocations[1], next[0]), ctx, async ({ request: original }) => {
    executions++;
    assert.equal(original.url, origin + '/api/v1/plans/' + planId + '/apply');
    assert.equal(original.headers.get('idempotency-key'), key);
    return { status: 200, body: Buffer.from(JSON.stringify({ ok: true, planId, completed: [{ result: { id: 10, replayed: true } }], notApplied: [] })) };
  });
  const final = await jobs.enqueue(request('/plans/' + planId + '/apply', { key }), ctx);
  assert.equal(final.status, 200); assert.equal((await final.json()).completed[0].result.replayed, true);
  assert.equal(executions, 2); assert.equal(invocations.length, 2);
});

test('explicit retry can recheck a terminal uncertain DomainError without resending the old job', async () => {
  const { jobs, invocations } = setup(), ctx = context(), planId = randomUUID(), key = randomUUID();
  const first = await enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx);
  await jobs.run(invocation(invocations[0], first), ctx, async () => { throw new DomainError('uncertain_update', 'The prior dispatched update has no confirmed result yet.', 409, { uncertain: true }); });
  assert.equal((await jobs.status(first, ctx)).status, 409);
  const next = await enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx);
  assert.notEqual(next, first); assert.equal(invocations.length, 2);
  let automaticExecutions = 0;
  await jobs.run(invocation(invocations[0], first), ctx, async () => { automaticExecutions++; });
  assert.equal(automaticExecutions, 0);
});

test('confirmed receipts, mismatched uncertainty and generic transport failures cannot reserve a new job', async () => {
  for (const kind of ['completed', 'confirmed_partial', 'wrong_plan', 'generic_502', 'cancelled_uncertainty']) {
    const { jobs, invocations } = setup(), ctx = context(), planId = randomUUID(), key = randomUUID();
    const first = await enqueue(jobs, request('/plans/' + planId + '/apply', { key }), ctx);
    const status = kind === 'completed' ? 200 : kind === 'confirmed_partial' ? 207 : 502;
    const value = kind === 'generic_502' ? { error: { code: 'repository_transport', message: 'No conclusive receipt.' } } : {
      ok: kind === 'completed', planId: kind === 'wrong_plan' ? randomUUID() : planId, completed: [], notApplied: [],
      ...(kind === 'confirmed_partial' ? {} : { retrySamePlan: true }), error: { code: kind === 'cancelled_uncertainty' ? 'job_cancelled' : 'repository_transport' },
    };
    await jobs.run(invocation(invocations[0], first), ctx, async () => ({ status, body: Buffer.from(JSON.stringify(value)) }));
    const retry = await jobs.enqueue(request('/plans/' + planId + '/apply', { key }), ctx);
    assert.equal(retry.status, status); assert.deepEqual(await retry.json(), value); assert.equal(invocations.length, 1);
  }
});

test('large-result preparation accepts a download Web Response and preserves ACL targets', async () => {
  let preparedContext, acl;
  const ctx = context({ repo: { assert: async operations => { acl = operations; } } });
  const { jobs, invocations } = setup({ prepareResponse: async (response, caller) => {
    preparedContext = caller;
    assert.equal(response.body.length, 5 * 1024 * 1024);
    return new Response('{"download":{"id":"private"}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  } });
  const id = await enqueue(jobs, request('/exchange/10/export', { method: 'GET' }), ctx);
  await jobs.run(invocation(invocations[0], id), ctx, async () => ({ status: 200, body: Buffer.alloc(5 * 1024 * 1024), readTargets: [10] }));
  assert.equal(preparedContext, ctx);
  assert.deepEqual(await (await jobs.status(id, ctx)).json(), { download: { id: 'private' } });
  assert.deepEqual(acl, [{ target: 10, action: 'read' }]);
});

test('ordinary dev preserves configured target values and uses one offline Netlify app', () => {
  const env = { VITE_SENSENET_REPO_URL: 'https://configured.invalid', TIMELINE_REPOSITORY_URL: 'https://configured.invalid', NODE_EXTRA_CA_CERTS: 'configured-ca.pem' };
  const options = devOptions({ environment: env });
  assert.equal(options.options.env.VITE_SENSENET_REPO_URL, env.VITE_SENSENET_REPO_URL);
  assert.equal(options.options.env.TIMELINE_REPOSITORY_URL, env.TIMELINE_REPOSITORY_URL);
  assert.equal(options.options.env.NODE_EXTRA_CA_CERTS, env.NODE_EXTRA_CA_CERTS);
  assert.equal(options.options.env.TIMELINE_LOCAL_PROFILE, undefined);
  assert.equal(options.options.env.TIMELINE_NETLIFY_DEV, 'true');
  assert.ok(options.args.includes('--offline')); assert.ok(options.args.includes('--no-open'));
});
