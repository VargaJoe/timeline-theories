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
  // Create a Memo content under /Root/Content/SampleTimelines
  const result = await repository.create({
    parentPath: '/Root/Content/SampleTimelines',
    contentTypeName: 'Memo',
    name: data.name.replace(/\s+/g, '-').toLowerCase(),
    fields: {
      DisplayName: data.name,
      Description: data.description || '',
      SortOrder: data.sortOrder || 'chronological',
    },
  });
  return {
    id: result.d.Id,
    name: result.d.DisplayName,
    description: result.d.Description,
    sort_order: result.d.SortOrder,
    created_at: result.d.CreationDate,
  };
}

export async function getTimelines(): Promise<Timeline[]> {
  // List Memo contents under /Root/Content/SampleTimelines using sn-client loadCollection
  const result = await repository.loadCollection({
    path: '/Root/Content/SampleTimelines',
    oDataOptions: {
      query: 'TypeIs:Memo',
      select: ['Id', 'DisplayName', 'Description', 'SortOrder', 'CreationDate'],
      orderby: ['DisplayName'],
    },
  });
  return result.d.results.map((item: any) => ({
    id: item.Id,
    name: item.DisplayName,
    description: item.Description,
    sort_order: item.SortOrder,
    created_at: item.CreationDate,
  }));
}
