import { MediaLibraryService, resizeImageToDefault, uploadCoverImageBinary } from './mediaLibraryService';
import { loadApiKey } from './sensenet';
import { omdbKeyFullPath, tmdbKeyFullPath } from '../projectPaths';
import type { MediaItem } from './mediaLibraryService';

// Rate limiting interfaces
export interface RateLimitInfo {
  isLimited: boolean;
  retryAfter?: number; // seconds to wait
  remaining?: number;
  resetTime?: Date;
  source: DataSourceType;
}

export interface ApiError extends Error {
  status?: number;
  rateLimitInfo?: RateLimitInfo;
}

export interface MediaUpdateData {
  title?: string;
  description?: string;
  coverImageUrl?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
  source?: string; // Which source was used for the data
  _binaryCoverImageUploaded?: boolean; // Internal flag for binary upload
}

export interface MediaUpdateResult {
  mediaItem: MediaItem;
  updateData: MediaUpdateData | null;
  error?: string;
  hasChanges: boolean;
}

export interface UpdateOptions {
  updateTitles: boolean;
  updateDescriptions: boolean;
  updateCoverImages: boolean;
  onlyMissing: boolean; // true = only update empty fields, false = overwrite all
  preferredSources: DataSourceType[]; // Order of preferred sources
}

// Supported data sources
export const DataSource = {
  IMDB: 'imdb',
  TVDB: 'tvdb', 
  TMDB: 'tmdb',
  TRAKT: 'trakt',
  OMDB: 'omdb'
} as const;

export type DataSourceType = typeof DataSource[keyof typeof DataSource];

// Interface for enhanced progress reporting with API status
export interface BulkUpdateProgress {
  current: number;
  total: number;
  currentItem: string;
  apiStatus?: {
    source: string;
    status: 'active' | 'rate-limited' | 'failed';
    message?: string;
    retryAfter?: number;
  };
}

// Type for enhanced progress callback
export type ProgressCallback = (progress: BulkUpdateProgress) => void;

export class MediaUpdateService {
  // Static property to track rate limiting across API calls
  private static rateLimitInfo: RateLimitInfo = {
    isLimited: false,
    resetTime: undefined,
    source: DataSource.OMDB
  };

  // Rate limiting state
  private static rateLimitState: Map<DataSourceType, RateLimitInfo> = new Map();

  /**
   * Fetch updated data for a single media item from multiple sources
   */
  static async fetchUpdateData(mediaItem: MediaItem, options?: UpdateOptions): Promise<MediaUpdateData | null> {
    try {
      console.log('Fetching update data for:', mediaItem.DisplayName);
      
      // Parse external links if available
      const externalLinks = this.parseExternalLinks(mediaItem.ExternalLinks);
      console.log('External links found:', externalLinks);
      
      // Get preferred sources from options or use default order
      const preferredSources = options?.preferredSources || [DataSource.OMDB, DataSource.TMDB, DataSource.TRAKT];
      
      // Build sources array based on available links and user preference
      const availableSources = [];
      
      for (const source of preferredSources) {
        let identifier = null;
        
        switch (source) {
          case DataSource.OMDB:
            identifier = externalLinks.imdb; // OMDb uses IMDb IDs
            break;
          case DataSource.TMDB:
            identifier = externalLinks.tmdb;
            break;
          case DataSource.TRAKT:
            identifier = externalLinks.trakt;
            break;
          case DataSource.IMDB:
            identifier = externalLinks.imdb;
            break;
          case DataSource.TVDB:
            identifier = externalLinks.tvdb;
            break;
        }
        
        if (identifier) {
          availableSources.push({ source, identifier });
        }
      }

      // Try each available source in user's preferred order
      for (const { source, identifier } of availableSources) {
        console.log(`Trying ${source.toUpperCase()} with ID: ${identifier} for ${mediaItem.DisplayName}`);
        
        try {
          const data = await this.fetchFromSource(source, identifier, mediaItem);
          if (data) {
            console.log(`Successfully fetched data from ${source.toUpperCase()}`);
            return { ...data, source: source.toUpperCase() };
          } else {
            console.log(`${source.toUpperCase()} returned no data for ID: ${identifier}`);
          }
        } catch (error) {
          if (error instanceof Error && 'status' in error) {
            const apiError = error as ApiError;
            if (apiError.status === 429 || apiError.message.includes('rate limit') || apiError.message.includes('limit exceeded')) {
              console.warn(`Rate limit hit for ${source.toUpperCase()}: ${apiError.message}. Skipping to next source.`);
              continue; // Skip to next source instead of failing entirely
            }
          }
          console.error(`Error fetching from ${source.toUpperCase()}:`, error);
          // Continue to next source on other errors too
        }
      }

      // If external IDs fail, try specialized handling for TV content
      if (mediaItem.DisplayName && mediaItem.MediaType) {
        console.log(`External IDs failed, trying specialized TV content handling for: ${mediaItem.DisplayName}`);
        
        // Check if this is a season or episode
        if (mediaItem.MediaType === 'season' || mediaItem.MediaType === 'episode') {
          const result = await this.handleTVSeasonOrEpisode(mediaItem, preferredSources);
          if (result) return result;
        }
        
        // Regular title search fallback
        const searchTitle = mediaItem.Title || mediaItem.DisplayName;
        console.log(`Specialized handling failed, trying title search for: ${searchTitle}`);
        const titleResult = await this.searchByTitle(searchTitle, mediaItem.MediaType, preferredSources);
        if (titleResult) {
          return titleResult;
        }
      }

      // If title search fails, try extracting the base series name for broader search
      const searchTitle = mediaItem.Title || mediaItem.DisplayName;
      if (searchTitle && searchTitle.includes(':')) {
        const baseName = searchTitle.split(':')[0].trim();
        console.log(`Specific title failed, trying base series search for: ${baseName}`);
        const baseResult = await this.searchByTitle(baseName, mediaItem.MediaType, preferredSources);
        if (baseResult) {
          // Mark that this is a fallback result
          return { ...baseResult, title: searchTitle, source: `${baseResult.source} (Series Match)` };
        }
      }

      return null;

    } catch (error) {
      console.error('Error fetching update data for media item:', mediaItem.Id, error);
      return null;
    }
  }

