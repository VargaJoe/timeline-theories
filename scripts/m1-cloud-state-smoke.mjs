import { pathToFileURL } from 'node:url';

// Public expected target values only. No configuration/MCP credential source,
// repository client, authorization header, grant or arbitrary API route exists.
const REPOSITORY = 'https://plastice.sensenet.cloud';
const AUTHORITY = 'https://plastice-is.sensenet.cloud';
const PROJECT = '/Root/Content/timelines';
const PREVIEW_HOST = /^deploy-preview-53--[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.netlify\.app$/;
class ProbeError extends Error {}
const ensure = (condition, message) => { if (!condition) throw new ProbeError(message); };

/** The parent verifies this exact URL is PR53's current automatic Deploy Preview.
 * The CLI then performs a distinct public app-storage diagnostic, with zero
 * SenseNet requests and zero application/repository credentials sent. */
export function validatePreviewUrl(value) {
  let url; try { url = new URL(value); } catch { throw new ProbeError('Supply the explicitly verified PR53 Deploy Preview HTTPS origin.'); }
  ensure(url.protocol === 'https:' && PREVIEW_HOST.test(url.hostname) && !url.port && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash, 'Only the explicitly verified deploy-preview-53--*.netlify.app HTTPS origin is allowed.');
  return url.origin;
}
export function verifyBinding(capabilities) {
  ensure(capabilities?.repository === REPOSITORY && capabilities?.authority === AUTHORITY && capabilities?.project === PROJECT, 'Discovery does not match the approved public repository, authority and project binding.');
  ensure(capabilities.version === '1' && capabilities.runtime === 'Netlify Functions in the Timeline app' && capabilities.concurrency?.atomicBatch === false, 'Discovery does not identify the expected single Netlify application contract.');
}

export async function runCloudStateSmoke({ url, fetchImpl = fetch } = {}) {
  const origin = validatePreviewUrl(url), started = Date.now(), deadline = started + 60000;
  let requestCount = 0;
  async function request(path, post = false) {
    ensure(['/api/v1/capabilities','/api/v1/__verification/storage'].includes(path), 'Diagnostic route is outside the fixed public allowlist.');
    const remaining = deadline - Date.now(); ensure(remaining > 0, 'Public app storage verification timed out without a completed proof.');
    requestCount++;
    const result = await fetchImpl(origin + path, { method: post ? 'POST' : 'GET', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(Math.min(15000, remaining)), headers: post ? { 'Content-Type': 'application/json' } : {}, ...(post ? { body: '{}' } : {}) });
    ensure(result.status === 200 || post && result.status === 202, `Public diagnostic returned HTTP ${result.status}; response bodies are not printed.`);
    let value; try { value = await result.json(); } catch { throw new ProbeError('Public diagnostic returned invalid JSON; response bodies are not printed.'); }
    return { status: result.status, value };
  }
  verifyBinding((await request('/api/v1/capabilities')).value);
  for (let attempt = 0; attempt < 12; attempt++) {
    const result = await request('/api/v1/__verification/storage', true);
    ensure(result.value.senseNetRequests === 0 && result.value.repositoryWrites === 0, 'App storage verification did not confirm zero SenseNet requests and writes.');
    if (result.status === 202) { ensure(result.value.pending === true, 'The diagnostic did not report a bounded pending result.'); await new Promise(resolve => setTimeout(resolve, 500)); continue; }
    const proof = result.value.storageSelftest, checks = proof?.checks;
    ensure(proof?.state === 'completed' && proof.passed === true && checks?.firstWriteWinners === 1 && ['strongInitialRead','nonmatchingCasRejected','currentCasSucceeded','staleCasRejected','strongFinalRead','ownedCleanupVerified'].every(name => checks[name] === true), 'The completed private app storage proof did not satisfy every conditional-write, strong-read and owned-cleanup gate.');
    const approvedChecks = { firstWriteWinners: 1 };
    for(const name of ['strongInitialRead','nonmatchingCasRejected','currentCasSucceeded','staleCasRejected','strongFinalRead','ownedCleanupVerified'])approvedChecks[name]=true;
    return { passed: true, deployPreviewHost: new URL(origin).hostname, appStorageProof: { state: 'completed', passed: true, checks: approvedChecks }, httpRequests: requestCount, senseNetRequests: 0, repositoryWrites: 0, credentialsSent: false };
  }
  throw new ProbeError('Public app storage verification stayed pending; no completed proof was recorded.');
}
export async function main(args = process.argv.slice(2)) {
  ensure(args.length === 2 && args[0] === '--url', 'Usage: node scripts/m1-cloud-state-smoke.mjs --url <verified PR53 Deploy Preview HTTPS origin>');
  const result = await runCloudStateSmoke({ url: args[1] }); console.log(JSON.stringify(result, null, 2)); return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => {
  console.error(error instanceof ProbeError ? error.message : 'Public app storage verification failed during the bounded preview transport; response bodies were not printed.'); process.exitCode = 1;
});
