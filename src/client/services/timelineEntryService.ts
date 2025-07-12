import { repository } from './sensenet';
import { TIMELINE_ENTRY_CONTENT_TYPE } from '../contentTypes';

// TimelineEntry interface matching the SenseNet content type
export interface TimelineEntry {
  id: string;
  mediaItemId: number;
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
        orderby: ['Position'],
      },
    });
    return result.d.results.map((item: Record<string, unknown>) => ({
      id: String(item.Id),
      mediaItemId: item.MediaItem, // Reference field
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
        MediaItem: data.mediaItemId, // Reference field
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
