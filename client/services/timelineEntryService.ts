import { repository, assertOperations, captureOperationContext } from './sensenet';
import { mediaLibraryPath } from '../projectPaths';
import { TIMELINE_ENTRY_CONTENT_TYPE } from '../contentTypes';
import { singleChoice } from './contentValues';

// Minimal MediaItem reference type for expanded reference
export interface MediaItemRef {
  Name: string;
  Id: number;
  DisplayName?: string;
  Title?: string;
  Subtitle?: string;
  MediaType?: string;
  CoverImageUrl?: string;
  ReleaseDate?: string;
  Description?: string;
  Author?: string;
  Publisher?: string;
  ISBN?: string;
  PublicationYear?: number;
  Genre?: string | string[];
  Tags?: string | string[];
  CoverImageBin?: {
    __mediaresource?: {
      media_src: string;
    };
  };
}

export interface TimelineEntry {
  id: string;
  name?: string;
  displayName: string;
  mediaItem: MediaItemRef | null;
  timelineId: number;
  position: number;
  chronologicalDate?: string;
  chronologicalDescription?: string;
  releaseOrderPosition?: number;
  notes?: string;
  entryLabel?: string;
  isOptional?: boolean;
  arcGroup?: string;
  importance?: string;
  createdBy?: string;
}

// Service methods for TimelineEntry CRUD
export class TimelineEntryService {
  // Delete a timeline entry by id
  static async deleteTimelineEntry(entryId: string | number): Promise<void> {
    try {
      await repository.delete({ idOrPath: entryId });
    } catch (error) {
      console.error('Failed to delete timeline entry:', error);
      throw new Error('Failed to delete timeline entry.');
    }
  }
  // List all entries for a given timeline
  static async listTimelineEntries(timelineId: number, parentPath: string, sortBy?: 'position' | 'publication-date' | 'chronological-date'): Promise<TimelineEntry[]> {
    const results = [];
    const checkContext = captureOperationContext();
    for (let skip = 0; ; skip += 100) {
      checkContext();
      const result = await repository.loadCollection({
        path: parentPath,
        oDataOptions: {
          query: `+TypeIs:TimelineEntry +Hidden:0`,
          select: [
            'Id',
            'Name',
            'DisplayName',
            // 'MediaItem',
            'MediaItem/Id',
            'MediaItem/Name',
            'MediaItem/DisplayName',
            'MediaItem/Title',
            'MediaItem/Subtitle',
            'MediaItem/MediaType',
            'MediaItem/CoverImageUrl',
            'MediaItem/CoverImageBin',
            'Position',
            'ChronologicalDate',
            'ChronologicalDescription',
            'ReleaseOrderPosition',
            'Notes',
            'EntryLabel',
            'IsOptional',
            'ArcGroup',
            'Importance',
            'CreatedBy',
          ],
          expand: ['MediaItem'], // Expand the MediaItem reference
          orderby: sortBy === 'publication-date' ? ['MediaItem/PublicationYear','Id'] : sortBy === 'chronological-date' ? ['ChronologicalDate','Id'] : ['Position','Id'],
          top: 100, skip,
        },
      });
      results.push(...result.d.results);
      if (result.d.results.length < 100) break;
    }
    checkContext();
    return results.map((item: Record<string, unknown>) => {
      const media = (Array.isArray(item.MediaItem) ? item.MediaItem[0] : item.MediaItem) as (Omit<MediaItemRef, 'MediaType'> & { MediaType?: string | string[] }) | undefined;
      return {        id: String(item.Id),
        name: item.Name as string,
        displayName: item.DisplayName as string,
        mediaItem: media ? { ...media, MediaType: singleChoice(media.MediaType) } : null,
        timelineId,
        position: Number(item.Position),
        chronologicalDate: item.ChronologicalDate as string | undefined,
        chronologicalDescription: item.ChronologicalDescription as string | undefined,
        releaseOrderPosition: item.ReleaseOrderPosition as number | undefined,
        notes: item.Notes as string | undefined,
        entryLabel: singleChoice(item.EntryLabel as string | string[] | undefined),
        isOptional: item.IsOptional as boolean | undefined,
        arcGroup: item.ArcGroup as string | undefined,
        importance: singleChoice(item.Importance as string | string[] | undefined),
        createdBy: item.CreatedBy as string | undefined,
      };
    });
  }

  // Get a single timeline entry by id
  /**
   * Create a TimelineEntry under the given timeline path
   * @param data TimelineEntry data (excluding id)
   * @param parentPath Path of the parent timeline (required)
   */
  static async createTimelineEntry(data: Omit<TimelineEntry, 'id'>, parentPath: string): Promise<TimelineEntry & { mediaItemPath?: string }> {
    const checkContext = captureOperationContext();
    await assertOperations([{ target: parentPath, action: 'create', contentType: TIMELINE_ENTRY_CONTENT_TYPE }]);
    if (!data.mediaItem?.Id) throw new Error('An entry needs a local media reference');
    const media = await repository.load({ idOrPath: data.mediaItem.Id, oDataOptions: { select: ['Path'] } });
    if (!media.d.Path?.startsWith(mediaLibraryPath + '/')) throw new Error('Media reference is outside the project library');
    checkContext();
    const result = await repository.post({
      parentPath,
      contentType: TIMELINE_ENTRY_CONTENT_TYPE,
      content: {
        Name: data.name || 'entry-' + crypto.randomUUID(),
        DisplayName: data.displayName || data.mediaItem?.DisplayName || 'Unnamed Entry',
        MediaItem: data.mediaItem?.Id, // Reference field (id)
        Position: data.position,
        ChronologicalDate: data.chronologicalDate,
        ChronologicalDescription: data.chronologicalDescription,
        ReleaseOrderPosition: data.releaseOrderPosition,
        Notes: data.notes,
        EntryLabel: data.entryLabel,
        IsOptional: data.isOptional ?? false,
        ArcGroup: data.arcGroup,
        Importance: data.importance,
        CreatedBy: data.createdBy,
      },
    });
    
    // Return the created entry with path for media item
    const mediaItemPath = media.d.Path;
    
    return {
      id: String(result.d.Id),
      ...data,
      mediaItemPath,
    };
  }

  // Update a timeline entry
  static async updateTimelineEntry(entryId: string | number, updates: Partial<Omit<TimelineEntry, 'id' | 'mediaItem' | 'timelineId'>>): Promise<void> {
    try {
      await repository.patch({
        idOrPath: entryId,
        content: {
          Name: updates.name,
          DisplayName: updates.displayName,
          Position: updates.position,
          ChronologicalDate: updates.chronologicalDate,
          ChronologicalDescription: updates.chronologicalDescription,
          ReleaseOrderPosition: updates.releaseOrderPosition,
          Notes: updates.notes,
          EntryLabel: updates.entryLabel,
          IsOptional: updates.isOptional,
          ArcGroup: updates.arcGroup,
          Importance: updates.importance,
        },
      });
    } catch (error) {
      console.error('Failed to update timeline entry:', error);
      throw new Error('Failed to update timeline entry.');
    }
  }

  // Bulk update entry positions
  static async updateEntryPositions(entries: TimelineEntry[]): Promise<void> {
    const checkContext = captureOperationContext();
    // For each entry, update its Position field
    // (Could be optimized with batch API if available)
    await assertOperations(entries.map(entry => ({ target: entry.id, action: 'update' as const })));
    for (const [idx, entry] of entries.entries()) {
      checkContext();
      await repository.patch({ idOrPath: Number(entry.id), content: { Position: idx + 1 } });
    }
  }
}
