import { repository } from './sensenet';
import { TIMELINE_ENTRY_CONTENT_TYPE } from '../contentTypes';

// Minimal MediaItem reference type for expanded reference
export interface MediaItemRef {
  Id: number;
  DisplayName?: string;
  CoverImageUrl?: string;
}

export interface TimelineEntry {
  id: string;
  displayName: string;
  mediaItem: MediaItemRef | null;
  timelineId: number;
  position: number;
  chronologicalDate?: string;
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
  // List all entries for a given timeline
  static async listTimelineEntries(timelineId: number, parentPath: string): Promise<TimelineEntry[]> {
    const result = await repository.loadCollection({
      path: parentPath,
      oDataOptions: {
        query: `TypeIs:TimelineEntry`,
        select: [
          'Id',
          'DisplayName',
          'MediaItem',
          'Position',
          'ChronologicalDate',
          'ReleaseOrderPosition',
          'Notes',
          'EntryLabel',
          'IsOptional',
          'ArcGroup',
          'Importance',
          'CreatedBy',
        ],
        expand: ['MediaItem'], // Expand the MediaItem reference
        orderby: ['Position'],
      },
    });
    return result.d.results.map((item: Record<string, unknown>) => ({
      id: String(item.Id),
      displayName: item.DisplayName as string,
      mediaItem: item.MediaItem || null, // Expanded MediaItem object or null
      timelineId,
      position: item.Position,
      chronologicalDate: item.ChronologicalDate,
      releaseOrderPosition: item.ReleaseOrderPosition,
      notes: item.Notes,
      entryLabel: item.EntryLabel,
      isOptional: item.IsOptional,
      arcGroup: item.ArcGroup,
      importance: item.Importance,
      createdBy: item.CreatedBy,
    }));
  }

  // Get a single timeline entry by id
  /**
   * Create a TimelineEntry under the given timeline path
   * @param data TimelineEntry data (excluding id)
   * @param parentPath Path of the parent timeline (required)
   */
  static async createTimelineEntry(data: Omit<TimelineEntry, 'id'>, parentPath: string): Promise<TimelineEntry> {
    const result = await repository.post({
      parentPath,
      contentType: TIMELINE_ENTRY_CONTENT_TYPE,
      content: {
        MediaItem: data.mediaItem?.Id, // Reference field (id)
        Position: data.position,
        ChronologicalDate: data.chronologicalDate,
        ReleaseOrderPosition: data.releaseOrderPosition,
        Notes: data.notes,
        EntryLabel: data.entryLabel,
        IsOptional: data.isOptional ?? false,
        ArcGroup: data.arcGroup,
        Importance: data.importance,
        CreatedBy: data.createdBy,
      },
    });
    return {
      id: String(result.d.Id),
      ...data,
    };
  }

  // Add more methods as needed (get, update, delete, list)
}
