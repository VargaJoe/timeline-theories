import test from 'node:test';
import assert from 'node:assert/strict';
import { createDisplayPermissions } from '../client/services/displayPermissions.mjs';

const pathFor = id => `/Root/Content/timelines/MediaLibrary/item-${id}`;

test('case-insensitive SenseNet paths reuse caller-bound hints for the same content ID', async () => {
  const canonical = '/Root/Content/timelines/Timelines/Conan the Barbarian';
  const f = fixture();
  f.store.remember({ ...content(7), Path: canonical });
  for (const target of [canonical.toLowerCase(), canonical.toUpperCase(), canonical, 7]) {
    assert.equal(await f.store.can([operation(target, 'read')]), true);
    assert.equal(await f.store.can([operation(target, 'update')]), true);
  }
  assert.equal(f.loads.length, 0, 'Changing path capitalization is not another permission target');
});

test('a lower-case route accepts the canonical mixed-case Path returned by SenseNet', async () => {
  const canonical = '/Root/Content/timelines/Timelines/Conan the Barbarian';
  const f = fixture({ load: async () => ({ ...content(7), Path: canonical }) });
  assert.equal(await f.store.can([operation(canonical.toLowerCase(), 'read')]), true);
  assert.equal(await f.store.can([operation(canonical.toUpperCase(), 'update')]), true);
  assert.equal(await f.store.can([operation(7, 'delete')]), true);
  assert.equal(f.loads.length, 1, 'Canonical path and route aliases share one authorized descriptor');
});

function content(id = 7, actions = [{ Name: 'Edit', Forbidden: false }, { Name: 'Delete', Forbidden: false }]) {
  return { Id: id, Path: pathFor(id), Actions: { results: actions } };
}
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const turn = () => new Promise(resolve => setImmediate(resolve));
async function started(predicate) {
  for (let attempts = 0; attempts < 20 && !predicate(); attempts++) await turn();
  assert.equal(predicate(), true, 'The expected asynchronous work did not start.');
}
function fixture(options = {}) {
  let identity = 'editor';
  let writable = true;
  let now = 100_000;
  const loads = [];
  const readiness = [];
  const store = createDisplayPermissions({
    identity: () => identity,
    writable: () => writable,
    now: () => now,
    load: async target => {
      loads.push(target);
      return options.load ? options.load(target) : content(Number(target));
    },
    ready: async (target, creating) => {
      readiness.push({ target, creating });
      return options.ready ? options.ready(target, creating) : true;
    },
    ...(options.ttlMs === undefined ? {} : { ttlMs: options.ttlMs }),
    ...(options.concurrency === undefined ? {} : { concurrency: options.concurrency }),
  });
  return { store, loads, readiness, setIdentity: value => { identity = value; }, setWritable: value => { writable = value; }, setNow: value => { now = value; } };
}
const operation = (target, action) => ({ target, action });

test('transport outages are unavailable, fail closed, and stay cached until explicit retry', async () => {
  let healthy = false;
  const f = fixture({ load: async () => {
    if (!healthy) throw new Error('Repository request timed out');
    return content(7);
  } });
  const operations = [operation(7, 'read')];
  assert.equal(await f.store.inspect(operations), 'unavailable');
  assert.equal(await f.store.can(operations), false);
  healthy = true;
  assert.equal(await f.store.inspect(operations), 'unavailable', 'No background retry or fail-open stale hint');
  assert.equal(f.loads.length, 1);
  f.store.invalidate();
  assert.equal(await f.store.inspect(operations), 'allowed');
  assert.equal(f.loads.length, 2);
});

test('known inaccessible targets and forbidden actions remain denials rather than outages', async () => {
  const missing = fixture({ load: async () => { throw Object.assign(new Error('Not available to this caller'), { permissionUnavailable: false }); } });
  assert.equal(await missing.store.inspect([operation(7, 'read')]), 'denied');
  assert.equal(await missing.store.can([operation(7, 'read')]), false);
  assert.equal(missing.loads.length, 1);
  const forbidden = fixture();
  forbidden.store.remember(content(7, [{ Name: 'Edit', Forbidden: true }]));
  assert.equal(await forbidden.store.inspect([operation(7, 'update')]), 'denied');
  assert.equal(forbidden.loads.length, 0);
});

test('an outage result from a previous identity cannot replace a fresh allowed descriptor', async () => {
  const gate = deferred();
  const f = fixture({ load: async () => gate.promise });
  const previous = f.store.inspect([operation(7, 'read')]);
  await started(() => f.loads.length === 1);
  f.setIdentity('next-editor');
  f.store.remember(content(7));
  gate.resolve(null);
  assert.equal(await previous, 'denied');
  assert.equal(await f.store.inspect([operation(7, 'read')]), 'allowed');
});

