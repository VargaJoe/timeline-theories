import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import source from './m0-snapshot.cjs';

const { PRODUCTION_URL, ROOT_PATH, loadConfiguredMcp } = source;
const AUTHORITY = 'https://plastice-is.sensenet.cloud';
const PREVIEW_HOST = /^deploy-preview-53--[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.netlify\.app$/;
class ProbeError extends Error {}
function ensure(value, message) { if (!value) throw new ProbeError(message); }

/** The parent must verify this exact URL is PR53's current GitHub-generated
 * Deploy Preview before invoking the CLI. No production/custom hosts, redirects,
 * user credentials in URLs, arbitrary routes or alternate PRs are accepted. */
export function validatePreviewUrl(value) {
  let url; try { url = new URL(value); } catch { throw new ProbeError('Supply the explicitly verified PR53 Deploy Preview HTTPS origin.'); }
  ensure(url.protocol === 'https:' && PREVIEW_HOST.test(url.hostname) && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Only the explicitly verified deploy-preview-53--*.netlify.app HTTPS origin is allowed.');
  return url.origin;
}
export function verifyBinding(capabilities) {
  ensure(capabilities?.repository === new URL(PRODUCTION_URL).origin && capabilities?.authority === AUTHORITY && capabilities?.project === ROOT_PATH, 'Discovery does not match the approved Plastice repository, authority and project. No credential was sent.');
  ensure(capabilities.version === '1' && capabilities.runtime === 'Netlify Functions in the Timeline app' && capabilities.concurrency?.atomicBatch === false, 'Discovery does not identify the expected single Netlify application contract. No credential was sent.');
}

/** Actual cloud conditional-write acceptance. No production SenseNet mutations:
 * only public discovery and the bounded preview-only app metadata probe route.
 * Credential loading happens only AFTER unauthenticated target verification. */
export async function runCloudStateSmoke({ url, fetchImpl = fetch, loadCredential = loadConfiguredMcp } = {}) {
  const origin = validatePreviewUrl(url), host = new URL(origin).hostname;
  let requestCount = 0, credential, binding, probeId, cleanupNeeded = false;
  const checks = {};
  async function request(path, input) {
    // There are exactly two allowed paths; no general-purpose API caller.
    ensure(path === '/api/v1/capabilities' || probeId && path === `/api/v1/__verification/state/${probeId}`, 'Probe route is outside the bounded allowlist.');
    requestCount++;
    const response = await fetchImpl(origin + path, { method: input ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(30000), headers: input ? { Authorization: 'Bearer ' + credential, 'X-Timeline-Backend-Auth': 'ApiKey', 'X-Timeline-Repository': binding.repository, 'X-Timeline-Authority': binding.authority, 'X-Timeline-Project': binding.project, 'Content-Type': 'application/json' } : {}, ...(input ? { body: JSON.stringify(input) } : {}) });
    ensure(response.status === 200, `Bounded preview request returned HTTP ${response.status}. Response bodies and credentials are not printed.`);
    let result; try { result = await response.json(); } catch { throw new ProbeError('Bounded preview request returned invalid JSON. Response bodies are not printed.'); }
    if (input) ensure(result.repositoryWrites === 0, 'The app metadata probe did not confirm zero repository writes.');
    return result;
  }
  function etag(value) { ensure(typeof value === 'string' && value.trim() && value.length <= 512, 'A bounded real cloud ETag is required for conditional acceptance.'); return value; }
  try {
    binding = await request('/api/v1/capabilities'); verifyBinding(binding); checks.bindingVerified = true;
    const configured = await loadCredential();
    let configuredRepository;try{configuredRepository=new URL(configured?.repositoryUrl).href;}catch{throw new ProbeError('Configured MCP source does not identify the approved production repository.');}
    ensure(configuredRepository === PRODUCTION_URL && typeof configured.apiKey === 'string' && configured.apiKey, 'Configured MCP source does not supply the approved production backend identity.');
    credential = configured.apiKey; probeId = randomUUID(); cleanupNeeded = true;
    const path = `/api/v1/__verification/state/${probeId}`;
    const firstOutcomes = await Promise.allSettled([request(path, { phase: 'new', value: 'A' }), request(path, { phase: 'new', value: 'B' })]);
    ensure(firstOutcomes.every(outcome => outcome.status === 'fulfilled'), `A concurrent cloud probe request was interrupted for owned UUID ${probeId}; no cloud CAS proof was recorded.`);
    const first = firstOutcomes.map(outcome => outcome.value);
    ensure(first.every(result => typeof result.modified === 'boolean'), 'Cloud first-write results did not expose conditional outcomes.');
    const winners = first.map((result, index) => ({ result, index })).filter(row => row.result.modified);
    ensure(winners.length === 1, 'Concurrent cloud onlyIfNew did not produce exactly one winner.'); checks.firstWriteWinners = 1;
    const winner = winners[0], initial = await request(path, { phase: 'read' });
    const initialETag = etag(initial.etag);
    ensure(initial.exists === true && initial.value === (winner.index === 0 ? 'A' : 'B') && initialETag === etag(winner.result.etag), 'Strong cloud read did not match the successful concurrent conditional write.'); checks.strongInitialRead = true;
    const unmatched = await request(path, { phase: 'replace', value: 'C', etag: '"absent-' + probeId + '"' });
    ensure(unmatched.modified === false, 'A nonmatching cloud ETag unexpectedly overwrote the probe.'); checks.nonmatchingCasRejected = true;
    const replaced = await request(path, { phase: 'replace', value: 'C', etag: initialETag });
    ensure(replaced.modified === true && etag(replaced.etag) !== initialETag, 'The current cloud ETag did not conditionally update to a new ETag.'); checks.currentCasSucceeded = true;
    const stale = await request(path, { phase: 'replace', value: 'A', etag: initialETag });
    ensure(stale.modified === false, 'The actual stale cloud ETag unexpectedly overwrote the probe.'); checks.staleCasRejected = true;
    const final = await request(path, { phase: 'read' });
    ensure(final.exists === true && final.value === 'C' && etag(final.etag) === replaced.etag, 'Strong final cloud read did not preserve the successful CAS postcondition.'); checks.strongFinalRead = true;
  } finally {
    if (cleanupNeeded) {
      const path = `/api/v1/__verification/state/${probeId}`;
      // Wait for both simultaneous requests to settle before deleting their
      // exact owned UUID. A failed test must not race a still-running contender.
      let cleaned = false;
      for (let attempt = 0; attempt < 3 && !cleaned; attempt++) {
        try {
          const removed = await request(path, { phase: 'delete' });
          const absent = await request(path, { phase: 'read' });
          cleaned = removed.deleted === true && absent.exists === false;
        } catch { /* Only bounded owned cleanup is retried; no error body is logged. */ }
      }
      checks.ownedCleanupVerified = cleaned;
      ensure(cleaned, `Owned cloud metadata cleanup is unconfirmed for UUID ${probeId}. No repository write was attempted.`);
    }
  }
  return { passed: true, deployPreviewHost: host, checks, httpRequests: requestCount, repositoryWrites: 0, secretsPrinted: false };
}

export async function main(args = process.argv.slice(2)) {
  ensure(args.length === 2 && args[0] === '--url', 'Usage: node scripts/m1-cloud-state-smoke.mjs --url <verified PR53 Deploy Preview HTTPS origin>');
  const result = await runCloudStateSmoke({ url: args[1] });
  console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  // Never echo arbitrary fetch/MCP errors, private headers or response bodies.
  console.error(error instanceof ProbeError ? error.message : 'Cloud state verification failed during the bounded preview transport; credentials and response bodies were not printed.');
  process.exitCode = 1;
});
