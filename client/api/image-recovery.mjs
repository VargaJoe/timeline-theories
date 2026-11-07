import { randomUUID } from 'node:crypto';
import { DomainError, assertObject } from '../domain/content.mjs';
import { assertUuid, hash } from './store.mjs';
import { imageOperationId } from './image-assets.mjs';
import { MutationJournal } from './journal.mjs';

const failure = (code, message, details) => new DomainError(code, message, 409, details);
const imageActions = ['image-draft', 'image-variant', 'image-seal', 'image-delete'];
const unavailable = () => new DomainError('operation_unavailable', 'Image recovery is unavailable for this backend identity.', 404);
function originalAction(principal, key, operationId) {
  const action = imageActions.find(action => imageOperationId(principal, key, action) === operationId);
  if (!action) throw failure('idempotency_conflict', 'Recovery requires the original exact image operation and Idempotency-Key.');
  return action;
}
const unpreparedResult = proof => ({ status: 200, value: { operationId: proof.operationId, stoppedRequestId: proof.stoppedRequestId, notPrepared: true, pending: false, repositoryWrites: 0, policy: 'Stopped writer recovery only; no image payload or completion receipt was synthesized and no repository write was redispatched.' } });

/** A writer can stop before journal.prepare. Its absence is not an image
 * receipt; persist the exact owner attestation before releasing only that writer. */
async function recoverUnpreparedImage(context, input, key, store, coordinator) {
  if (input.stoppedRequestId !== undefined) assertUuid(input.stoppedRequestId, 'Stopped request ID');
  const proofKey = input.stoppedRequestId && `image-unprepared-confirmations/${input.operationId}/${input.stoppedRequestId}`;
  let proof = proofKey && (await store.read(proofKey))?.data;
  if (proof) {
    if (proof.version !== 1 || proof.notPrepared !== true || proof.confirmStopped !== true || proof.operationId !== input.operationId || proof.stoppedRequestId !== input.stoppedRequestId || proof.identity !== context.identity.Id || typeof proof.principal !== 'string' || !proof.principal || proof.principal.length > 256) throw unavailable();
    if (originalAction(proof.principal, key, input.operationId) !== proof.action) throw failure('idempotency_conflict', 'The stopped image proof differs from the original operation.');
    // A later exact-key retry may now have a real journal row. Always use that
    // normal recovery path rather than treating an old absence proof as a receipt.
    if (await store.mutationRow(proof.principal, input.operationId)) return { row: await store.recoveryMutation(input.operationId, context.identity.Id, proof.principal) };
    await context.check();
    const held = await coordinator.inspect();
    // Request UUIDs cannot be reused. An old proof must never release a future writer.
    if (held.state !== 'held' || held.owner?.requestId !== input.stoppedRequestId) return unpreparedResult(proof);
    if (held.owner.operationId !== input.operationId || held.owner.principal !== proof.principal || held.owner.identity !== context.identity.Id) throw failure('coordinator_owner_conflict', 'The held invocation differs from the saved stopped image owner.');
  } else {
    await context.check();
    const held = await coordinator.inspect();
    if (held.state !== 'held' || held.owner?.operationId !== input.operationId || held.owner.identity !== context.identity.Id) throw unavailable();
    const principal = held.owner.principal, action = originalAction(principal, key, input.operationId);
    if (await store.mutationRow(principal, input.operationId)) return { row: await store.recoveryMutation(input.operationId, context.identity.Id, principal) };
    if (input.confirmStopped !== true) return { status: 409, value: { operationId: input.operationId, stoppedRequestId: held.owner.requestId, notPrepared: true, pending: true, operatorMustConfirmStopped: true, repositoryWrites: 0 } };
    if (held.owner.requestId !== input.stoppedRequestId) throw failure('coordinator_owner_conflict', 'This is not the exact held image invocation.');
    proof = { version: 1, operationId: input.operationId, stoppedRequestId: input.stoppedRequestId, identity: context.identity.Id, principal, action, notPrepared: true, confirmStopped: true };
    await context.check();
    await store.immutable(proofKey, proof, 'idempotency_conflict');
  }
  await context.check();
  if (await store.mutationRow(proof.principal, input.operationId)) throw failure('image_recovery_changed', 'The image journal changed during stopped-writer recovery. Retry its normal saved operation recovery.');
  await coordinator.releaseAbandoned(input.stoppedRequestId, context.identity.Id);
  return unpreparedResult(proof);
}
async function observation(context, payload) {
  try { return { outcome: 'confirmed', result: await context.repo.images.reconcile(payload) }; }
  catch (error) {
    if (!(error instanceof DomainError) || [401, 403].includes(error.status)) throw error;
    return { outcome: 'unknown', error: { code: error.code, message: error.message } };
  }
}
/** An ordinary retry may inspect bytes while the original writer is held. It
 * never releases that writer, clears its intent or redispatches the upload. */
