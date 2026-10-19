import JSZip from 'jszip';
import { TimelineEntryService, type TimelineEntry } from './timelineEntryService';
import { acknowledgeNativeCommands, applyNativeCommands, nativeCoverPayload, NativeApiError } from './nativeApi';
import type { NativeCommand, NativeApplyResult } from './nativeApi';
import { repository, assertOperations, captureOperationContext } from './sensenet';
import type { Operation } from './sensenet';
import { mediaLibraryPath, timelinesPath } from '../projectPaths';
import { decodeTimelineArchive, entryFieldsFromRow, coverMimeType } from '../domain/exchange.mjs';

interface ImportResult { entriesCreated: number; entriesUpdated: number; entriesSkipped: number; errors: string[]; }
const referenceId = (value: unknown): number | undefined => {
  if (Array.isArray(value)) return referenceId(value[0]);
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object') return Number((value as { Id?: number }).Id) || undefined;
  return undefined;
};
function revisionOf(content: Record<string, unknown>): string {
  const fields = ['Id', 'Name', 'Path', 'ParentId', 'Type', 'revision', 'ModificationDate', 'Version', 'DisplayName', 'Position', 'ChronologicalDate', 'ChronologicalDescription', 'Notes', 'EntryLabel', 'Importance', 'CoverImageBin'];
  return JSON.stringify({ ...Object.fromEntries(fields.map(field => [field, content[field] ?? null])), MediaItem: referenceId(content.MediaItem), etag: (content.__metadata as { etag?: string } | undefined)?.etag });
}
function approvedRevision(content: Record<string, unknown>): string {
  if (typeof content.revision !== 'string' || !content.revision) throw new Error('Import requires a revision from the configured application gateway');
  return content.revision;
}