  /**
   * Handle TV seasons and episodes by finding the base show first, then using specialized endpoints
   */
  private static async handleTVSeasonOrEpisode(mediaItem: MediaItem, preferredSources: DataSourceType[]): Promise<MediaUpdateData | null> {
    const displayName = mediaItem.DisplayName;
    
    // With the new data structure, Title should contain the clean show name
    // Examples: Title: "9-1-1: Lone Star", Subtitle: "S02E01" 
    //          Title: "Breaking Bad", Subtitle: "Season 5"
    const baseShowName = mediaItem.Title || displayName;
    
    if (!baseShowName) return null;
    
    console.log(`Using clean show title: "${baseShowName}" for "${displayName}"`);
    
    // Try to find the base show on TMDB first
    if (preferredSources.includes(DataSource.TMDB)) {
      try {
        const showResult = await this.searchTMDBByTitle(baseShowName);
        if (showResult) {
          console.log(`Found base show on TMDB: ${showResult.title}`);
          
          // Now we need to get the TMDB ID for this show
          const showId = await this.getTMDBShowId(baseShowName);
          if (showId) {
            console.log(`Got TMDB show ID: ${showId} for "${baseShowName}"`);
            
            // Now use specialized endpoints with the show ID
            if (mediaItem.MediaType === 'season') {
              const seasonData = await this.fetchTMDBSeason(showId, await loadApiKey(tmdbKeyFullPath) || '', mediaItem);
              if (seasonData) return { ...seasonData, source: 'TMDB (Season)' };
            } else if (mediaItem.MediaType === 'episode') {
              const episodeData = await this.fetchTMDBEpisode(showId, await loadApiKey(tmdbKeyFullPath) || '', mediaItem);
              if (episodeData) return { ...episodeData, source: 'TMDB (Episode)' };
            }
          }
        }
      } catch (error) {
        console.error('Error in specialized TV content handling:', error);
      }
    }
    
    return null;
  }