test('successful caller read proves read availability even when Browse is absent', async () => {
  const f = fixture();
  f.setIdentity('visitor');
  f.setWritable(false);
  f.store.remember(content(7, []));
  assert.equal(await f.store.can([operation(7, 'read')]), true);
  assert.equal(await f.store.can([operation(pathFor(7), 'read')]), true);
  assert.equal(await f.store.can([operation(7, 'update')]), false);
  assert.equal(await f.store.can([operation(7, 'delete')]), false);
  assert.deepEqual(f.loads, []);
  assert.deepEqual(f.readiness, []);
});

test('Id, numeric string and canonical Path share one remembered decision', async () => {
  const f = fixture();
  f.store.remember(content(), ['7', pathFor(7)]);
  const operations = [7, '7', pathFor(7)].map(target => operation(target, 'update'));
  assert.equal(await f.store.can(operations), true);
  assert.equal(f.loads.length, 0);
  assert.equal(f.readiness.length, 1, 'A compound display check shares native write readiness.');
});

test('only exact Edit and Delete with boolean Forbidden false grant write hints', async () => {
  const f = fixture();
  f.store.remember(content(7, [{ Name: 'Edit', Forbidden: false }, { Name: 'Delete', Forbidden: true }]));
  assert.equal(await f.store.can([operation(7, 'update'), operation(7, 'upload')]), true);
  assert.equal(await f.store.can([operation(7, 'delete')]), false);
  assert.equal(f.loads.length, 0);
  assert.equal(f.readiness.length, 1);

  f.store.remember(content(8, ['Create', 'Update', 'Remove', 'Upload'].map(Name => ({ Name, Forbidden: false }))));
  for (const action of ['update', 'upload', 'delete']) assert.equal(await f.store.can([operation(8, action)]), false);
  assert.equal(f.loads.length, 0, 'A complete action list with no matching action is a known denial.');
});

test('raw OData Actions arrays carry the same hints as the SDK results wrapper', async () => {
  const f = fixture();
  const actual = content();
  actual.Actions = actual.Actions.results;
  f.store.remember(actual);
  assert.equal(await f.store.can([operation(7, 'update'), operation(7, 'delete')]), true);
  assert.equal(f.loads.length, 0);
});

test('empty expanded Actions is a known write denial without a fallback request', async () => {
  const f = fixture();
  f.store.remember(content(7, []));
  assert.equal(await f.store.can([operation(7, 'update'), operation(7, 'delete')]), false);
  assert.equal(f.loads.length, 0);
  assert.equal(f.readiness.length, 0);
});

const malformedCases = [
  ['missing', undefined],
  ['deferred', { __deferred: { uri: '/odata.svc/content(7)/Actions' } }],
  ['null', null],
  ['non-array results', { results: 'unexpanded' }],
];
for (const [name, Actions] of malformedCases) test(`malformed ${name} actions fall back once and never grant writes`, async () => {
  const unknown = { Id: 7, Path: pathFor(7), Actions };
  const f = fixture({ load: async () => unknown });
  f.store.remember(unknown);
  assert.equal(await f.store.can([operation(7, 'update'), operation(7, 'upload'), operation(7, 'delete')]), false);
  assert.equal(f.loads.length, 1);
  assert.equal(f.readiness.length, 0);
});

for (const Forbidden of [undefined, 'false', null]) test(`malformed Forbidden is never an affirmative action: ${JSON.stringify(Forbidden)}`, async () => {
  const f = fixture();
  f.store.remember(content(7, [{ Name: 'Edit', Forbidden }]));
  assert.equal(await f.store.can([operation(7, 'update'), operation(7, 'upload')]), false);
  assert.equal(f.readiness.length, 0);
});

test('lower-case metadata operations cannot substitute for expanded Actions', async () => {
  const metadataOnly = { Id: 7, Path: pathFor(7), __metadata: { actions: [{ name: 'Edit', forbidden: false }, { name: 'Delete', forbidden: false }] } };
  const f = fixture({ load: async () => metadataOnly });
  f.store.remember(metadataOnly);
  assert.equal(await f.store.can([operation(7, 'update'), operation(7, 'delete')]), false);
  assert.equal(f.loads.length, 1);
  assert.equal(f.readiness.length, 0);
});

test('one exact content read supplies a large compound check with repeated media IDs', async () => {
  let active = 0;
  let maximum = 0;
  const f = fixture({ load: async target => {
    active++;
    maximum = Math.max(maximum, active);
    await turn();
    active--;
    return content(Number(target));
  } });
  const operations = Array.from({ length: 32 }, (_, index) => index + 1).flatMap(id => [
    operation(id, 'read'), operation(id, 'update'), operation(id, 'upload'), operation(id, 'delete'), operation(String(id), 'update'),
  ]);
  assert.equal(await f.store.can(operations), true);
  assert.equal(f.loads.length, 32, 'Operations on the same media content do not create per-action requests.');
  assert.equal(new Set(f.loads.map(String)).size, 32);
  assert.equal(maximum, 4, 'The default read concurrency is bounded at four.');
  assert.equal(f.readiness.length, 1);
});

