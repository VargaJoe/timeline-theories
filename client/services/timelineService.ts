import { TimelineEntryService } from './timelineEntryService';
import { MediaLibraryService } from './mediaLibraryService';

/**
 * Export a timeline and its entries to TSV format (Notepad++-friendly)
 * @param timeline Timeline object (with id, name, etc.)
 * @param parentPath Path to the timeline (for entries)
 * @returns TSV string with header and all entries
 */
export async function exportTimelineToTSV(timeline: Timeline, parentPath: string): Promise<string> {
  // Fetch all entries for the timeline
  const entries = await TimelineEntryService.listTimelineEntries(Number(timeline.id), parentPath);
  // Define columns according to the spec
  const columns = [
    'timeline_name',
    'entry_name',
    'title',
    'description',
    'media_type',
    'media_id',
    'cover_image',
    'date',
    'position',
    'notes',
    // Add more fields as needed
  ];
  // Header
  let tsv = columns.join('\t') + '\n';
  // Rows
  for (const entry of entries) {
    const media = entry.mediaItem;
    const row = [
      timeline.name || '',
      entry.name || '', // SenseNet Name field
      media?.Title || entry.displayName || '',
      media?.Description || entry.notes || '',
      media?.MediaType || '',
      media?.Id ? String(media.Id) : '',
      media?.CoverImageUrl || (media?.CoverImageBin && media.CoverImageBin.__mediaresource ? media.CoverImageBin.__mediaresource.media_src : ''),
      entry.chronologicalDate || '',
      entry.position || '',
      entry.notes || '',
      // Add more fields as needed
    ];
    tsv += row.map(v => (v ? String(v).replace(/\t|\n|\r/g, ' ') : '')).join('\t') + '\n';
  }
  return tsv;
}

/**
 * Import timeline entries from TSV format
 * @param tsvContent TSV string content
 * @param timelineName Name of the timeline
 */