  /**
   * Get TMDB show ID by searching for the show title
   */
  private static async getTMDBShowId(showTitle: string): Promise<string | null> {
    try {
      const apiKey = await loadApiKey(tmdbKeyFullPath);
      if (!apiKey) return null;

      // Clean title (remove year if present)
      const cleanTitle = showTitle.replace(/\s*\(\d{4}\)$/, '');
      // Extract year if present
      const yearMatch = showTitle.match(/\((\d{4})\)$/);
      const year = yearMatch ? yearMatch[1] : '';
      
      // Search for TV show
      const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}${year ? `&first_air_date_year=${year}` : ''}`;
      const tvResponse = await fetch(tvUrl);
      const tvData = await tvResponse.json();
      
      if (tvData.results && tvData.results.length > 0) {
        const show = tvData.results[0];
        console.log(`Found TMDB show: ${show.name} (ID: ${show.id})`);
        return String(show.id);
      }
      
      return null;
    } catch (error) {
      console.error('Error getting TMDB show ID:', error);
      return null;
    }
  }

  /**
   * Parse external links from media item - handles both JSON and URL formats
   */
  private static parseExternalLinks(externalLinks?: string): Record<string, string> {
    const links: Record<string, string> = {};
    
    if (!externalLinks) return links;

    try {
      // First try to parse as JSON (structured format)
      const parsed = JSON.parse(externalLinks);
      if (typeof parsed === 'object') {
        // Extract IDs from structured data - handle both string and number values
        if (parsed.imdb && parsed.imdb !== null) {
          links.imdb = this.extractIMDbId(String(parsed.imdb)) || String(parsed.imdb);
        }
        if (parsed.tmdb && parsed.tmdb !== null) {
          links.tmdb = String(parsed.tmdb);
        }
        if (parsed.trakt && parsed.trakt !== null) {
          links.trakt = String(parsed.trakt);
        }
        if (parsed.tvdb && parsed.tvdb !== null) {
          links.tvdb = String(parsed.tvdb);
        }
        console.log('Parsed JSON external links:', links);
        return links;
      }
    } catch {
      // Not JSON, try parsing as plain text with URLs
      console.log('External links not JSON, trying URL parsing');
    }

    try {
      const urlRegexes = {
        imdb: /(?:imdb\.com\/title\/)([a-zA-Z0-9]+)/i,
        tmdb: /(?:themoviedb\.org\/(?:movie|tv)\/(\d+))/i,
        trakt: /(?:trakt\.tv\/(?:movies|shows)\/([a-zA-Z0-9-]+))/i,
        tvdb: /(?:thetvdb\.com\/(?:series|movies)\/([a-zA-Z0-9-]+))/i
      };

      for (const [source, regex] of Object.entries(urlRegexes)) {
        const match = externalLinks.match(regex);
        if (match) {
          links[source] = match[1];
        }
      }
    } catch (error) {
      console.error('Error parsing external links:', error);
    }

    return links;
  }

  /**
   * Extract IMDb ID from URL or return the ID if already clean
   */
  private static extractIMDbId(url: string): string | null {
    if (!url) return null;
    
    // If it's already a clean IMDb ID
    if (/^tt\d+$/.test(url)) return url;
    
    // Extract from URL
    const match = url.match(/(?:imdb\.com\/title\/|^)(tt\d+)/);
    return match ? match[1] : null;
  }

  /**
   * Fetch data from specific source with content validation
   */
  private static async fetchFromSource(source: DataSourceType, identifier: string, mediaItem: MediaItem): Promise<MediaUpdateData | null> {
    let data: MediaUpdateData | null = null;

    console.log(`Fetching from ${source.toUpperCase()} with identifier: ${identifier}`);

    switch (source) {
      case DataSource.OMDB:
        data = await this.fetchFromOMDb(identifier);
        break;
      case DataSource.TMDB:
        data = await this.fetchFromTMDB(identifier, mediaItem.MediaType, mediaItem);
        break;
      case DataSource.TRAKT:
        data = await this.fetchFromTrakt(identifier);
        break;
      default:
        console.warn(`Unsupported source: ${source}`);
        return null;
    }

    // Validate that the returned data actually matches what we're looking for
    if (data && mediaItem.DisplayName) {
      const isValidMatch = this.validateContentMatch(data, mediaItem.DisplayName);
      if (!isValidMatch) {
        console.log(`❌ Content validation failed for ${source.toUpperCase()} ID ${identifier}:`);
        console.log(`   Expected: "${mediaItem.DisplayName}"`);
        console.log(`   Got: "${data.title}"`);
        console.log(`   This appears to be incorrect data, skipping...`);
        return null; // Reject this data as it doesn't match
      } else {
        console.log(`✅ Content validation passed for ${source.toUpperCase()} ID ${identifier}`);
      }
    }

    return data;
  }

  /**
   * Search by title across multiple sources
   */
  private static async searchByTitle(title: string, mediaType?: string, preferredSources?: DataSourceType[]): Promise<MediaUpdateData | null> {
    const sources = preferredSources || [DataSource.OMDB, DataSource.TMDB];
    
    for (const source of sources) {
      console.log(`Searching ${source.toUpperCase()} by title:`, title);
      
      let result = null;
      switch (source) {
        case DataSource.OMDB:
          result = await this.searchOMDbByTitle(title, mediaType);
          break;
        case DataSource.TMDB:
          result = await this.searchTMDBByTitle(title);
          break;
      }
      
      if (result) {
        return { ...result, source: source.toUpperCase() };
      }
    }

    return null;
  }

  /**
   * Fetch from OMDb API using IMDb ID with rate limit handling
   */
  private static async fetchFromOMDb(imdbId: string): Promise<MediaUpdateData | null> {
    const apiKey = await loadApiKey(omdbKeyFullPath);
    if (!apiKey) {
      console.warn('OMDb API key not configured in SenseNet');
      return null;
    }

    return this.retryWithBackoff(async () => {
      // Ensure IMDb ID has proper format
      const formattedId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
      const response = await fetch(`https://www.omdbapi.com/?i=${formattedId}&apikey=${apiKey}&plot=full`);
      if (!response.ok) {
        const error: ApiError = new Error(`OMDb API error: ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const data = await response.json();
      if (data.Response === 'False') {
        if (data.Error?.includes('daily limit exceeded')) {
          const error: ApiError = new Error('OMDb daily limit exceeded');
          error.status = 401;
          throw error;
        }
        return null; // Not found, but not an error
      }
      if (data.Response === 'True') {
        return {
          title: data.Title,
          description: data.Plot,
          coverImageUrl: data.Poster !== 'N/A' ? data.Poster : undefined,
          releaseDate: data.Released !== 'N/A' ? data.Released : undefined,
          runtime: data.Runtime !== 'N/A' ? parseInt(data.Runtime) : undefined,
          genres: data.Genre !== 'N/A' ? data.Genre.split(', ') : undefined
        };
      }
      return null;
    }, DataSource.OMDB);
  }

  /**
   * Search OMDb by title
   */
  private static async searchOMDbByTitle(title: string, mediaType?: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = await loadApiKey(omdbKeyFullPath);
      if (!apiKey) return null;

      // Clean title (remove year if present)
      const cleanTitle = title.replace(/\s*\(\d{4}\)$/, '');
      // Extract year if present
      const yearMatch = title.match(/\((\d{4})\)$/);
      const year = yearMatch ? yearMatch[1] : '';
      
      // Map media type to OMDb types
      let type = '';
      if (mediaType?.toLowerCase().includes('movie') || mediaType?.toLowerCase().includes('film')) {
        type = '&type=movie';
      } else if (mediaType === 'show' || mediaType === 'season' || mediaType === 'episode' || 
                 mediaType?.toLowerCase().includes('tv') || mediaType?.toLowerCase().includes('series')) {
        type = '&type=series';
      }
      
      const url = `https://www.omdbapi.com/?t=${encodeURIComponent(cleanTitle)}${year ? `&y=${year}` : ''}${type}&apikey=${apiKey}&plot=full`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.Response === 'True') {
        return {
          title: data.Title,
          description: data.Plot,
          coverImageUrl: data.Poster !== 'N/A' ? data.Poster : undefined,
          releaseDate: data.Released !== 'N/A' ? data.Released : undefined,
          runtime: data.Runtime !== 'N/A' ? parseInt(data.Runtime) : undefined,
          genres: data.Genre !== 'N/A' ? data.Genre.split(', ') : undefined
        };
      }
      return null;
    } catch (error) {
      console.error('Error searching OMDb by title:', error);
      return null;
    }
  }

