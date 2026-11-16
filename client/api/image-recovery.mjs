import { randomUUID } from 'node:crypto';
import { DomainError, assertObject } from '../domain/content.mjs';
import { assertUuid, hash } from './store.mjs';
import { imageOperationId } from './image-assets.mjs';
import { MutationJournal } from './journal.mjs';
import { imageJobInput } from './image-jobs.mjs';

const failure = (code, message, details) => new DomainError(code, message, 409, details);
const imageActions = ['image-draft', 'image-variant', 'image-seal', 'image-delete'];
const unavailable = () => new DomainError('operation_unavailable', 'Image recovery is unavailable for this backend identity.', 404);
function originalAction(principal, key, operationId) {
  const action = imageActions.find(action => imageOperationId(principal, key, action) === operationId);
  if (!action) throw failure('idempotency_conflict', 'Recovery requires the original exact image operation and Idempotency-Key.');
  return action;
}
const unpreparedResult = proof => ({ status: 200, value: { operationId: proof.operationId, stoppedRequestId: proof.stoppedRequestId, notPrepared: true, pending: false, repositoryWrites: 0, policy: 'Stopped writer recovery only; no image payload or completion receipt was synthesized and no repository write was redispatched.' } });

async function unpreparedJobProvenance(context, input, key, store) {
  const mapping = (await store.read(`image-job-operations/${input.operationId}`))?.data;
  if (!mapping) return null;
  const principal = mapping.principal;
  if (typeof principal !== 'string' || !principal || principal.length > 256 || mapping.identity !== context.identity.Id) throw unavailable();
  let owned = principal.startsWith(`session:${context.identity.Id}:`);
  if (principal.startsWith('grant:')) {
    const grantId = principal.slice(6); assertUuid(grantId, 'Original grant ID');
    owned = (await store.read(`grant-ids/${grantId}`))?.data.identity === context.identity.Id;
  }
  if (!owned) throw unavailable();
  const action = originalAction(principal, key, input.operationId);
  assertUuid(mapping.id, 'Original image job ID');
  const [saved, claimed] = await Promise.all([store.read(`jobs/${mapping.id}/input`), store.read(`jobs/${mapping.id}/claim`)]);
  const job = saved?.data, claim = claimed?.data;
  if (!job || !claim || !mapping.image || !job.image || job.id !== mapping.id || job.binding !== store.prefix || job.principal !== principal || job.identity !== context.identity.Id || job.method !== 'POST' || typeof job.path !== 'string' || !/^\/api\/v1\/images\/drafts(?:\/[1-9][0-9]*\/(?:seal|delete))?$/.test(job.path) || job.headers?.['idempotency-key'] !== key || claim.id !== mapping.id || claim.principal !== principal || claim.identity !== context.identity.Id) throw unavailable();
  assertUuid(job.requestId, 'Original image request ID'); assertUuid(claim.nonce, 'Original image job claim');
  if (input.stoppedRequestId !== undefined && input.stoppedRequestId !== job.requestId) throw failure('coordinator_owner_conflict', 'This is not the exact claimed image job invocation.');
  if (typeof job.body !== 'string' || job.body.length > 4 * Math.ceil(32768 / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(job.body)) throw unavailable();
  const bytes = Buffer.from(job.body, 'base64');
  const image = imageJobInput(job.path, bytes, { ...context, principal }, context.repo.paths.root, key);
  if (!image || image.action !== action || image.operationId !== input.operationId || hash(image) !== hash(mapping.image) || hash(image) !== hash(job.image)) throw unavailable();
  return { jobId: mapping.id, requestId: job.requestId, principal, action, targetId: image.targetId, fingerprint: hash({ mapping, job, claim }) };
}

/** A permanent job claim may precede coordinator.acquire and journal.prepare.
 * Its bound records establish provenance; only the owner attests the stop. */
async function recoverUnpreparedJob(context, input, key, store, coordinator, savedProof) {
  await context.check();
  const original = await unpreparedJobProvenance(context, input, key, store);
  if (!original) throw unavailable();
  if (savedProof && savedProof.jobId !== original.jobId) throw failure('idempotency_conflict', 'The saved absence proof belongs to another image job.');
  if (await store.mutationRow(original.principal, input.operationId)) return { row: await store.recoveryMutation(input.operationId, context.identity.Id, original.principal) };
  const held = await coordinator.inspect();
  // This branch has no held original writer to release. Even the same operation
  // under another request remains exclusively owned by that invocation.
  if (held.state === 'held') throw failure('coordinator_owner_conflict', 'A claimed pre-journal job cannot release a held writer.');
  if (input.confirmStopped !== true) return { status: 409, value: { operationId: input.operationId, stoppedRequestId: original.requestId, notPrepared: true, pending: true, operatorMustConfirmStopped: true, repositoryWrites: 0 } };
  return coordinator.run(async guard => {
    await context.check(); await guard.assertOwner();
    const current = await unpreparedJobProvenance(context, input, key, store);
    if (!current || current.fingerprint !== original.fingerprint) throw failure('image_recovery_changed', 'The claimed image job changed during stopped recovery.');
    if (await store.mutationRow(original.principal, input.operationId)) throw failure('image_recovery_changed', 'The image journal appeared during stopped-job recovery. Retry its normal saved operation recovery.');
    await context.repo.images.owner(original.targetId, { write: true });
    await context.check(); await guard.assertOwner();
    if (await store.mutationRow(original.principal, input.operationId)) throw failure('image_recovery_changed', 'The image journal appeared during current owner authorization. Retry its normal saved operation recovery.');
    const proof = { version: 1, operationId: input.operationId, stoppedRequestId: original.requestId, identity: context.identity.Id, principal: original.principal, action: original.action, notPrepared: true, confirmStopped: true, jobId: original.jobId };
    await store.immutable(`image-unprepared-confirmations/${input.operationId}/${original.requestId}`, proof, 'idempotency_conflict');
    await context.check(); await guard.assertOwner();
    if (await store.mutationRow(original.principal, input.operationId)) throw failure('image_recovery_changed', 'The image journal appeared while saving the stopped-job proof. Retry its normal saved operation recovery.');
    await context.check(); await guard.assertOwner();
    return unpreparedResult(proof);
  }, { requestId: randomUUID(), identity: context.identity.Id, principal: original.principal, operationId: input.operationId });
}

/** A writer can stop before journal.prepare. Its absence is not an image
 * receipt; persist the exact owner attestation before releasing only that writer. */
async function recoverUnpreparedImage(context, input, key, store, coordinator) {
  if (input.stoppedRequestId !== undefined) assertUuid(input.stoppedRequestId, 'Stopped request ID');
  const proofKey = input.stoppedRequestId && `image-unprepared-confirmations/${input.operationId}/${input.stoppedRequestId}`;
  let proof = proofKey && (await store.read(proofKey))?.data;
  if (proof) {
    if (proof.version !== 1 || proof.notPrepared !== true || proof.confirmStopped !== true || proof.operationId !== input.operationId || proof.stoppedRequestId !== input.stoppedRequestId || proof.identity !== context.identity.Id || typeof proof.principal !== 'string' || !proof.principal || proof.principal.length > 256) throw unavailable();
    if (originalAction(proof.principal, key, input.operationId) !== proof.action) throw failure('idempotency_conflict', 'The stopped image proof differs from the original operation.');
    if (proof.jobId !== undefined) return recoverUnpreparedJob(context, input, key, store, coordinator, proof);
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
    if (held.state !== 'held' || held.owner?.operationId !== input.operationId || held.owner.identity !== context.identity.Id) return recoverUnpreparedJob(context, input, key, store, coordinator);
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
const abandonmentCode = 'image_publication_abandoned';
const incompleteImage = error => error instanceof DomainError && error.code === 'uncertain_image_mutation' && error.status === 409 && error.details?.uncertain === true;
function receiptResult(operationId, receipt) {
  const abandoned = receipt.ok === false && receipt.failure?.code === abandonmentCode && receipt.failure.abandoned === true;
  return { status: 200, value: { operationId, confirmed: abandoned ? false : receipt.found, pending: !receipt.found, ...(abandoned ? { abandoned: true } : {}), repositoryWrites: 0, ...(receipt.ok === false ? { failure: receipt.failure } : { result: receipt.result }), policy: 'Receipt reconciliation only; no image bytes or repository writes are redispatched.' } };
}
async function checkedReceipt(context, payload, journal) {
  const receipt = await journal.receipt(payload);
  // A terminal failure does not claim native completion. Successful receipts
  // still require current authorized native readback.
  if (receipt.ok !== false) await observation(context, payload).then(value => { if (value.outcome !== 'confirmed') throw failure('image_recovery_pending', 'The saved receipt cannot currently be read back.', value); });
  return receipt;
}
/** Explicitly accept an unconfirmed stopped operation as a terminal failure.
 * Neither a missing generation nor a timeout is evidence that dispatch stopped.
 * Keep the original payload/before-state and every native partial artifact. */
async function abandonPreparedImage(context, input, payload, row, store, coordinator) {
  const stopKey = `image-stopped-confirmations/${input.operationId}/${input.stoppedRequestId}`;
  const proof = { operationId: input.operationId, stoppedRequestId: input.stoppedRequestId, identity: context.identity.Id, principal: row.principal };
  const matchesProof = value => value?.operationId === proof.operationId && value.stoppedRequestId === proof.stoppedRequestId && value.identity === proof.identity && value.principal === proof.principal;
  await context.check();
  const held = await coordinator.inspect(), savedProof = await store.read(stopKey);
  const exactOwner = held.owner?.requestId === input.stoppedRequestId && held.owner.operationId === input.operationId && held.owner.principal === row.principal && held.owner.identity === context.identity.Id;
  // A past proof never authorizes releasing another invocation, even one for
  // this same operation. History supplies provenance, never a stopped state.
  if (held.state === 'held' && !exactOwner) throw failure('coordinator_owner_conflict', 'Abandonment cannot release a different held invocation.');
  if (savedProof && !matchesProof(savedProof.data)) throw failure('coordinator_owner_conflict', 'The saved stopped invocation proof differs from this image operation.');
  if (held.state === 'released' && !exactOwner && !matchesProof(savedProof?.data)) {
    // Store.read is strong and uses the same repository/auth/project binding
    // prefix as Coordinator. A later read-only invocation can replace the last
    // released owner, but cannot replace this immutable request registration.
    const registered = (await store.read(`writer-requests/${input.stoppedRequestId}`))?.data;
    if (registered?.requestId !== input.stoppedRequestId || registered.identity !== context.identity.Id || registered.principal !== row.principal || registered.operationId !== input.operationId) throw failure('coordinator_owner_conflict', 'Abandonment requires the exact stopped invocation binding or its saved owner attestation.');
    // Registration precedes acquire and can include busy invocations. Only the
    // caller's explicit confirmStopped:true attestation supplies the stop proof;
    // no historical registration can authorize releasing a current writer.
  }
  await context.repo.images.owner(payload.targetId, { write: true });
  let initiallyConfirmed = false;
  if (!row.result) {
    try { await context.repo.images.reconcile(payload); initiallyConfirmed = true; }
    catch (error) { if (!incompleteImage(error)) throw error; }
  }
  await context.check();
  // Persist before releasing: a lost release acknowledgement cannot discard
  // the exact stop proof when the next coordinator owner replaces this owner.
  await store.immutable(stopKey, proof, 'idempotency_conflict');
  await context.check();
  if (held.state === 'held') await coordinator.releaseAbandoned(input.stoppedRequestId, context.identity.Id);
  return coordinator.run(async guard => {
    await context.check();
    await context.repo.images.owner(payload.targetId, { write: true });
    const journal = new MutationJournal(store, row.principal, context.repo);
    try {
      try { return receiptResult(input.operationId, await checkedReceipt(context, payload, journal)); }
      catch (error) { if (initiallyConfirmed || !incompleteImage(error)) throw error; }
      await context.check(); await guard.assertOwner();
      // A completed/failed receipt appearing during observation wins. Never
      // replace another terminal result merely because abandonment was asked.
      if ((await journal.row(payload))?.result) return receiptResult(input.operationId, await checkedReceipt(context, payload, journal));
      const result = { ok: false, code: abandonmentCode, message: 'The original owner abandoned this stopped image publication with an unconfirmed native outcome. Existing partial state and original images were preserved; no repository write was sent.', status: 409, abandoned: true, outcomeUnconfirmed: true, stoppedRequestId: input.stoppedRequestId, partialStatePreserved: true, repositoryWrites: 0, completed: [] };
      await context.check(); await guard.assertOwner();
      try { await journal.fail(payload, result); }
      catch (error) {
        if (!(error instanceof DomainError) || error.code !== 'idempotency_conflict' || !(await journal.row(payload))?.result) throw error;
        return receiptResult(input.operationId, await checkedReceipt(context, payload, journal));
      }
      return receiptResult(input.operationId, { found: true, ok: false, failure: result });
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return { status: error.status || 409, value: { operationId: input.operationId, confirmed: false, pending: true, repositoryWrites: 0, error: { code: error.code, message: error.message } } };
    }
  }, { requestId: randomUUID(), identity: context.identity.Id, principal: row.principal, operationId: input.operationId });
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
  if (Object.keys(input).some(key => !['operationId', 'stoppedRequestId', 'confirmStopped', 'abandon'].includes(key)) || input.abandon !== undefined && input.abandon !== true) throw failure('invalid_input', 'Image recovery accepts its exact operation ID, an explicitly confirmed stopped request and optional abandon:true.');
  assertUuid(input.operationId, 'Image operation ID');
  if (input.stoppedRequestId !== undefined) assertUuid(input.stoppedRequestId, 'Stopped request ID');
  if (input.confirmStopped !== undefined && input.confirmStopped !== true || input.confirmStopped === true && input.stoppedRequestId === undefined || input.stoppedRequestId !== undefined && input.confirmStopped !== true || input.abandon === true && input.confirmStopped !== true) throw failure('stopped_confirmation_required', 'The operator must verify the exact original invocation has stopped; no timer or network error confirms this.');
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
  if (input.abandon === true) return abandonPreparedImage(context, input, payload, row, store, coordinator);
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
      return receiptResult(input.operationId, await checkedReceipt(context, payload, journal));
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      return { status: error.status || 409, value: { operationId: input.operationId, confirmed: false, pending: true, repositoryWrites: 0, error: { code: error.code, message: error.message } } };
    }
  }, { requestId: randomUUID(), identity: context.identity.Id, principal: row.principal, operationId: input.operationId });
}
