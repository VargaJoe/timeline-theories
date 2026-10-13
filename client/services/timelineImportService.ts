import JSZip from 'jszip';
import { TimelineEntryService, type TimelineEntry } from './timelineEntryService';
import { uploadCoverImageBinary } from './mediaLibraryService';
import { repository, assertOperations, captureOperationContext } from './sensenet';
import type { Operation } from './sensenet';
import { mediaLibraryPath } from '../projectPaths';

/**
 * Parsed timeline entry from TSV
 */
interface ParsedTimelineEntry {
  entryName: string;
  Title: string;
  Description: string;
  MediaType: string;
  mediaId: string;
  coverImageFilename: string;
  ChronologicalDate: string;
  Position: number;
  Notes: string;
  EntryLabel: string;
  Importance: string;
  ChronologicalDescription: string;
  Author: string;
  Publisher: string;
  ISBN: string;
  PublicationYear: number;
  Genre: string[];
  Tags: string[];
}

/**
 * Import result with statistics
 */
interface ImportResult {
  entriesCreated: number;
  entriesUpdated: number;
  entriesSkipped: number;
  errors: string[];
}

/**
 * Unescapes TSV field values
 */
function unescapeTSVField(value: string): string {
  return value
    .replace(/\\t/g, '\t')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r');
}

/**
 * Parses comma-separated string to array
 */
function stringToArray(value: string): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map(item => item.trim()).filter(item => item !== '');
}

/**
 * Parses TSV content and returns timeline entries
 */
function parseTSV(content: string): { timelineName: string; entries: ParsedTimelineEntry[] } {
  const lines = content.split('\n').filter(line => line.trim() !== '');
  
  if (lines.length < 2) {
    throw new Error('TSV file must contain at least a header and one data row');
  }

  // Skip header row
  const dataLines = lines.slice(1);
  const entries: ParsedTimelineEntry[] = [];
  let timelineName = '';

  for (let i = 0; i < dataLines.length; i++) {
    const line = dataLines[i];
    const fields = line.split('\t');

    if (fields.length < 19) {
      throw new Error(`Invalid TSV row ${i + 2}: expected 19 columns`);
    }

    // Extract timeline name from first entry
    if (i === 0) {
      timelineName = unescapeTSVField(fields[0]);
    }

    entries.push({
      entryName: unescapeTSVField(fields[1]),
      Title: unescapeTSVField(fields[2]),
      Description: unescapeTSVField(fields[3]),
      MediaType: unescapeTSVField(fields[4]),
      mediaId: fields[5],
      coverImageFilename: unescapeTSVField(fields[6]),
      ChronologicalDate: unescapeTSVField(fields[7]),
      Position: parseInt(fields[8]) || 0,
      Notes: unescapeTSVField(fields[9]),
      EntryLabel: unescapeTSVField(fields[10]),
      Importance: unescapeTSVField(fields[11]),
      ChronologicalDescription: unescapeTSVField(fields[12]),
      Author: unescapeTSVField(fields[13]),
      Publisher: unescapeTSVField(fields[14]),
      ISBN: unescapeTSVField(fields[15]),
      PublicationYear: parseInt(fields[16]) || 0,
      Genre: stringToArray(unescapeTSVField(fields[17])),
      Tags: stringToArray(unescapeTSVField(fields[18])),
    });
  }

  return { timelineName, entries };
}

export async function prepareTimelineImport(zipFile: File, timelineId: number, parentPath: string) {
  const checkContext = captureOperationContext();
  const zip = await JSZip.loadAsync(zipFile);
  const tsv = zip.file('timeline_data.tsv');
  if (!tsv) throw new Error('timeline_data.tsv not found in ZIP');
  const { entries } = parseTSV(await tsv.async('string'));
  const existing = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);
  const byName = new Map<string | undefined, TimelineEntry>(existing.map((entry: TimelineEntry) => [entry.name,entry]));
  const names = new Set<string>();
  const operations: Operation[] = [];
  const plan: {entry: ParsedTimelineEntry; previous: TimelineEntry | undefined; media: {Id:number;Name:string;DisplayName:string}; cover:Blob | undefined}[] = [];
  for (const entry of entries) {
    if (!entry.entryName || entry.entryName.includes('/') || names.has(entry.entryName)) throw new Error('Ambiguous or invalid entry name in archive');
    names.add(entry.entryName);
    const mediaId = Number(entry.mediaId);
    if (!Number.isSafeInteger(mediaId) || mediaId < 1) throw new Error('Archive needs a valid existing local media reference');
    const media = await repository.load({ idOrPath: mediaId, oDataOptions: { select: ['Id','Name','Path','Title','DisplayName'] } });
    if (!media.d.Path?.startsWith(mediaLibraryPath + '/')) throw new Error('Archive media reference is outside this library');
    const previous = byName.get(entry.entryName);
    if (previous?.mediaItem && previous.mediaItem.Id !== mediaId) throw new Error('Archive reference conflicts with the existing occurrence');
    const entryTarget = previous?.id || parentPath;
    operations.push(previous ? { target: entryTarget, action: 'update' } : { target: parentPath, action: 'create', contentType: 'TimelineEntry' });
    let cover: Blob | undefined;
    if (entry.coverImageFilename) {
      const file = zip.file('covers/' + entry.coverImageFilename);
      if (!file) throw new Error('Cover file is missing from the archive');
      cover = await file.async('blob');
      operations.push({ target: mediaId, action: 'upload' });
    }
    plan.push({entry, previous, media:media.d, cover});
  }
  // Expose a review snapshot; execute retains its private complete target plan.
  // A caller changing the preview must not remove a later denied target.
  return { operations: operations.map(operation => ({ ...operation })), execute: async (): Promise<ImportResult> => {
    checkContext();
    await assertOperations(operations);
    const result: ImportResult = { entriesCreated:0, entriesUpdated:0, entriesSkipped:0, errors:[] };
    for (const {entry, previous, media, cover} of plan) {
      checkContext();
      const data: Omit<TimelineEntry,'id'> = { name:entry.entryName, displayName:entry.Title, timelineId,
        mediaItem:{ Id:media.Id, Name:media.Name, DisplayName:media.DisplayName }, position:entry.Position,
        chronologicalDate:entry.ChronologicalDate || undefined, chronologicalDescription:entry.ChronologicalDescription,
        notes:entry.Notes, entryLabel:entry.EntryLabel || undefined, importance:entry.Importance || undefined };
      if (cover) await uploadCoverImageBinary(media.Id, cover, entry.coverImageFilename);
      checkContext();
      if (previous) { await TimelineEntryService.updateTimelineEntry(previous.id, data); result.entriesUpdated++; }
      else { await TimelineEntryService.createTimelineEntry(data,parentPath); result.entriesCreated++; }
    }
    return result;
  } };
}
export async function importTimelineFromZip(zipFile: File, timelineId: number, parentPath: string, suppliedRepository: typeof repository): Promise<ImportResult> {
  if (suppliedRepository !== repository) throw new Error('Repository mismatch');
  return (await prepareTimelineImport(zipFile,timelineId,parentPath)).execute();
}