  /**
   * Fetch from TMDB API with rate limit handling
   */
  private static async fetchFromTMDB(tmdbId: string, mediaType?: string, mediaItem?: MediaItem): Promise<MediaUpdateData | null> {
    const apiKey = await loadApiKey(tmdbKeyFullPath);
    if (!apiKey) {
      console.warn('TMDB API key not configured in SenseNet');
      return null;
    }

    return this.retryWithBackoff(async () => {
      console.log(`Attempting to fetch TMDB ID: ${tmdbId} with mediaType: ${mediaType}`);
      
      // Handle different media types with appropriate endpoints
      if (mediaType?.toLowerCase().includes('movie') || mediaType?.toLowerCase().includes('film')) {
        // Movie endpoint
        return await this.fetchTMDBMovie(tmdbId, apiKey);
      } else if (mediaType === 'show' || mediaType?.toLowerCase().includes('tv') || mediaType?.toLowerCase().includes('series')) {
        // TV Series endpoint
        return await this.fetchTMDBTVSeries(tmdbId, apiKey);
      } else if (mediaType === 'season') {
        // Season endpoint - requires show ID and season number
        return await this.fetchTMDBSeason(tmdbId, apiKey, mediaItem);
      } else if (mediaType === 'episode') {
        // Episode endpoint - requires show ID, season and episode numbers
        return await this.fetchTMDBEpisode(tmdbId, apiKey, mediaItem);
      } else {
        // Unknown type, try both movie and TV series
        console.log(`Unknown media type: ${mediaType}, trying both movie and TV endpoints`);
        const movieResult = await this.fetchTMDBMovie(tmdbId, apiKey);
        if (movieResult) return movieResult;
        
        const tvResult = await this.fetchTMDBTVSeries(tmdbId, apiKey);
        if (tvResult) return tvResult;
        
        console.log(`No data found on TMDB for ID: ${tmdbId}`);
        return null;
      }
    }, DataSource.TMDB);
  }

  /**
   * Fetch movie data from TMDB
   */
  private static async fetchTMDBMovie(tmdbId: string, apiKey: string): Promise<MediaUpdateData | null> {
    console.log(`Trying TMDB movie endpoint for ID: ${tmdbId}`);
    const response = await fetch(`https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}`);
    if (!response.ok) {
      if (response.status === 429) {
        const error: ApiError = new Error('TMDB rate limit exceeded');
        error.status = response.status;
        throw error;
      }
      console.log(`TMDB movie endpoint returned ${response.status} for ID: ${tmdbId}`);
      return null;
    }
    
    const data = await response.json();
    if (data.id) {
      console.log(`Successfully fetched from TMDB movie:`, data.title);
      return {
        title: data.title,
        description: data.overview,
        coverImageUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        releaseDate: data.release_date,
        runtime: data.runtime,
        genres: data.genres?.map((g: { name: string }) => g.name)
      };
    }
    return null;
  }

