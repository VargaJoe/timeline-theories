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
  title: string;
  year?: number;
  season?: number;  // For season and episode types
  episode?: number; // For episode type
}

// Raw Trakt API response types
interface TraktMovieItem {
  rank: number;
  id: number;
  listed_at: string;
  notes: string | null;
  type: 'movie';
  movie: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
      tvdb?: number;
    };
  };
}

interface TraktShowItem {
  rank: number;
  id: number;
  listed_at: string;
  notes: string | null;
  type: 'show';
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
      tvdb?: number;
    };
  };
}

interface TraktSeasonItem {
  rank: number;
  id: number;
  listed_at: string;
  notes: string | null;
  type: 'season';
  season: {
    number: number;
    ids: {
      trakt: number;
      tvdb?: number;
      tmdb?: number;
    };
  };
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
      tvdb?: number;
    };
  };
}

interface TraktEpisodeItem {
  rank: number;
  id: number;
  listed_at: string;
  notes: string | null;
  type: 'episode';
  episode: {
    season: number;
    number: number;
    title: string;
    ids: {
      trakt: number;
      tvdb?: number;
      tmdb?: number;
    };
  };
  show: {
    title: string;
    year: number;
    ids: {
      trakt: number;
      imdb?: string;
      tmdb?: number;
      tvdb?: number;
    };
  };
}

type TraktRawItem = TraktMovieItem | TraktShowItem | TraktSeasonItem | TraktEpisodeItem;

function mapTraktItem(item: TraktRawItem): TraktListItem {
  switch (item.type) {
    case 'movie':
      return {
        type: 'movie',
        ids: item.movie.ids,
        title: `${item.movie.title} (${item.movie.year})`, // Keep movies as "title (year)"
        year: item.movie.year
      };
    
    case 'show':
      return {
        type: 'show',
        ids: item.show.ids,
        title: `${item.show.title} (${item.show.year})`, // Shows as "title (year)"
        year: item.show.year
      };
    
    case 'season':
      return {
        type: 'season',
        ids: item.show.ids, // Use show IDs for seasons
        title: `${item.show.title} (${item.show.year}) Season ${item.season.number}`, // "title (year) Season X"
        year: item.show.year,
        season: item.season.number
      };
    
    case 'episode': {
      const seasonNum = item.episode.season.toString().padStart(2, '0');
      const episodeNum = item.episode.number.toString().padStart(2, '0');
      return {
        type: 'episode',
        ids: item.show.ids, // Use show IDs for episodes  
        title: `${item.show.title} (${item.show.year}) S${seasonNum}E${episodeNum}`, // "title (year) SXXeXX"
        year: item.show.year,
        season: item.episode.season,
        episode: item.episode.number
      };
    }
    
    default:
      throw new Error(`Unknown Trakt item type: ${(item as TraktRawItem).type}`);
  }
}

export async function fetchTraktList(username: string, listSlug: string, accessToken?: string): Promise<TraktListItem[]> {
  // Use real Trakt-format test JSON if present (for local dev)
  if (import.meta.env.DEV) {
    try {
      const res = await fetch('/example-trakt-response.json');
      if (res.ok) {
        const data: TraktRawItem[] = await res.json();
        return data.map(mapTraktItem);
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
  
  const data: TraktRawItem[] = await res.json();
  return data.map(mapTraktItem);
}
