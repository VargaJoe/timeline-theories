import { DomainError, assertId, assertObject } from '../domain/content.mjs';
import { assertUuid, hash } from './store.mjs';
import { imageOperationId, validateImageManifest, validateImageVariant, IMAGE_LIMITS } from './image-assets.mjs';
import { requireScope } from './plans.mjs';

// Only metadata can enter the durable job store. Image bytes stay transient
// in the synchronous variant upload and are stored solely in SenseNet.
export function imageJobAction(route) {
  const path = route.replace(/^\/api\/v1\//, '');
  if (path === 'images/drafts') return 'image-draft';
  const match = path.match(/^images\/drafts\/[1-9][0-9]*\/(seal|delete)$/);
  return match ? 'image-' + match[1] : null;
}

export function imageJobInput(route, bytes, context, projectRoot, key) {
  const action = imageJobAction(route);
  if (!action) return null;
  requireScope(context, 'covers:write');
  const operationId = imageOperationId(context.principal, key, action);
  if (bytes.length > 32768) throw new DomainError('input_limit', 'Image metadata exceeds the request limit.', 413);
  let input;
  try { input = JSON.parse(bytes.toString('utf8')); }
  catch { throw new DomainError('invalid_json', 'Image metadata must be JSON.'); }
  assertObject(input);
  const allowed = action === 'image-draft' ? ['ownerId', 'generationId', 'expectedRevision', 'manifest'] : action === 'image-seal' ? ['ownerId', 'variants'] : ['ownerId'];
  if (Object.keys(input).some(key => !allowed.includes(key))) throw new DomainError('invalid_image_asset', 'Unknown image request property.');
  const targetId = assertId(input.ownerId);
  if (action === 'image-draft') {
    assertUuid(input.generationId, 'Image generation ID');
    if (typeof input.expectedRevision !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(input.expectedRevision)) throw new DomainError('invalid_image_asset', 'Draft preparation needs the exact editor revision.');
    const manifest = validateImageManifest(input.manifest, { draft: true });
    if (manifest.ownerId !== targetId || manifest.generationId !== input.generationId || manifest.projectPath !== projectRoot) throw new DomainError('image_owner_mismatch', 'Draft manifest owner, generation and project must match the request.', 403);
  } else if (action === 'image-seal') {
    if (!Array.isArray(input.variants) || input.variants.length < 1 || input.variants.length > IMAGE_LIMITS.variants) throw new DomainError('invalid_image_asset', 'A completed image set requires 1..3 variants.');
    input.variants.forEach(variant => validateImageVariant(variant));
  }
  return { action, targetId, operationId, requestHash: hash({ route, input }) };
}

export async function authorizeImageJobResult(context, image) {
  if (!image) return;
  requireScope(context, 'covers:write');
  // A stored result never replaces the caller's current Save permission.
  await context.repo.images.owner(image.targetId, { write: true });
}