  /**
   * Fetch TV series data from TMDB
   */
  private static async fetchTMDBTVSeries(tmdbId: string, apiKey: string): Promise<MediaUpdateData | null> {
    console.log(`Trying TMDB TV series endpoint for ID: ${tmdbId}`);
    const response = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${apiKey}`);
    if (!response.ok) {
      if (response.status === 429) {
        const error: ApiError = new Error('TMDB rate limit exceeded');
        error.status = response.status;
        throw error;
      }
      console.log(`TMDB TV series endpoint returned ${response.status} for ID: ${tmdbId}`);
      return null;
    }
    
    const data = await response.json();
    if (data.id) {
      console.log(`Successfully fetched from TMDB TV series:`, data.name);
      return {
        title: data.name,
        description: data.overview,
        coverImageUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        releaseDate: data.first_air_date,
        runtime: data.episode_run_time?.[0],
        genres: data.genres?.map((g: { name: string }) => g.name)
      };
    }
    return null;
  }

  /**
   * Fetch season data from TMDB using series ID and season number
   */
  private static async fetchTMDBSeason(tmdbId: string, apiKey: string, mediaItem?: MediaItem): Promise<MediaUpdateData | null> {
    // Extract season number from subtitle (clean data) or display name (fallback)
    // With new structure: Subtitle should be "Season 1", DisplayName might be "Show (2020) Season 1"
    let seasonNumber: string | null = null;
    
    // Try Subtitle field first (clean structured data)
    if (mediaItem?.Subtitle) {
      const subMatch = mediaItem.Subtitle.match(/Season (\d+)/i);
      if (subMatch) {
        seasonNumber = subMatch[1];
        console.log(`Extracted season from Subtitle field: ${seasonNumber}`);
      }
    }
    
    // Fallback to DisplayName parsing for legacy data
    if (!seasonNumber && mediaItem?.DisplayName) {
      const seasonMatch = mediaItem.DisplayName.match(/Season (\d+)|S(\d{1,2})/i);
      if (seasonMatch) {
        seasonNumber = seasonMatch[1] || seasonMatch[2];
        console.log(`Extracted season from DisplayName: ${seasonNumber}`);
      }
    }
    
    if (!seasonNumber) {
      console.warn('Could not extract season number from subtitle or display name:', mediaItem?.Subtitle, mediaItem?.DisplayName);
      // Fallback to TV series data
      return await this.fetchTMDBTVSeries(tmdbId, apiKey);
    }
    
    // Convert to number and back to remove leading zeros
    const seasonNum = parseInt(seasonNumber, 10).toString();
    console.log(`Trying TMDB season endpoint for series ID: ${tmdbId}, season: ${seasonNum}`);
    
    const response = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNum}?api_key=${apiKey}`);
    if (!response.ok) {
      if (response.status === 429) {
        const error: ApiError = new Error('TMDB rate limit exceeded');
        error.status = response.status;
        throw error;
      }
      console.log(`TMDB season endpoint returned ${response.status} for series ID: ${tmdbId}, season: ${seasonNum}`);
      // Fallback to TV series data
      return await this.fetchTMDBTVSeries(tmdbId, apiKey);
    }
    
