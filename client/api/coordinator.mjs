import { randomUUID } from 'node:crypto';
import { DomainError } from '../domain/content.mjs';
import { openAppState, assertUuid } from './store.mjs';

/** Coordinates writers inside this Netlify app with a permanent conditional
 * Blobs record. Repository administrators outside the app are not serialized;
 * this does not grant backend CAS or atomic multi-content saves. */
export class Coordinator {
  constructor(config) { Object.assign(this, openAppState(config)); }
  async record() { return this.blobs.getWithMetadata(this.prefix + 'writer', { type: 'json', consistency: 'strong' }); }
  async inspect() {
    const record = await this.record();
    if (!record) return { state: 'released', owner: null };
    this.checkBinding(record.data);
    const owner = record.data.owner && { ...record.data.owner };
    if (owner) delete owner.nonce;
    return { state: record.data.state, owner, etag: record.etag };
  }
  checkBinding(value) {
    if (value.binding !== this.binding) throw new DomainError('coordinator_binding_mismatch', 'This writer belongs to a different repository/auth/project.', 503);
    if (!['held','released'].includes(value.state)) throw new DomainError('coordinator_state_invalid', 'The shared writer state is invalid.', 503);
  }
  async acquire(options) {
    const { requestId, identity, principal, planId, jobId, waitMs = 0 } = options;
    assertUuid(requestId, 'Request ID');
    if (!Number.isSafeInteger(identity) || identity < 1 || typeof principal !== 'string' || !principal || principal.length > 256 || !Number.isInteger(waitMs) || waitMs < 0 || waitMs > 5000) throw new DomainError('invalid_writer_owner', 'Writer requires an authenticated identity, principal and bounded wait.');
    if (planId !== undefined) assertUuid(planId, 'Plan ID');
    if (jobId !== undefined) assertUuid(jobId, 'Job ID');
    const deadline = Date.now() + waitMs;
    const owner = { requestId, identity, principal, nonce: randomUUID(), startedAt: new Date().toISOString(), ...(planId ? { planId } : {}), ...(jobId ? { jobId } : {}) };
    // Keep exact stopped-request confirmation unambiguous forever, including
    // across restarts. A busy invocation also consumes its UUID; the next
    // Function invocation must receive a fresh server-generated request ID.
    const registered = await this.blobs.setJSON(this.prefix + `writer-requests/${requestId}`, owner, { onlyIfNew: true });
    if (!registered.modified) throw new DomainError('coordinator_request_reused', 'A writer invocation UUID cannot be reused. Retry with a fresh invocation request ID.', 409);
    for (;;) {
      let record = await this.record();
      if (!record) {
        await this.blobs.setJSON(this.prefix + 'writer', { binding: this.binding, state: 'released', owner: null, transition: randomUUID() }, { onlyIfNew: true });
        record = await this.record();
      }
      if (!record?.etag) throw new DomainError('coordinator_state_invalid', 'Shared writer ETag is unavailable.', 503);
      this.checkBinding(record.data);
      if (record.data.state === 'released') {
        const result = await this.blobs.setJSON(this.prefix + 'writer', { binding: this.binding, state: 'held', owner, transition: randomUUID() }, { onlyIfMatch: record.etag });
        if (result.modified) {
          if (!result.etag) throw new DomainError('coordinator_state_invalid', 'Acquired writer ETag is unavailable.', 503);
          return { ...owner, etag: result.etag };
        }
      }
      if (Date.now() >= deadline) throw new DomainError('coordinator_busy', 'The shared application writer is held. Retry the same saved plan/key; a stopped invocation needs explicit owner recovery.', 409, { requestId: record.data.state === 'held' ? record.data.owner?.requestId : undefined });
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(1, deadline - Date.now()))));
    }
  }
  async assertHeld(owner) {
    const current = await this.record();
    if (!current) throw new DomainError('coordinator_owner_lost', 'The application writer ownership is unavailable.', 409);
    this.checkBinding(current.data);
    if (current.data.state !== 'held' || current.etag !== owner.etag || current.data.owner?.requestId !== owner.requestId || current.data.owner?.nonce !== owner.nonce) throw new DomainError('coordinator_owner_lost', 'This invocation no longer owns the application writer; no new backend write may be dispatched.', 409);
    return current;
  }
  async releaseOwned(owner) {
    const current = await this.assertHeld(owner);
    const result = await this.blobs.setJSON(this.prefix + 'writer', { binding: this.binding, state: 'released', owner: current.data.owner, transition: randomUUID(), releasedAt: new Date().toISOString() }, { onlyIfMatch: current.etag });
    if (!result.modified) throw new DomainError('coordinator_owner_lost', 'Writer ownership changed before release; no other invocation was released.', 409);
  }
  async run(action, options = {}) {
    const owner = await this.acquire(options);
    const guard = { requestId: owner.requestId, assertOwner: () => this.assertHeld(owner) };
    try { return await action(guard); }
    finally { await this.releaseOwned(owner); }
  }
  /** The caller authenticates the ORIGINAL backend identity and explicitly
   * confirms this exact stopped request. Clocks never justify takeover. */
  async releaseAbandoned(stoppedRequestId, identity) {
    assertUuid(stoppedRequestId, 'Stopped request ID');
    if (!Number.isSafeInteger(identity) || identity < 1) throw new DomainError('invalid_writer_owner', 'An authenticated original backend identity is required.');
    const current = await this.record();
    if (!current) throw new DomainError('coordinator_owner_conflict', 'There is no matching held invocation.', 409);
    this.checkBinding(current.data);
    if (current.data.state !== 'held' || current.data.owner?.requestId !== stoppedRequestId || current.data.owner?.identity !== identity) throw new DomainError('coordinator_owner_conflict', 'Only the original backend identity may release the exact confirmed stopped invocation.', 409);
    const result = await this.blobs.setJSON(this.prefix + 'writer', { binding: this.binding, state: 'released', owner: current.data.owner, transition: randomUUID(), releasedAt: new Date().toISOString(), stoppedInvocationConfirmed: true }, { onlyIfMatch: current.etag });
    if (!result.modified) throw new DomainError('coordinator_owner_conflict', 'Writer ownership changed during stopped invocation recovery.', 409);
    return { released: true, requestId: stoppedRequestId, ...(current.data.owner.planId ? { planId: current.data.owner.planId } : {}), ...(current.data.owner.jobId ? { jobId: current.data.owner.jobId } : {}) };
  }
  close() {}
}
