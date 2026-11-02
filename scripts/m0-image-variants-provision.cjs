'use strict';

// Explicit, local-only migration for the image-variant technical proof.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const local = require('./m0-local-api.cjs');
const { permissions } = require('./m0-acl.cjs');

const ASSETS = '/Root/Content/timelines/ImageAssets';
const SCHEMAS = [
  ['ImageVariant', 'GenericContent/File/Image'],
  ['ImageVariantSet', 'GenericContent/Folder'],
  ['MediaItem', 'GenericContent'],
  ['Timeline', 'GenericContent/Folder'],
];

async function provision() {
  // local.api and local.upload reject hosts/ports other than the owned M0 target.
  local.assertLocal(local.REPOSITORY);
  const account = local.readAccounts().admin;
  const editor = local.readAccounts().editor;
  const schemas = [];
  for (const [name, parent] of SCHEMAS) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../deployment/contenttypes', name + '.xml'));
    await local.upload('/Root/System/Schema/ContentTypes/' + parent, {
      name, bytes, contentType: 'ContentType', mime: 'text/xml', account,
    });
    schemas.push({ name, sha256: crypto.createHash('sha256').update(bytes).digest('hex') });
  }
  // Workspace AllowedChildTypes constrains descendants too. Preserve the
  // existing allowlist and add only the two new local feature types.
  const projectPath = '/Root/Content/timelines';
  const allowed = await local.api(projectPath, { account, operation: 'AllowedChildTypes', query: { $select: 'Name', metadata: 'no' } });
  assert.ok(Array.isArray(allowed.results));
  const previousTypes = allowed.results.map(item => item.Name);
  const nextTypes = [...new Set([...previousTypes, 'ImageVariantSet', 'ImageVariant'])];
  if (nextTypes.length !== previousTypes.length) await local.api(projectPath, { account, method: 'PATCH', body: { AllowedChildTypes: nextTypes } });
  let root;
  try {
    root = await local.api(ASSETS, { account, query: { $select: 'Id,Name,Path,Type', metadata: 'no' } });
  } catch (error) {
    if (error.status !== 404) throw error;
    root = await local.api('/Root/Content/timelines', {
      method: 'POST', account, query: { metadata: 'no' },
      body: { __ContentType: 'Folder', Name: 'ImageAssets', DisplayName: 'Generated image variants', AllowedChildTypes: ['Folder'] },
    });
  }
  assert.equal(root.Path, ASSETS);
  assert.equal(root.Type, 'Folder', 'Reserved image root must be a Folder; existing content is never replaced.');
  // Folder Save/Delete denies are local-only: children still need Save/Delete
  // for the guarded set operations. Editors cannot move a containing subtree.
  await permissions(root.Id, [{ identity: editor.path, localOnly: true, Save: 'deny', Delete: 'deny', AddNew: 'deny' },
    { identity: editor.path, SetPermissions: 'deny' },
    ...['/Root/IMS/BuiltIn/Portal/Visitor', local.readAccounts().reader.path].map(identity => ({ identity, localOnly: true, See: 'deny', Open: 'deny' }))]);
  // The guarded files have extensionless node names (w400). The pinned native
  // BinaryHandler skips its pre-content 304 shortcut for extensionless paths;
  // the handler also enforces no-store. No global Portal.settings is changed.
  const report = {
    version: 1, installedAt: new Date().toISOString(), repository: local.REPOSITORY,
    schemas, projectAllowedChildTypes: nextTypes, root: { id: root.Id, path: root.Path }, nativeCachePolicy: 'Enforced extensionless node names + handler no-store; no Portal.settings migration.',
    policy: 'Explicit local M0 schema migration. Existing sources, ACL, identities, secrets and original binary fields are preserved. No production migration.',
  };
  fs.writeFileSync(path.join(local.ROOT, 'image-variants-provision.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ installed: schemas.map(item => item.name), root: root.Path }));
  return report;
}

module.exports = { provision, ASSETS, SCHEMAS };
if (require.main === module) provision().catch(error => { console.error(error.message); process.exitCode = 1; });
