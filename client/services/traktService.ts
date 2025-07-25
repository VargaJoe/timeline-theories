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
        formattedTitle: `${item.movie.title} (${item.movie.year})`, // Formatted movie title as "Title (Year)"
        title: item.movie.title, // Clean title
        year: item.movie.year
      };
    
    case 'show':
      return {
        type: 'show',
        ids: item.show.ids,
        formattedTitle: `${item.show.title} (${item.show.year})`, // Formatted show title as "Title (Year)"
        title: item.show.title, // Clean title
        year: item.show.year
      };
    
    case 'season':
      return {
        type: 'season',
        ids: item.show.ids, // Use show IDs for seasons
        formattedTitle: `${item.show.title} (${item.show.year}) Season ${item.season.number}`, // Formatted season title as "Title (Year) Season X"
        title: item.show.title, // Clean show title
        year: item.show.year,
        season: item.season.number
      };
    
    case 'episode': {
      const seasonNum = item.episode.season.toString().padStart(2, '0');
      const episodeNum = item.episode.number.toString().padStart(2, '0');
      return {
        type: 'episode',
        ids: item.show.ids, // Use show IDs for episodes  
        formattedTitle: `${item.show.title} (${item.show.year}) S${seasonNum}E${episodeNum}`, // Formatted episode title as "Title (Year) SXXEYY"
        title: item.show.title, // Clean show title
        episodeTitle: item.episode.title, // Episode title
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
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data: TraktRawItem[] = await res.json();
        console.log('Using local test data from example-trakt-response.json');
        return data.map(mapTraktItem);
      }
    } catch (error) {
      console.log('Test file not found or invalid, proceeding with API call:', error);
      // Ignore if test file not found or invalid
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
