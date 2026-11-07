import fs from 'node:fs/promises';
import https from 'node:https';
import { pathToFileURL } from 'node:url';

/** Read-only, one-shot diagnosis of this project's existing M0 dependencies. */
export async function checkLocalRuntime(environment = process.env, probe = probeJson) {
  const repository = 'https://localhost:41016', authority = 'https://localhost:41017', project = '/Root/Content/timelines';
  if ((environment.TIMELINE_DOCKER_PROFILE ?? 'm0-local') !== 'm0-local' ||
      (environment.VITE_SENSENET_REPO_URL ?? repository) !== repository ||
      (environment.VITE_OIDC_AUTHORITY ?? authority) !== authority ||
      (environment.VITE_PROJECT_ROOT_PATH ?? project) !== project) {
    throw new Error('local:check is restricted to this project\'s own M0 runtime. No requests were sent.');
  }
  const targets = [
    { name: 'App/API', url: 'https://localhost:8080/api/v1/capabilities', valid: value => value?.version === '1' && value.basePath === '/api/v1' && Array.isArray(value.operations) && value.repository === repository && value.authority === authority && value.project === project },
    { name: 'SenseNet content', url: repository + "/OData.svc/Root/Content('timelines')?$select=Id&metadata=no", valid: value => Number.isSafeInteger(value?.d?.Id) && value.d.Id > 0 },
    { name: 'Identity discovery', url: authority + '/.well-known/openid-configuration', valid: value => value?.issuer?.replace(/\/$/, '') === authority },
  ];
  return Promise.all(targets.map(async target => {
    try {
      const { status, value } = await probe(target.url);
      return { name: target.name, ok: status === 200 && target.valid(value), status };
    } catch { return { name: target.name, ok: false, error: 'Unreachable, TLS error or 6s deadline exceeded' }; }
  }));
}

async function probeJson(url) {
  const ca = await fs.readFile(new URL('../deployment/.local/certificates/localhost.pem', import.meta.url));
  return new Promise((resolve, reject) => {
    const request = https.get(url, { ca }, response => {
      const chunks = []; let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 65536) request.destroy(new Error('Response limit exceeded'));
        else chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        try { resolve({ status: response.statusCode, value: JSON.parse(Buffer.concat(chunks).toString()) }); }
        catch { reject(new Error('Invalid JSON')); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error('Absolute readiness deadline exceeded')), 6000);
    request.on('close', () => clearTimeout(timer));
    request.on('error', reject);
  });
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  try {
    const results = await checkLocalRuntime();
    for (const row of results) console.log(`${row.ok ? 'OK' : 'FAIL'} ${row.name}${row.status ? ' (HTTP ' + row.status + ')' : ': ' + row.error}`);
    console.log('Identity discovery does not verify login/client registration. Check login in the app separately.');
    if (results.some(row => !row.ok)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
