// Actual HTTPS read-only Netlify app against the isolated repository.
// Run the managed app with --local --readonly; this script creates no content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createClient } from './m1-client.mjs';

const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const APP = 'https://localhost:8080', PROJECT = '/Root/Content/timelines';

export async function smoke() {
  assert.equal(local.REPOSITORY, 'https://localhost:41016');
  assert.equal(local.AUTHORITY, 'https://localhost:41017');
  const checks = [], report = { ranAt: new Date().toISOString(), app: APP, repository: local.REPOSITORY, checks, passed: false,
    validation: 'Real HTTPS read-only denial and unchanged target revision. Internal Function write dispatch and permission probes require the handler tests; this script does not inspect another process or a retired SQLite database.' };
  const record = name => { checks.push({ name, passed: true }); console.log(JSON.stringify({ check: name, passed: true })); };
  const client = createClient({ baseUrl: APP + '/api/v1', repository: local.REPOSITORY, authority: local.AUTHORITY, project: PROJECT,
    caFile: path.join(local.ROOT, 'certificates/localhost.pem') });
  let grant, account, failure, grantRevoked = false;
  try {
    const discovery = await client.verify();
    assert.equal(discovery.readOnly, true, 'Start the one managed Netlify app with --local --readonly before this smoke.');
    record('HTTPS discovery preserves the exact isolated target and advertises read-only');
    account = local.readAccounts().editor;
    grant = await client.request('/grants', { method: 'POST', token: account.apiKey, backendAuth: 'ApiKey',
      body: { scopes: ['content:read', 'media:write'], expiresInSeconds: 60 } });
    const page = await client.request('/media?top=1', { token: grant.token });
    assert.ok(page.items.length);
    const { data: before } = await client.request('/content/' + page.items[0].Id, { token: grant.token });
    assert.match(before.revision, /^sha256:[a-f0-9]{64}$/);
    record('Actual scoped HTTPS list and detail reads remain available');
    await assert.rejects(client.request('/plans', { method: 'POST', token: grant.token, body: { commands: [
      { action: 'update', targetId: before.Id, expectedRevision: before.revision, fields: { Description: 'must not save in read-only mode' } },
    ] } }), error => error.status === 403 && error.code === 'read_only');
    const { data: after } = await client.request('/content/' + before.Id, { token: grant.token });
    assert.equal(after.revision, before.revision);
    record('Read-only rejects a writer plan and preserves the existing content revision');
    await client.request('/grants/' + grant.id + '/revoke', { method: 'POST', token: account.apiKey, backendAuth: 'ApiKey', body: {} });
    grantRevoked = true;
    await assert.rejects(client.request('/content/' + before.Id, { token: grant.token }), error => error.status === 401);
    report.passed = true;
    record('The temporary app grant is revoked and cannot read existing content');
  } catch (error) { failure = error; report.error = error.code || 'readonly_verification_failed'; }
  finally {
    if (grant && account && !grantRevoked) {
      try { await client.request('/grants/' + grant.id + '/revoke', { method: 'POST', token: account.apiKey, backendAuth: 'ApiKey', body: {} }); }
      catch { report.cleanupError = 'grant_revocation_failed'; report.passed = false; }
    }
    fs.writeFileSync(path.join(local.ROOT, 'm1-readonly-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: checks.length }));
  }
  if (failure || !report.passed) throw failure || new Error('Read-only smoke cleanup failed.');
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await smoke(); } catch { process.exitCode = 1; }
}