export async function importTimelineFromTSV(tsvContent: string, timelineName: string): Promise<void> {
  const lines = tsvContent.split('\n').filter(line => line.trim());
  if (lines.length < 2) {
    throw new Error('Invalid TSV format: must have at least header and one data row');
  }

  const headers = lines[0].split('\t').map(h => h.trim());
  const requiredHeaders = ['title', 'media_type'];
  const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
  if (missingHeaders.length > 0) {
    throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
  }

  // Verify timeline exists
  const timelinePath = `${contentPaths.timelines}/Timelines/${timelineName}`;
  try {
    await repository.load({ idOrPath: timelinePath });
  } catch {
    throw new Error(`Timeline '${timelineName}' not found or inaccessible`);
  }

  const parentPath = `${timelinePath}`;

  // Process each data row
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split('\t').map(v => v.trim());
    if (values.length !== headers.length) {
      console.warn(`Skipping row ${i + 1}: column count mismatch`);
      continue;
    }

    const rowData: Record<string, string> = {};
    headers.forEach((header, index) => {
      rowData[header] = values[index] || '';
    });

    // Validate required fields
    if (!rowData.title || !rowData.media_type) {
      console.warn(`Skipping row ${i + 1}: missing required fields`);
      continue;
    }

    try {
      // Check if entry already exists by path
      let existingEntryPath: string | undefined;
      if (rowData.entry_name) {
        // Try to find existing entry by path
        try {
          const entryPath = `${parentPath}/${rowData.entry_name}`;
          await repository.load({
            idOrPath: entryPath,
          });
          existingEntryPath = entryPath;
        } catch {
          // Entry doesn't exist, will create new one
        }
      }

      // Create media item if needed
      let mediaItemId: number | undefined;
      if (rowData.media_id) {
        mediaItemId = parseInt(rowData.media_id);
      } else {
        // For now, create a basic media item
        // TODO: Enhance with more fields and better media item creation
        const mediaResult = await repository.post({
          parentPath: '/Root/Content/MediaLibrary',
          contentType: 'MediaItem',
          content: {
            Name: rowData.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
            DisplayName: rowData.title,
            Title: rowData.title,
            Description: rowData.description || '',
            MediaType: rowData.media_type,
            CoverImageUrl: rowData.cover_image || undefined,
          },
        });
        mediaItemId = mediaResult.d.Id;
      }

      // Generate unique name for the entry
      const generateEntryName = (baseName: string, index: number): string => {
        const cleanName = baseName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
        return `entry-${index}-${cleanName}`.substring(0, 50); // Limit length
      };

      const entryName = rowData.entry_name || generateEntryName(rowData.title, i);

      if (existingEntryPath) {
        // Update existing entry
        await repository.patch({
          idOrPath: existingEntryPath,
          content: {
            DisplayName: rowData.title,
            MediaItem: mediaItemId,
            Position: rowData.position ? parseInt(rowData.position) : i,
            ChronologicalDate: rowData.date || undefined,
            Notes: rowData.description || rowData.notes || undefined,
          },
        });
      } else {
        // Create new timeline entry
        await repository.post({
          parentPath,
          contentType: 'TimelineEntry',
          content: {
            Name: entryName,
            DisplayName: rowData.title,
            MediaItem: mediaItemId,
            Position: rowData.position ? parseInt(rowData.position) : i,
            ChronologicalDate: rowData.date || undefined,
            Notes: rowData.notes || undefined,
          },
        });
      }
    } catch (error) {
      console.error(`Failed to import row ${i + 1}:`, error);
      throw new Error(`Failed to import row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Import timeline entries from ZIP file containing TSV data and cover images
 * @param zipFile ZIP file to import
 * @param timelineName Name of the timeline to import into
 */
export async function importTimelineFromZIP(zipFile: File, timelineName: string): Promise<void> {
  try {
    // Dynamically import JSZip only when needed
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    // Load the ZIP file
    await zip.loadAsync(zipFile);
    
    // Read the TSV data
    const tsvFile = zip.file('data.tsv');
    if (!tsvFile) {
      throw new Error('ZIP file does not contain data.tsv');
    }
    
    const tsvContent = await tsvFile.async('text');
    
    // Parse TSV
    const lines = tsvContent.split('\n').filter(line => line.trim());
    if (lines.length < 2) {
      throw new Error('Invalid TSV format: must have at least header and one data row');
    }
    
    const headers = lines[0].split('\t').map(h => h.trim());
    const requiredHeaders = ['title', 'media_type'];
    const missingHeaders = requiredHeaders.filter(h => !headers.includes(h));
    if (missingHeaders.length > 0) {
      throw new Error(`Missing required columns: ${missingHeaders.join(', ')}`);
    }
    
    // Verify timeline exists
    const timelinePath = `${contentPaths.timelines}/Timelines/${timelineName}`;
    try {
      await repository.load({ idOrPath: timelinePath });
    } catch {
      throw new Error(`Timeline '${timelineName}' not found or inaccessible`);
    }
    
    const parentPath = `${timelinePath}`;
    
    // Process each data row
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split('\t').map(v => v.trim());
      if (values.length !== headers.length) {
        console.warn(`Skipping row ${i + 1}: column count mismatch`);
        continue;
      }
      
      const rowData: Record<string, string> = {};
      headers.forEach((header, index) => {
        rowData[header] = values[index] || '';
      });
      
      // Validate required fields
      if (!rowData.title || !rowData.media_type) {
        console.warn(`Skipping row ${i + 1}: missing required fields`);
        continue;
      }
      
      try {
        // Check if entry already exists by path
        let existingEntryPath: string | undefined;
        if (rowData.entry_name) {
          try {
            const entryPath = `${parentPath}/${rowData.entry_name}`;
            await repository.load({ idOrPath: entryPath });
            existingEntryPath = entryPath;
          } catch {
            // Entry doesn't exist, will create new one
          }
        }
        
        // Create or find media item
        let mediaItemId: number | undefined;
        
        if (rowData.media_id) {
          mediaItemId = parseInt(rowData.media_id);
        } else {
          // Create a new media item
          const mediaContent: Record<string, unknown> = {
            Name: rowData.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
            DisplayName: rowData.title,
            Title: rowData.title,
            Description: rowData.description || '',
            MediaType: rowData.media_type,
          };
          
          // Add optional media fields
          if (rowData.author) mediaContent.Author = rowData.author;
          if (rowData.publisher) mediaContent.Publisher = rowData.publisher;
          if (rowData.isbn) mediaContent.ISBN = rowData.isbn;
          if (rowData.publication_year) mediaContent.PublicationYear = parseInt(rowData.publication_year);
          if (rowData.genre) mediaContent.Genre = rowData.genre.split(';').map(g => g.trim());
          if (rowData.tags) mediaContent.Tags = rowData.tags.split(';').map(t => t.trim());
          
          // Add cover image URL if available
          if (rowData.cover_image_url) {
            mediaContent.CoverImageUrl = rowData.cover_image_url;
          }
          
          const mediaResult = await repository.post({
            parentPath: '/Root/Content/MediaLibrary',
            contentType: 'MediaItem',
            content: mediaContent,
          });
          
          mediaItemId = mediaResult.d.Id;
        }
        
        // Generate unique name for the entry
        const generateEntryName = (baseName: string, index: number): string => {
          const cleanName = baseName.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
          return `entry-${index}-${cleanName}`.substring(0, 50);
        };
        
        const entryName = rowData.entry_name || generateEntryName(rowData.title, i);
        
        if (existingEntryPath) {
          // Update existing entry
          const updateContent: Record<string, unknown> = {
            DisplayName: rowData.title,
            MediaItem: mediaItemId,
            Position: rowData.position ? parseInt(rowData.position) : i,
            ChronologicalDate: rowData.date || undefined,
            Notes: rowData.notes || undefined,
          };
          
          // Add optional entry fields
          if (rowData.entry_label) updateContent.EntryLabel = rowData.entry_label;
          if (rowData.importance) updateContent.Importance = rowData.importance;
          if (rowData.chronological_description) updateContent.ChronologicalDescription = rowData.chronological_description;
          
          await repository.patch({
            idOrPath: existingEntryPath,
            content: updateContent,
          });
        } else {
          // Create new timeline entry
          const entryContent: Record<string, unknown> = {
            Name: entryName,
            DisplayName: rowData.title,
            MediaItem: mediaItemId,
            Position: rowData.position ? parseInt(rowData.position) : i,
            ChronologicalDate: rowData.date || undefined,
            Notes: rowData.notes || undefined,
          };
          
          // Add optional entry fields
          if (rowData.entry_label) entryContent.EntryLabel = rowData.entry_label;
          if (rowData.importance) entryContent.Importance = rowData.importance;
          if (rowData.chronological_description) entryContent.ChronologicalDescription = rowData.chronological_description;
          
          await repository.post({
            parentPath,
            contentType: 'TimelineEntry',
            content: entryContent,
          });
        }
      } catch (error) {
        console.error(`Failed to import row ${i + 1}:`, error);
        throw new Error(`Failed to import row ${i + 1}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.error('Failed to import timeline from ZIP:', error);
    throw new Error(`Failed to import timeline: ${error instanceof Error ? error.message : String(error)}`);
  }
}
/**
 * Deletes a timeline by path segment (Name) or Id
 * @param idOrPath Timeline Id (number) or path segment (string)
 * @param permanent If true, permanently deletes; otherwise moves to Trash
 */
export async function deleteTimeline(idOrPath: string | number, permanent = false): Promise<void> {
  try {
    let resolvedIdOrPath = idOrPath;
    if (typeof idOrPath === 'string' && !idOrPath.startsWith('/') && isNaN(Number(idOrPath))) {
      // Assume it's a timeline name, resolve to full path
      resolvedIdOrPath = `${timelinesPath}/${idOrPath}`;
    }
    await repository.delete({
      idOrPath: resolvedIdOrPath,
      permanent,
    });
  } catch (error) {
    console.error('Failed to delete timeline:', error);
    throw new Error('Failed to delete timeline. Please check your connection and try again.');
  }
}
import { repository } from './sensenet';
import { timelinesPath } from '../projectPaths';
import { TIMELINE_CONTENT_TYPE } from '../contentTypes';
import { repositoryUrl, contentPaths } from '../configuration';

// Timeline service for frontend API calls
export interface Timeline {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  sort_order?: string;
  created_at?: string;
  coverImageUrl?: string;
  isVisible?: boolean;
  timelineType?: string;
}

export async function createTimeline(data: { name: string; displayName?: string; description?: string; sortOrder?: string; timelineType?: string }): Promise<Timeline> {
  try {
    // Create a Timeline content under the configured path
    const result = await repository.post({
      parentPath: timelinesPath,
      contentType: TIMELINE_CONTENT_TYPE,
      oDataOptions: {
        select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'IsVisible', 'TimelineType'],
      },
      content: {
        Name: data.name,
        DisplayName: data.displayName || data.name,
        Description: data.description || '',
        SortOrder: data.sortOrder || 'chronological',
        TimelineType: data.timelineType || 'chronological',
      },
    });
    
    return {
      id: String(result.d.Id),
      name: result.d.Name || data.name, // Use the path segment, not DisplayName
      displayName: result.d.DisplayName || data.displayName || data.name,
      description: result.d.Description || data.description,
      sort_order: result.d.SortOrder || data.sortOrder,
      created_at: result.d.CreationDate,
      isVisible: typeof result.d.IsVisible === 'boolean' ? result.d.IsVisible : false,
      timelineType: result.d.TimelineType || data.timelineType || 'chronological',
    };
  } catch (error) {
    console.error('Failed to create timeline:', error);
    throw new Error('Failed to create timeline. Please check your connection and try again.');
  }
}

