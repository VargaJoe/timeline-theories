import JSZip from 'jszip';
import { TimelineEntryService, type TimelineEntry } from './timelineEntryService';

/**
 * Parsed timeline entry from TSV
 */
interface ParsedTimelineEntry {
  entryName: string;
  title: string;
  description: string;
  mediaType: string;
  mediaId: string;
  coverImageFilename: string;
  date: string;
  position: number;
  notes: string;
  entryLabel: string;
  importance: string;
  chronologicalDescription: string;
  author: string;
  publisher: string;
  isbn: string;
  publicationYear: number;
  genre: string[];
  tags: string[];
}

/**
 * Import result with statistics
 */
interface ImportResult {
  entriesCreated: number;
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
      title: unescapeTSVField(fields[2]),
      description: unescapeTSVField(fields[3]),
      mediaType: unescapeTSVField(fields[4]),
      mediaId: fields[5],
      coverImageFilename: unescapeTSVField(fields[6]),
      date: unescapeTSVField(fields[7]),
      position: parseInt(fields[8]) || 0,
      notes: unescapeTSVField(fields[9]),
      entryLabel: unescapeTSVField(fields[10]),
      importance: unescapeTSVField(fields[11]),
      chronologicalDescription: unescapeTSVField(fields[12]),
      author: unescapeTSVField(fields[13]),
      publisher: unescapeTSVField(fields[14]),
      isbn: unescapeTSVField(fields[15]),
      publicationYear: parseInt(fields[16]) || 0,
      genre: stringToArray(unescapeTSVField(fields[17])),
      tags: stringToArray(unescapeTSVField(fields[18])),
    });
  }

  return { timelineName, entries };
}

/**
 * Uploads cover image to media item
 */
async function uploadCoverImage(
  repository: typeof import('./sensenet').repository,
  mediaItemPath: string,
  imageBlob: Blob,
  filename: string
): Promise<boolean> {
  try {
    // Use repository upload for binary field
    const formData = new FormData();
    formData.append('CoverImageBin', imageBlob, filename);

    const response = await repository.fetch(
      `${repository.configuration.repositoryUrl}${mediaItemPath}`,
      {
        method: 'PATCH',
        body: formData,
        credentials: 'include',
      }
    );

    if (!response.ok) {
      console.warn(`[timelineImportService] Failed to upload cover image: ${response.status}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn(`[timelineImportService] Error uploading cover image:`, error);
    return false;
  }
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
  repository: typeof import('./sensenet').repository
): Promise<ImportResult> {
  const result: ImportResult = {
    entriesCreated: 0,
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

    // Get existing entries to avoid duplicates
    const existingEntries = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);
    const existingNames = new Set(existingEntries.map(e => e.name));

    // Process each entry
    for (const entry of entries) {
      try {
        // Skip if entry already exists
        if (existingNames.has(entry.entryName)) {
          console.log(`[timelineImportService] Skipping duplicate entry: ${entry.entryName}`);
          result.entriesSkipped++;
          continue;
        }

        // Prepare entry data, excluding empty choice fields
        const entryData: Omit<TimelineEntry, 'id'> = {
          name: entry.entryName,
          displayName: entry.title,
          chronologicalDate: entry.date,
          position: entry.position,
          notes: entry.notes,
          chronologicalDescription: entry.chronologicalDescription,
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
              DisplayName: entry.title,
            };
          }
        }

        // Add choice fields only if they have valid values
        if (entry.entryLabel && entry.entryLabel.trim() !== '') {
          entryData.entryLabel = entry.entryLabel;
        }
        if (entry.importance && entry.importance.trim() !== '') {
          entryData.importance = entry.importance;
        }
        
        // Create timeline entry
        const createdEntry = await TimelineEntryService.createTimelineEntry(
          entryData,
          parentPath
        );

        // Upload cover image if available - use the actual media item ID from the created entry
        if (entry.coverImageFilename && entryData.mediaItem) {
          const coverFile = zip.file(`covers/${entry.coverImageFilename}`);
          if (coverFile) {
            const imageBlob = await coverFile.async('blob');
            const mediaPath = `/Root/Content/MediaLibrary/${entryData.mediaItem.Id}`;
            await uploadCoverImage(
              repository,
              mediaPath,
              imageBlob,
              entry.coverImageFilename
            );
          }
        }

        result.entriesCreated++;
      } catch (error) {
        console.error(`[timelineImportService] Failed to create entry: ${entry.entryName}`, error);
        result.entriesSkipped++;
        result.errors.push(
          `Failed to create entry "${entry.entryName}": ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    console.log(`[timelineImportService] Import complete. Created: ${result.entriesCreated}, Skipped: ${result.entriesSkipped}`);
    return result;
  } catch (error) {
    console.error('[timelineImportService] Import failed:', error);
    throw new Error(`Failed to import timeline: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
