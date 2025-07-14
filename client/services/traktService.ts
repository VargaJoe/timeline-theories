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


export async function fetchTraktList(username: string, listSlug: string, accessToken?: string): Promise<TraktListItem[]> {
  // Use real Trakt-format test JSON if present (for local dev)
  if (import.meta.env.DEV) {
    try {
      const res = await fetch('/example-trakt-response.json');
      if (res.ok) {
        const data = await res.json();
        // Map from real Trakt format to minimal structure
        return data.map((item: Record<string, any>) => ({
          type: item.type,
          ids: item[item.type]?.ids,
          title: item[item.type]?.title,
          year: item[item.type]?.year
        }));
      }
    } catch {
      // Ignore if test file not found
    }
  }
  // Always use Netlify proxy to avoid CORS issues
  const url = `/.netlify/functions/trakt-proxy?username=${encodeURIComponent(username)}&list=${encodeURIComponent(listSlug)}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('Failed to fetch Trakt list');
  const data = await res.json();
  // Map to minimal structure
  return data.map((item: Record<string, any>) => ({
    type: item.type,
    ids: item[item.type]?.ids,
    title: item[item.type]?.title,
    year: item[item.type]?.year
  }));
}
