import { repository } from './sensenet';

// Timeline service for frontend API calls
export interface Timeline {
  id: string;
  name: string;
  description?: string;
  sort_order?: string;
  created_at?: string;
}

export async function createTimeline(data: { name: string; description?: string; sortOrder?: string }): Promise<Timeline> {
  try {
    // Create a Memo content under /Root/Content/SampleTimelines using the correct repository.post method
    const result = await repository.post({
      parentPath: '/Root/Content/SampleTimelines',
      contentType: 'Memo',
      oDataOptions: {
        select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
      },
      content: {
        Name: data.name.replace(/\s+/g, '-').toLowerCase(),
        DisplayName: data.name,
        Description: data.description || '',
        SortOrder: data.sortOrder || 'chronological',
      },
    });
    
    return {
      id: String(result.d.Id),
      name: result.d.DisplayName || data.name,
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
    // List Memo contents under /Root/Content/SampleTimelines using sn-client loadCollection
    const result = await repository.loadCollection({
      path: '/Root/Content/SampleTimelines',
      oDataOptions: {
        query: 'TypeIs:Memo',
        select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
        orderby: ['DisplayName'],
      },
    });
    
    return result.d.results.map((item: { 
      Id: number; 
      DisplayName: string; 
      Description?: string; 
      SortOrder?: string; 
      CreationDate: string; 
    }) => ({
      id: String(item.Id),
      name: item.DisplayName,
      description: item.Description || '',
      sort_order: item.SortOrder || 'chronological',
      created_at: item.CreationDate,
    }));
  } catch (error) {
    console.error('Failed to load timelines:', error);
    throw new Error('Failed to load timelines. Please check your connection and try again.');
  }
}
