import JSZip from 'jszip';
import { TimelineEntryService, type TimelineEntry } from './timelineEntryService';
import { uploadCoverImageBinary } from './mediaLibraryService';

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
      console.warn(`[timelineImportService] Skipping line ${i + 2}: insufficient columns (${fields.length}/19)`);
      continue;
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

/**
 * Imports timeline from ZIP file
 * @param zipFile ZIP file containing timeline_data.tsv and covers folder
 * @param timelineId Timeline ID to import into
 * @param parentPath Parent path where timeline entries will be created
 * @param repository Repository instance with authentication
 * @returns Import result with statistics
 */
export async function importTimelineFromZip(
  zipFile: File,
  timelineId: number,
  parentPath: string,
  _repository: typeof import('./sensenet').repository
): Promise<ImportResult> {
  const result: ImportResult = {
    entriesCreated: 0,
    entriesUpdated: 0,
    entriesSkipped: 0,
    errors: [],
  };

  try {
    // Load ZIP file
    const zip = await JSZip.loadAsync(zipFile);

    // Read TSV content
    const tsvFile = zip.file('timeline_data.tsv');
    if (!tsvFile) {
      throw new Error('timeline_data.tsv not found in ZIP file');
    }

    const tsvContent = await tsvFile.async('string');
    const { timelineName, entries } = parseTSV(tsvContent);

    console.log(`[timelineImportService] Importing ${entries.length} entries into timeline: ${timelineName}`);

    // Get existing entries - map by name for quick lookup
    const existingEntries = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);
    const existingEntriesMap = new Map(existingEntries.map(e => [e.name, e]));

    // Process each entry
    for (const entry of entries) {
      try {
        const existingEntry = existingEntriesMap.get(entry.entryName);

        // Prepare entry data, excluding empty choice fields
        const entryData: Omit<TimelineEntry, 'id'> = {
          name: entry.entryName,
          displayName: entry.Title,
          chronologicalDate: entry.ChronologicalDate,
          position: entry.Position,
          notes: entry.Notes,
          chronologicalDescription: entry.ChronologicalDescription,
          timelineId,
          mediaItem: null, // Will be set if we have a media ID
        };

        // Set MediaItem reference if we have a media ID
        if (entry.mediaId && entry.mediaId.trim() !== '') {
          const mediaIdNum = parseInt(entry.mediaId);
          if (!isNaN(mediaIdNum)) {
            entryData.mediaItem = {
              Id: mediaIdNum,
              Name: entry.entryName, // Fallback to entry name
              DisplayName: entry.Title,
            };
          }
        }

        // Add choice fields only if they have valid values
        if (entry.EntryLabel && entry.EntryLabel.trim() !== '') {
          entryData.entryLabel = entry.EntryLabel;
        }
        if (entry.Importance && entry.Importance.trim() !== '') {
          entryData.importance = entry.Importance;
        }

        if (existingEntry) {
          // Update existing entry using path-based addressing (security: no ID)
          console.log(`[timelineImportService] Updating existing entry: ${entry.entryName}`);
          
          const entryPath = `${parentPath}/${entry.entryName}`;
          await TimelineEntryService.updateTimelineEntry(entryPath, {
            name: entry.entryName,
            displayName: entry.Title,
            chronologicalDate: entry.ChronologicalDate,
            position: entry.Position,
            notes: entry.Notes,
            chronologicalDescription: entry.ChronologicalDescription,
            entryLabel: entryData.entryLabel,
            importance: entryData.importance,
          });

          result.entriesUpdated++;

          // Upload cover image if available
          if (entry.coverImageFilename && entryData.mediaItem) {
            console.log(`[timelineImportService] Attempting to upload cover: ${entry.coverImageFilename} for media ${entryData.mediaItem.Id}`);
            const coverFile = zip.file(`covers/${entry.coverImageFilename}`);
            if (coverFile) {
              const imageBlob = await coverFile.async('blob');
              try {
                await uploadCoverImageBinary(entryData.mediaItem.Id, imageBlob, entry.coverImageFilename);
                console.log(`[timelineImportService] Successfully uploaded cover for ${entry.entryName}`);
              } catch (error) {
                console.warn(`[timelineImportService] Failed to upload cover:`, error);
              }
            } else {
              console.warn(`[timelineImportService] Cover file not found in ZIP: covers/${entry.coverImageFilename}`);
            }
          } else {
            if (!entry.coverImageFilename) {
              console.log(`[timelineImportService] No cover filename for entry: ${entry.entryName}`);
            }
            if (!entryData.mediaItem) {
              console.log(`[timelineImportService] No media item for entry: ${entry.entryName}`);
            }
          }
        } else {
          // Create new timeline entry
          console.log(`[timelineImportService] Creating new entry: ${entry.entryName}`);
          
          await TimelineEntryService.createTimelineEntry(
            entryData,
            parentPath
          );

          // Upload cover image if available - use the actual media item ID from the created entry
          if (entry.coverImageFilename && entryData.mediaItem) {
            console.log(`[timelineImportService] Attempting to upload cover: ${entry.coverImageFilename} for media ${entryData.mediaItem.Id}`);
            const coverFile = zip.file(`covers/${entry.coverImageFilename}`);
            if (coverFile) {
              const imageBlob = await coverFile.async('blob');
              try {
                await uploadCoverImageBinary(entryData.mediaItem.Id, imageBlob, entry.coverImageFilename);
                console.log(`[timelineImportService] Successfully uploaded cover for ${entry.entryName}`);
              } catch (error) {
                console.warn(`[timelineImportService] Failed to upload cover:`, error);
              }
            } else {
              console.warn(`[timelineImportService] Cover file not found in ZIP: covers/${entry.coverImageFilename}`);
            }
          } else {
            if (!entry.coverImageFilename) {
              console.log(`[timelineImportService] No cover filename for entry: ${entry.entryName}`);
            }
            if (!entryData.mediaItem) {
              console.log(`[timelineImportService] No media item for entry: ${entry.entryName}`);
            }
          }

          result.entriesCreated++;
        }
      } catch (error) {
        console.error(`[timelineImportService] Failed to process entry: ${entry.entryName}`, error);
        result.entriesSkipped++;
        result.errors.push(
          `Failed to process entry "${entry.entryName}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    console.log(`[timelineImportService] Import complete. Created: ${result.entriesCreated}, Updated: ${result.entriesUpdated}, Skipped: ${result.entriesSkipped}`);
    return result;
  } catch (error) {
    console.error('[timelineImportService] Import failed:', error);
    throw new Error(`Failed to import timeline: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