export async function observeHeldImage(context, payload, store, coordinator) {
  const held = await coordinator.inspect();
  if (held.state !== 'held' || held.owner?.operationId !== payload.operationId || held.owner.principal !== context.principal || held.owner.identity !== context.identity.Id) return;
  const row = await store.mutationRow(context.principal, payload.operationId);
  if (!row) throw failure('coordinator_busy', 'The image invocation is still held; its stopped state must be confirmed by its original backend owner.', { stoppedRequestId: held.owner.requestId, operationId: payload.operationId, operatorMustConfirmStopped: true });
  if (row.request_hash !== payload.requestHash) throw failure('idempotency_conflict', 'This image key belongs to a different saved request.');
  await context.check();
  const observed = await observation(context, payload);
  throw failure('image_recovery_required', 'The exact image outcome was inspected without a write. The operator must confirm the original invocation has stopped before releasing it.', { operationId: payload.operationId, stoppedRequestId: held.owner.requestId, operatorMustConfirmStopped: true, repositoryWrites: 0, ...observed });
}

/** Metadata-only recovery. Explicit owner attestation is the stop proof used
 * by the existing Coordinator boundary. Elapsed time is never stop proof. */
export async function recoverImage(context, input, idempotencyKey, store, coordinator) {
  assertObject(input);
  if (Object.keys(input).some(key => !['operationId', 'stoppedRequestId', 'confirmStopped'].includes(key))) throw failure('invalid_input', 'Image recovery accepts its exact operation ID and optionally an explicitly confirmed stopped request.');
  assertUuid(input.operationId, 'Image operation ID');
  if (input.confirmStopped !== undefined && input.confirmStopped !== true || input.confirmStopped === true && input.stoppedRequestId === undefined || input.stoppedRequestId !== undefined && input.confirmStopped !== true) throw failure('stopped_confirmation_required', 'The operator must verify the exact original invocation has stopped; no timer or network error confirms this.');
  let row;
  try { row = await store.recoveryMutation(input.operationId, context.identity.Id, context.principal); }
  catch (error) {
    if (!(error instanceof DomainError) || error.code !== 'operation_unavailable') throw error;
    const recovered = await recoverUnpreparedImage(context, input, idempotencyKey, store, coordinator);
    if (!recovered.row) return recovered;
    row = recovered.row;
  }
  const payload = JSON.parse(row.payload);
  const { requestHash, ...original } = payload;
  if (row.request_hash !== requestHash || hash(original) !== requestHash || imageOperationId(row.principal, idempotencyKey, payload.action) !== input.operationId) throw failure('idempotency_conflict', 'Recovery requires the original exact image operation and Idempotency-Key.');
  await context.check();
  const held = await coordinator.inspect();
  const stopKey = input.stoppedRequestId && `image-stopped-confirmations/${input.operationId}/${input.stoppedRequestId}`;
  if (held.state === 'held') {
    if (held.owner?.operationId !== input.operationId || held.owner.principal !== row.principal || held.owner.identity !== context.identity.Id) throw failure('coordinator_owner_conflict', 'The held invocation belongs to a different image operation or backend identity.');
    if (input.stoppedRequestId === undefined || input.confirmStopped !== true) {
      const observed = await observation(context, payload);
      return { status: 409, value: { operationId: input.operationId, pending: true, operatorMustConfirmStopped: true, stoppedRequestId: held.owner.requestId, repositoryWrites: 0, ...observed } };
    }
    assertUuid(input.stoppedRequestId, 'Stopped request ID');
    if (held.owner.requestId !== input.stoppedRequestId) throw failure('coordinator_owner_conflict', 'This is not the exact held image invocation.');
    await coordinator.releaseAbandoned(input.stoppedRequestId, context.identity.Id);
  } else if (input.stoppedRequestId !== undefined) {
    // Idempotent retry after a successful explicit release is allowed only for
    // the same last owner. An unrelated released invocation cannot be adopted.
    const proof = await store.read(stopKey);
    if (!(proof?.data.identity === context.identity.Id && proof.data.principal === row.principal) && (held.owner?.requestId !== input.stoppedRequestId || held.owner.operationId !== input.operationId || held.owner.identity !== context.identity.Id)) throw failure('coordinator_owner_conflict', 'The confirmed stopped request differs from the saved image invocation.');
  }
  if (stopKey) await store.immutable(stopKey, { operationId: input.operationId, stoppedRequestId: input.stoppedRequestId, identity: context.identity.Id, principal: row.principal }, 'idempotency_conflict');
  return coordinator.run(async () => {
    await context.check();
    const journal = new MutationJournal(store, row.principal, context.repo);
    try {
      const receipt = await journal.receipt(payload);
      // A durable receipt does not replace current caller ACL checks.
      if (receipt.ok !== false) await observation(context, payload).then(value => { if (value.outcome !== 'confirmed') throw failure('image_recovery_pending', 'The saved receipt cannot currently be read back.', value); });
      return { status: 200, value: { operationId: input.operationId, confirmed: receipt.found, pending: !receipt.found, repositoryWrites: 0, ...(receipt.ok === false ? { failure: receipt.failure } : { result: receipt.result }), policy: 'Receipt reconciliation only; no image bytes or repository writes are redispatched.' } };
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return { status: error.status || 409, value: { operationId: input.operationId, confirmed: false, pending: true, repositoryWrites: 0, error: { code: error.code, message: error.message } } };
    }
  }, { requestId: randomUUID(), identity: context.identity.Id, principal: row.principal, operationId: input.operationId });
}