test('simultaneous checks coalesce the same target read', async () => {
  const gate = deferred();
  const f = fixture({ load: async () => gate.promise });
  const pending = Promise.all([
    f.store.can([operation(7, 'update')]),
    f.store.can([operation('7', 'upload')]),
    f.store.can([operation(7, 'delete')]),
  ]);
  await started(() => f.loads.length === 1);
  gate.resolve(content());
  assert.deepEqual(await pending, [true, true, true]);
  assert.equal(f.loads.length, 1);
});

test('default display hints remain snapshots until explicit invalidation or fresh content', async () => {
  const f = fixture();
  f.store.remember(content());
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  f.setNow(86_500_000);
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, 0);
  f.store.remember(content(7, [{ Name: 'Edit', Forbidden: true }]));
  assert.equal(await f.store.can([operation(7, 'update')]), false);
  assert.equal(f.loads.length, 0, 'A newly loaded Actions response replaces the displayed snapshot.');
  f.store.invalidate();
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, 1, 'Explicit invalidation obtains current metadata.');
});

test('an explicitly requested TTL expires hints without installing a background refresh', async () => {
  const f = fixture({ ttlMs: 30_000 });
  f.store.remember(content());
  f.setNow(129_999);
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, 0);
  f.setNow(130_001);
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, 1);
});

test('explicit refreshSince observes revoked rights and reuses the denial fetched at the threshold', async () => {
  const f = fixture({ load: async () => content(7, [{ Name: 'Edit', Forbidden: true }]) });
  f.store.remember(content());
  f.setNow(102_000);
  assert.equal(await f.store.can([operation(7, 'update')], { refreshSince: 101_000 }), false);
  assert.equal(f.loads.length, 1);
  assert.equal(await f.store.can([operation(7, 'update')], { refreshSince: 102_000 }), false);
  assert.equal(f.loads.length, 1);
  assert.equal(f.readiness.length, 0);
});

test('readonly and anonymous scopes never discover or ready a write', async () => {
  for (const identity of ['reader', 'visitor']) {
    const f = fixture();
    f.setIdentity(identity);
    f.setWritable(false);
    f.store.remember(content());
    for (const target of [7, 8]) for (const action of ['update', 'upload', 'delete']) assert.equal(await f.store.can([operation(target, action)]), false);
    assert.equal(f.loads.length, 0);
    assert.equal(f.readiness.length, 0);
  }
});

test('create uses the same parent Add hint and exact allowed child type without permission probes', async () => {
  const f = fixture();
  f.store.remember(content(7, [{ Name: 'Add', Forbidden: false }, { Name: 'Create', Forbidden: false }]));
  const root = content(8, [{ Name: 'Add', Forbidden: false }]);
  root.EffectiveAllowedChildTypes = { results: [{ Name: 'TimelineEntry' }, { Name: 'MediaItem' }] };
  f.store.remember(root);
  assert.equal(await f.store.can([{ target: 8, action: 'create', contentType: 'TimelineEntry' }]), true);
  assert.deepEqual(f.readiness, [{ target: 8, creating: true }]);
  assert.equal(await f.store.can([{ target: 8, action: 'create', contentType: 'BookMediaItem' }]), false);
  assert.equal(f.loads.length, 0);
});

test('raw OData allowed child type arrays support create display hints', async () => {
  const f = fixture();
  const root = content(7, [{ Name: 'Add', Forbidden: false }]);
  root.EffectiveAllowedChildTypes = [{ Name: 'Timeline' }];
  f.store.remember(root);
  assert.equal(await f.store.can([{ target: 7, action: 'create', contentType: 'Timeline' }]), true);
  assert.equal(f.loads.length, 0);
  assert.equal(f.readiness.length, 1);
});

for (const allowedTypes of [undefined, null, { __deferred: { uri: '/types' } }, { results: 'unexpanded' }, [], [{ Name: 'GenericContent' }]]) test(`unknown or non-exact child types cannot grant create: ${JSON.stringify(allowedTypes)}`, async () => {
  const root = { ...content(7, [{ Name: 'Add', Forbidden: false }]), EffectiveAllowedChildTypes: allowedTypes };
  const f = fixture({ load: async () => root });
  f.store.remember(root);
  assert.equal(await f.store.can([{ target: 7, action: 'create', contentType: 'TimelineEntry' }]), false);
  assert.equal(f.readiness.length, 0);
});

