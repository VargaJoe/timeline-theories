import JSZip from 'jszip';
import { TimelineEntryService, type MediaItemRef } from './timelineEntryService';
import { repository, assertOperations, captureOperationContext } from './sensenet';
import { mediaLibraryPath, timelinesPath } from '../projectPaths';
import { encodeTimelineArchive, EXCHANGE_LIMITS } from '../domain/exchange.mjs';
import { nativeResponse, NativeApiError } from './nativeApi';

interface ExportResult { blob: Blob; filename: string; skippedImagesCount: number; }
async function downloadImage(media: Record<string, unknown>): Promise<{ data: Blob; contentType: string } | null> {
  const resource = (media.CoverImageBin as MediaItemRef['CoverImageBin'])?.__mediaresource;
  await assertOperations([{ target: Number(media.Id), action: 'read' }]);
  let response: Response;
  if (resource?.media_src) {
    const origin = repository.configuration.repositoryUrl.replace(/\/odata\.svc\/?$/i, '');
    const url = new URL(resource.media_src, origin);
    if (url.origin !== new URL(origin).origin || url.username || url.password) throw new Error('Binary cover resource is outside the configured repository');
    response = await repository.fetch(url.href, { method: 'GET', credentials: 'include' });
  } else if (media.CoverImageUrl) {
    // Only the bound gateway may resolve an allowed public cover origin. The
    // browser never forwards its repository credential to the external URL.
    try { response = await nativeResponse('/content/' + Number(media.Id) + '/cover'); }
    catch (error) {
      if (error instanceof NativeApiError && ([401, 403, 409].includes(error.status) && !error.code.startsWith('cover_'))) throw error;
      return null;
    }
  } else return null;
  if (!response.ok) {
    if ([401, 403].includes(response.status)) throw new Error('Cover read permission was denied');
    return null;
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > EXCHANGE_LIMITS.coverBytes) throw new Error('Cover exceeds the export size limit');
  if (!response.body) return null;
  const reader = response.body.getReader(), chunks: ArrayBuffer[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > EXCHANGE_LIMITS.coverBytes) { await reader.cancel(); throw new Error('Cover exceeds the export size limit'); }
      chunks.push(Uint8Array.from(value).buffer);
    }
  } finally { reader.releaseLock(); }
  if (!size) return null;
  const contentType = response.headers.get('content-type') || 'image/jpeg';
  return { data: new Blob(chunks, { type: contentType }), contentType };
}
export async function exportTimelineAsZip(timelineId: number, timelineName: string, parentPath: string, suppliedRepository: typeof repository): Promise<ExportResult> {
  if (suppliedRepository !== repository) throw new Error('Repository mismatch');
  const checkContext = captureOperationContext();
  const timeline = await repository.load({ idOrPath: timelineId });
  if (timeline.d.Type !== 'Timeline' || timeline.d.Path !== parentPath || !parentPath.startsWith(timelinesPath + '/')) throw new Error('Export target must be the selected local timeline');
  const entries = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);
  const mediaCache = new Map<number, MediaItemRef>();
  for (const entry of entries) {
    checkContext();
    await assertOperations([{ target: entry.id, action: 'read' }]);
    if (!entry.mediaItem) throw new Error('Export entry needs a readable local media reference');
    const id = entry.mediaItem.Id;
    let media = mediaCache.get(id);
    if (!media) {
      const content = await repository.load({ idOrPath: id });
      if (!content.d.Path?.startsWith(mediaLibraryPath + '/') || !['MediaItem', 'BookMediaItem'].includes(content.d.Type)) throw new Error('Export media reference is outside this library');
      media = content.d as MediaItemRef; mediaCache.set(id, media);
    }
    entry.mediaItem = media;
  }
  const encoded = await encodeTimelineArchive(JSZip, timelineName, entries, async media => {
    checkContext(); const cover = await downloadImage(media); checkContext(); return cover;
  });
  checkContext();
  return { blob: new Blob([Uint8Array.from(encoded.bytes).buffer], { type: 'application/zip' }), filename: encoded.filename, skippedImagesCount: encoded.skippedImagesCount };
}
