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

// Timeline service for frontend API calls
export interface Timeline {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  sort_order?: string;
  created_at?: string;
  coverImageUrl?: string;
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
        select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate', 'CoverImageUrl'],
        orderby: ['DisplayName'],
      },
    });
    
    return result.d.results.map((item: { 
      Id: number; 
      Name: string;
      DisplayName: string; 
      Description?: string; 
      SortOrder?: string | string[];
      CreationDate: string;
      CoverImageUrl?: string;
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
      };
    });
  } catch (error) {
    console.error('Failed to load timelines:', error);
    throw new Error('Failed to load timelines. Please check your connection and try again.');
  }
}
