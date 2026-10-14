import { createHash, randomUUID } from 'node:crypto';

const response = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
class SelftestError extends Error {}
const ensure = (condition, phase) => { if (!condition) throw new SelftestError(phase); };

/** Preview-only, once per trusted deployment. This module has no repository,
 * authentication, MCP, or HTTP transport dependency. All keys/values/ETags are
 * generated or read internally; public callers supply no probe parameters.
 * Netlify's own private storage SDK is the sole external operation here. */
export async function verifyAppStorage(config, store) {
  if (config.deployContext !== 'deploy-preview' && config.local !== true) return response(404, { error: { code: 'route_unavailable', message: 'Application route not found.' } });
  if (typeof config.deployId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(config.deployId)) return response(503, { error: { code: 'storage_selftest_configuration', message: 'A trusted deployment ID is required for app storage verification.' } });
  const deployHash = createHash('sha256').update('timeline-storage-selftest/v1\0' + config.deployId).digest('hex');
  const prefix = store.prefix + 'storage-selftest/' + deployHash + '/';
  const read = key => store.blobs.getWithMetadata(key, { type: 'json', consistency: 'strong' });
  const savedResponse = saved => response(saved.status, saved.body);
  let claim;
  try {
    const previous = await read(prefix + 'result');
    if (previous) return savedResponse(previous.data);
    claim = await store.blobs.setJSON(prefix + 'claim', { id: randomUUID(), startedAt: new Date().toISOString() }, { onlyIfNew: true });
    if (!claim.modified) {
      const completed = await read(prefix + 'result');
      return completed ? savedResponse(completed.data) : response(202, { storageSelftest: { state: 'running' }, pending: true, senseNetRequests: 0, repositoryWrites: 0 });
    }
  } catch { return response(503, { error: { code: 'storage_selftest_unavailable', message: 'Private app storage verification is unavailable.' }, senseNetRequests: 0, repositoryWrites: 0 }); }

  const key = prefix + 'probes/' + randomUUID(), checks = {};
  let failedPhase, cleanupConfirmed = false;
  const etag = value => { ensure(typeof value === 'string' && value.trim() && value.length <= 512, 'etag_unavailable'); return value; };
  try {
    const outcomes = await Promise.allSettled([
      store.blobs.setJSON(key, { value: 'A' }, { onlyIfNew: true }),
      store.blobs.setJSON(key, { value: 'B' }, { onlyIfNew: true }),
    ]);
    ensure(outcomes.every(outcome => outcome.status === 'fulfilled' && typeof outcome.value.modified === 'boolean'), 'first_write_unconfirmed');
    const winners = outcomes.map((outcome, index) => ({ result: outcome.value, index })).filter(outcome => outcome.result.modified);
    checks.firstWriteWinners = winners.length; ensure(winners.length === 1, 'first_write_not_exclusive');
    const initial = await read(key), initialETag = etag(initial?.etag), winner = winners[0];
    ensure(initial?.data.value === (winner.index === 0 ? 'A' : 'B') && initialETag === etag(winner.result.etag), 'initial_strong_read'); checks.strongInitialRead = true;
    const wrong = await store.blobs.setJSON(key, { value: 'C' }, { onlyIfMatch: '"missing-' + randomUUID() + '"' });
    ensure(wrong.modified === false, 'nonmatching_cas'); checks.nonmatchingCasRejected = true;
    const current = await store.blobs.setJSON(key, { value: 'C' }, { onlyIfMatch: initialETag });
    ensure(current.modified === true && etag(current.etag) !== initialETag, 'current_cas'); checks.currentCasSucceeded = true;
    const stale = await store.blobs.setJSON(key, { value: 'A' }, { onlyIfMatch: initialETag });
    ensure(stale.modified === false, 'stale_cas'); checks.staleCasRejected = true;
    const final = await read(key);
    ensure(final?.data.value === 'C' && etag(final.etag) === current.etag, 'final_strong_read'); checks.strongFinalRead = true;
  } catch (error) { failedPhase = error instanceof SelftestError ? error.message : 'storage_transport'; }
  finally {
    // Both initial writes have settled before cleanup. Delete only the fresh
    // internal UUID, never a caller-selected key, prefix, plan, grant or receipt.
    for (let attempt = 0; attempt < 3 && !cleanupConfirmed; attempt++) {
      try { await store.blobs.delete(key); cleanupConfirmed = !await read(key); } catch { /* No transport error text or credentials are exposed. */ }
    }
    checks.ownedCleanupVerified = cleanupConfirmed;
    if (!cleanupConfirmed) failedPhase = 'owned_cleanup_unconfirmed';
  }
  const result = { status: failedPhase ? 503 : 200, body: { storageSelftest: { state: failedPhase ? 'failed' : 'completed', passed: !failedPhase, checks, ...(failedPhase ? { failedPhase } : {}) }, senseNetRequests: 0, repositoryWrites: 0 } };
  try {
    const archived = await store.blobs.setJSON(prefix + 'result', result, { onlyIfNew: true });
    if (!archived.modified) {
      const previous = await read(prefix + 'result');
      if (previous) return savedResponse(previous.data);
      return response(503, { error: { code: 'storage_selftest_unavailable', message: 'Private app storage verification receipt is unavailable.' }, senseNetRequests: 0, repositoryWrites: 0 });
    }
  } catch { return response(503, { error: { code: 'storage_selftest_unavailable', message: 'Private app storage verification receipt is unavailable.' }, senseNetRequests: 0, repositoryWrites: 0 }); }
  return savedResponse(result);
}