    const data = await response.json();
    if (data.id) {
      console.log(`Successfully fetched from TMDB season:`, data.name);
      return {
        title: data.name,
        description: data.overview,
        coverImageUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        releaseDate: data.air_date,
        runtime: undefined, // Seasons don't have runtime
        genres: [] // Season data doesn't include genres
      };
    }
    return null;
  }

  /**
   * Fetch episode data from TMDB using series ID, season and episode numbers
   */
  private static async fetchTMDBEpisode(tmdbId: string, apiKey: string, mediaItem?: MediaItem): Promise<MediaUpdateData | null> {
    // Extract season and episode numbers from subtitle (clean data) or display name (fallback)
    // With new structure: Subtitle should be "S01E01", DisplayName might be "Show (2020) S01E01"
    let seasonNumber: number | null = null;
    let episodeNumber: number | null = null;
    
    // Try Subtitle field first (clean structured data)
    if (mediaItem?.Subtitle) {
      const subMatch = mediaItem.Subtitle.match(/S(\d{1,2})E(\d{1,2})/i);
      if (subMatch) {
        seasonNumber = parseInt(subMatch[1], 10);
        episodeNumber = parseInt(subMatch[2], 10);
        console.log(`Extracted from Subtitle field: Season ${seasonNumber}, Episode ${episodeNumber}`);
      }
    }
    
    // Fallback to DisplayName parsing for legacy data
    if ((seasonNumber === null || episodeNumber === null) && mediaItem?.DisplayName) {
      const episodeMatch = mediaItem.DisplayName.match(/S(\d{2})E(\d{2})/i);
      if (episodeMatch) {
        seasonNumber = parseInt(episodeMatch[1], 10);
        episodeNumber = parseInt(episodeMatch[2], 10);
        console.log(`Extracted from DisplayName: Season ${seasonNumber}, Episode ${episodeNumber}`);
      }
    }
    
    if (seasonNumber === null || episodeNumber === null) {
      console.warn('Could not extract season/episode numbers from subtitle or display name:', mediaItem?.Subtitle, mediaItem?.DisplayName);
      // Fallback to TV series data
      return await this.fetchTMDBTVSeries(tmdbId, apiKey);
    }
    console.log(`Trying TMDB episode endpoint for series ID: ${tmdbId}, season: ${seasonNumber}, episode: ${episodeNumber}`);
    
    const response = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}?api_key=${apiKey}`);
    if (!response.ok) {
      if (response.status === 429) {
        const error: ApiError = new Error('TMDB rate limit exceeded');
        error.status = response.status;
        throw error;
      }
      console.log(`TMDB episode endpoint returned ${response.status} for series ID: ${tmdbId}, season: ${seasonNumber}, episode: ${episodeNumber}`);
      // Fallback to TV series data
      return await this.fetchTMDBTVSeries(tmdbId, apiKey);
    }
    
    const data = await response.json();
    if (data.id) {
      console.log(`Successfully fetched from TMDB episode:`, data.name);
      return {
        title: data.name,
        description: data.overview,
        coverImageUrl: data.still_path ? `https://image.tmdb.org/t/p/w500${data.still_path}` : undefined,
        releaseDate: data.air_date,
        runtime: data.runtime,
        genres: [] // Episode data doesn't include genres
      };
    }
    return null;
  }

  /**
   * Search TMDB by title
   */
  private static async searchTMDBByTitle(title: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = await loadApiKey(tmdbKeyFullPath);
      if (!apiKey) return null;

      // Clean title (remove year if present)
      const cleanTitle = title.replace(/\s*\(\d{4}\)$/, '');
      // Extract year if present
      const yearMatch = title.match(/\((\d{4})\)$/);
      const year = yearMatch ? yearMatch[1] : '';
      // Try movie search first, then TV if no results
      const movieUrl = `https://api.themoviedb.org/3/search/movie?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}${year ? `&year=${year}` : ''}`;
      const movieResponse = await fetch(movieUrl);
      const movieData = await movieResponse.json();
      if (movieData.results && movieData.results.length > 0) {
        const movie = movieData.results[0];
        return {
          title: movie.title,
          description: movie.overview,
          coverImageUrl: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : undefined,
          releaseDate: movie.release_date,
          genres: [] // Would need additional API call for full genre names
        };
      }
      // Try TV search if movie search failed
      const tvUrl = `https://api.themoviedb.org/3/search/tv?api_key=${apiKey}&query=${encodeURIComponent(cleanTitle)}${year ? `&first_air_date_year=${year}` : ''}`;
      const tvResponse = await fetch(tvUrl);
      const tvData = await tvResponse.json();
      if (tvData.results && tvData.results.length > 0) {
        const show = tvData.results[0];
        return {
          title: show.name,
          description: show.overview,
          coverImageUrl: show.poster_path ? `https://image.tmdb.org/t/p/w500${show.poster_path}` : undefined,
          releaseDate: show.first_air_date,
          genres: [] // Would need additional API call for full genre names
        };
      }
      return null;
    } catch (error) {
      console.error('Error searching TMDB by title:', error);
      return null;
    }
  }

  /**
   * Fetch from Trakt API with rate limit handling (placeholder - requires proper API integration)
   */
  private static async fetchFromTrakt(traktSlug: string): Promise<MediaUpdateData | null> {
    return this.retryWithBackoff(async () => {
      // This would require proper Trakt API integration
      console.log('Trakt integration not yet implemented for:', traktSlug);
      
      // When implementing, use something like:
      // const response = await fetch(`/.netlify/functions/trakt-proxy?slug=${traktSlug}`);
      // if (!response.ok) {
      //   const error: ApiError = new Error(`Trakt API error: ${response.status}`);
      //   error.status = response.status;
      //   if (response.status === 429) {
      //     error.message = 'Trakt rate limit exceeded';
      //   }
      //   throw error;
      // }
      
      return null;
    }, DataSource.TRAKT);
  }

  /**
   * Analyze what changes would be made to a media item
   */
  static analyzeChanges(mediaItem: MediaItem, updateData: MediaUpdateData, options: UpdateOptions & { coverImageMode?: 'url' | 'binary' }): MediaUpdateData | null {
    const changes: MediaUpdateData = {};
    let hasChanges = false;

    // Check title
    if (options.updateTitles && updateData.title) {
      const shouldUpdate = options.onlyMissing ? 
        (!mediaItem.DisplayName || mediaItem.DisplayName.trim() === '') : 
        true;
      
      if (shouldUpdate && updateData.title !== mediaItem.DisplayName) {
        changes.title = updateData.title;
        hasChanges = true;
      }
    }

    // Check description
    if (options.updateDescriptions && updateData.description) {
      const shouldUpdate = options.onlyMissing ? 
        (!mediaItem.Description || mediaItem.Description.trim() === '') : 
        true;
      
      if (shouldUpdate && updateData.description !== mediaItem.Description) {
        changes.description = updateData.description;
        hasChanges = true;
      }
    }

    // Check cover image
    if (options.updateCoverImages && updateData.coverImageUrl) {
      const shouldUpdate = options.onlyMissing ? 
        (!mediaItem.CoverImageUrl || mediaItem.CoverImageUrl.trim() === '') : 
        true;
      
      // For binary mode, we need to trigger update even if URL is the same
      // because we want to convert the URL to a binary upload
      const urlChanged = updateData.coverImageUrl !== mediaItem.CoverImageUrl;
      const binaryModeConversion = options.coverImageMode === 'binary' && updateData.coverImageUrl;
      
      console.log(`[analyzeChanges] Cover image check for "${mediaItem.DisplayName}":`, {
        shouldUpdate,
        urlChanged,
        binaryModeConversion,
        coverImageMode: options.coverImageMode,
        currentUrl: mediaItem.CoverImageUrl,
        newUrl: updateData.coverImageUrl
      });
      
      if (shouldUpdate && (urlChanged || binaryModeConversion)) {
        changes.coverImageUrl = updateData.coverImageUrl;
        hasChanges = true;
        console.log(`[analyzeChanges] Cover image will be updated for "${mediaItem.DisplayName}"`);
      }
    }

    // Copy source info
    if (updateData.source) {
      changes.source = updateData.source;
    }

    return hasChanges ? changes : null;
  }

  /**
   * Process bulk update for multiple media items with enhanced progress reporting
   */
  static async processBulkUpdate(
    mediaItems: MediaItem[],
    options: UpdateOptions & { coverImageMode?: 'url' | 'binary' },
    onProgress?: ProgressCallback,
    isPreview: boolean = true
  ): Promise<MediaUpdateResult[]> {
    const results: MediaUpdateResult[] = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const mediaItem = mediaItems[i];
      
      // Report basic progress
      const progress: BulkUpdateProgress = {
        current: i + 1,
        total: mediaItems.length,
        currentItem: mediaItem.DisplayName || 'Unknown'
      };
      
      onProgress?.(progress);

      try {
        // Fetch update data with API status tracking
        let apiError: ApiError | null = null;
        let updateData: MediaUpdateData | null = null;
        
        try {
          updateData = await this.fetchUpdateData(mediaItem, options);
        } catch (error) {
          if (error instanceof Error && 'status' in error) {
            apiError = error as ApiError;
            
            // Report API status if there's a rate limit issue
            if (apiError.status === 429 || apiError.message.includes('rate limit') || apiError.message.includes('limit exceeded')) {
              progress.apiStatus = {
                source: 'API',
                status: 'rate-limited',
                message: apiError.message,
                retryAfter: this.rateLimitInfo.resetTime ? 
                  Math.max(0, Math.ceil((this.rateLimitInfo.resetTime.getTime() - Date.now()) / 1000)) : 
                  undefined
              };
              onProgress?.(progress);
            }
          }
        }
        
        if (updateData) {
          // Report successful API fetch
          if (updateData.source) {
            progress.apiStatus = {
              source: updateData.source,
              status: 'active',
              message: `Successfully fetched from ${updateData.source}`
            };
            onProgress?.(progress);
          }
          
          // Analyze what changes should be made
          const changes = this.analyzeChanges(mediaItem, updateData, options);
          
          if (changes) {
            // Apply the update with proper field mapping
            const updateFields: Record<string, string | number | undefined> = {};
            if (changes.title) updateFields.DisplayName = changes.title;
            if (changes.description) updateFields.Description = changes.description;

            // Cover image update logic
            console.log('[processBulkUpdate] options:', options, 'changes:', changes);
            if (changes.coverImageUrl) {
              if (options.coverImageMode === 'binary' && !isPreview) {
                // Download, resize, and upload as binary (only during final processing)
                try {
                  console.log('[MediaUpdateService] Binary cover image mode selected for', mediaItem.DisplayName, changes.coverImageUrl);
                  const blob = await resizeImageToDefault(changes.coverImageUrl);
                  console.log('[MediaUpdateService] Resized image blob for', mediaItem.DisplayName, blob);
                  await uploadCoverImageBinary(mediaItem.Id, blob);
                  console.log('[MediaUpdateService] uploadCoverImageBinary called for', mediaItem.DisplayName, mediaItem.Id);
                  // Clear CoverImageUrl field if storing as binary only
                  updateFields.CoverImageUrl = '';
                  // Mark as a change even if no other fields are updated
                  if (!changes.title && !changes.description) {
                    changes._binaryCoverImageUploaded = true;
                  }
                } catch (e) {
                  console.error('Failed to upload cover image as binary:', e);
                  // fallback: set URL if binary upload fails
                  updateFields.CoverImageUrl = changes.coverImageUrl;
                }
              } else {
                // For preview or URL mode, just set the URL
                updateFields.CoverImageUrl = changes.coverImageUrl;
              }
            }

            console.log(`📝 Applying changes to "${mediaItem.DisplayName}":`, changes);
            console.log(`🔄 Update fields:`, updateFields);

            // Only apply database updates if this is NOT a preview
            if (!isPreview) {
              await MediaLibraryService.updateMediaItem(mediaItem.Id, updateFields);
            } else {
              console.log(`[processBulkUpdate] Preview mode - skipping database update for "${mediaItem.DisplayName}"`);
            }

            results.push({
              mediaItem,
              updateData: changes,
              hasChanges: true
            });
          } else {
            results.push({
              mediaItem,
              updateData: null,
              hasChanges: false
            });
          }
        } else {
          results.push({
            mediaItem,
            updateData: null,
            error: 'No data found',
            hasChanges: false
          });
        }
      } catch (error) {
        results.push({
          mediaItem,
          updateData: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          hasChanges: false
        });
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return results;
  }

  /**
   * Validate that the returned content actually matches what we're looking for
   */
  private static validateContentMatch(data: MediaUpdateData, expectedTitle: string): boolean {
    if (!data.title || !expectedTitle) return false;

    const normalizedExpected = expectedTitle.toLowerCase().trim();
    const normalizedActual = data.title.toLowerCase().trim();

    // Exact match
    if (normalizedActual === normalizedExpected) return true;

    // Check if the actual title is contained in expected (for series episodes/specials)
    if (normalizedExpected.includes(normalizedActual)) return true;

    // Check if the expected title starts with the actual title (for base series)
    if (normalizedExpected.startsWith(normalizedActual)) return true;

    // Check for common patterns like "Series: Episode" vs "Series"
    const expectedBase = normalizedExpected.split(':')[0].trim();
    if (normalizedActual === expectedBase) return true;

    // Check for year variations
    const yearPattern = /\(\d{4}\)/;
    const expectedWithoutYear = normalizedExpected.replace(yearPattern, '').trim();
    const actualWithoutYear = normalizedActual.replace(yearPattern, '').trim();
    if (expectedWithoutYear === actualWithoutYear) return true;

    return false;
  }

  /**
   * Retry helper with exponential backoff for rate limited requests
   */
  private static async retryWithBackoff<T>(
    operation: () => Promise<T>,
    source: DataSourceType,
    maxRetries: number = 3
  ): Promise<T> {
    let lastError: Error | null = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Check if we're currently rate limited
        const limitInfo = this.rateLimitState.get(source);
        if (limitInfo?.isLimited) {
          const waitTime = limitInfo.retryAfter || Math.pow(2, attempt - 1) * 1000;
          console.log(`⏱️ Rate limited on ${source.toUpperCase()}, waiting ${waitTime}ms before retry ${attempt}/${maxRetries}`);
          await this.delay(waitTime);
        }

        const result = await operation();
        
        // Clear rate limit state on success
        this.rateLimitState.delete(source);
        return result;
        
      } catch (error) {
        lastError = error as Error;
        const apiError = error as ApiError;
        
        // Check if this is a rate limit error
        if (this.isRateLimitError(apiError, source)) {
          const retryAfter = this.extractRetryAfter(apiError, source) || Math.pow(2, attempt) * 1000;
          
          this.rateLimitState.set(source, {
            isLimited: true,
            retryAfter,
            source,
            resetTime: new Date(Date.now() + retryAfter)
          });
          
          console.log(`🚫 Rate limit hit on ${source.toUpperCase()}, attempt ${attempt}/${maxRetries}, waiting ${retryAfter}ms`);
          
          if (attempt < maxRetries) {
            await this.delay(retryAfter);
            continue;
          }
        }
        
        // For non-rate-limit errors, don't retry
        if (!this.isRateLimitError(apiError, source)) {
          throw error;
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Check if an error is due to rate limiting
   */
  private static isRateLimitError(error: ApiError, source: DataSourceType): boolean {
    if (!error.status) return false;
    
    switch (source) {
      case DataSource.OMDB:
        return error.status === 401 || error.message?.includes('daily limit exceeded');
      case DataSource.TMDB:
        return error.status === 429;
      case DataSource.TRAKT:
        return error.status === 420 || error.status === 429;
      default:
        return error.status === 429 || error.status === 420;
    }
  }

  /**
   * Extract retry-after time from API response
   */
  private static extractRetryAfter(error: ApiError, source: DataSourceType): number | null {
    // Some APIs include retry-after in headers or error messages
    if (error.rateLimitInfo?.retryAfter) {
      return error.rateLimitInfo.retryAfter * 1000; // Convert to milliseconds
    }
    
    // Default backoff times by source
    switch (source) {
      case DataSource.OMDB:
        return 24 * 60 * 60 * 1000; // 24 hours for daily limit
      case DataSource.TMDB:
        return 10 * 1000; // 10 seconds
      case DataSource.TRAKT:
        return 60 * 1000; // 1 minute
      default:
        return 60 * 1000; // 1 minute default
    }
  }

  /**
   * Simple delay helper
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get current rate limit status for all sources
   */
  static getRateLimitStatus(): Map<DataSourceType, RateLimitInfo> {
    return new Map(this.rateLimitState);
  }

}