for (const actions of [[{ Name: 'Add', Forbidden: true }], [{ Name: 'Create', Forbidden: false }], []]) test(`exact child types cannot substitute for Add rights: ${JSON.stringify(actions)}`, async () => {
  const f = fixture();
  f.store.remember({ ...content(7, actions), EffectiveAllowedChildTypes: [{ Name: 'TimelineEntry' }] });
  assert.equal(await f.store.can([{ target: 7, action: 'create', contentType: 'TimelineEntry' }]), false);
  if (actions.some(row => row.Name === 'Add')) assert.equal(f.loads.length, 0);
  else {
    // ContextMenu descriptors omit Add, so one full parent descriptor read is valid.
    assert.ok(f.loads.length <= 1);
    assert.ok(f.loads.every(target => target === 7));
  }
  assert.equal(f.readiness.length, 0);
});

test('readonly create does not load a parent or ready native writes', async () => {
  const f = fixture();
  f.setWritable(false);
  f.store.remember({ ...content(7, [{ Name: 'Add', Forbidden: false }]), EffectiveAllowedChildTypes: [{ Name: 'TimelineEntry' }] });
  assert.equal(await f.store.can([{ target: 7, action: 'create', contentType: 'TimelineEntry' }]), false);
  assert.equal(await f.store.can([{ target: 8, action: 'create', contentType: 'TimelineEntry' }]), false);
  assert.equal(f.loads.length, 0);
  assert.equal(f.readiness.length, 0);
});

for (const [name, load] of [
  ['network failure', async () => { throw new Error('offline'); }],
  ['null content', async () => null],
  ['unexpected scalar', async () => 'allowed'],
]) test(`failed exact read (${name}) cannot enable a write`, async () => {
  const f = fixture({ load });
  assert.equal(await f.store.can([operation(7, 'update')]), false);
  assert.equal(f.readiness.length, 0);
});

test('a loader response for another content cannot authorize or populate the requested target', async () => {
  const f = fixture({ load: async () => content(8) });
  assert.equal(await f.store.can([operation(7, 'update')]), false);
  assert.equal(await f.store.can([operation(7, 'read')]), false);
  assert.equal(await f.store.can([operation(8, 'update')]), true);
  assert.equal(f.loads.length, 2, 'The mismatched first response was not cached under its returned content ID.');
});

for (const value of [false, undefined, 'true', {}]) test(`native readiness must be affirmative: ${JSON.stringify(value)}`, async () => {
  const f = fixture({ ready: async () => value });
  f.store.remember(content());
  assert.equal(await f.store.can([operation(7, 'update')]), false);
  assert.equal(f.loads.length, 0);
  assert.equal(f.readiness.length, 1);
});
test('native readiness failure fails closed', async () => {
  const f = fixture({ ready: async () => { throw new Error('native backend unavailable'); } });
  f.store.remember(content());
  assert.equal(await f.store.can([operation(7, 'update')]), false);
});

test('identity change during exact load rejects the old result and permits a fresh retry', async () => {
  const gate = deferred();
  let first = true;
  const f = fixture({ load: async () => { if (first) { first = false; return gate.promise; } return content(); } });
  const pending = f.store.can([operation(7, 'update')]);
  await started(() => f.loads.length === 1);
  f.setIdentity('another-editor');
  gate.resolve(content());
  assert.equal(await pending, false);
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, 2, 'The preceding identity cannot populate the next identity cache.');
});

test('invalidation during exact load rejects the late result and permits a fresh retry', async () => {
  const gate = deferred();
  let first = true;
  const f = fixture({ load: async () => { if (first) { first = false; return gate.promise; } return content(); } });
  const pending = f.store.can([operation(7, 'update')]);
  await started(() => f.loads.length === 1);
  f.store.invalidate();
  gate.resolve(content());
  assert.equal(await pending, false);
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, 2);
});

for (const change of ['identity', 'invalidate', 'writable']) test(`${change} during native readiness rejects late permission hints`, async () => {
  const gate = deferred();
  let first = true;
  const f = fixture({ ready: async () => { if (first) { first = false; return gate.promise; } return true; } });
  f.store.remember(content());
  const pending = f.store.can([operation(7, 'update')]);
  await started(() => f.readiness.length === 1);
  if (change === 'identity') f.setIdentity('another-editor');
  else if (change === 'invalidate') f.store.invalidate();
  else f.setWritable(false);
  gate.resolve(true);
  assert.equal(await pending, false);
  if (change === 'writable') f.setWritable(true);
  assert.equal(await f.store.can([operation(7, 'update')]), true);
  assert.equal(f.loads.length, change === 'writable' ? 0 : 1, 'A fresh exact read follows the invalidated remembered content.');
  assert.equal(f.readiness.length, 2);
});