export async function getTimelines(includePrivate = false, characterFilter?: string, skip?: number, top?: number, sortOrder?: 'alphabetical' | 'created_desc'): Promise<Timeline[]> {
  try {
    // Build query based on whether to include private timelines
    let query = `+TypeIs:${TIMELINE_CONTENT_TYPE} +Hidden:0`;
    if (!includePrivate) {
      query += ` +IsVisible:true`;
    }

    // Add character filter if specified
    if (characterFilter && characterFilter.trim() !== '') {
      if (characterFilter === '#') {
        // For non-alphabetic characters, use regex to match anything that doesn't start with a letter
        query += ` +DisplayName:<'a'`;
      } else {
        // For alphabetic characters, use wildcard search
        query += ` +DisplayName:'${characterFilter.toLowerCase()}*'`;
      }
    }

    // Determine orderby based on sortOrder
    let orderby: string[];
    if (sortOrder === 'created_desc') {
      orderby = ['CreationDate desc'];
    } else {
      // Default to alphabetical for all cases
      orderby = ['DisplayName'];
    }

    // Build oData options
    const oDataOptions: any = {
      query: query,
      select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CoverImageUrl', 'IsVisible', 'TimelineType'],
      orderby: orderby,
    };

    // Add pagination for all views to limit initial load and enable load more functionality
    if (skip !== undefined && skip > 0) {
      oDataOptions.skip = skip;
    }
    if (top !== undefined && top > 0) {
      oDataOptions.top = top;
    }

    // List Timeline contents under the configured path
    const result = await repository.loadCollection({
      path: timelinesPath,
      oDataOptions: oDataOptions,
    });
    
    return result.d.results.map((item: { 
      Id: number; 
      Name: string;
      DisplayName: string; 
      Description?: string; 
      SortOrder?: string | string[];
      CreationDate: string;
      CoverImageUrl?: string;
      IsVisible?: boolean;
      TimelineType?: string;
    }) => {
      // Handle SortOrder as array or string, use first element if array, else default to 'chronological'
      let sortOrder = 'chronological';
      if (Array.isArray(item.SortOrder) && item.SortOrder.length > 0) {
        sortOrder = item.SortOrder[0];
      } else if (typeof item.SortOrder === 'string') {
        sortOrder = item.SortOrder;
      }
      
      return {
        id: String(item.Id),
        name: item.Name, 
        displayName: item.DisplayName,
        description: item.Description || '',
        sort_order: sortOrder,
        created_at: item.CreationDate,
        coverImageUrl: item.CoverImageUrl,
        isVisible: typeof item.IsVisible === 'boolean' ? item.IsVisible : false,
        timelineType: item.TimelineType || 'chronological',
      };
    });
  } catch (error) {
    console.error('Failed to load timelines:', error);
    throw new Error('Failed to load timelines. Please check your connection and try again.');
  }
}

