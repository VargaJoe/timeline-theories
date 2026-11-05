import { repositoryUrl, siteConfig } from '../configuration';
import { nativeResponse } from '../services/nativeApi';
import type { ImageDescriptor } from './imageVariants';

const abortError = () => new DOMException('Image loading was cancelled.', 'AbortError');

/** Aborted queued jobs are removed before starting, rather than spending a worker. */
export function createImageRequestQueue(limit = 2) {
  const maximum = Math.max(1, Math.min(2, Number.isFinite(limit) ? Math.floor(limit) : 2));
  let active = 0;
  const waiting: Array<{ start: () => void; cancel: () => void }> = [];
  const pump = () => {
    while (active < maximum && waiting.length) waiting.shift()!.start();
  };
  return {
    run<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        if (signal.aborted) { reject(abortError()); return; }
        const entry = {
          start: () => {
            signal.removeEventListener('abort', entry.cancel);
            if (signal.aborted) { reject(abortError()); return; }
            active++;
            Promise.resolve().then(() => {
              if (signal.aborted) throw abortError();
              return work();
            }).then(resolve, reject).finally(() => { active--; pump(); });
          },
          cancel: () => {
            const index = waiting.indexOf(entry);
            if (index !== -1) waiting.splice(index, 1);
            signal.removeEventListener('abort', entry.cancel);
            reject(abortError());
          },
        };
        signal.addEventListener('abort', entry.cancel, { once: true });
        waiting.push(entry); pump();
      });
    },
  };
}

export const imageRequestQueue = createImageRequestQueue(siteConfig.imageCache.concurrencyLimit);

export interface ImageFetchOptions {
  signal: AbortSignal;
  accessToken?: string;
  assertContext?: () => void;
}

export function nativeImagePresentationTarget(source: string, generationId?: string): { path: string; generationId: string } | undefined {
  let url: URL;
  try { url = new URL(source, window.location.origin); } catch { return undefined; }
  if (url.origin !== window.location.origin || url.username || url.password || url.search || url.hash) return undefined;
  const match = url.pathname.match(/^\/api\/v1\/images\/([1-9][0-9]*)\/([0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/w[1-9][0-9]{0,3}$/i);
  if (!match || !Number.isSafeInteger(Number(match[1])) || generationId !== undefined && generationId !== match[2]) return undefined;
  return { path: `/content/${match[1]}/image-presentation`, generationId: match[2] };
}

/** Metadata only: every visible-generation refresh rechecks current source access without image bytes. */
export async function readNativeImagePresentation(path: string, { signal, assertContext = () => {} }: ImageFetchOptions): Promise<ImageDescriptor> {
  if (!/^\/content\/[1-9][0-9]*\/image-presentation$/.test(path)) throw new Error('Invalid image presentation target.');
  const check = () => { if (signal.aborted) throw abortError(); assertContext(); };
  check();
  const response = await nativeResponse(path, { signal, cache: 'no-store' });
  check();
  if (!response.ok) throw new Error('Image presentation is unavailable.');
  const payload = await response.json() as { data?: ImageDescriptor };
  check();
  if (!payload.data || !['active', 'blocked', 'stale', 'missing', 'legacy'].includes(payload.data.state)) throw new Error('Invalid image presentation response.');
  return payload.data;
}

/** Native images receive the native binding; repository bearer never crosses origins. */
export async function fetchImageBlob(source: string, { signal, accessToken, assertContext = () => {} }: ImageFetchOptions): Promise<Blob> {
  const check = () => { if (signal.aborted) throw abortError(); assertContext(); };
  check();
  const url = new URL(source, window.location.origin);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('Unsupported image URL.');
  let response: Response;
  if (url.origin === window.location.origin && url.pathname.startsWith('/api/v1/')) {
    if (url.search || url.hash) throw new Error('Native image URLs cannot contain query parameters or fragments.');
    response = await nativeResponse(url.pathname, { signal, cache: 'no-store', headers: { Accept: 'image/webp,image/png,image/jpeg' } });
  } else {
    const headers: Record<string, string> = {};
    const repositorySource = url.origin === new URL(repositoryUrl).origin;
    if (accessToken && url.protocol === 'https:' && repositorySource) headers.Authorization = `Bearer ${accessToken}`;
    response = await fetch(url.href, { headers, credentials: 'omit', redirect: 'error', cache: repositorySource ? 'no-store' : 'default', signal });
  }
  check();
  if (!response.ok) throw new Error(`Failed to fetch image: ${response.status}`);
  const blob = await response.blob();
  check();
  return blob;
}
