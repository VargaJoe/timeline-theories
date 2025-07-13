import { repository } from './sensenet';
import { timelinesPath } from '../projectPaths';
import { TIMELINE_CONTENT_TYPE } from '../contentTypes';

// Timeline service for frontend API calls
export interface Timeline {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  sort_order?: string;
  created_at?: string;
}

export async function createTimeline(data: { name: string; displayName?: string; description?: string; sortOrder?: string }): Promise<Timeline> {
  try {
    // Create a Timeline content under the configured path
    const result = await repository.post({
      parentPath: timelinesPath,
      contentType: TIMELINE_CONTENT_TYPE,
      oDataOptions: {
        select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
      },
      content: {
        Name: data.name,
        DisplayName: data.displayName || data.name,
        Description: data.description || '',
        SortOrder: data.sortOrder || 'chronological',
      },
    });
    
    return {
      id: String(result.d.Id),
      name: result.d.Name || data.name, // Use the path segment, not DisplayName
      displayName: result.d.DisplayName || data.displayName || data.name,
      description: result.d.Description || data.description,
      sort_order: result.d.SortOrder || data.sortOrder,
      created_at: result.d.CreationDate,
    };
  } catch (error) {
    console.error('Failed to create timeline:', error);
    throw new Error('Failed to create timeline. Please check your connection and try again.');
  }
}

export async function getTimelines(): Promise<Timeline[]> {
  try {
    // List Timeline contents under the configured path
    const result = await repository.loadCollection({
      path: timelinesPath,
      oDataOptions: {
        query: `TypeIs:${TIMELINE_CONTENT_TYPE}`,
        select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
        orderby: ['DisplayName'],
      },
    });
    
    return result.d.results.map((item: { 
      Id: number; 
      Name: string;
      DisplayName: string; 
      Description?: string; 
      SortOrder?: string; 
      CreationDate: string; 
    }) => ({
      id: String(item.Id),
      name: item.Name, 
      displayName: item.DisplayName,
      description: item.Description || '',
      sort_order: item.SortOrder || 'chronological',
      created_at: item.CreationDate,
    }));
  } catch (error) {
    console.error('Failed to load timelines:', error);
    throw new Error('Failed to load timelines. Please check your connection and try again.');
  }
}