/**
 * Get media cover images for a timeline to display in card montage
 * @param timelinePath Timeline path for fetching entries
 * @param limit Maximum number of covers to return (default: 4)
 */
export async function getTimelineMediaCovers(timelinePath: string, limit = 4): Promise<string[]> {
  try {
    // Fetch timeline entries with expanded MediaItem references
    const result = await repository.loadCollection({
      path: timelinePath,
      oDataOptions: {
        query: `+TypeIs:TimelineEntry +Hidden:0`,
        select: ['MediaItem/CoverImageUrl', 'MediaItem/CoverImageBin'], //'MediaItem', 
        expand: ['MediaItem'],
        orderby: ['Position'],
        top: 50, // Get more entries to have a good pool for random selection
      },
    });

    // Collect all available cover URLs
    const allCoverUrls: string[] = [];
    for (const item of result.d.results) {
      const mediaItem = item.MediaItem;
      if (mediaItem) {
        // Use the helper function to get cover URL (either from URL or binary field)
        const coverUrl = MediaLibraryService.getCoverImageUrl(mediaItem);
        if (coverUrl) {
          allCoverUrls.push(coverUrl);
        }
      }
    }

    // If we have fewer covers than requested, return all
    if (allCoverUrls.length <= limit) {
      return allCoverUrls;
    }

    // Randomly select covers from the available pool
    const selectedCovers: string[] = [];
    const availableCovers = [...allCoverUrls]; // Create a copy to avoid modifying original
    
    for (let i = 0; i < limit && availableCovers.length > 0; i++) {
      const randomIndex = Math.floor(Math.random() * availableCovers.length);
      selectedCovers.push(availableCovers[randomIndex]);
      availableCovers.splice(randomIndex, 1); // Remove selected cover to avoid duplicates
    }

    return selectedCovers;
  } catch (error) {
    console.error('Failed to load timeline media covers:', error);
    return [];
  }
}



