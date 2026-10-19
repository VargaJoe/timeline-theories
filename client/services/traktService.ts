import { nativeRequest } from './nativeApi';

// Trakt API integration for importing lists
// This is a minimal service for fetching Trakt lists and items

export interface TraktListItem {
  type: 'movie' | 'show' | 'season' | 'episode';
  ids: {
    trakt: number;
    imdb?: string;
    tmdb?: number;
    tvdb?: number;
  };
  formattedTitle: string; // Formatted title for display (existing)
  title: string;          // Clean show/movie title (new)
  episodeTitle?: string;  // Episode title for episodes (new)
  year?: number;
  season?: number;  // For season and episode types
  episode?: number; // For episode type
}

/** Fetch the actual selected list through the authorized native gateway. */
export async function fetchTraktList(username: string, listSlug: string): Promise<TraktListItem[]> {
  return nativeRequest<TraktListItem[]>('/api/v1/providers/trakt/list', {
    method: 'POST', body: JSON.stringify({ username, listSlug }),
  });
}
