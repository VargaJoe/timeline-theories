import { DomainError, assertId, assertObject } from '../domain/content.mjs';
import { assertUuid, hash } from './store.mjs';
import { imageOperationId, validateImageManifest } from './image-assets.mjs';
import { requireScope } from './plans.mjs';

async function ownsOriginalPrincipal(store, principal, identity) {
  if (typeof principal !== 'string' || !principal || principal.length > 256) return false;
  if (principal.startsWith(`session:${identity}:`)) return true;
  if (!principal.startsWith('grant:')) return false;
  const grantId = principal.slice(6);
  try { assertUuid(grantId, 'Original grant ID'); } catch { return false; }
  return (await store.read(`grant-ids/${grantId}`))?.data.identity === identity;
}

function checkedDraft(row, projectRoot) {
  if (row.state !== 'pending' || row.result !== null || typeof row.payload !== 'string' || Buffer.byteLength(row.payload) > 32768) return null;
  try {
    const payload = JSON.parse(row.payload); assertObject(payload);
    if (Object.keys(payload).some(key => !['operationId', 'action', 'targetId', 'generationId', 'expectedRevision', 'manifest', 'requestHash'].includes(key)) || payload.action !== 'image-draft') return null;
    assertUuid(row.operation_id, 'Original image operation ID'); assertUuid(payload.generationId, 'Original generation ID'); assertId(payload.targetId);
    const { requestHash, ...original } = payload;
    if (payload.operationId !== row.operation_id || typeof requestHash !== 'string' || !/^[a-f0-9]{64}$/.test(requestHash) || row.request_hash !== requestHash || hash(original) !== requestHash || typeof payload.expectedRevision !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(payload.expectedRevision)) return null;
    const manifest = validateImageManifest(payload.manifest, { draft: true });
    if (manifest.projectPath !== projectRoot || manifest.ownerId !== payload.targetId || manifest.generationId !== payload.generationId) return null;
    // This browser convention is usable only when its deterministic operation
    // binding proves it is the exact original key, never a replacement key.
    const idempotencyKey = `${payload.generationId}:draft`;
    if (imageOperationId(row.principal, idempotencyKey, payload.action) !== row.operation_id) return null;
    return { payload, idempotencyKey };
  } catch { return null; }
}

/** Explicit metadata discovery only. It creates no alias, receipt, stop proof,
 * coordinator owner, transfer or repository mutation. History is not stop proof. */
export async function discoverPendingImageDrafts(context, store) {
  requireScope(context, 'covers:write');
  if (!context.credential || context.grant || !context.principal.startsWith(`session:${context.identity.Id}:`)) throw new DomainError('session_required', 'Image recovery discovery requires the current authenticated backend owner session.', 403);
  await context.check();
  const pending = await store.pendingMutations(), candidates = [];
  let unsupportedPending = false;
  for (const row of pending) {
    if (!await ownsOriginalPrincipal(store, row?.principal, context.identity.Id)) continue;
    const checked = checkedDraft(row, context.repo.paths.root);
    if (!checked) { unsupportedPending = true; continue; }
    let owner;
    try { owner = await context.repo.images.owner(checked.payload.targetId, { write: true }); }
    catch (error) { if ([403, 404].includes(error.status)) continue; throw error; }
    await context.check();
    if (owner.Id !== checked.payload.targetId) throw new DomainError('state_invalid', 'The current image owner response does not match the saved operation.', 503);
    candidates.push({ row, ownerId: owner.Id, idempotencyKey: checked.idempotencyKey });
  }
  const references = candidates.length ? await store.writerRequestRegistrations() : { complete: true, registrations: [] };
  const data = [];
  for (const { row, ownerId, idempotencyKey } of candidates) {
    // Bounded history reads can take time. Renew owner Save immediately before
    // disclosing metadata; the credential check alone does not renew its ACL.
    let owner;
    try { owner = await context.repo.images.owner(ownerId, { write: true }); }
    catch (error) { if ([403, 404].includes(error.status)) continue; throw error; }
    if (owner.Id !== ownerId) throw new DomainError('state_invalid', 'The current image owner response does not match the saved operation.', 503);
    const title = [owner.Title, owner.DisplayName, owner.Name].find(value => typeof value === 'string' && value.trim()) || `Item #${ownerId}`;
    const requestIds = references.complete ? [...new Set(references.registrations.filter(item => item.principal === row.principal && item.identity === context.identity.Id && item.operationId === row.operation_id).map(item => item.requestId))].sort() : [];
    data.push({ operationId: row.operation_id, ownerId, title: title.slice(0, 500), action: 'image-draft', idempotencyKey, requestIds, ...(!requestIds.length ? { requestReferenceRequired: true } : {}) });
  }
  await context.check();
  return { data, ...(unsupportedPending ? { unsupportedPending: true } : {}) };
}
