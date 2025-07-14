import { MediaLibraryService } from './mediaLibraryService';
import type { MediaItem } from './mediaLibraryService';

export interface MediaUpdateData {
  title?: string;
  description?: string;
  coverImageUrl?: string;
  releaseDate?: string;
  runtime?: number;
  genres?: string[];
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
}

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
  static async fetchUpdateData(mediaItem: MediaItem): Promise<MediaUpdateData | null> {
    try {
      console.log('Fetching update data for:', mediaItem.DisplayName);
      
      // Parse external links if available
      const externalLinks = this.parseExternalLinks(mediaItem.ExternalLinks);
      
      // Try different sources in order of preference
      const sources = [
        { source: DataSource.IMDB, url: externalLinks.imdb },
        { source: DataSource.TVDB, url: externalLinks.tvdb },
        { source: DataSource.TMDB, url: externalLinks.tmdb },
        { source: DataSource.OMDB, url: externalLinks.omdb },
        { source: DataSource.TRAKT, url: externalLinks.trakt }
      ];

      // Try each source that has a URL
      for (const { source, url } of sources) {
        if (url) {
          console.log(`Trying ${source.toUpperCase()} for ${mediaItem.DisplayName}`);
          const data = await this.fetchFromSource(source, url, mediaItem);
          if (data) {
            console.log(`Successfully fetched data from ${source.toUpperCase()}`);
            return { ...data, source: source.toUpperCase() };
          }
        }
      }

      // If no external links, try searching by title
      if (mediaItem.DisplayName) {
        console.log(`No external links found, trying search for: ${mediaItem.DisplayName}`);
        return await this.searchByTitle(mediaItem.DisplayName, mediaItem.MediaType);
      }

      return null;

    } catch (error) {
      console.error('Error fetching update data for media item:', mediaItem.Id, error);
      return null;
    }
  }

  /**
   * Fetch data from a specific source using its URL or ID
   */
  private static async fetchFromSource(
    source: DataSourceType, 
    url: string, 
    mediaItem: MediaItem
  ): Promise<MediaUpdateData | null> {
    try {
      switch (source) {
        case DataSource.IMDB:
          return await this.fetchFromIMDb(url);
        case DataSource.TVDB:
          return await this.fetchFromTVDB(url);
        case DataSource.TMDB:
          return await this.fetchFromTMDB(url, mediaItem);
        case DataSource.OMDB:
          return await this.fetchFromOMDb(url);
        case DataSource.TRAKT:
          return await this.fetchFromTrakt(url);
        default:
          return null;
      }
    } catch (error) {
      console.error(`Error fetching from ${source}:`, error);
      return null;
    }
  }

  /**
   * Fetch data from IMDb using web scraping (since IMDb doesn't have public API)
   */
  private static async fetchFromIMDb(url: string): Promise<MediaUpdateData | null> {
    try {
      // Extract IMDb ID from URL
      const imdbId = this.extractIMDbId(url);
      if (!imdbId) return null;

      console.log(`Fetching IMDb data for ID: ${imdbId}`);
      
      // Use OMDb API with IMDb ID (free alternative to direct IMDb scraping)
      return await this.fetchFromOMDbAPI(imdbId);

    } catch (error) {
      console.error('Error fetching from IMDb:', error);
      return null;
    }
  }

  /**
   * Fetch data from OMDb API (free IMDb data)
   */
  private static async fetchFromOMDb(url: string): Promise<MediaUpdateData | null> {
    const imdbId = this.extractIMDbId(url) || url;
    return await this.fetchFromOMDbAPI(imdbId);
  }

  /**
   * Fetch data from OMDb API using IMDb ID
   */
  private static async fetchFromOMDbAPI(imdbId: string): Promise<MediaUpdateData | null> {
    try {
      // OMDb API is free but requires an API key
      // For development, we can use the free tier with limited requests
      // Users would need to get their own API key from http://www.omdbapi.com/
      
      const apiKey = import.meta.env.VITE_OMDB_API_KEY || 'demo'; // You'll need to set this
      const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${apiKey}&plot=full`);
      
      if (!response.ok) {
        throw new Error(`OMDb API error: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.Response === 'False') {
        console.log('OMDb API returned error:', data.Error);
        return null;
      }

      return {
        title: data.Title,
        description: data.Plot !== 'N/A' ? data.Plot : undefined,
        coverImageUrl: data.Poster !== 'N/A' ? data.Poster : undefined,
        releaseDate: data.Released !== 'N/A' ? data.Released : undefined,
        runtime: data.Runtime !== 'N/A' ? parseInt(data.Runtime) : undefined,
        genres: data.Genre !== 'N/A' ? data.Genre.split(', ') : undefined
      };

    } catch (error) {
      console.error('Error fetching from OMDb API:', error);
      return null;
    }
  }

  /**
   * Fetch data from TMDB (The Movie Database) - free API
   */
  private static async fetchFromTMDB(url: string, mediaItem: MediaItem): Promise<MediaUpdateData | null> {
    try {
      const tmdbId = this.extractTMDBId(url);
      if (!tmdbId) return null;

      const apiKey = import.meta.env.VITE_TMDB_API_KEY;
      if (!apiKey) {
        console.log('TMDB API key not configured');
        return null;
      }

      const mediaType = mediaItem.MediaType?.toLowerCase() === 'movie' ? 'movie' : 'tv';
      const response = await fetch(
        `https://api.themoviedb.org/3/${mediaType}/${tmdbId}?api_key=${apiKey}&language=en-US`
      );
      
      if (!response.ok) {
        throw new Error(`TMDB API error: ${response.status}`);
      }

      const data = await response.json();

      return {
        title: data.title || data.name,
        description: data.overview,
        coverImageUrl: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : undefined,
        releaseDate: data.release_date || data.first_air_date,
        runtime: data.runtime || data.episode_run_time?.[0],
        genres: data.genres?.map((g: { name: string }) => g.name)
      };

    } catch (error) {
      console.error('Error fetching from TMDB:', error);
      return null;
    }
  }

  /**
   * Fetch data from TVDB - requires API key
   */
  private static async fetchFromTVDB(_url: string): Promise<MediaUpdateData | null> {
    try {
      // TVDB API requires authentication, which is more complex
      // For now, we'll just log that it's not implemented
      console.log('TVDB integration not yet implemented - requires complex authentication');
      return null;

    } catch (error) {
      console.error('Error fetching from TVDB:', error);
      return null;
    }
  }

  /**
   * Fetch data from Trakt (production only)
   */
  private static async fetchFromTrakt(_url: string): Promise<MediaUpdateData | null> {
    try {
      // Use existing Trakt integration if available
      console.log('Trakt integration available only in production environment');
      return null;

    } catch (error) {
      console.error('Error fetching from Trakt:', error);
      return null;
    }
  }

  /**
   * Search for media by title when no external links are available
   */
  private static async searchByTitle(title: string, mediaType?: string): Promise<MediaUpdateData | null> {
    try {
      // Clean title for search
      const cleanTitle = this.cleanTitleForSearch(title);
      const year = this.extractYearFromTitle(title);

      console.log(`Searching for: "${cleanTitle}" (${year || 'no year'})`);

      // Try OMDb API search first (free)
      const omdbResult = await this.searchOMDbAPI(cleanTitle, year || undefined, mediaType);
      if (omdbResult) return omdbResult;

      // Try TMDB search if API key is available
      const tmdbResult = await this.searchTMDBAPI(cleanTitle, year || undefined, mediaType);
      if (tmdbResult) return tmdbResult;

      return null;

    } catch (error) {
      console.error('Error searching by title:', error);
      return null;
    }
  }

  /**
   * Search OMDb API by title
   */
  private static async searchOMDbAPI(title: string, year?: number, mediaType?: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = import.meta.env.VITE_OMDB_API_KEY || 'demo';
      let searchUrl = `https://www.omdbapi.com/?s=${encodeURIComponent(title)}&apikey=${apiKey}`;
      
      if (year) searchUrl += `&y=${year}`;
      if (mediaType?.toLowerCase() === 'movie') searchUrl += '&type=movie';
      if (mediaType?.toLowerCase() === 'tv show') searchUrl += '&type=series';

      const response = await fetch(searchUrl);
      if (!response.ok) return null;

      const searchData = await response.json();
      if (searchData.Response === 'False' || !searchData.Search?.[0]) return null;

      // Get details for the first result
      const firstResult = searchData.Search[0];
      return await this.fetchFromOMDbAPI(firstResult.imdbID);

    } catch (error) {
      console.error('Error searching OMDb:', error);
      return null;
    }
  }

  /**
   * Search TMDB API by title
   */
  private static async searchTMDBAPI(title: string, year?: number, mediaType?: string): Promise<MediaUpdateData | null> {
    try {
      const apiKey = import.meta.env.VITE_TMDB_API_KEY;
      if (!apiKey) return null;

      const searchType = mediaType?.toLowerCase() === 'movie' ? 'movie' : 'tv';
      let searchUrl = `https://api.themoviedb.org/3/search/${searchType}?api_key=${apiKey}&query=${encodeURIComponent(title)}`;
      
      if (year) searchUrl += `&year=${year}`;

      const response = await fetch(searchUrl);
      if (!response.ok) return null;

      const searchData = await response.json();
      if (!searchData.results?.[0]) return null;

      const firstResult = searchData.results[0];
      
      return {
        title: firstResult.title || firstResult.name,
        description: firstResult.overview,
        coverImageUrl: firstResult.poster_path ? `https://image.tmdb.org/t/p/w500${firstResult.poster_path}` : undefined,
        releaseDate: firstResult.release_date || firstResult.first_air_date,
        source: 'TMDB'
      };

    } catch (error) {
      console.error('Error searching TMDB:', error);
      return null;
    }
  }

  // Helper methods for parsing external links and extracting IDs
  private static parseExternalLinks(externalLinksJson?: string): Record<string, string> {
    if (!externalLinksJson) return {};
    try {
      return JSON.parse(externalLinksJson);
    } catch {
      return {};
    }
  }

  private static extractIMDbId(url: string): string | null {
    const match = url.match(/imdb\.com\/title\/(tt\d+)/);
    return match ? match[1] : null;
  }

  private static extractTMDBId(url: string): string | null {
    const match = url.match(/themoviedb\.org\/(?:movie|tv)\/(\d+)/);
    return match ? match[1] : null;
  }

  private static extractYearFromTitle(title: string): number | null {
    const match = title.match(/\((\d{4})\)/);
    return match ? parseInt(match[1]) : null;
  }

  private static cleanTitleForSearch(title: string): string {
    // Remove year and other noise from title for better search
    return title.replace(/\(\d{4}\)/, '').trim();
  }

  /**
   * Analyze what would change for a media item given update data and options
   */
  static analyzeChanges(
    mediaItem: MediaItem, 
    updateData: MediaUpdateData, 
    options: UpdateOptions
  ): { hasChanges: boolean; changes: Partial<MediaUpdateData> } {
    const changes: Partial<MediaUpdateData> = {};
    let hasChanges = false;

    // Check title changes
    if (options.updateTitles && updateData.title) {
      const shouldUpdate = options.onlyMissing 
        ? !mediaItem.DisplayName || mediaItem.DisplayName.trim() === ''
        : true;
      
      if (shouldUpdate && updateData.title !== mediaItem.DisplayName) {
        changes.title = updateData.title;
        hasChanges = true;
      }
    }

    // Check description changes
    if (options.updateDescriptions && updateData.description) {
      const shouldUpdate = options.onlyMissing 
        ? !mediaItem.Description || mediaItem.Description.trim() === ''
        : true;
      
      if (shouldUpdate && updateData.description !== mediaItem.Description) {
        changes.description = updateData.description;
        hasChanges = true;
      }
    }

    // Check cover image changes
    if (options.updateCoverImages && updateData.coverImageUrl) {
      const shouldUpdate = options.onlyMissing 
        ? !mediaItem.CoverImageUrl || mediaItem.CoverImageUrl.trim() === ''
        : true;
      
      if (shouldUpdate && updateData.coverImageUrl !== mediaItem.CoverImageUrl) {
        changes.coverImageUrl = updateData.coverImageUrl;
        hasChanges = true;
      }
    }

    return { hasChanges, changes };
  }

  /**
   * Apply updates to a media item
   */
  static async applyUpdate(mediaItem: MediaItem, changes: Partial<MediaUpdateData>): Promise<void> {
    const updateData: Partial<MediaItem> = {};

    if (changes.title) updateData.DisplayName = changes.title;
    if (changes.description) updateData.Description = changes.description;
    if (changes.coverImageUrl) updateData.CoverImageUrl = changes.coverImageUrl;
    if (changes.releaseDate) updateData.ReleaseDate = changes.releaseDate;
    if (changes.runtime) updateData.Duration = changes.runtime;
    if (changes.genres) updateData.Genre = changes.genres.join(', ');

    await MediaLibraryService.updateMediaItem(mediaItem.Id, updateData);
  }

  /**
   * Process bulk updates for multiple media items
   */
  static async processBulkUpdate(
    mediaItems: MediaItem[],
    options: UpdateOptions,
    onProgress?: (current: number, total: number, item: MediaItem) => void
  ): Promise<MediaUpdateResult[]> {
    const results: MediaUpdateResult[] = [];

    for (let i = 0; i < mediaItems.length; i++) {
      const mediaItem = mediaItems[i];
      
      if (onProgress) {
        onProgress(i + 1, mediaItems.length, mediaItem);
      }

      try {
        // Fetch update data
        const updateData = await this.fetchUpdateData(mediaItem);
        
        if (!updateData) {
          results.push({
            mediaItem,
            updateData: null,
            error: 'No data found on Trakt',
            hasChanges: false
          });
          continue;
        }

        // Analyze changes
        const { hasChanges, changes } = this.analyzeChanges(mediaItem, updateData, options);

        results.push({
          mediaItem,
          updateData: changes,
          hasChanges
        });

      } catch (error) {
        results.push({
          mediaItem,
          updateData: null,
          error: error instanceof Error ? error.message : 'Unknown error',
          hasChanges: false
        });
      }
    }

    return results;
  }

  /**
   * Apply bulk updates after user confirmation
   */
  static async applyBulkUpdates(
    results: MediaUpdateResult[],
    onProgress?: (current: number, total: number, item: MediaItem) => void
  ): Promise<{ success: number; failed: number; errors: string[] }> {
    const itemsToUpdate = results.filter(r => r.hasChanges && r.updateData);
    let success = 0;
    let failed = 0;
    const errors: string[] = [];

    for (let i = 0; i < itemsToUpdate.length; i++) {
      const result = itemsToUpdate[i];
      
      if (onProgress) {
        onProgress(i + 1, itemsToUpdate.length, result.mediaItem);
      }

      try {
        await this.applyUpdate(result.mediaItem, result.updateData!);
        success++;
      } catch (error) {
        failed++;
        const errorMsg = `${result.mediaItem.DisplayName}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        errors.push(errorMsg);
      }
    }

    return { success, failed, errors };
  }
}