/**
 * Download an image blob from binaryhandler URL
 * Uses XMLHttpRequest WITHOUT Authorization header to avoid CORS preflight
 * Relies on session cookies for authentication
 * @param imageUrl SenseNet binaryhandler URL
 * @returns Blob or null if download fails
 */
async function downloadImageBlob(imageUrl: string): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      if (!imageUrl) {
        resolve(null);
        return;
      }
      
      // If it's a relative SenseNet path, prepend repository URL
      const fullUrl = imageUrl.startsWith('http') ? imageUrl : `${repositoryUrl}${imageUrl}`;
      
      console.log('Downloading image from:', fullUrl);
      
      // Use XMLHttpRequest WITHOUT Authorization header
      // This avoids CORS preflight and relies on cookie-based session auth
      const xhr = new XMLHttpRequest();
      xhr.open('GET', fullUrl, true);
      xhr.responseType = 'blob';
      xhr.withCredentials = true; // Send cookies for session authentication
      
      // DO NOT add Authorization header - it triggers CORS preflight!
      // The session cookie should be enough
      
      xhr.onload = function() {
        if (xhr.status === 200) {
          console.log('Successfully downloaded image blob:', xhr.response.type, xhr.response.size);
          resolve(xhr.response as Blob);
        } else {
          console.warn('Failed to download image:', xhr.status, xhr.statusText);
          resolve(null);
        }
      };
      
      xhr.onerror = function() {
        console.warn('XHR error downloading image');
        resolve(null);
      };
      
      xhr.send();
    } catch (error) {
      console.warn('Failed to download image blob:', error);
      resolve(null);
    }
  });
}

