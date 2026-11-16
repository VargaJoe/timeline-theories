import { nativeRequest, nativeResponse } from './nativeApi';
import { captureOperationContext } from './sensenet';

export interface PendingImagePublication {
  operationId: string;
  ownerId: number;
  title: string;
  action: 'image-draft';
  idempotencyKey: string;
  requestIds: string[];
  requestReferenceRequired?: boolean;
}
export interface ImageRecoveryResult {
  operationId: string;
  confirmed?: boolean;
  pending: boolean;
  abandoned?: boolean;
  notPrepared?: boolean;
  failure?: { code: string; message?: string };
  repositoryWrites: number;
}

// Discovery is explicit and never polls. The server returns only the current
// backend user's operations and checks current owner write access.
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export async function pendingImagePublications(signal: AbortSignal): Promise<PendingImagePublication[]> {
  const items = await nativeRequest<unknown>('/images/recovery/pending', { signal, cache: 'no-store' });
  if (!Array.isArray(items) || items.length > 100 || items.some(item => !item || typeof item !== 'object'
    || !uuid(item.operationId) || !Number.isSafeInteger(item.ownerId) || item.ownerId < 1 || item.action !== 'image-draft'
    || typeof item.title !== 'string' || item.title.length > 500 || typeof item.idempotencyKey !== 'string'
    || !item.idempotencyKey.endsWith(':draft') || !uuid(item.idempotencyKey.slice(0, -6))
    || !Array.isArray(item.requestIds) || item.requestIds.length > 200 || item.requestIds.some((id: unknown) => !uuid(id))
    || new Set(item.requestIds).size !== item.requestIds.length || item.requestReferenceRequired !== undefined && item.requestReferenceRequired !== true
    || item.requestReferenceRequired === true && item.requestIds.length !== 0)) throw new Error('The saved publication references could not be read. Retry the check; no recovery was sent.');
  return items as PendingImagePublication[];
}

export async function recoverPendingImage(publication: PendingImagePublication, signal: AbortSignal,
  options: { requestId?: string; confirmStopped?: boolean; abandon?: boolean } = {}): Promise<ImageRecoveryResult> {
  const check = captureOperationContext(); check(); signal.throwIfAborted();
  if (options.abandon && (!options.confirmStopped || !options.requestId)) throw new Error('Verify the original server request has stopped before closing it.');
  const body = { operationId: publication.operationId,
    ...(options.confirmStopped ? { confirmStopped: true, stoppedRequestId: options.requestId } : {}),
    ...(options.abandon ? { abandon: true } : {}) };
  const response = await nativeResponse('/images/recovery', { method: 'POST', headers: { 'Idempotency-Key': publication.idempotencyKey },
    body: JSON.stringify(body), signal }, { pendingImageRecoveryId: publication.operationId });
  const result = await response.json() as ImageRecoveryResult;
  check(); signal.throwIfAborted();
  if (!result || result.operationId !== publication.operationId || result.repositoryWrites !== 0 || typeof result.pending !== 'boolean'
    || result.abandoned && (result.pending || result.confirmed || result.failure?.code !== 'image_publication_abandoned')
    || !response.ok && !(response.status === 409 && result.pending)) throw new Error('The saved publication could not be verified. Its original reference has been kept.');
  return result;
}
