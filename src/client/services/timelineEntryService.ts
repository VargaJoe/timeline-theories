import { repository } from './sensenet';
import { timelineEntriesPath } from '../projectPaths';

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
  static async listTimelineEntries(timelineId: number): Promise<TimelineEntry[]> {
    const result = await repository.loadCollection({
      path: TimelineEntryService.TIMELINE_ENTRY_PATH,
      oDataOptions: {
        query: `TypeIs:TimelineEntry AND TimelineId:${timelineId}`,
        select: [
          'Id',
          'MediaItemId',
          'TimelineId',
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
    return result.d.results.map((item: any) => ({
      id: String(item.Id),
      mediaItemId: item.MediaItemId,
      timelineId: item.TimelineId,
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
  static async getTimelineEntry(entryId: string): Promise<TimelineEntry> {
    const result = await repository.get({
      path: `${TimelineEntryService.TIMELINE_ENTRY_PATH}/${entryId}`,
      oDataOptions: {
        select: [
          'Id',
          'MediaItemId',
          'TimelineId',
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
      },
    });
    const item = result.d;
    return {
      id: String(item.Id),
      mediaItemId: item.MediaItemId,
      timelineId: item.TimelineId,
      position: item.Position,
      chronologicalDate: item.ChronologicalDate,
      releaseOrderPosition: item.ReleaseOrderPosition,
      notes: item.Notes,
      entryLabel: item.EntryLabel,
      isOptional: item.IsOptional,
      arcGroup: item.ArcGroup,
      importance: item.Importance,
      createdBy: item.CreatedBy,
    };
  }
  static readonly TIMELINE_ENTRY_PATH = timelineEntriesPath;

  static async createTimelineEntry(data: Omit<TimelineEntry, 'id'>): Promise<TimelineEntry> {
    const result = await repository.post({
      parentPath: TimelineEntryService.TIMELINE_ENTRY_PATH,
      contentType: 'TimelineEntry',
      content: {
        MediaItemId: data.mediaItemId,
        TimelineId: data.timelineId,
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