/**
 * Export timeline with entries to ZIP file containing TSV data and cover images
 * @param timeline Timeline object
 * @param parentPath Path to the timeline
 * @returns ZIP file as Blob
 */
export async function exportTimelineToZIP(
  timeline: Timeline,
  parentPath: string
): Promise<Blob> {
  try {
    // Dynamically import JSZip only when needed
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    
    // First, create the TSV data
    const entries = await TimelineEntryService.listTimelineEntries(Number(timeline.id), parentPath);
    const columns = [
      'timeline_name',
      'entry_name',
      'title',
      'description',
      'media_type',
      'media_id',
      'cover_image',
      'date',
      'position',
      'notes',
      'entry_label',
      'importance',
      'chronological_description',
      'author',
      'publisher',
      'isbn',
      'publication_year',
      'genre',
      'tags',
    ];
    
    let tsv = columns.join('\t') + '\n';
    const coversFolder = zip.folder('covers');
    if (!coversFolder) {
      throw new Error('Failed to create covers folder in ZIP');
    }
    
    let coverIndex = 0;
    
    // Process each entry
    for (const entry of entries) {
      const media = entry.mediaItem;
      let coverImageFilename = '';
      
      // Download cover image if available
      if (media?.CoverImageUrl || (media?.CoverImageBin && media.CoverImageBin.__mediaresource)) {
        try {
          const coverUrl = media.CoverImageUrl || 
            (media.CoverImageBin && media.CoverImageBin.__mediaresource ? `${repositoryUrl}${media.CoverImageBin.__mediaresource.media_src}` : null);
          
          if (coverUrl) {
            console.log(`Downloading cover image for ${media.Title || entry.displayName}`);
            const blob = await downloadImageBlob(coverUrl);
            if (blob) {
              // Determine file extension from MIME type or use jpg as default
              const ext = blob.type.includes('png') ? 'png' : 'jpg';
              coverImageFilename = `cover_${coverIndex}.${ext}`;
              coversFolder.file(coverImageFilename, blob);
              console.log(`Added cover image: ${coverImageFilename}`);
              coverIndex++;
            }
          }
        } catch (error) {
          console.warn('Failed to download cover image for entry:', entry.name, error);
        }
      }
      
      const row = [
        timeline.name || '',
        entry.name || '',
        media?.Title || entry.displayName || '',
        media?.Description || '',
        media?.MediaType || '',
        media?.Id ? String(media.Id) : '',
        coverImageFilename, // Use the filename instead of URL
        entry.chronologicalDate || '',
        entry.position || '',
        entry.notes || '',
        entry.entryLabel || '',
        entry.importance || '',
        entry.chronologicalDescription || '',
        media?.Author || '',
        media?.Publisher || '',
        media?.ISBN || '',
        media?.PublicationYear || '',
        media?.Genre ? (Array.isArray(media.Genre) ? media.Genre.join(';') : media.Genre) : '',
        media?.Tags ? (Array.isArray(media.Tags) ? media.Tags.join(';') : media.Tags) : '',
      ];
      
      tsv += row.map(v => (v ? String(v).replace(/\t|\n|\r/g, ' ') : '')).join('\t') + '\n';
    }
    
    // Add TSV to ZIP
    zip.file('data.tsv', tsv);
    
    // Generate the ZIP blob
    const zipBlob = await zip.generateAsync({ type: 'blob' });
    console.log('Generated ZIP file:', zipBlob.size, 'bytes');
    return zipBlob;
  } catch (error) {
    console.error('Failed to export timeline to ZIP:', error);
    throw new Error(`Failed to export timeline: ${error instanceof Error ? error.message : String(error)}`);
  }
}
