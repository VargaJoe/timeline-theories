// Actual HTTPS read-only gateway against the isolated repository; creates no content.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadConfig } from '../server/config.mjs';
import { createApp } from '../server/app.mjs';
import { StockRepository } from '../server/stock-repository.mjs';
import { createClient } from './m1-client.mjs';
const require = createRequire(import.meta.url), local = require('./m0-local-api.cjs');
const config = { ...loadConfig({ local: true }), readOnly: true, port: 0,
  dataDir: path.join(local.ROOT, 'm1-readonly-' + randomUUID()) };
const checks = [], report = { ranAt: new Date().toISOString(), repository: local.REPOSITORY, checks, passed: false };
const record = name => { checks.push({ name, passed: true }); console.log(JSON.stringify({ check: name, passed: true })); };
const originalRequest = StockRepository.prototype.request;
let repositoryWrites = 0, saveProbes = 0;
StockRepository.prototype.request = function(url, options = {}) {
  if (!['GET', 'HEAD'].includes(options.method || 'GET')) repositoryWrites++;
  if (new URL(url).pathname.endsWith('/HasPermission') && new URL(url).searchParams.get('permissions')?.includes('Save')) saveProbes++;
  return originalRequest.call(this, url, options);
};
let app, grant;
try {
  app = createApp(config);
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const client = createClient({ baseUrl: 'https://localhost:' + app.server.address().port + '/api/v1',
    repository: local.REPOSITORY, authority: local.AUTHORITY, project: config.projectRoot,
    caFile: path.join(local.ROOT, 'certificates/localhost.pem') });
  const discovery = await client.verify();
  assert.equal(discovery.readOnly, true); record('HTTPS discovery preserves exact target binding and advertises read-only');
  const account = local.readAccounts().editor;
  grant = await client.request('/grants', { method: 'POST', token: account.apiKey, backendAuth: 'ApiKey',
    body: { scopes: ['content:read', 'media:write'], expiresInSeconds: 60 } });
  const page = await client.request('/media?top=1', { token: grant.token });
  assert.ok(page.items.length); const { data: before } = await client.request('/content/' + page.items[0].Id, { token: grant.token });
  assert.match(before.revision, /^sha256:[a-f0-9]{64}$/); record('Actual scoped HTTPS list/detail reads remain available');
  const probesBefore = saveProbes;
  await assert.rejects(client.request('/plans', { method: 'POST', token: grant.token, body: { commands: [
    { action: 'update', targetId: before.Id, expectedRevision: before.revision, fields: { Description: 'must not save in read-only mode' } }
  ] } }), error => error.status === 403 && error.code === 'read_only');
  assert.equal(repositoryWrites, 0); assert.equal(saveProbes, probesBefore);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM mutations').get().n, 0);
  record('Read-only rejects an authorized writer before Save ACL probing, mutation intent or repository write');
  const { data: after } = await client.request('/content/' + before.Id, { token: grant.token });
  assert.equal(after.revision, before.revision);
  await client.request('/grants/' + grant.id + '/revoke', { method: 'POST', token: grant.token, body: {} });
  await assert.rejects(client.request('/content/' + before.Id, { token: grant.token }), error => error.status === 401);
  report.repositoryWrites = repositoryWrites; report.passed = true;
  record('Existing content revision is unchanged and the temporary grant is revoked');
} catch (error) {
  report.error = error.code || 'readonly_verification_failed'; process.exitCode = 1;
} finally {
  if (app) {
    if (grant) app.store.db.prepare('UPDATE grants SET revoked=1 WHERE id=?').run(grant.id);
    await new Promise(resolve => app.server.close(resolve)); app.coordinator.close(); app.store.close();
  }
  StockRepository.prototype.request = originalRequest;
  fs.writeFileSync(path.join(local.ROOT, 'm1-readonly-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, repositoryWrites }));
}
