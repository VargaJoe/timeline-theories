import { MediaLibraryService } from './mediaLibraryService';
import type { MediaItem } from './mediaLibraryService';

export interface MediaUpdateData {
  title?: string;
  description?: string;
  coverImageUrl?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
  source?: string; // Which source was used for the data
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

export class MediaUpdateService {
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
        const data = await this.fetchFromSource(source, identifier, mediaItem);
        if (data) {
          console.log(`Successfully fetched data from ${source.toUpperCase()}`);
          return { ...data, source: source.toUpperCase() };
        } else {
          console.log(`${source.toUpperCase()} returned no data for ID: ${identifier}`);
        }
      }

      // If external IDs fail, try searching by title with preferred sources
      if (mediaItem.DisplayName) {
        console.log(`External IDs failed, trying title search for: ${mediaItem.DisplayName}`);
        const titleResult = await this.searchByTitle(mediaItem.DisplayName, mediaItem.MediaType, preferredSources);
        if (titleResult) {
          return titleResult;
        }
      }

      // If title search fails, try extracting the base series name for broader search
      if (mediaItem.DisplayName && mediaItem.DisplayName.includes(':')) {
        const baseName = mediaItem.DisplayName.split(':')[0].trim();
        console.log(`Specific title failed, trying base series search for: ${baseName}`);
        const baseResult = await this.searchByTitle(baseName, mediaItem.MediaType, preferredSources);
        if (baseResult) {
          // Mark that this is a fallback result
          return { ...baseResult, title: mediaItem.DisplayName, source: `${baseResult.source} (Series Match)` };
        }
      }

      return null;

    } catch (error) {
      console.error('Error fetching update data for media item:', mediaItem.Id, error);
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
        data = await this.fetchFromTMDB(identifier, mediaItem.MediaType);
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
   * Fetch from OMDb API using IMDb ID
   */
  private static async fetchFromOMDb(imdbId: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = import.meta.env.VITE_OMDB_API_KEY;
      if (!apiKey) {
        console.warn('OMDb API key not configured');
        return null;
      }

      // Ensure IMDb ID has proper format
      const formattedId = imdbId.startsWith('tt') ? imdbId : `tt${imdbId}`;
      
      const response = await fetch(`https://www.omdbapi.com/?i=${formattedId}&apikey=${apiKey}&plot=full`);
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
      console.error('Error fetching from OMDb:', error);
      return null;
    }
  }

  /**
   * Search OMDb by title
   */
  private static async searchOMDbByTitle(title: string, mediaType?: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = import.meta.env.VITE_OMDB_API_KEY;
      if (!apiKey) return null;

      // Clean title (remove year if present)
      const cleanTitle = title.replace(/\s*\(\d{4}\)$/, '');
      
      // Extract year if present
      const yearMatch = title.match(/\((\d{4})\)$/);
      const year = yearMatch ? yearMatch[1] : '';

      // Map media type
      let type = '';
      if (mediaType?.toLowerCase().includes('movie') || mediaType?.toLowerCase().includes('film')) {
        type = '&type=movie';
      } else if (mediaType?.toLowerCase().includes('tv') || mediaType?.toLowerCase().includes('series')) {
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
   * Fetch from TMDB API
   */
  private static async fetchFromTMDB(tmdbId: string, mediaType?: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = import.meta.env.VITE_TMDB_API_KEY;
      if (!apiKey) {
        console.warn('TMDB API key not configured');
        return null;
      }

      console.log(`Attempting to fetch TMDB ID: ${tmdbId} with mediaType: ${mediaType}`);

      // Try different content types based on media type or try both
      const typesToTry = [];
      
      if (mediaType?.toLowerCase().includes('movie') || mediaType?.toLowerCase().includes('film')) {
        typesToTry.push('movie');
      } else if (mediaType?.toLowerCase().includes('tv') || mediaType?.toLowerCase().includes('series') || mediaType?.toLowerCase().includes('episode')) {
        typesToTry.push('tv');
      } else {
        // Unknown type, try both
        typesToTry.push('movie', 'tv');
      }

      for (const type of typesToTry) {
        console.log(`Trying TMDB ${type} endpoint for ID: ${tmdbId}`);
        
        const response = await fetch(`https://api.themoviedb.org/3/${type}/${tmdbId}?api_key=${apiKey}`);
        
        if (response.ok) {
          const data = await response.json();
          
          if (data.id) {
            console.log(`Successfully fetched from TMDB ${type}:`, data.title || data.name);
            return {
              title: data.title || data.name,
              description: data.overview,
              coverImageUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
              releaseDate: data.release_date || data.first_air_date,
              runtime: data.runtime || data.episode_run_time?.[0],
              genres: data.genres?.map((g: { name: string }) => g.name)
            };
          }
        } else {
          console.log(`TMDB ${type} endpoint returned ${response.status} for ID: ${tmdbId}`);
        }
      }

      console.log(`No data found on TMDB for ID: ${tmdbId}`);
      return null;
    } catch (error) {
      console.error('Error fetching from TMDB:', error);
      return null;
    }
  }

  /**
   * Search TMDB by title
   */
  private static async searchTMDBByTitle(title: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = import.meta.env.VITE_TMDB_API_KEY;
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
   * Fetch from Trakt API (placeholder - requires proper API integration)
   */
  private static async fetchFromTrakt(traktSlug: string): Promise<MediaUpdateData | null> {
    // This would require proper Trakt API integration
    console.log('Trakt integration not yet implemented for:', traktSlug);
    return null;
  }

  /**
   * Analyze what changes would be made to a media item
   */
  static analyzeChanges(mediaItem: MediaItem, updateData: MediaUpdateData, options: UpdateOptions): MediaUpdateData | null {
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
      
      if (shouldUpdate && updateData.coverImageUrl !== mediaItem.CoverImageUrl) {
        changes.coverImageUrl = updateData.coverImageUrl;
        hasChanges = true;
      }
    }

    // Copy source info
    if (updateData.source) {
      changes.source = updateData.source;
    }

    return hasChanges ? changes : null;
  }

  /**
   * Process bulk update for multiple media items
   */
  static async processBulkUpdate(
    mediaItems: MediaItem[], 
    options: UpdateOptions,
    onProgress?: (current: number, total: number, currentItem: string) => void
  ): Promise<MediaUpdateResult[]> {
    const results: MediaUpdateResult[] = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const mediaItem = mediaItems[i];
      
      onProgress?.(i + 1, mediaItems.length, mediaItem.DisplayName || 'Unknown');

      try {
        // Fetch update data
        const updateData = await this.fetchUpdateData(mediaItem, options);
        
        if (updateData) {
          // Analyze what changes should be made
          const changes = this.analyzeChanges(mediaItem, updateData, options);
          
          if (changes) {
            // Apply the update with proper field mapping
            const updateFields: Record<string, string | number | undefined> = {};
            if (changes.title) updateFields.DisplayName = changes.title;
            if (changes.description) updateFields.Description = changes.description;
            if (changes.coverImageUrl) updateFields.CoverImageUrl = changes.coverImageUrl;
            
            console.log(`📝 Applying changes to "${mediaItem.DisplayName}":`, changes);
            console.log(`🔄 Update fields:`, updateFields);
            
            await MediaLibraryService.updateMediaItem(mediaItem.Id, updateFields);
            
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

}
