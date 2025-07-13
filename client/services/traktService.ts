// Trakt API integration for importing lists
// This is a minimal service for fetching Trakt lists and items

export interface TraktListItem {
  type: 'movie' | 'show' | 'episode';
  ids: {
    trakt: number;
    imdb?: string;
    tmdb?: number;
    tvdb?: number;
  };
  title: string;
  year?: number;
}

import { traktApiKey } from '../configuration';

export async function fetchTraktList(username: string, listSlug: string, accessToken?: string): Promise<TraktListItem[]> {
  const url = `https://api.trakt.tv/users/${username}/lists/${listSlug}/items`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'trakt-api-version': '2',
    'trakt-api-key': traktApiKey
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch Trakt list');
  const data = await res.json();
  // Map to minimal structure
  return data.map((item: any) => ({
    type: item.type,
    ids: item[item.type]?.ids,
    title: item[item.type]?.title,
    year: item[item.type]?.year
  }));
}