export async function prepareTimelineImport(zipFile: File, timelineId: number, parentPath: string) {
  const checkContext = captureOperationContext();
  const { entries, covers } = await decodeTimelineArchive(JSZip, zipFile);
  const parent = await repository.load({ idOrPath: parentPath });
  if (parent.d.Id !== timelineId || parent.d.Type !== 'Timeline' || parent.d.Path !== parentPath || !parentPath.startsWith(timelinesPath + '/')) throw new Error('Import target must be the selected local timeline');
  const existing = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);
  const byName = new Map<string | undefined, TimelineEntry>();
  for (const entry of existing) {
    if (byName.has(entry.name)) throw new Error('Timeline contains ambiguous occurrence Names');
    byName.set(entry.name, entry);
  }
  const revisions = new Map<string | number, string>([[parentPath, revisionOf(parent.d)]]);
  const nativeRevisions = new Map<number, string>();
  const mediaCache = new Map<number, { Id: number; Name: string; DisplayName: string }>();
  const coverByMedia = new Map<number, { bytes: Uint8Array; filename: string }>();
  const operations: Operation[] = [];
  const plan: { fields: Record<string, unknown>; previous: TimelineEntry | undefined }[] = [];
  for (const entry of entries) {
    checkContext();
    const mediaId = Number(entry.mediaId);
    let media = mediaCache.get(mediaId);
    if (!media) {
      const loaded = await repository.load({ idOrPath: mediaId });
      if (!loaded.d.Path?.startsWith(mediaLibraryPath + '/') || !['MediaItem', 'BookMediaItem'].includes(loaded.d.Type)) throw new Error('Archive media reference is outside this library');
      media = { Id: loaded.d.Id, Name: loaded.d.Name, DisplayName: loaded.d.DisplayName };
      revisions.set(mediaId, revisionOf(loaded.d)); nativeRevisions.set(mediaId, approvedRevision(loaded.d)); mediaCache.set(mediaId, media);
    }
    const previous = byName.get(entry.entryName);
    if (previous) {
      const loaded = await repository.load({ idOrPath: previous.id });
      if (loaded.d.Type !== 'TimelineEntry' || loaded.d.Path !== parentPath + '/' + entry.entryName || referenceId(loaded.d.MediaItem) !== mediaId) throw new Error('Archive reference conflicts with the existing occurrence');
      revisions.set(previous.id, revisionOf(loaded.d));
      nativeRevisions.set(Number(previous.id), approvedRevision(loaded.d));
    }
    const fields = entryFieldsFromRow(entry, { displayName: media.DisplayName });
    operations.push(previous ? { target: previous.id, action: 'update' } : { target: parentPath, action: 'create', contentType: 'TimelineEntry' });
    if (entry.coverImageFilename) {
      const bytes = covers.get(entry.coverImageFilename)!;
      const previousCover = coverByMedia.get(mediaId);
      if (previousCover && (previousCover.bytes.length !== bytes.length || bytes.some((byte, index) => byte !== previousCover.bytes[index]))) throw new Error('Archive assigns conflicting covers to the same media item');
      if (!previousCover) {
        coverByMedia.set(mediaId, { bytes, filename: entry.coverImageFilename });
        operations.push({ target: mediaId, action: 'upload' });
      }
    }
    plan.push({ previous, fields });
  }
  const commands: NativeCommand[] = [];
  for (const [mediaId, cover] of coverByMedia) {
    const payload = await nativeCoverPayload(new Blob([Uint8Array.from(cover.bytes).buffer], { type: coverMimeType(cover.bytes) }), cover.filename);
    checkContext();
    commands.push({ action: 'cover', targetId: mediaId, expectedRevision: nativeRevisions.get(mediaId), ...payload });
  }
  for (const { fields, previous } of plan) {
    commands.push(previous ? { action: 'update', targetId: Number(previous.id), expectedRevision: nativeRevisions.get(Number(previous.id)), fields } :
      { action: 'create', type: 'TimelineEntry', parentId: timelineId, fields: { ...fields, IsOptional: false } });
  }
  const entryCounts = (receipt: NativeApplyResult): ImportResult => {
    const result: ImportResult = { entriesCreated: 0, entriesUpdated: 0, entriesSkipped: 0, errors: [] };
    for (const completed of receipt.completed) {
      const command = completed.index === undefined ? undefined : commands[completed.index];
      if (command?.action === 'create') result.entriesCreated++;
      if (command?.action === 'update') result.entriesUpdated++;
    }
    result.entriesSkipped = plan.length - result.entriesCreated - result.entriesUpdated;
    return result;
  };
  checkContext();
  await assertOperations(operations);
  let executed = false;
  // The exposed preview cannot mutate the private operations, prepared bytes or target plan.
  return { operations: operations.map(operation => ({ ...operation })), execute: async (): Promise<ImportResult> => {
    checkContext();
    if (executed) throw new Error('Import plan has already been executed');
    await assertOperations(operations);
    for (const [target, expected] of revisions) {
      const current = await repository.load({ idOrPath: target });
      if (revisionOf(current.d) !== expected) throw new Error('Import target changed after preparation; prepare the archive again');
    }
    // A newly-created occurrence must also invalidate a prepared create command.
    const currentEntries = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);
    const currentNames = new Map(currentEntries.map(entry => [entry.name, entry.id]));
    for (const item of plan) if (currentNames.get(String(item.fields.Name)) !== item.previous?.id) throw new Error('Timeline occurrences changed after preparation; prepare the archive again');
    await assertOperations(operations); checkContext(); executed = true;
    if (!commands.length) return { entriesCreated: 0, entriesUpdated: 0, entriesSkipped: 0, errors: [] };
    let receipt: NativeApplyResult;
    try { receipt = await applyNativeCommands(commands, checkContext); }
    catch (error) {
      if (error instanceof NativeApiError && error.applyResult) {
        const counts = entryCounts(error.applyResult);
        const uncertain = 'retrySamePlan' in error.applyResult && error.applyResult.retrySamePlan === true;
        error.message = `Import stopped: ${counts.entriesCreated} entries created, ${counts.entriesUpdated} updated, ${counts.entriesSkipped} ${uncertain ? 'without a confirmed result' : 'not applied'}. ${error.message} ${uncertain ? 'Resolve the pending application operation before starting another import.' : 'Reload the timeline before retrying.'}`;
      }
      throw error;
    }
    acknowledgeNativeCommands(commands);
    return entryCounts(receipt);
  } };
}
export async function importTimelineFromZip(zipFile: File, timelineId: number, parentPath: string, suppliedRepository: typeof repository): Promise<ImportResult> {
  if (suppliedRepository !== repository) throw new Error('Repository mismatch');
  return (await prepareTimelineImport(zipFile, timelineId, parentPath)).execute();
}
