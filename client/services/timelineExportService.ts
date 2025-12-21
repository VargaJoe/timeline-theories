import JSZip from 'jszip';
import { TimelineEntryService } from './timelineEntryService';
import type { TimelineEntry } from './timelineEntryService';

/**
 * Export result with metadata
 */
interface ExportResult {
  blob: Blob;
  filename: string;
  skippedImagesCount: number;
}

/**
 * Escapes special characters in TSV field values
 */
function escapeTSVField(value: string | undefined | null): string {
  if (!value) return '';
  return String(value)
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Converts array to comma-separated string
 */
function arrayToString(value: string | string[] | undefined | null): string {
  if (!value) return '';
  if (Array.isArray(value)) {
    return value.join(', ');
  }
  return String(value);
}

/**
 * Downloads a binary image using repository.fetch() with authentication
 */
async function downloadImage(
  repository: typeof import('./sensenet').repository,
  mediaResource: { media_src: string }
): Promise<Blob | null> {
  try {
    // Construct the full image URL - use simple concatenation like SenseNet does
    const repositoryUrl = repository.configuration.repositoryUrl.replace('/odata.svc', '');
    const imageUrl = `${repositoryUrl}${mediaResource.media_src}`;
    
    const response = await repository.fetch(imageUrl, {
      method: 'GET',
      credentials: 'include',
    });

    if (!response.ok) {
      console.warn(`[timelineExportService] Failed to download image: ${response.status} ${response.statusText}`);
      return null;
    }

    const blob = await response.blob();
    if (blob.size === 0) {
      console.warn(`[timelineExportService] Downloaded image is empty`);
      return null;
    }

    return blob;
  } catch (error) {
    console.warn(`[timelineExportService] Error downloading image:`, error);
    return null;
  }
}

/**
 * Builds TSV content from timeline entries
 * @param coverFilenames Map of entry index to cover filename in ZIP
 */
function buildTSV(entries: TimelineEntry[], timelineName: string, coverFilenames: Map<number, string>): string {
  // Define all 19 columns as per the TSV format specification
  const columns = [
    'timeline_name',
    'entry_name',
    'Title',
    'Description',
    'MediaType',
    'media_id',
    'cover_image',
    'ChronologicalDate',
    'Position',
    'Notes',
    'EntryLabel',
    'Importance',
    'ChronologicalDescription',
    'Author',
    'Publisher',
    'ISBN',
    'PublicationYear',
    'Genre',
    'Tags',
  ];

  // Header row
  const rows: string[] = [columns.join('\t')];

  // Data rows
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const media = entry.mediaItem;
    const coverFilename = coverFilenames.get(i) || '';
    
    const row = [
      escapeTSVField(timelineName),
      escapeTSVField(entry.name),
      escapeTSVField(media?.Title || entry.displayName),
      escapeTSVField(media?.Description),
      escapeTSVField(media?.MediaType),
      media?.Id ? String(media.Id) : '',
      coverFilename, // ZIP-beli fájlnév (cover_0.jpg, cover_1.jpg, stb.)
      escapeTSVField(entry.chronologicalDate),
      entry.position ? String(entry.position) : '',
      escapeTSVField(entry.notes),
      escapeTSVField(entry.entryLabel),
      escapeTSVField(entry.importance),
      escapeTSVField(entry.chronologicalDescription),
      escapeTSVField(media?.Author),
      escapeTSVField(media?.Publisher),
      escapeTSVField(media?.ISBN),
      media?.PublicationYear ? String(media.PublicationYear) : '',
      escapeTSVField(arrayToString(media?.Genre)),
      escapeTSVField(arrayToString(media?.Tags)),
    ];

    rows.push(row.join('\t'));
  }

  return rows.join('\n');
}

/**
 * Gets file extension from content type
 */
function getExtensionFromContentType(contentType: string): string {
  const mimeMap: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
  };
  return mimeMap[contentType.toLowerCase()] || 'jpg';
}

/**
 * Exports a timeline with its entries and cover images as a ZIP file
 * @param timelineId Timeline ID
 * @param timelineName Timeline name for the file
 * @param parentPath Parent path where timeline entries are stored
 * @param repository Repository instance with authentication
 * @returns Export result with blob, filename, and metadata
 */
export async function exportTimelineAsZip(
  timelineId: number,
  timelineName: string,
  parentPath: string,
  repository: typeof import('./sensenet').repository
): Promise<ExportResult> {
  try {
    // Fetch all timeline entries with expanded media items
    const entries = await TimelineEntryService.listTimelineEntries(timelineId, parentPath);

    // Create ZIP file
    const zip = new JSZip();

    // Download and add cover images first, track filenames
    const coversFolder = zip.folder('covers');
    if (!coversFolder) {
      throw new Error('Failed to create covers folder in ZIP');
    }

    const coverFilenames = new Map<number, string>();
    let skippedImagesCount = 0;
    let imageIndex = 0;

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const media = entry.mediaItem;
      
      // Check if media item has binary cover image
      if (media?.CoverImageBin?.__mediaresource?.media_src) {
        const blob = await downloadImage(repository, media.CoverImageBin.__mediaresource);
        
        if (blob) {
          // Get extension from blob type or default to jpg
          const extension = getExtensionFromContentType(blob.type || 'image/jpeg');
          const filename = `cover_${imageIndex}.${extension}`;
          coversFolder.file(filename, blob);
          coverFilenames.set(i, filename); // Track which entry has which cover file
          imageIndex++;
        } else {
          skippedImagesCount++;
        }
      }
    }

    // Build TSV content with cover filenames
    const tsvContent = buildTSV(entries, timelineName, coverFilenames);
    zip.file('timeline_data.tsv', tsvContent);

    // Generate ZIP blob
    const zipBlob = await zip.generateAsync({ type: 'blob' });

    // Create filename with timestamp
    const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const sanitizedName = timelineName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
    const filename = `timeline-${sanitizedName}-${timestamp}.zip`;

    return {
      blob: zipBlob,
      filename,
      skippedImagesCount,
    };
  } catch (error) {
    console.error('Error exporting timeline:', error);
    throw new Error(`Failed to export timeline: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}
