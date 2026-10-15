'use strict';
// Explicit isolated-local identity provisioning. Never uses a production endpoint or an owner fallback at runtime.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = require('./m0-local-api.cjs');
const { READ_PERMISSIONS } = require('./m0-acl.cjs');
const PROJECT = '/Root/Content/timelines';
const PORTAL = '/Root/IMS/BuiltIn/Portal';
const FILE = path.join(local.ROOT, 'm1-inventory.json');
const OWNER = 'timeline-theories-m1-local-inventory';
const secrets = [];
const selected = { '$select': 'Id,Name,Path,Type,LoginName,Description', metadata: 'no' };
function assertBinding(record) {
  assert.equal(local.REPOSITORY, 'https://localhost:41016'); assert.equal(local.AUTHORITY, 'https://localhost:41017');
  assert.equal(record.owner, OWNER); assert.equal(record.repositoryUrl, local.REPOSITORY);
  assert.equal(record.authority, local.AUTHORITY); assert.equal(record.projectRoot, PROJECT);
  assert.match(record.setupId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(record.path, PORTAL + '/m1-inventory-' + record.setupId);
}
function save(record) {
  assertBinding(record);
  const temporary = FILE + '.tmp-' + record.setupId;
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(temporary, FILE);
}
async function readOwned(record, admin) {
  let user;
  try { user = await local.api(record.identityId || record.path, { account: admin, query: selected }); }
  catch (error) {
    if (error.status === 404 && !record.identityId && record.state === 'pending_user') return undefined;
    throw error; // Denial, transport failure and a vanished known identity never authorize another create.
  }
  assert.equal(user.Path, record.path); assert.equal(user.Type, 'User');
  assert.equal(user.Name, 'm1-inventory-' + record.setupId); assert.equal(user.LoginName, user.Name);
  assert.equal(user.Description, OWNER + ':' + record.setupId);
  if (record.identityId) assert.equal(user.Id, record.identityId);
  assert.ok(Number.isSafeInteger(user.Id) && user.Id > 0);
  return user;
}
async function projectTargets(admin) {
  const result = [PROJECT];
  for (let skip = 0; ; skip += 200) {
    const response = await local.request(local.REPOSITORY + '/OData.svc' + PROJECT + '?' + new URLSearchParams({
      query: '+InTree:' + PROJECT + ' .AUTOFILTERS:OFF .LIFESPAN:OFF', '$select': 'Id,Path', '$top': '200', '$skip': String(skip), '$orderby': 'Id', metadata: 'no',
    }), { account: admin });
    if (response.status !== 200) { const error = new Error('Local inventory project enumeration HTTP ' + response.status); error.status = response.status; throw error; }
    const page = response.value?.d;
    if (!Array.isArray(page.results)) throw new Error('Inventory setup project enumeration did not return IDs and paths');
    for (const row of page.results) {
      if (!Number.isSafeInteger(row.Id) || typeof row.Path !== 'string' || (row.Path !== PROJECT && !row.Path.startsWith(PROJECT + '/'))) throw new Error('Inventory setup enumeration crossed the local project boundary');
      if (row.Path !== PROJECT) result.push(row.Id);
    }
    if (page.results.length < 200) return result;
    if (result.length > 20000) throw new Error('Inventory setup exceeds the isolated project target limit');
  }
}
async function grantOwnedRead(record, admin, targets) {
  let inheritanceBoundaries = 0;
  for (const target of targets) {
    const acl = await local.api(target, { operation: 'GetAcl', account: admin });
    if (target !== PROJECT && acl.inherits !== false) continue;
    // Root and existing broken-inheritance boundaries need only this service's inherited row.
    // Existing visitor/editor/reader rows and inheritance settings are preserved.
    await local.api(target, { operation: 'SetPermissions', method: 'POST', account: admin,
      body: { r: [{ identity: record.path, localOnly: false, ...READ_PERMISSIONS }] } });
    inheritanceBoundaries++;
  }
  return inheritanceBoundaries;
}
async function verify(record, admin, targets) {
  assertBinding(record);
  const user = await readOwned(record, admin);
  if (!user || !record.credential || record.credential.mode !== 'ApiKey' || typeof record.credential.value !== 'string' || !record.credential.value) throw new Error('Owned inventory credential proof is incomplete');
  const account = { apiKey: record.credential.value };
  const principal = await local.api('/Root', { operation: 'GetCurrentUser', account, query: { '$select': 'Id,Name', metadata: 'no' } });
  assert.equal(principal.Id, record.identityId, 'Inventory API key authenticated another identity');
  let verifiedTargets = 0;
  for (const target of targets) {
    const content = await local.api(target, { account, query: { '$select': 'Id,Path', metadata: 'no' } });
    assert.ok(Number.isSafeInteger(content.Id)); assert.ok(content.Path === PROJECT || content.Path.startsWith(PROJECT + '/'));
    for (const permission of ['See', 'Open', 'OpenMinor', 'SeePermissions']) {
      assert.equal(await local.api(target, { operation: 'HasPermission', account, query: { permissions: permission } }), true, 'Inventory read permission is missing');
    }
    for (const permission of ['Save', 'AddNew', 'Delete', 'SetPermissions']) {
      assert.equal(await local.api(target, { operation: 'HasPermission', account, query: { permissions: permission } }), false, 'Inventory identity unexpectedly has a write permission');
    }
    verifiedTargets++;
  }
  return { verifiedTargets, identityId: user.Id, path: user.Path };
}
async function setup() {
  assert.equal(local.REPOSITORY, 'https://localhost:41016'); assert.equal(local.AUTHORITY, 'https://localhost:41017');
  const accountsBytes = fs.readFileSync(path.join(local.ROOT, 'accounts.json'));
  const accounts = JSON.parse(accountsBytes.toString('utf8'));
  for (const account of Object.values(accounts)) for (const field of ['password', 'apiKey', 'token']) if (typeof account[field] === 'string') secrets.push(account[field]);
  const admin = accounts.admin;
  const root = await local.api(PROJECT, { account: admin, query: { '$select': 'Id,Path', metadata: 'no' } });
  assert.equal(root.Path, PROJECT);
  const targets = await projectTargets(admin);
  let record;
  if (fs.existsSync(FILE)) {
    record = JSON.parse(fs.readFileSync(FILE, 'utf8')); assertBinding(record);
    if (record.credential?.value) secrets.push(record.credential.value);
    if (record.state === 'ready') {
      const verified = await verify(record, admin, targets);
      assert.deepEqual(fs.readFileSync(path.join(local.ROOT, 'accounts.json')), accountsBytes);
      return { reused: true, credentialFile: 'deployment/.local/m1-inventory.json', ...verified };
    }
    if (!['pending_user', 'pending_key', 'pending_acl'].includes(record.state)) throw new Error('Unknown owned inventory setup state');
  } else {
    const setupId = crypto.randomUUID();
    record = { version: 1, owner: OWNER, setupId, repositoryUrl: local.REPOSITORY, authority: local.AUTHORITY,
      projectRoot: PROJECT, path: PORTAL + '/m1-inventory-' + setupId, state: 'pending_user', createdAt: new Date().toISOString() };
    fs.writeFileSync(FILE, JSON.stringify(record, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  let user = await readOwned(record, admin);
  if (!user) {
    const password = 'M1a!' + crypto.randomBytes(32).toString('hex'); secrets.push(password);
    user = await local.api(PORTAL, { method: 'POST', account: admin, body: { __ContentType: 'User', Name: 'm1-inventory-' + record.setupId,
      DisplayName: 'M1 local read-only inventory', LoginName: 'm1-inventory-' + record.setupId,
      Description: OWNER + ':' + record.setupId, Email: 'm1-inventory-' + record.setupId + '@localhost.invalid', Password: password, Enabled: true } });
  }
  record.identityId = user.Id;
  if (!record.credential) {
    record.state = 'pending_key'; save(record);
    const key = await local.api(record.path, { operation: 'CreateApiKey', method: 'POST', account: admin, body: {} });
    if (typeof key.Value !== 'string' || !key.Value) throw new Error('Inventory key creation did not return a credential');
    secrets.push(key.Value); record.credential = { mode: 'ApiKey', value: key.Value };
  }
  record.state = 'pending_acl'; save(record);
  const inheritanceBoundaries = await grantOwnedRead(record, admin, targets);
  const verified = await verify(record, admin, targets);
  record.state = 'ready'; record.verifiedAt = new Date().toISOString(); record.verifiedTargets = verified.verifiedTargets; record.inheritanceBoundaries = inheritanceBoundaries;
  save(record);
  assert.deepEqual(fs.readFileSync(path.join(local.ROOT, 'accounts.json')), accountsBytes, 'Inventory setup changed existing local accounts');
  return { reused: false, credentialFile: 'deployment/.local/m1-inventory.json', inheritanceBoundaries, ...verified };
}
module.exports = { setup, FILE, assertBinding };
if (require.main === module) setup().then(report => console.log(JSON.stringify({ passed: true, ...report }))).catch(error => {
  const message = secrets.reduce((text, value) => value ? text.replaceAll(value, '[redacted]') : text, String(error.message));
  console.error('Local inventory setup failed: ' + message); process.exitCode = 1;
});
