export const IMAGE_READ_TIMEOUT_MS = 20000;
const transientStatuses = new Set([500, 502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527]);
const transportCodes = new Set(['native_gateway_upstream_error', 'native_gateway_unavailable', 'native_gateway_timeout', 'native_request_failed', 'repository_transport', 'repository_timeout', 'backend_failure', 'cover_transport', 'cover_timeout']);

export class ImageReadFailure extends Error {
  readonly retryable = true;
  readonly status: number;
  constructor(status: number, timedOut: boolean) {
    super(timedOut ? 'Image loading timed out. Retry the image or preview.' : `The image service temporarily failed (HTTP ${status}). Retry the image or preview.`);
    this.name = 'ImageReadFailure'; this.status = status;
  }
}
export const isTransientImageReadFailure = (error: unknown): error is ImageReadFailure => error instanceof ImageReadFailure;

function transient(error: unknown): boolean {
  // The operation passed here contains only a fetch/body read. Context and
  // format validation stay outside it; those failures must never be retried.
  if (error instanceof TypeError) return true; // Fetch or interrupted body.
  if (!error || typeof error !== 'object') return false;
  const value = error as { status?: number; transportFailure?: boolean; code?: string };
  if (value.status !== undefined && [400, 401, 403, 404, 409, 413, 429].includes(value.status)) return false;
  if (typeof value.code === 'string' && !transportCodes.has(value.code)) return false;
  return transientStatuses.has(value.status ?? 0) || value.transportFailure === true;
}
function pause(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => { signal.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(finish, delayMs);
    const cancel = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); reject(signal.reason); };
    signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
  });
}

/** Only image reads opt into this helper. Never wrap publication, upload,
 * plans, jobs or recovery writes. Two bounded attempts are not live polling. */
export async function readImage<T>(operation: (signal: AbortSignal) => Promise<T>, options: {
  signal: AbortSignal; assertContext?: () => void; timeoutMs?: number; retryDelayMs?: number;
}): Promise<T> {
  const { signal, assertContext = () => {} } = options;
  const check = () => { signal.throwIfAborted(); assertContext(); };
  const timeoutMs = Math.max(1, Math.min(IMAGE_READ_TIMEOUT_MS, options.timeoutMs ?? IMAGE_READ_TIMEOUT_MS));
  for (let attempt = 0; attempt < 2; attempt++) {
    check();
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
    let cancel = () => {};
    const interrupted = new Promise<never>((_resolve, reject) => {
      cancel = () => { controller.abort(signal.reason); reject(signal.reason); };
      signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel();
      timer = setTimeout(() => {
        timedOut = true; const error = new DOMException('Image read deadline expired.', 'TimeoutError');
        controller.abort(error); reject(error);
      }, timeoutMs);
    });
    let value: T;
    try {
      value = await Promise.race([Promise.resolve().then(() => { controller.signal.throwIfAborted(); return operation(controller.signal); }), interrupted]);
    } catch (error) {
      check();
      if (!timedOut && !transient(error)) throw error;
      if (attempt === 1) throw new ImageReadFailure(timedOut ? 504 : Number((error as { status?: number })?.status) || 503, timedOut);
      await pause(signal, Math.max(0, options.retryDelayMs ?? 300));
      continue;
    } finally {
      clearTimeout(timer); signal.removeEventListener('abort', cancel);
    }
    check(); return value;
  }
  throw new Error('Image read attempts exhausted.');
}
