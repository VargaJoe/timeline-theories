import test from 'node:test';
import assert from 'node:assert/strict';
import fixtureSmoke from '../scripts/m0-multi-poster-smoke.cjs';

const { runFixtureSetupWrite, mutationJobSucceeded, unexpectedMutationSuccess } = fixtureSmoke;

test('the actual draft 201, seal 200 and apply 200 job sequence is accepted and permits cleanup; wrong 2xx/207 never passes', () => {
  const jobs = [
    { acknowledgedPath: '/api/v1/images/drafts', terminalStatus: 201 },
    { acknowledgedPath: '/api/v1/images/drafts/13146/seal', terminalStatus: 200 },
    { acknowledgedPath: '/api/v1/plans/0846fd13-4cd1-4363-8bd2-a747b80bcc40/apply', terminalStatus: 200 },
  ];
  assert(jobs.every(mutationJobSucceeded)); assert.equal(unexpectedMutationSuccess(jobs), false);
  for (const job of [
    { ...jobs[0], terminalStatus: 200 }, { ...jobs[0], terminalStatus: 207 },
    { ...jobs[1], terminalStatus: 201 }, { ...jobs[1], terminalStatus: 207 },
    { ...jobs[2], terminalStatus: 201 }, { ...jobs[2], terminalStatus: 207 },
    { acknowledgedPath: '/api/v1/unknown', terminalStatus: 200 },
  ]) {
    assert.equal(mutationJobSucceeded(job), false); assert.equal(unexpectedMutationSuccess([job]), true, 'An unexpected success status preserves fixtures for outcome review.');
  }
  assert.equal(mutationJobSucceeded({ acknowledgedPath: jobs[0].acknowledgedPath }), false);
});
test('a committed setup write followed by HTTP 5xx preserves its saved exact intent for every fixture mutation kind', async () => {
  for (const kind of ['create', 'original-upload', 'acl', 'owner-revision-patch']) {
    const intent = { request_id: 'fixture-request-' + kind, kind, target: '/Root/Content/timelines/q-owned', body: { own: kind } }, snapshots = [];
    let committed = false;
    await assert.rejects(runFixtureSetupWrite(intent, async recorded => {
      assert.deepEqual(snapshots.at(-1), { ...recorded }, 'Exact intent is durably captured before dispatch.');
      committed = true; throw Object.assign(Error('Response failed after commit'), { status: 503 });
    }, { persist: () => snapshots.push(structuredClone(intent)) }), /after commit/);
    assert.equal(committed, true); assert.equal(intent.state, 'uncertain'); assert.equal(intent.responseStatus, 503);
    assert.deepEqual(snapshots.at(-1).body, { own: kind }); assert.equal(snapshots.at(-1).state, 'uncertain');
    assert.equal(snapshots.some(row => row.state === 'confirmed' || row.state === 'rejected'), false, 'No successful or confirmed-rejection state may authorize fixture cleanup.');
  }
});

test('an invalid create acknowledgement or failed post-write readback remains uncertain even when the validation error has a 4xx status', async () => {
  for (const validationError of [Error('Wrong returned fixture path'), Object.assign(Error('Readback denied'), { status: 403 })]) {
    const intent = { kind: 'create', path: '/Root/Content/timelines/q-owned', body: { Name: 'q-owned' } }, snapshots = [];
    await assert.rejects(runFixtureSetupWrite(intent, async () => ({ Id: 7, Path: '/Root/Content/foreign' }), {
      validate: result => { intent.returnedContract = result; throw validationError; }, persist: () => snapshots.push(structuredClone(intent)),
    }), error => error === validationError);
    assert.equal(intent.state, 'uncertain'); assert.deepEqual(snapshots.at(-1).body, { Name: 'q-owned' });
    assert.equal(snapshots.at(-1).returnedContract.Path, '/Root/Content/foreign');
  }
});

test('only an actual checked acknowledgement or a definite dispatch 4xx can close a setup intent', async () => {
  const confirmed = { body: { Name: 'q-owned' } };
  await runFixtureSetupWrite(confirmed, async () => ({ Id: 7 }), { validate: row => assert.equal(row.Id, 7) });
  assert.equal(confirmed.state, 'confirmed');
  for (const [error, expected] of [
    [Object.assign(Error('Save denied before commit'), { status: 403 }), 'rejected'],
    [Error('Connection lost'), 'uncertain'],
    [Object.assign(Error('Pending outcome'), { status: 409, details: { uncertain: true } }), 'uncertain'],
  ]) {
    const intent = {};
    await assert.rejects(runFixtureSetupWrite(intent, async () => { throw error; }), failure => failure === error);
    assert.equal(intent.state, expected);
  }
});
